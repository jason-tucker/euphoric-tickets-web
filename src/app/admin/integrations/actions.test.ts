// Sudo integration management (plan §4.2 / §4.5 save-time SSRF policy).
// requireSudo is mocked (the session layer is out of scope); everything else
// runs against the scratch DB. Requires TEST_DATABASE_URL.

import { eq } from 'drizzle-orm'
import { beforeEach, expect, it, vi } from 'vitest'
import { db } from '@/db/client'
import { integrationAudit, integrations, integrationWebhookAllowlist, ticketCategories } from '@/db/schema'
import { apiRequest, describeDb, makeBusiness, makeCategory, makeIntegrationTicket, makeUser, rand, resetLimiters } from '@/test/fixtures'
import { handleGetTicket } from '@/server/integrations/api'
import { decryptSecret } from '@/server/integrations/crypto'
import { allowlistRowSchema, parseLinkOrigin, readSettingsForm } from '@/server/integrations/adminValidation'

const sudo = vi.hoisted(() => ({ userId: null as string | null }))
vi.mock('@/server/sudo', () => ({
  requireSudo: async () => {
    if (!sudo.userId) throw new Error('NEXT_REDIRECT')
    return { user: { id: sudo.userId } }
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const actions = await import('./actions')

function form(entries: Record<string, string | string[]>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x)
  return f
}

it('parses link origins strictly', () => {
  expect(parseLinkOrigin('https://music.euphoric.fm')).toBe('https://music.euphoric.fm')
  expect(parseLinkOrigin('https://music.euphoric.fm/')).toBe('https://music.euphoric.fm')
  for (const bad of ['http://music.euphoric.fm', 'https://music.euphoric.fm/x', 'https://u:p@music.euphoric.fm', 'nope']) {
    expect(parseLinkOrigin(bad), bad).toBeNull()
  }
  expect(readSettingsForm(form({ name: 'x', linkOrigin: 'https://a.test/path' })).linkOrigin).toBe('__invalid__')
})

it('validates allowlist rows', () => {
  const ok = { scheme: 'http', host: 'music-web', port: '6096', path: '/api/hooks/tickets', expectedNetworkCidr: '172.30.40.0/24' }
  expect(allowlistRowSchema.safeParse(ok).success).toBe(true)
  for (const over of [
    { scheme: 'ftp' },
    { host: 'bad host' },
    { port: '70000' },
    { path: 'api/hooks' },
    { path: '/api?x=1' },
    { expectedNetworkCidr: '0.0.0.0/0' },
    { expectedNetworkCidr: '127.0.0.0/24' },
  ]) {
    expect(allowlistRowSchema.safeParse({ ...ok, ...over }).success, JSON.stringify(over)).toBe(false)
  }
})

describeDb('admin integration actions', () => {
  beforeEach(async () => {
    resetLimiters()
    sudo.userId = (await makeUser()).id
  })

  it('refuses everything without sudo', async () => {
    sudo.userId = null
    await expect(actions.createIntegrationAction(null, form({}))).rejects.toThrow('NEXT_REDIRECT')
  })

  it('creates an integration, shows the key + secret once, stores only hash + ciphertext, and audits no secrets', async () => {
    const biz = await makeBusiness()
    await makeCategory(biz.id, 'newsong')
    const opener = await makeUser()
    const slug = rand('efm')
    const res = await actions.createIntegrationAction(
      null,
      form({
        businessId: biz.id,
        name: 'EFM Music',
        slug,
        scopes: ['tickets:read', 'tickets:write'],
        allowedCategoryKeys: 'newsong',
        linkOrigin: 'https://music.test',
        actorImpersonation: 'on',
      }),
    )
    expect(res?.ok).toBe(true)
    if (!res?.ok) return
    const [key, secret] = res.items.map((i) => i.value)
    expect(key).toMatch(/^etk\.[0-9A-Za-z]{10}\.[0-9A-Za-z]{43}$/)

    const [row] = await db.select().from(integrations).where(eq(integrations.id, res.id))
    expect(row).toMatchObject({ slug, scopes: ['tickets:read', 'tickets:write'], allowedCategoryKeys: ['newsong'], actorImpersonation: true })
    expect(JSON.stringify(row)).not.toContain(key!.split('.')[2])
    expect(JSON.stringify(row)).not.toContain(secret)
    expect(decryptSecret(row!.webhookSecretEnc!, row!.id)).toBe(secret)

    // The key works against the API…
    const t = await makeIntegrationTicket({ businessId: biz.id, integrationId: row!.id, openerUserId: opener.id })
    expect((await handleGetTicket(apiRequest('GET', '/x', { key }), String(t.id))).status).toBe(200)
    // …until rotated.
    const rotated = await actions.rotateKeyAction(row!.id)
    expect(rotated?.ok).toBe(true)
    const newKey = rotated?.ok ? rotated.items[0]!.value : ''
    expect((await handleGetTicket(apiRequest('GET', '/x', { key, ip: '10.1.1.1' }), String(t.id))).status).toBe(401)
    expect((await handleGetTicket(apiRequest('GET', '/x', { key: newKey }), String(t.id))).status).toBe(200)

    const audit = await db.select().from(integrationAudit).where(eq(integrationAudit.integrationId, row!.id))
    expect(audit.map((a) => a.action).sort()).toEqual(['integration.created', 'key.rotated'])
    const dump = JSON.stringify(audit)
    for (const s of [key!, newKey, secret!, key!.split('.')[2]!, newKey.split('.')[2]!]) expect(dump).not.toContain(s)

    // Duplicate slug and unknown category keys are refused.
    const dup = await actions.createIntegrationAction(null, form({ businessId: biz.id, name: 'x', slug, allowedCategoryKeys: '' }))
    expect(dup).toEqual({ ok: false, error: 'That slug is already in use.' })
    const badCat = await actions.createIntegrationAction(null, form({ businessId: biz.id, name: 'x', slug: rand('s'), allowedCategoryKeys: 'nope' }))
    expect(badCat?.ok).toBe(false)
  })

  it('refuses a non-allowlisted webhook URL at save, accepts an exact match, and clears it when the row goes', async () => {
    const biz = await makeBusiness()
    const created = await actions.createIntegrationAction(null, form({ businessId: biz.id, name: 'EFM', slug: rand('efm'), allowedCategoryKeys: '' }))
    if (!created?.ok) throw new Error('create failed')
    const id = created.id

    await expect(actions.setWebhookUrlAction(id, form({ webhookUrl: 'http://music-web:6096/api/hooks/tickets' }))).rejects.toThrow(/Refused/)
    await actions.addAllowlistAction(
      id,
      form({ scheme: 'http', host: 'music-web', port: '6096', path: '/api/hooks/tickets', expectedNetworkCidr: '172.30.40.0/24' }),
    )
    for (const miss of [
      'http://music-web:6097/api/hooks/tickets',
      'https://music-web:6096/api/hooks/tickets',
      'http://music-web:6096/api/hooks/tickets/x',
      'http://169.254.169.254/latest/meta-data',
      'http://music-web:6096/api/hooks/tickets?x=1',
    ]) {
      await expect(actions.setWebhookUrlAction(id, form({ webhookUrl: miss })), miss).rejects.toThrow()
    }
    await actions.setWebhookUrlAction(id, form({ webhookUrl: 'http://music-web:6096/api/hooks/tickets' }))
    let [row] = await db.select().from(integrations).where(eq(integrations.id, id))
    expect(row!.webhookUrl).toBe('http://music-web:6096/api/hooks/tickets')

    await actions.removeAllowlistAction(id, form({ scheme: 'http', host: 'music-web', port: '6096', path: '/api/hooks/tickets' }))
    ;[row] = await db.select().from(integrations).where(eq(integrations.id, id))
    expect(row!.webhookUrl).toBeNull()
    expect(await db.select().from(integrationWebhookAllowlist).where(eq(integrationWebhookAllowlist.integrationId, id))).toHaveLength(0)
  })

  it('toggles integration_only only for categories of the integration’s own team', async () => {
    const biz = await makeBusiness()
    const other = await makeBusiness()
    const own = await makeCategory(biz.id, 'songedit')
    const foreign = await makeCategory(other.id, 'songedit')
    const created = await actions.createIntegrationAction(null, form({ businessId: biz.id, name: 'EFM', slug: rand('efm'), allowedCategoryKeys: '' }))
    if (!created?.ok) throw new Error('create failed')
    await actions.setCategoryIntegrationOnlyAction(created.id, form({ categoryId: own.id, integrationOnly: 'true' }))
    await expect(actions.setCategoryIntegrationOnlyAction(created.id, form({ categoryId: foreign.id, integrationOnly: 'true' }))).rejects.toThrow()
    const [a] = await db.select().from(ticketCategories).where(eq(ticketCategories.id, own.id))
    const [b] = await db.select().from(ticketCategories).where(eq(ticketCategories.id, foreign.id))
    expect(a!.integrationOnly).toBe(true)
    expect(b!.integrationOnly).toBe(false)
  })

  it('disabling an integration makes its key stop authenticating', async () => {
    const biz = await makeBusiness()
    const opener = await makeUser()
    const created = await actions.createIntegrationAction(null, form({ businessId: biz.id, name: 'EFM', slug: rand('efm'), scopes: ['tickets:read'], allowedCategoryKeys: '' }))
    if (!created?.ok) throw new Error('create failed')
    const t = await makeIntegrationTicket({ businessId: biz.id, integrationId: created.id, openerUserId: opener.id })
    const key = created.items[0]!.value
    expect((await handleGetTicket(apiRequest('GET', '/x', { key }), String(t.id))).status).toBe(200)
    await actions.setEnabledAction(created.id, form({ enabled: 'false' }))
    expect((await handleGetTicket(apiRequest('GET', '/x', { key }), String(t.id))).status).toBe(401)
  })
})
