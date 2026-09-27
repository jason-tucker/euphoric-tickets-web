// DB-backed route tests for the Integration API (plan §6 "P1" checks that
// can run without Discord). Requires TEST_DATABASE_URL (a scratch Postgres);
// skipped otherwise. Network edges (bot, Discord) are faked.

import { and, eq, sql } from 'drizzle-orm'
import { beforeEach, expect, it, vi } from 'vitest'
import { db } from '@/db/client'
import { auditLogs, businesses, integrationAudit, integrations, ticketMessages, tickets } from '@/db/schema'
import {
  apiRequest,
  describeDb,
  fakeDeps,
  makeBusiness,
  makeCategory,
  makeIntegration,
  makeIntegrationTicket,
  makeUser,
  resetLimiters,
  snowflake,
  stateOf,
} from '@/test/fixtures'
import { DiscordHttpError } from '@/lib/discord'
import { BotUnavailableError } from './botClient'
import {
  handleGetTicket,
  handleGuildRoles,
  handleMember,
  handleOpenTicket,
  handlePatchTicket,
  handlePostMessage,
  staffRoleIdsForCategory,
} from './api'
import { RATE } from './rateLimit'

async function world() {
  const biz = await makeBusiness()
  const otherBiz = await makeBusiness()
  const cat = await makeCategory(biz.id, 'newsong', { integrationOnly: true, staffRoleIds: snowflake() })
  await makeCategory(otherBiz.id, 'newsong')
  const opener = await makeUser()
  const main = await makeIntegration(biz.id)
  const sibling = await makeIntegration(biz.id) // same team, different integration
  const foreign = await makeIntegration(otherBiz.id)
  const ticket = await makeIntegrationTicket({ businessId: biz.id, integrationId: main.integration.id, openerUserId: opener.id, categoryId: cat.id })
  const siblingTicket = await makeIntegrationTicket({ businessId: biz.id, integrationId: sibling.integration.id, openerUserId: opener.id, categoryId: cat.id })
  const plainTicket = await makeIntegrationTicket({ businessId: biz.id, integrationId: null, openerUserId: opener.id, categoryId: cat.id })
  const foreignTicket = await makeIntegrationTicket({ businessId: otherBiz.id, integrationId: foreign.integration.id, openerUserId: opener.id })
  return { biz, otherBiz, cat, opener, main, sibling, foreign, ticket, siblingTicket, plainTicket, foreignTicket }
}

const openBody = (over: Record<string, unknown> = {}) => ({
  categoryKey: 'newsong',
  openerDiscordId: snowflake(),
  subject: 'New songs from DJ X',
  card: { title: 'Batch #12', lines: ['Song #1: A', 'Song #2: B'], link: { label: 'Open in portal', url: 'https://music.test/batches/12' } },
  externalRef: `batch:${snowflake()}`,
  ...over,
})

describeDb('Integration API — auth', () => {
  beforeEach(resetLimiters)

  it('401s a missing, malformed, unknown-prefix, wrong-secret or disabled key', async () => {
    const w = await world()
    const path = `/api/v1/tickets/${w.ticket.id}`
    const wrongSecret = w.main.key.slice(0, -1) + (w.main.key.endsWith('A') ? 'B' : 'A')
    const unknownPrefix = `etk.ZZZZZZZZZZ.${w.main.key.split('.')[2]}`
    for (const key of [undefined, 'garbage', unknownPrefix, wrongSecret]) {
      const res = await handleGetTicket(apiRequest('GET', path, { key, ip: `1.1.1.${Math.floor(Math.random() * 200)}` }), String(w.ticket.id))
      expect(res.status, String(key)).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
    }
    await db.update(integrations).set({ enabled: false }).where(eq(integrations.id, w.main.integration.id))
    const res = await handleGetTicket(apiRequest('GET', path, { key: w.main.key }), String(w.ticket.id))
    expect(res.status).toBe(401)
  })

  it('brakes failing requests per bucket, but a valid key always succeeds even when its bucket is exhausted', async () => {
    const w = await world()
    const bad = 'etk.AAAAAAAAAA.' + 'A'.repeat(43)
    // Default (untrusted proxy headers): every failure shares one bucket, so
    // spoofing cf-connecting-ip / x-forwarded-for buys nothing.
    for (let i = 0; i < RATE.authFailuresPerBucket; i++) {
      const r = await handleGetTicket(
        apiRequest('GET', '/x', { key: bad, ip: `203.0.113.${i}`, headers: { 'cf-connecting-ip': `198.51.100.${i}` } }),
        '1',
      )
      expect(r.status).toBe(401)
    }
    const braked = await handleGetTicket(apiRequest('GET', '/x', { key: bad, ip: '192.0.2.1' }), '1')
    expect(braked.status).toBe(429)
    expect(Number(braked.headers.get('Retry-After'))).toBeGreaterThan(0)
    // Header-less requests are braked too (and cost no DB lookup).
    expect((await handleGetTicket(apiRequest('GET', '/x', {}), '1')).status).toBe(429)
    // The exploit scenario: the bucket is exhausted, yet the legitimate key works.
    const ok = await handleGetTicket(apiRequest('GET', '/x', { key: w.main.key, ip: '203.0.113.0' }), String(w.ticket.id))
    expect(ok.status).toBe(200)
  })

  it('with INTEGRATION_TRUST_PROXY_HEADERS: per-IP buckets, and a spoofed victim IP cannot lock the victim out', async () => {
    const w = await world()
    process.env.INTEGRATION_TRUST_PROXY_HEADERS = '1'
    try {
      const victim = '172.20.0.5'
      for (let i = 0; i < RATE.authFailuresPerBucket; i++) {
        expect((await handleGetTicket(apiRequest('GET', '/x', { ip: '10.0.0.66', headers: { 'cf-connecting-ip': victim } }), '1')).status).toBe(401)
      }
      expect((await handleGetTicket(apiRequest('GET', '/x', { ip: victim }), '1')).status).toBe(429)
      // Another bucket still gets plain 401s.
      expect((await handleGetTicket(apiRequest('GET', '/x', { ip: '172.20.0.6' }), '1')).status).toBe(401)
      // The victim's valid key is unaffected.
      expect((await handleGetTicket(apiRequest('GET', '/x', { key: w.main.key, ip: victim }), String(w.ticket.id))).status).toBe(200)
    } finally {
      delete process.env.INTEGRATION_TRUST_PROXY_HEADERS
    }
  })

  it('30k header-less failures from distinct IPs keep the failed-auth map ≤ cap with bounded per-hit work', async () => {
    process.env.INTEGRATION_TRUST_PROXY_HEADERS = '1'
    try {
      for (let i = 0; i < 30_000; i++) {
        const ip = `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`
        const r = await handleGetTicket(apiRequest('GET', '/x', { ip, headers: { 'cf-connecting-ip': ip } }), '1')
        if (r.status !== 401) throw new Error(`unexpected ${r.status} at ${i}`)
      }
      const lim = globalThis.__integrationLimiters!.authFail
      expect(lim.size).toBeLessThanOrEqual(RATE.authFailureMaxBuckets)
      expect(lim.stats.maxHitWork).toBeLessThanOrEqual(9)
    } finally {
      delete process.env.INTEGRATION_TRUST_PROXY_HEADERS
    }
  }, 60_000)

  it('audits auth failures sampled (≤1 row per bucket per minute, ≤10/min overall), never with key material', async () => {
    const w = await world()
    const count = async () => (await db.select({ id: integrationAudit.id }).from(integrationAudit).where(eq(integrationAudit.action, 'auth.failed'))).length
    const before = await count()
    const wrongSecret = w.main.key.slice(0, -1) + (w.main.key.endsWith('A') ? 'B' : 'A')
    for (let i = 0; i < 15; i++) {
      await handleGetTicket(apiRequest('GET', '/x', { key: i % 2 ? wrongSecret : undefined }), '1')
    }
    // Default mode: one shared bucket → one row for 15 failures.
    expect((await count()) - before).toBe(1)
    const rows = await db.select().from(integrationAudit).where(eq(integrationAudit.action, 'auth.failed'))
    const text = JSON.stringify(rows)
    expect(text).not.toContain('etk.')
    expect(text).not.toContain(w.main.key.split('.')[1]!) // not even the prefix
    expect(text).not.toContain(w.main.key.split('.')[2]!.slice(0, 20))

    // Trusted per-IP buckets: 40 distinct IPs still add at most 10 rows a minute.
    resetLimiters()
    process.env.INTEGRATION_TRUST_PROXY_HEADERS = '1'
    try {
      const mid = await count()
      for (let i = 0; i < 40; i++) await handleGetTicket(apiRequest('GET', '/x', { ip: `192.0.2.${i}` }), '1')
      expect((await count()) - mid).toBe(RATE.authAuditPerMinGlobal)
      const latest = await db.select().from(integrationAudit).where(eq(integrationAudit.action, 'auth.failed'))
      expect(latest.some((r) => (r.metadata as { bucket?: string; reason?: string }).bucket === '192.0.2.0')).toBe(true)
      expect(latest.every((r) => typeof (r.metadata as { reason?: unknown }).reason === 'string')).toBe(true)
    } finally {
      delete process.env.INTEGRATION_TRUST_PROXY_HEADERS
    }
  })

  it('rate-limits 60/min per key', async () => {
    const w = await world()
    for (let i = 0; i < RATE.perKeyPerMin; i++) {
      const r = await handleGetTicket(apiRequest('GET', '/x', { key: w.main.key }), String(w.ticket.id))
      expect(r.status).toBe(200)
    }
    const r = await handleGetTicket(apiRequest('GET', '/x', { key: w.main.key }), String(w.ticket.id))
    expect(r.status).toBe(429)
    // A different key is unaffected.
    const s = await handleGetTicket(apiRequest('GET', '/x', { key: w.sibling.key }), String(w.siblingTicket.id))
    expect(s.status).toBe(200)
  })

  it('404s /api/v1 unless the Host is an internal alias (public tunnel/Caddy Host, even with a valid key)', async () => {
    const w = await world()
    const deps = fakeDeps()
    for (const host of ['tickets.euphoric.fm', 'tickets.euphoric.gg', '127.0.0.1:16095']) {
      const headers = { host }
      const get = await handleGetTicket(apiRequest('GET', '/x', { key: w.main.key, headers }), String(w.ticket.id))
      expect(get.status, host).toBe(404)
      expect(await get.text()).toBe('')
      const open = await handleOpenTicket(apiRequest('POST', '/api/v1/tickets', { key: w.main.key, body: openBody(), headers }), deps)
      expect(open.status).toBe(404)
      const msg = await handlePostMessage(
        apiRequest('POST', '/x', { key: w.main.key, body: { kind: 'system', body: 'x' }, headers: { ...headers, 'idempotency-key': 'h1' } }),
        String(w.ticket.id),
        deps,
      )
      expect(msg.status).toBe(404)
      const roles = await handleGuildRoles(apiRequest('GET', '/x', { key: w.main.key, headers }), deps)
      expect(roles.status).toBe(404)
    }
    expect(deps.bot.openTicket).not.toHaveBeenCalled()
    expect(deps.calls.posts).toBe(0)
    // Rejected hosts are not counted as auth failures.
    expect(globalThis.__integrationLimiters?.authFail.size ?? 0).toBe(0)
    // The staging/local-test port works once added to INTERNAL_API_HOSTS.
    process.env.INTERNAL_API_HOSTS = 'tickets-web:3000,tickets-web,127.0.0.1:16095'
    try {
      const local = await handleGetTicket(apiRequest('GET', '/x', { key: w.main.key, headers: { host: '127.0.0.1:16095' } }), String(w.ticket.id))
      expect(local.status).toBe(200)
    } finally {
      delete process.env.INTERNAL_API_HOSTS
    }
    // The internal alias works.
    expect((await handleGetTicket(apiRequest('GET', '/x', { key: w.main.key }), String(w.ticket.id))).status).toBe(200)
  })

  it('403s a missing scope', async () => {
    const w = await world()
    await db.update(integrations).set({ scopes: ['guild:read'] }).where(eq(integrations.id, w.main.integration.id))
    const r = await handleGetTicket(apiRequest('GET', '/x', { key: w.main.key }), String(w.ticket.id))
    expect(r.status).toBe(403)
    expect((await r.json()).error).toBe('scope_missing')
  })
})

describeDb('Integration API — scoping', () => {
  beforeEach(resetLimiters)

  it('404s any cross-integration, cross-business, non-integration or unknown ticket on every /tickets/:id* route', async () => {
    const w = await world()
    const deps = fakeDeps()
    for (const t of [w.siblingTicket, w.foreignTicket, w.plainTicket]) {
      const id = String(t.id)
      expect((await handleGetTicket(apiRequest('GET', '/x', { key: w.main.key }), id)).status).toBe(404)
      expect(
        (await handlePatchTicket(apiRequest('PATCH', '/x', { key: w.main.key, body: { status: 'waiting' } }), id, deps)).status,
      ).toBe(404)
      expect(
        (
          await handlePostMessage(
            apiRequest('POST', '/x', { key: w.main.key, body: { kind: 'system', body: 'hi' }, headers: { 'idempotency-key': 'k1' } }),
            id,
            deps,
          )
        ).status,
      ).toBe(404)
    }
    for (const id of ['999999999', 'abc', '0', '-1']) {
      expect((await handleGetTicket(apiRequest('GET', '/x', { key: w.main.key }), id)).status).toBe(404)
    }
    expect(deps.calls.posts).toBe(0)
    // Foreign tickets were not touched.
    const [f] = await db.select().from(tickets).where(eq(tickets.id, w.foreignTicket.id))
    expect(f!.status).toBe('open')
  })

  it('returns the scoped ticket view', async () => {
    const w = await world()
    const staff = await makeUser()
    await db.update(tickets).set({ assigneeUserId: staff.id, status: 'in_progress' }).where(eq(tickets.id, w.ticket.id))
    const r = await handleGetTicket(apiRequest('GET', '/x', { key: w.main.key }), String(w.ticket.id))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({
      status: 'in_progress',
      claimedBy: staff.discordId,
      closedAt: null,
      webUrl: `https://tickets.test/b/${w.biz.slug}/tickets/${w.ticket.id}`,
      discordChannelUrl: `https://discord.com/channels/${w.biz.discordGuildId}/${w.ticket.discordChannelId}`,
    })
  })
})

describeDb('POST /api/v1/tickets (open)', () => {
  beforeEach(resetLimiters)

  it('validates the body strictly (422)', async () => {
    const w = await world()
    const deps = fakeDeps()
    const bad = [
      openBody({ subject: 'x'.repeat(101) }),
      openBody({ subject: '   ' }),
      openBody({ extra: 1 }),
      openBody({ openerDiscordId: 'nope' }),
      openBody({ externalRef: 'has space' }),
      openBody({ card: { title: 't', lines: Array(26).fill('l'), link: { label: 'l', url: 'https://music.test/' } } }),
      openBody({ card: { title: 't', lines: ['x'.repeat(201)], link: { label: 'l', url: 'https://music.test/' } } }),
      openBody({ card: { title: 't', lines: [], link: { label: 'x'.repeat(41), url: 'https://music.test/' } } }),
      // Discord's link-button limit is 512 characters (a 640-char URL used to half-open a ticket).
      openBody({ card: { title: 't', lines: [], link: { label: 'l', url: `https://music.test/${'a'.repeat(513 - 'https://music.test/'.length)}` } } }),
      // 512 raw characters, but longer once percent-encoded by URL normalisation.
      openBody({ card: { title: 't', lines: [], link: { label: 'l', url: `https://music.test/${'é'.repeat(200)}` } } }),
      // Within every per-field limit but over the bot's 16 KB body cap in UTF-8.
      openBody({ card: { title: 't', lines: Array(25).fill('♪'.repeat(200)), link: { label: 'l', url: 'https://music.test/' } } }),
    ]
    for (const body of bad) {
      resetLimiters() // more cases than the 10/min open limit
      const r = await handleOpenTicket(apiRequest('POST', '/api/v1/tickets', { key: w.main.key, body }), deps)
      expect(r.status).toBe(422)
    }
    const notJson = await handleOpenTicket(
      apiRequest('POST', '/api/v1/tickets', { key: w.main.key, body: '{', headers: { 'content-type': 'application/json' } }),
      deps,
    )
    expect(notJson.status).toBe(422)
    const huge = await handleOpenTicket(apiRequest('POST', '/api/v1/tickets', { key: w.main.key, body: 'x'.repeat(40_000) }), deps)
    expect(huge.status).toBe(413)
    expect(deps.bot.openTicket).not.toHaveBeenCalled()
  })

  it('accepts a card.link.url of exactly 512 characters', async () => {
    const w = await world()
    const url = `https://music.test/${'a'.repeat(512 - 'https://music.test/'.length)}`
    expect(url).toHaveLength(512)
    const body = openBody({ card: { title: 't', lines: [], link: { label: 'l', url } } })
    const created = await makeIntegrationTicket(
      { businessId: w.biz.id, integrationId: w.main.integration.id, openerUserId: w.opener.id, categoryId: w.cat.id },
      { externalRef: body.externalRef as string },
    )
    const deps = fakeDeps({ bot: { openTicket: vi.fn(async () => ({ ok: true as const, ticketId: created.id, channelId: created.discordChannelId!, created: true })) } })
    expect((await handleOpenTicket(apiRequest('POST', '/api/v1/tickets', { key: w.main.key, body }), deps)).status).toBe(201)
  })

  it('422s a card.link.url whose origin is not link_origin', async () => {
    const w = await world()
    const deps = fakeDeps()
    for (const url of ['https://music.test.evil.com/x', 'http://music.test/x', 'https://music.test:444/x', 'https://evil.com/?https://music.test']) {
      const body = openBody({ card: { title: 't', lines: [], link: { label: 'l', url } } })
      const r = await handleOpenTicket(apiRequest('POST', '/api/v1/tickets', { key: w.main.key, body }), deps)
      expect(r.status, url).toBe(422)
    }
    expect(deps.bot.openTicket).not.toHaveBeenCalled()
  })

  it('403s a category not allowlisted on the key or not in the key business', async () => {
    const w = await world()
    const deps = fakeDeps()
    await makeCategory(w.biz.id, 'support')
    let r = await handleOpenTicket(apiRequest('POST', '/api/v1/tickets', { key: w.main.key, body: openBody({ categoryKey: 'support' }) }), deps)
    expect(r.status).toBe(403)
    expect((await r.json()).error).toBe('category_forbidden')
    // Allowlisted key but the category only exists in ANOTHER business.
    await db.update(integrations).set({ allowedCategoryKeys: ['newsong', 'elsewhere'] }).where(eq(integrations.id, w.main.integration.id))
    await makeCategory(w.otherBiz.id, 'elsewhere')
    r = await handleOpenTicket(apiRequest('POST', '/api/v1/tickets', { key: w.main.key, body: openBody({ categoryKey: 'elsewhere' }) }), deps)
    expect(r.status).toBe(403)
    expect(deps.bot.openTicket).not.toHaveBeenCalled()
  })

  it('passes the §4.4 request to the bot and maps its answers', async () => {
    const w = await world()
    const body = openBody()
    const created = await makeIntegrationTicket(
      { businessId: w.biz.id, integrationId: w.main.integration.id, openerUserId: w.opener.id, categoryId: w.cat.id },
      { externalRef: body.externalRef as string },
    )
    const openTicket = vi.fn(async () => ({ ok: true as const, ticketId: created.id, channelId: created.discordChannelId!, created: true }))
    const deps = fakeDeps({ bot: { openTicket } })
    const r = await handleOpenTicket(apiRequest('POST', '/api/v1/tickets', { key: w.main.key, body }), deps)
    expect(r.status).toBe(201)
    expect(await r.json()).toEqual({
      ticketId: created.id,
      number: created.id,
      webUrl: `https://tickets.test/b/${w.biz.slug}/tickets/${created.id}`,
      discordChannelUrl: `https://discord.com/channels/${w.biz.discordGuildId}/${created.discordChannelId}`,
      created: true,
    })
    expect(openTicket).toHaveBeenCalledWith({
      integrationId: w.main.integration.id,
      integrationSlug: w.main.integration.slug,
      integrationName: w.main.integration.name,
      businessId: w.biz.id,
      categoryKey: 'newsong',
      openerDiscordId: body.openerDiscordId,
      subject: body.subject,
      card: body.card,
      externalRef: body.externalRef,
    })
    expect((await stateOf(created.id))?.lastStatus).toBe('open')

    // Adoption / replay → 200 created:false.
    openTicket.mockResolvedValueOnce({ ok: true, ticketId: created.id, channelId: created.discordChannelId!, created: false })
    const again = await handleOpenTicket(apiRequest('POST', '/api/v1/tickets', { key: w.main.key, body }), deps)
    expect(again.status).toBe(200)
    expect((await again.json()).created).toBe(false)
  })

  it('escapes markdown and defuses mentions in subject / card title / card lines before the bot sees them', async () => {
    const w = await world()
    const body = openBody({
      subject: '**Urgent** @everyone <@&123456789012345678>',
      card: {
        title: '# Batch _12_',
        lines: ['[Approve batch](https://evil.example/login)', '*'.repeat(200), 'plain line'],
        link: { label: 'Open [portal]', url: 'https://music.test/batches/12' },
      },
    })
    const created = await makeIntegrationTicket(
      { businessId: w.biz.id, integrationId: w.main.integration.id, openerUserId: w.opener.id, categoryId: w.cat.id },
      { externalRef: body.externalRef as string },
    )
    const openTicket = vi.fn(async () => ({ ok: true as const, ticketId: created.id, channelId: created.discordChannelId!, created: true }))
    const r = await handleOpenTicket(apiRequest('POST', '/api/v1/tickets', { key: w.main.key, body }), fakeDeps({ bot: { openTicket } }))
    expect(r.status).toBe(201)
    const sent = (openTicket.mock.calls[0] as unknown as [{ subject: string; card: { title: string; lines: string[]; link: { label: string } } }])[0]
    expect(sent.subject).toBe('\\*\\*Urgent\\*\\* @\u200beveryone \\<@&123456789012345678\\>')
    expect(sent.card.title).toBe('\\# Batch \\_12\\_')
    // The masked link renders literally (no clickable phishing link).
    expect(sent.card.lines[0]).toBe('\\[Approve batch\\](https://evil.example/login)')
    // Escaping doubles '*'; the line is clamped to the bot's 200 without a dangling '\\'.
    expect(sent.card.lines[1]!.length).toBeLessThanOrEqual(200)
    expect(sent.card.lines[1]!.endsWith('…')).toBe(true)
    expect((/\\+$/.exec(sent.card.lines[1]!.slice(0, -1))?.[0].length ?? 0) % 2).toBe(0)
    expect(sent.card.lines[2]).toBe('plain line')
    // A button label is plain text in Discord; it is forwarded as-is.
    expect(sent.card.link.label).toBe('Open [portal]')
  })

  it('trims the subject BEFORE escaping, so an NBSP-prefixed heading is escaped and the bot stores it unchanged', async () => {
    const w = await world()
    for (const [subject, expected] of [
      ['\u00a0# heading ', '\\# heading'],
      ['\u00a0\u2003-# subtext\u00a0', '\\-# subtext'],
      ['  **bold**  ', '\\*\\*bold\\*\\*'],
    ] as const) {
      resetLimiters()
      const body = openBody({ subject })
      const created = await makeIntegrationTicket(
        { businessId: w.biz.id, integrationId: w.main.integration.id, openerUserId: w.opener.id, categoryId: w.cat.id },
        { externalRef: body.externalRef as string },
      )
      const openTicket = vi.fn(async () => ({ ok: true as const, ticketId: created.id, channelId: created.discordChannelId!, created: true }))
      const r = await handleOpenTicket(apiRequest('POST', '/api/v1/tickets', { key: w.main.key, body }), fakeDeps({ bot: { openTicket } }))
      expect(r.status, JSON.stringify(subject)).toBe(201)
      const sent = (openTicket.mock.calls[0] as unknown as [{ subject: string }])[0]
      expect(sent.subject).toBe(expected)
      // What the bot stores (it trims) is exactly what was escaped.
      expect(sent.subject.trim()).toBe(sent.subject)
    }
    // Whitespace-only, NBSP included, is still blank → 422.
    resetLimiters()
    const blank = await handleOpenTicket(
      apiRequest('POST', '/api/v1/tickets', { key: w.main.key, body: openBody({ subject: '\u00a0 \u2003' }) }),
      fakeDeps(),
    )
    expect(blank.status).toBe(422)
  })

  it('maps bot errors to the public codes', async () => {
    const w = await world()
    const cases: Array<[unknown, number, string, string | null]> = [
      [{ ok: false, status: 404, code: 'opener_not_member' }, 404, 'opener_not_member', null],
      [{ ok: false, status: 403, code: 'opener_pending' }, 403, 'opener_pending', null],
      [{ ok: false, status: 403, code: 'category_forbidden' }, 403, 'category_forbidden', null],
      [{ ok: false, status: 409, code: 'opening_in_progress' }, 409, 'opening_in_progress', '5'],
      [{ ok: false, status: 409, code: 'ticket_channel_missing' }, 409, 'ticket_channel_missing', null],
    ]
    for (const [result, status, code, retry] of cases) {
      const deps = fakeDeps({ bot: { openTicket: vi.fn(async () => result as never) } })
      const r = await handleOpenTicket(apiRequest('POST', '/api/v1/tickets', { key: w.main.key, body: openBody() }), deps)
      expect(r.status).toBe(status)
      expect((await r.json()).error).toBe(code)
      expect(r.headers.get('Retry-After')).toBe(retry)
      resetLimiters()
    }
    for (const errorClass of ['guild_unavailable', 'timeout', 'not_configured', 'http_500']) {
      const deps = fakeDeps({ bot: { openTicket: vi.fn(async () => { throw new BotUnavailableError(errorClass) }) } })
      const r = await handleOpenTicket(apiRequest('POST', '/api/v1/tickets', { key: w.main.key, body: openBody() }), deps)
      expect(r.status).toBe(502)
      expect((await r.json()).error).toBe('bot_unavailable')
    }
    // Bot claims success with a ticket outside this integration's scope → 502, no leak.
    const deps = fakeDeps({ bot: { openTicket: vi.fn(async () => ({ ok: true as const, ticketId: w.foreignTicket.id, channelId: snowflake(), created: true })) } })
    const r = await handleOpenTicket(apiRequest('POST', '/api/v1/tickets', { key: w.main.key, body: openBody() }), deps)
    expect(r.status).toBe(502)
  })

  it('limits opens to 10/min per key', async () => {
    const w = await world()
    const deps = fakeDeps({ bot: { openTicket: vi.fn(async () => ({ ok: false as const, status: 409 as const, code: 'opening_in_progress' as const })) } })
    for (let i = 0; i < RATE.opensPerKeyPerMin; i++) {
      expect((await handleOpenTicket(apiRequest('POST', '/x', { key: w.main.key, body: openBody() }), deps)).status).toBe(409)
    }
    expect((await handleOpenTicket(apiRequest('POST', '/x', { key: w.main.key, body: openBody() }), deps)).status).toBe(429)
  })
})

describeDb('POST /api/v1/tickets/:id/messages', () => {
  beforeEach(resetLimiters)

  const post = (key: string, id: number, body: unknown, idem?: string, deps = fakeDeps()) =>
    handlePostMessage(
      apiRequest('POST', `/api/v1/tickets/${id}/messages`, { key, body, headers: idem ? { 'idempotency-key': idem } : {} }),
      String(id),
      deps,
    )

  it('requires a well-formed Idempotency-Key', async () => {
    const w = await world()
    expect((await post(w.main.key, w.ticket.id, { kind: 'system', body: 'x' })).status).toBe(422)
    expect((await post(w.main.key, w.ticket.id, { kind: 'system', body: 'x' }, 'bad key!')).status).toBe(422)
    expect((await post(w.main.key, w.ticket.id, { kind: 'system', body: 'x'.repeat(1801) }, 'k')).status).toBe(422)
    expect((await post(w.main.key, w.ticket.id, { kind: 'shout', body: 'x' }, 'k')).status).toBe(422)
  })

  it('stores source=system, author_kind=integration and posts escaped text with the footer', async () => {
    const w = await world()
    const deps = fakeDeps()
    const r = await post(w.main.key, w.ticket.id, { kind: 'system', body: '**Approved** @everyone', itemRef: 'Song #3' }, 'decision:1', deps)
    expect(r.status).toBe(201)
    const json = await r.json()
    expect(json.created).toBe(true)
    const [row] = await db.select().from(ticketMessages).where(eq(ticketMessages.id, json.messageId))
    expect(row).toMatchObject({
      source: 'system',
      authorKind: 'integration',
      idempotencyKey: 'decision:1',
      authorUserId: null,
      body: '**Approved** @everyone',
      discordMessageId: json.discordMessageId,
    })
    expect(row!.metadata).toEqual({ integrationId: w.main.integration.id, itemRef: 'Song #3', actorDiscordId: null, kind: 'system' })
    const call = vi.mocked(deps.discord.postWebhook).mock.calls[0]![0]
    expect(call.content).toBe('\\*\\*Approved\\*\\* @​everyone\n-# via EFM Music · Song #3')
    expect(call.allowedMentions).toEqual({ parse: [] })
    expect(call.username).toBe('EFM Music')
    expect(call.webhookUrl).toBe(w.ticket.discordWebhookUrl)
  })

  it('2 concurrent requests with the same key produce exactly 1 Discord post', async () => {
    const w = await world()
    let posts = 0
    const deps = fakeDeps({
      discord: {
        postWebhook: vi.fn(async () => {
          posts++
          await new Promise((r) => setTimeout(r, 150))
          return { id: snowflake() }
        }),
      },
    })
    const body = { kind: 'comment', body: 'Nice track' }
    const [a, b] = await Promise.all([
      post(w.main.key, w.ticket.id, body, 'same-key', deps),
      post(w.main.key, w.ticket.id, body, 'same-key', deps),
    ])
    expect(posts).toBe(1)
    // The duplicate that arrives while the first attempt is in flight is NOT
    // told "done": 409 in_progress + Retry-After (only a Discord id means delivered).
    const [winner, loser] = a.status === 201 ? [a, b] : [b, a]
    expect(winner.status).toBe(201)
    expect(loser.status).toBe(409)
    expect(Number(loser.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)
    expect(Number(loser.headers.get('Retry-After'))).toBeLessThanOrEqual(30)
    const ja = await winner.json()
    const jb = await loser.json()
    expect(jb.error).toBe('in_progress')
    expect(ja.messageId).toBe(jb.messageId)
    const rows = await db
      .select()
      .from(ticketMessages)
      .where(and(eq(ticketMessages.ticketId, w.ticket.id), eq(ticketMessages.idempotencyKey, 'same-key')))
    expect(rows).toHaveLength(1)
    // A later replay also posts nothing and returns the stored Discord id.
    const c = await post(w.main.key, w.ticket.id, body, 'same-key', deps)
    expect(c.status).toBe(200)
    expect((await c.json()).discordMessageId).toBe(rows[0]!.discordMessageId)
    expect(posts).toBe(1)
  })

  it('re-posts a stored message that never reached Discord only once it is >30 s old', async () => {
    const w = await world()
    const failing = fakeDeps({
      discord: {
        postWebhook: vi.fn(async () => {
          throw new DiscordHttpError(500, 'boom')
        }),
      },
    })
    const first = await post(w.main.key, w.ticket.id, { kind: 'system', body: 'x' }, 'retry-me', failing)
    expect(first.status).toBe(502)
    expect(first.headers.get('Retry-After')).toBe('30')
    const { messageId } = await first.json()

    const ok = fakeDeps()
    // Too young: no re-post, and no false success either.
    const young = await post(w.main.key, w.ticket.id, { kind: 'system', body: 'x' }, 'retry-me', ok)
    expect(young.status).toBe(409)
    expect(await young.json()).toEqual({ error: 'in_progress', messageId })
    expect(Number(young.headers.get('Retry-After'))).toBeGreaterThanOrEqual(25)
    expect(ok.calls.posts).toBe(0)
    // Age it past 30 s → exactly one re-post, even with two concurrent replays.
    await db.execute(sql`UPDATE ticket_messages SET created_at = now() - interval '31 seconds' WHERE id = ${messageId}::uuid`)
    const [r1, r2] = await Promise.all([
      post(w.main.key, w.ticket.id, { kind: 'system', body: 'x' }, 'retry-me', ok),
      post(w.main.key, w.ticket.id, { kind: 'system', body: 'x' }, 'retry-me', ok),
    ])
    expect(ok.calls.posts).toBe(1)
    // The lease winner re-posts (200); the other either sees it delivered
    // (200) or the lease still held (409 in_progress).
    expect([r1.status, r2.status]).toContain(200)
    for (const r of [r1, r2]) expect([200, 409]).toContain(r.status)
    const [row] = await db.select().from(ticketMessages).where(eq(ticketMessages.id, messageId))
    expect(row!.discordMessageId).not.toBeNull()
  })

  it('a replay re-posts with the ORIGINAL row identity and refuses a different actor (409 idempotency_conflict)', async () => {
    const w = await world()
    const staffRole = w.cat.staffRoleIds
    const alice = snowflake()
    const bob = snowflake()
    const names: Record<string, string> = { [alice]: 'Alice', [bob]: 'Bob' }
    let staffNow = new Set([alice, bob])
    const lookup = vi.fn(async (_t: string, _g: string, id: string) =>
      ({ user: { id, username: names[id], global_name: names[id], avatar: null }, nick: null, roles: staffNow.has(id) ? [staffRole] : [] }) as never,
    )
    const msg = (actor?: string) => ({ kind: 'comment', body: 'hi', ...(actor ? { actorDiscordId: actor } : {}) })

    // Alice's post fails at Discord; the row is stored with actor Alice.
    const failing = fakeDeps({ discord: { fetchGuildMember: lookup, postWebhook: vi.fn(async () => { throw new DiscordHttpError(500, 'boom') }) } })
    const first = await post(w.main.key, w.ticket.id, msg(alice), 'who-1', failing)
    expect(first.status).toBe(502)
    const { messageId } = await first.json()
    await db.execute(sql`UPDATE ticket_messages SET created_at = now() - interval '31 seconds' WHERE id = ${messageId}::uuid`)

    // Scenario from the review: a replay naming Bob must not post as Bob.
    const ok = fakeDeps({ discord: { fetchGuildMember: lookup } })
    for (const actor of [bob, undefined]) {
      const r = await post(w.main.key, w.ticket.id, msg(actor), 'who-1', ok)
      expect(r.status, String(actor)).toBe(409)
      expect(await r.json()).toEqual({ error: 'idempotency_conflict', messageId })
    }
    expect(ok.calls.posts).toBe(0)

    // The matching replay wins the lease and posts as Alice (the stored actor).
    const replay = await post(w.main.key, w.ticket.id, msg(alice), 'who-1', ok)
    expect(replay.status).toBe(200)
    expect(ok.calls.posts).toBe(1)
    expect(vi.mocked(ok.discord.postWebhook).mock.calls[0]![0].username).toBe('Alice')
    const [row] = await db.select().from(ticketMessages).where(eq(ticketMessages.id, messageId))
    expect(row!.metadata).toMatchObject({ actorDiscordId: alice })
    // Once delivered, a mismatched replay is still a conflict.
    expect((await post(w.main.key, w.ticket.id, msg(bob), 'who-1', ok)).status).toBe(409)

    // If the stored actor is no longer staff, the re-post uses the integration's
    // own name — never the actor's, and never the replay's.
    const second = await post(w.main.key, w.ticket.id, msg(alice), 'who-2', failing)
    expect(second.status).toBe(502)
    const m2 = (await second.json()).messageId
    await db.execute(sql`UPDATE ticket_messages SET created_at = now() - interval '31 seconds' WHERE id = ${m2}::uuid`)
    staffNow = new Set([bob])
    const demoted = fakeDeps({ discord: { fetchGuildMember: lookup } })
    const r2 = await post(w.main.key, w.ticket.id, msg(alice), 'who-2', demoted)
    expect(r2.status).toBe(200)
    expect(vi.mocked(demoted.discord.postWebhook).mock.calls[0]![0].username).toBe('EFM Music')
  })

  it('ensures a webhook through the bot when the ticket has none, stores it, and forgets a deleted one', async () => {
    const w = await world()
    await db.update(tickets).set({ discordWebhookUrl: null, discordWebhookId: null }).where(eq(tickets.id, w.ticket.id))
    const deps = fakeDeps()
    const r = await post(w.main.key, w.ticket.id, { kind: 'system', body: 'x' }, 'e1', deps)
    expect(r.status).toBe(201)
    expect(deps.bot.ensureWebhook).toHaveBeenCalledWith({ ticketId: w.ticket.id, businessId: w.biz.id, integrationId: w.main.integration.id })
    const [t] = await db.select().from(tickets).where(eq(tickets.id, w.ticket.id))
    expect(t!.discordWebhookUrl).toMatch(/^https:\/\/discord\.com\/api\/v10\/webhooks\//)

    const gone = fakeDeps({ discord: { postWebhook: vi.fn(async () => { throw new DiscordHttpError(404, 'Unknown Webhook') }) } })
    expect((await post(w.main.key, w.ticket.id, { kind: 'system', body: 'x' }, 'e2', gone)).status).toBe(502)
    const [t2] = await db.select().from(tickets).where(eq(tickets.id, w.ticket.id))
    expect(t2!.discordWebhookUrl).toBeNull()

    const botDown = fakeDeps({ bot: { ensureWebhook: vi.fn(async () => { throw new BotUnavailableError('timeout') }) } })
    const down = await post(w.main.key, w.ticket.id, { kind: 'system', body: 'x' }, 'e3', botDown)
    expect(down.status).toBe(502)
    expect((await down.json()).error).toBe('bot_unavailable')
  })

  it('409s on a closed ticket (but still answers a replay of an accepted key)', async () => {
    const w = await world()
    const deps = fakeDeps()
    expect((await post(w.main.key, w.ticket.id, { kind: 'system', body: 'x' }, 'before', deps)).status).toBe(201)
    await db.update(tickets).set({ status: 'closed', closedAt: new Date() }).where(eq(tickets.id, w.ticket.id))
    const r = await post(w.main.key, w.ticket.id, { kind: 'system', body: 'x' }, 'after', deps)
    expect(r.status).toBe(409)
    expect((await r.json()).error).toBe('ticket_closed')
    expect((await post(w.main.key, w.ticket.id, { kind: 'system', body: 'x' }, 'before', deps)).status).toBe(200)
    expect(deps.calls.posts).toBe(1)
  })

  it('enforces the actorDiscordId rule (impersonation + live staff/opener role check)', async () => {
    const w = await world()
    const staffRole = w.cat.staffRoleIds
    const staff = snowflake()
    const member = (roles: string[], extra: Record<string, unknown> = {}) => ({
      user: { id: staff, username: 'staffer', global_name: 'Staff Person', avatar: null },
      nick: null,
      roles,
      ...extra,
    })
    const call = (deps: ReturnType<typeof fakeDeps>, actor: string, idem: string) =>
      post(w.main.key, w.ticket.id, { kind: 'comment', body: 'hi', actorDiscordId: actor }, idem, deps)

    // Not a member → 403; pending → 403; non-staff member → 403.
    for (const [m, idem] of [
      [null, 'a1'],
      [member([staffRole], { pending: true }), 'a2'],
      [member([snowflake()]), 'a3'],
    ] as const) {
      const deps = fakeDeps({ discord: { fetchGuildMember: vi.fn(async () => m as never) } })
      const r = await call(deps, staff, idem)
      expect(r.status, idem).toBe(403)
      expect((await r.json()).error).toBe('actor_forbidden')
      expect(deps.calls.posts).toBe(0)
    }
    // Every refusal is audited with a reason (ids only).
    const forbidden = async () =>
      (await db.select().from(integrationAudit).where(and(eq(integrationAudit.integrationId, w.main.integration.id), eq(integrationAudit.action, 'actor.forbidden')))).map(
        (r) => r.metadata as { ticketId: number; actorDiscordId: string; reason: string; purpose: string },
      )
    expect((await forbidden()).map((m) => m.reason).sort()).toEqual(['not_member', 'not_staff', 'pending'])
    expect((await forbidden()).every((m) => m.ticketId === w.ticket.id && m.actorDiscordId === staff && m.purpose === 'message')).toBe(true)
    // Staff for the category → posted as the actor's display name.
    const ok = fakeDeps({ discord: { fetchGuildMember: vi.fn(async () => member([staffRole]) as never) } })
    const posted = await call(ok, staff, 'a4')
    expect(posted.status).toBe(201)
    expect(vi.mocked(ok.discord.postWebhook).mock.calls[0]![0].username).toBe('Staff Person')
    // A successful impersonated post is audited: actor id, no body.
    const postedAudit = await db
      .select()
      .from(integrationAudit)
      .where(and(eq(integrationAudit.integrationId, w.main.integration.id), eq(integrationAudit.action, 'message.posted_as_actor')))
    expect(postedAudit.map((r) => r.metadata)).toEqual([
      { ticketId: w.ticket.id, messageId: (await posted.json()).messageId, actorDiscordId: staff, repost: false },
    ])
    // Team-wide staff and admin roles also count (the staff set is the
    // role-based union category ∪ team staff ∪ team admin).
    expect(staffRoleIdsForCategory({ staffRoleIds: 'T1', adminRoleIds: 'A1' }, { staffRoleIds: 'C1,C2' }).sort()).toEqual(['A1', 'C1', 'C2', 'T1'])
    const teamRole = snowflake()
    await db.update(businesses).set({ staffRoleIds: teamRole }).where(eq(businesses.id, w.biz.id))
    for (const [role, idem] of [[teamRole, 'a4t'], [w.biz.adminRoleIds, 'a4a']] as const) {
      const d = fakeDeps({ discord: { fetchGuildMember: vi.fn(async () => member([role]) as never) } })
      expect((await call(d, staff, idem)).status, idem).toBe(201)
    }
    // Permissions never count: a member whose only role is unrelated (say it
    // carries ManageGuild/ADMINISTRATOR in Discord) is not staff here.
    const permsOnly = fakeDeps({
      discord: { fetchGuildMember: vi.fn(async () => member([snowflake()], { permissions: '8' }) as never) },
    })
    expect((await call(permsOnly, staff, 'a4p')).status).toBe(403)
    // The opener counts; a reserved-word name falls back to the integration name.
    const opener = fakeDeps({
      discord: {
        fetchGuildMember: vi.fn(async () => ({ user: { id: w.opener.discordId, username: 'x', global_name: null, avatar: null }, nick: 'Discord King', roles: [] }) as never),
      },
    })
    expect((await call(opener, w.opener.discordId, 'a5')).status).toBe(201)
    expect(vi.mocked(opener.discord.postWebhook).mock.calls[0]![0].username).toBe('EFM Music')
    const [row] = await db.select().from(ticketMessages).where(and(eq(ticketMessages.ticketId, w.ticket.id), eq(ticketMessages.idempotencyKey, 'a5')))
    expect(row!.authorUserId).toBe(w.opener.id)
    expect(row!.metadata).toMatchObject({ actorDiscordId: w.opener.discordId, kind: 'comment' })

    // actor_impersonation off → 403 before any lookup.
    await db.update(integrations).set({ actorImpersonation: false }).where(eq(integrations.id, w.main.integration.id))
    const off = fakeDeps({ discord: { fetchGuildMember: vi.fn(async () => member([staffRole]) as never) } })
    expect((await call(off, staff, 'a6')).status).toBe(403)
    expect(off.discord.fetchGuildMember).not.toHaveBeenCalled()
    expect((await forbidden()).some((m) => m.reason === 'impersonation_disabled')).toBe(true)
  })
})

describeDb('PATCH /api/v1/tickets/:id', () => {
  beforeEach(resetLimiters)

  const patch = (key: string, id: number, body: unknown, deps = fakeDeps()) =>
    handlePatchTicket(apiRequest('PATCH', `/api/v1/tickets/${id}`, { key, body }), String(id), deps)

  it('sets a workflow status, posts a footer, and audits via integration:<slug>', async () => {
    const w = await world()
    const deps = fakeDeps()
    const r = await patch(w.main.key, w.ticket.id, { status: 'waiting' }, deps)
    expect(r.status).toBe(200)
    expect((await r.json()).status).toBe('waiting')
    expect(deps.discord.postChannelStatus).toHaveBeenCalledTimes(1)
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.ticketId, w.ticket.id))
    expect(logs.find((l) => l.action === 'status_changed')?.metadata).toEqual({
      from: 'open',
      to: 'waiting',
      via: `integration:${w.main.integration.slug}`,
    })
    expect((await patch(w.main.key, w.ticket.id, { status: 'open' }, deps)).status).toBe(422)
    expect((await patch(w.main.key, w.ticket.id, { status: 'waiting', x: 1 }, deps)).status).toBe(422)
  })

  it('closes through the bot, needs tickets:close, and 409s once closed', async () => {
    const w = await world()
    await db.update(integrations).set({ scopes: ['tickets:read', 'tickets:write'] }).where(eq(integrations.id, w.main.integration.id))
    const deps = fakeDeps()
    const noScope = await patch(w.main.key, w.ticket.id, { status: 'closed' }, deps)
    expect(noScope.status).toBe(403)
    expect(deps.bot.closeTicket).not.toHaveBeenCalled()

    await db.update(integrations).set({ scopes: ['tickets:read', 'tickets:write', 'tickets:close'] }).where(eq(integrations.id, w.main.integration.id))
    const closeTicket = vi.fn(async () => {
      await db.update(tickets).set({ status: 'closed', closedAt: new Date() }).where(eq(tickets.id, w.ticket.id))
      return { ok: true as const, closedBy: 'bot' as const }
    })
    const closing = fakeDeps({ bot: { closeTicket } })
    const r = await patch(w.main.key, w.ticket.id, { status: 'closed', reason: 'All songs decided — see [here](https://evil.example) @here' }, closing)
    expect(r.status).toBe(200)
    // The close reason reaches the opener's DM via the bot: escaped at the boundary.
    expect(closeTicket).toHaveBeenCalledWith({
      ticketId: w.ticket.id,
      businessId: w.biz.id,
      integrationId: w.main.integration.id,
      reason: 'All songs decided — see \\[here\\](https://evil.example) @\u200bhere',
    })
    const body = await r.json()
    expect(body.status).toBe('closed')
    expect(body.closedAt).not.toBeNull()
    expect(body.closedBy).toBe('bot')

    expect((await patch(w.main.key, w.ticket.id, { status: 'closed' }, closing)).status).toBe(409)
    expect((await patch(w.main.key, w.ticket.id, { status: 'waiting' }, closing)).status).toBe(409)
    expect(closeTicket).toHaveBeenCalledTimes(1)
    const audit = await db.select().from(integrationAudit).where(eq(integrationAudit.integrationId, w.main.integration.id))
    expect(audit.some((a) => a.action === 'ticket.closed')).toBe(true)
    expect(JSON.stringify(audit)).not.toContain('etk.')
  })

  it('forwards the close actor and returns + audits the bot-reported closedBy', async () => {
    const w = await world()
    const actor = snowflake()
    for (const [closedBy, expected] of [['actor', 'actor'], [null, null]] as const) {
      const t = await makeIntegrationTicket({ businessId: w.biz.id, integrationId: w.main.integration.id, openerUserId: w.opener.id, categoryId: w.cat.id })
      const closeTicket = vi.fn(async () => {
        await db.update(tickets).set({ status: 'closed', closedAt: new Date() }).where(eq(tickets.id, t.id))
        return { ok: true as const, closedBy }
      })
      const r = await patch(w.main.key, t.id, { status: 'closed', actorDiscordId: actor }, fakeDeps({ bot: { closeTicket } }))
      expect(r.status).toBe(200)
      expect((await r.json()).closedBy).toBe(expected)
      expect(closeTicket).toHaveBeenCalledWith(expect.objectContaining({ ticketId: t.id, businessId: w.biz.id, integrationId: w.main.integration.id, actorDiscordId: actor }))
      const audit = await db.select().from(integrationAudit).where(eq(integrationAudit.integrationId, w.main.integration.id))
      const row = audit.find((a) => a.action === 'ticket.closed' && (a.metadata as { ticketId?: number }).ticketId === t.id)
      expect(row?.metadata).toMatchObject({ actorDiscordId: actor, closedBy: expected })
    }
  })

  it('maps bot close answers and gates the close actor on actor_impersonation', async () => {
    const w = await world()
    expect(
      (await patch(w.main.key, w.ticket.id, { status: 'closed' }, fakeDeps({ bot: { closeTicket: vi.fn(async () => ({ ok: false as const, status: 409 as const, code: 'already_closed' as const })) } }))).status,
    ).toBe(409)
    expect(
      (await patch(w.main.key, w.ticket.id, { status: 'closed' }, fakeDeps({ bot: { closeTicket: vi.fn(async () => { throw new BotUnavailableError('timeout') }) } }))).status,
    ).toBe(502)
    await db.update(integrations).set({ actorImpersonation: false }).where(eq(integrations.id, w.main.integration.id))
    const deps = fakeDeps()
    const actor = snowflake()
    expect((await patch(w.main.key, w.ticket.id, { status: 'closed', actorDiscordId: actor }, deps)).status).toBe(403)
    expect(deps.bot.closeTicket).not.toHaveBeenCalled()
    const audit = await db.select().from(integrationAudit).where(and(eq(integrationAudit.integrationId, w.main.integration.id), eq(integrationAudit.action, 'actor.forbidden')))
    expect(audit.map((a) => a.metadata)).toEqual([{ ticketId: w.ticket.id, actorDiscordId: actor, reason: 'impersonation_disabled', purpose: 'close' }])
  })
})

describeDb('guild:read routes', () => {
  beforeEach(resetLimiters)

  it('lists guild roles (cached) and resolves members', async () => {
    const w = await world()
    await db.update(integrations).set({ scopes: ['guild:read'] }).where(eq(integrations.id, w.main.integration.id))
    const roles = [{ id: snowflake(), name: 'EFM Managers', color: 5, position: 3, managed: false }]
    const deps = fakeDeps({ discord: { fetchGuildRoles: vi.fn(async () => roles) } })
    for (let i = 0; i < 3; i++) {
      const r = await handleGuildRoles(apiRequest('GET', '/api/v1/guild/roles', { key: w.main.key }), deps)
      expect(r.status).toBe(200)
      expect(await r.json()).toEqual([{ id: roles[0]!.id, name: 'EFM Managers', color: 5, position: 3 }])
    }
    expect(deps.discord.fetchGuildRoles).toHaveBeenCalledTimes(1)

    const m = fakeDeps({ discord: { fetchGuildMember: vi.fn(async () => ({ roles: ['1'], nick: null, pending: true }) as never) } })
    const r = await handleMember(apiRequest('GET', '/x', { key: w.main.key }), snowflake(), m)
    expect(await r.json()).toEqual({ member: true, pending: true, roleIds: ['1'] })
    const none = await handleMember(apiRequest('GET', '/x', { key: w.main.key }), snowflake(), fakeDeps())
    expect(await none.json()).toEqual({ member: false, pending: false, roleIds: [] })
    expect((await handleMember(apiRequest('GET', '/x', { key: w.main.key }), 'abc', fakeDeps())).status).toBe(422)
    // A tickets-only key cannot use guild:read.
    expect((await handleGuildRoles(apiRequest('GET', '/x', { key: w.sibling.key }), deps)).status).toBe(200)
    await db.update(integrations).set({ scopes: ['tickets:read'] }).where(eq(integrations.id, w.sibling.integration.id))
    expect((await handleGuildRoles(apiRequest('GET', '/x', { key: w.sibling.key }), deps)).status).toBe(403)
  })
})
