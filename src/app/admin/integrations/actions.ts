'use server'

// Sudo-only management of Integration API clients (plan §4.2 "Management").
// Every action re-checks sudo first. Secrets (the API key and the webhook
// signing secret) are returned to the browser exactly once, in the action's
// return value, and are never stored in clear, logged, or audited.

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/db/client'
import { businesses, integrations, integrationWebhookAllowlist, ticketCategories, type Integration } from '@/db/schema'
import { requireSudo } from '@/server/sudo'
import { writeIntegrationAudit } from '@/server/integrations/audit'
import { encryptSecret } from '@/server/integrations/crypto'
import { generateIntegrationKey, generateWebhookSecret } from '@/server/integrations/keys'
import { matchAllowlist } from '@/server/integrations/webhookSsrf'
import {
  allowlistRowSchema,
  checkLinkOrigin,
  checkWebhookUrl,
  createIntegrationSchema,
  integrationSettingsSchema,
  readSettingsForm,
} from '@/server/integrations/adminValidation'

export type SecretResult =
  | { ok: true; id: string; items: Array<{ label: string; value: string }> }
  | { ok: false; error: string }
  | null

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function loadIntegration(id: string): Promise<Integration> {
  if (!UUID_RE.test(id)) throw new Error('Bad integration id')
  const [row] = await db.select().from(integrations).where(eq(integrations.id, id)).limit(1)
  if (!row) throw new Error('Integration not found')
  return row
}

async function assertCategoryKeysExist(businessId: string, keys: string[]): Promise<string | null> {
  if (keys.length === 0) return null
  const rows = await db
    .select({ key: ticketCategories.key })
    .from(ticketCategories)
    .where(and(eq(ticketCategories.businessId, businessId), inArray(ticketCategories.key, keys)))
  const have = new Set(rows.map((r) => r.key))
  const missing = keys.filter((k) => !have.has(k))
  return missing.length ? `Unknown category key(s) for this team: ${missing.join(', ')}` : null
}

// drizzle wraps the driver error; the Postgres code sits on `.cause`.
function isUniqueViolation(err: unknown): boolean {
  let e: unknown = err
  for (let i = 0; e && i < 3; i++) {
    if ((e as { code?: string }).code === '23505') return true
    e = (e as { cause?: unknown }).cause
  }
  return false
}

export async function createIntegrationAction(_prev: SecretResult, formData: FormData): Promise<SecretResult> {
  const session = await requireSudo()
  const parsed = createIntegrationSchema.safeParse({
    ...readSettingsForm(formData),
    businessId: String(formData.get('businessId') ?? ''),
    slug: String(formData.get('slug') ?? '').trim().toLowerCase(),
  })
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }
  const input = parsed.data
  const originErr = checkLinkOrigin(input.linkOrigin)
  if (originErr) return { ok: false, error: originErr }

  const [biz] = await db.select({ id: businesses.id }).from(businesses).where(eq(businesses.id, input.businessId)).limit(1)
  if (!biz) return { ok: false, error: 'Team not found' }
  const catErr = await assertCategoryKeysExist(biz.id, input.allowedCategoryKeys)
  if (catErr) return { ok: false, error: catErr }

  const id = randomUUID()
  const key = generateIntegrationKey()
  const webhookSecret = generateWebhookSecret()
  try {
    await db.insert(integrations).values({
      id,
      businessId: biz.id,
      name: input.name,
      slug: input.slug,
      keyPrefix: key.prefix,
      keyHash: key.hash,
      scopes: input.scopes,
      allowedCategoryKeys: input.allowedCategoryKeys,
      linkOrigin: input.linkOrigin,
      actorImpersonation: input.actorImpersonation,
      webhookSecretEnc: encryptSecret(webhookSecret, id),
      createdBy: session.user.id,
    })
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: 'That slug is already in use.' }
    // Never rethrow the raw driver error: it carries the bound parameters
    // (key hash, secret ciphertext) into logs and the error overlay.
    console.error('[admin/integrations] create failed', { err: err instanceof Error ? err.name : 'unknown' })
    return { ok: false, error: 'Could not create the integration.' }
  }
  await writeIntegrationAudit({
    integrationId: id,
    businessId: biz.id,
    actorUserId: session.user.id,
    action: 'integration.created',
    metadata: {
      name: input.name,
      slug: input.slug,
      scopes: input.scopes,
      allowedCategoryKeys: input.allowedCategoryKeys,
      linkOrigin: input.linkOrigin,
      actorImpersonation: input.actorImpersonation,
      keyPrefix: key.prefix,
    },
  })
  revalidatePath('/admin/integrations')
  return {
    ok: true,
    id,
    items: [
      { label: 'API key (Authorization: Bearer …)', value: key.key },
      { label: 'Webhook signing secret', value: webhookSecret },
    ],
  }
}

export async function updateIntegrationAction(id: string, formData: FormData): Promise<void> {
  const session = await requireSudo()
  const row = await loadIntegration(id)
  const parsed = integrationSettingsSchema.safeParse(readSettingsForm(formData))
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  const input = parsed.data
  const originErr = checkLinkOrigin(input.linkOrigin)
  if (originErr) throw new Error(originErr)
  const catErr = await assertCategoryKeysExist(row.businessId, input.allowedCategoryKeys)
  if (catErr) throw new Error(catErr)

  await db
    .update(integrations)
    .set({
      name: input.name,
      scopes: input.scopes,
      allowedCategoryKeys: input.allowedCategoryKeys,
      linkOrigin: input.linkOrigin,
      actorImpersonation: input.actorImpersonation,
    })
    .where(eq(integrations.id, row.id))
  await writeIntegrationAudit({
    integrationId: row.id,
    businessId: row.businessId,
    actorUserId: session.user.id,
    action: 'integration.updated',
    metadata: {
      before: {
        name: row.name,
        scopes: row.scopes,
        allowedCategoryKeys: row.allowedCategoryKeys,
        linkOrigin: row.linkOrigin,
        actorImpersonation: row.actorImpersonation,
      },
      after: input,
    },
  })
  revalidatePath(`/admin/integrations/${row.id}`)
}

// Bound with the id; useActionState's (prevState, formData) args are unused.
export async function rotateKeyAction(id: string): Promise<SecretResult> {
  const session = await requireSudo()
  const row = await loadIntegration(id)
  const key = generateIntegrationKey()
  await db.update(integrations).set({ keyPrefix: key.prefix, keyHash: key.hash }).where(eq(integrations.id, row.id))
  await writeIntegrationAudit({
    integrationId: row.id,
    businessId: row.businessId,
    actorUserId: session.user.id,
    action: 'key.rotated',
    metadata: { oldKeyPrefix: row.keyPrefix, newKeyPrefix: key.prefix },
  })
  revalidatePath(`/admin/integrations/${row.id}`)
  return { ok: true, id: row.id, items: [{ label: 'New API key (the old one stopped working)', value: key.key }] }
}

export async function rotateSecretAction(id: string): Promise<SecretResult> {
  const session = await requireSudo()
  const row = await loadIntegration(id)
  const secret = generateWebhookSecret()
  await db.update(integrations).set({ webhookSecretEnc: encryptSecret(secret, row.id) }).where(eq(integrations.id, row.id))
  await writeIntegrationAudit({
    integrationId: row.id,
    businessId: row.businessId,
    actorUserId: session.user.id,
    action: 'webhook_secret.rotated',
  })
  revalidatePath(`/admin/integrations/${row.id}`)
  return { ok: true, id: row.id, items: [{ label: 'New webhook signing secret (deliveries are signed with it from now on)', value: secret }] }
}

export async function setEnabledAction(id: string, formData: FormData): Promise<void> {
  const session = await requireSudo()
  const row = await loadIntegration(id)
  const enabled = String(formData.get('enabled') ?? '') === 'true'
  await db.update(integrations).set({ enabled }).where(eq(integrations.id, row.id))
  await writeIntegrationAudit({
    integrationId: row.id,
    businessId: row.businessId,
    actorUserId: session.user.id,
    action: enabled ? 'integration.enabled' : 'integration.disabled',
  })
  revalidatePath(`/admin/integrations/${row.id}`)
  revalidatePath('/admin/integrations')
}

export async function addAllowlistAction(id: string, formData: FormData): Promise<void> {
  const session = await requireSudo()
  const row = await loadIntegration(id)
  const parsed = allowlistRowSchema.safeParse({
    scheme: String(formData.get('scheme') ?? ''),
    host: String(formData.get('host') ?? ''),
    port: String(formData.get('port') ?? ''),
    path: String(formData.get('path') ?? ''),
    expectedNetworkCidr: String(formData.get('expectedNetworkCidr') ?? ''),
  })
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
  await db
    .insert(integrationWebhookAllowlist)
    .values({ integrationId: row.id, ...parsed.data })
    .onConflictDoUpdate({
      target: [
        integrationWebhookAllowlist.integrationId,
        integrationWebhookAllowlist.scheme,
        integrationWebhookAllowlist.host,
        integrationWebhookAllowlist.port,
        integrationWebhookAllowlist.path,
      ],
      set: { expectedNetworkCidr: parsed.data.expectedNetworkCidr },
    })
  await writeIntegrationAudit({
    integrationId: row.id,
    businessId: row.businessId,
    actorUserId: session.user.id,
    action: 'allowlist.added',
    metadata: { ...parsed.data },
  })
  revalidatePath(`/admin/integrations/${row.id}`)
}

export async function removeAllowlistAction(id: string, formData: FormData): Promise<void> {
  const session = await requireSudo()
  const row = await loadIntegration(id)
  const scheme = String(formData.get('scheme') ?? '')
  const host = String(formData.get('host') ?? '')
  const port = Number(formData.get('port') ?? '')
  const path = String(formData.get('path') ?? '')
  if (!Number.isInteger(port)) throw new Error('Bad port')
  // One transaction, with the integration row locked (FOR UPDATE, as in
  // setWebhookUrlAction): the row delete and clearing a webhook URL that no
  // longer matches commit together, so no reader ever sees a stored URL
  // without its allowlist row. (The dispatcher also fails closed on that.)
  await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ webhookUrl: integrations.webhookUrl })
      .from(integrations)
      .where(eq(integrations.id, row.id))
      .for('update')
    await tx
      .delete(integrationWebhookAllowlist)
      .where(
        and(
          eq(integrationWebhookAllowlist.integrationId, row.id),
          eq(integrationWebhookAllowlist.scheme, scheme),
          eq(integrationWebhookAllowlist.host, host),
          eq(integrationWebhookAllowlist.port, port),
          eq(integrationWebhookAllowlist.path, path),
        ),
      )
    // Keep the save-time invariant: a stored webhook URL always matches a row.
    if (locked?.webhookUrl) {
      const rest = await tx.select().from(integrationWebhookAllowlist).where(eq(integrationWebhookAllowlist.integrationId, row.id))
      if (!matchAllowlist(locked.webhookUrl, rest)) {
        await tx.update(integrations).set({ webhookUrl: null }).where(eq(integrations.id, row.id))
      }
    }
  })
  await writeIntegrationAudit({
    integrationId: row.id,
    businessId: row.businessId,
    actorUserId: session.user.id,
    action: 'allowlist.removed',
    metadata: { scheme, host, port, path },
  })
  revalidatePath(`/admin/integrations/${row.id}`)
}

export async function setWebhookUrlAction(id: string, formData: FormData): Promise<void> {
  const session = await requireSudo()
  const row = await loadIntegration(id)
  const raw = String(formData.get('webhookUrl') ?? '').trim()
  let next: string | null = null
  if (raw) {
    const checked = checkWebhookUrl(raw)
    if (!checked.ok) throw new Error(checked.error)
    next = checked.url
  }
  // Check and write under the same integration-row lock as
  // removeAllowlistAction, so a concurrent row removal cannot slip between
  // the allowlist check and the URL write.
  await db.transaction(async (tx) => {
    await tx.select({ id: integrations.id }).from(integrations).where(eq(integrations.id, row.id)).for('update')
    if (next) {
      const allow = await tx.select().from(integrationWebhookAllowlist).where(eq(integrationWebhookAllowlist.integrationId, row.id))
      // SSRF policy (plan §4.5): exact (scheme, host, port, path) match with an
      // allowlist row of THIS integration, or refuse.
      if (!matchAllowlist(next, allow)) {
        throw new Error('Refused: the URL does not exactly match an allowlist row of this integration.')
      }
    }
    await tx.update(integrations).set({ webhookUrl: next }).where(eq(integrations.id, row.id))
  })
  await writeIntegrationAudit({
    integrationId: row.id,
    businessId: row.businessId,
    actorUserId: session.user.id,
    action: 'webhook_url.set',
    metadata: { webhookUrl: next },
  })
  revalidatePath(`/admin/integrations/${row.id}`)
}

// Toggle ticket_categories.integration_only for a category of the
// integration's team (plan §4.4). Sudo-only: it removes a category from the
// web /t/new picker and makes the bot refuse its panel buttons.
export async function setCategoryIntegrationOnlyAction(id: string, formData: FormData): Promise<void> {
  const session = await requireSudo()
  const row = await loadIntegration(id)
  const categoryId = String(formData.get('categoryId') ?? '')
  if (!UUID_RE.test(categoryId)) throw new Error('Bad category id')
  const value = String(formData.get('integrationOnly') ?? '') === 'true'
  const [updated] = await db
    .update(ticketCategories)
    .set({ integrationOnly: value })
    .where(and(eq(ticketCategories.id, categoryId), eq(ticketCategories.businessId, row.businessId)))
    .returning({ key: ticketCategories.key })
  if (!updated) throw new Error('Category not found in this team')
  await writeIntegrationAudit({
    integrationId: row.id,
    businessId: row.businessId,
    actorUserId: session.user.id,
    action: 'category.integration_only',
    metadata: { categoryId, key: updated.key, integrationOnly: value },
  })
  revalidatePath(`/admin/integrations/${row.id}`)
}

// Toggle ticket_categories.ping_staff_on_open for a category of the
// integration's team (v0.12.3). Off = the bot's ticket-open message pings only
// the opener, not the category's staff roles (staff keep channel access).
// Same guards as the integration_only toggle: sudo re-checked, category must
// belong to the integration's team, audited.
export async function setCategoryPingStaffOnOpenAction(id: string, formData: FormData): Promise<void> {
  const session = await requireSudo()
  const row = await loadIntegration(id)
  const categoryId = String(formData.get('categoryId') ?? '')
  if (!UUID_RE.test(categoryId)) throw new Error('Bad category id')
  const value = String(formData.get('pingStaffOnOpen') ?? '') === 'true'
  const [updated] = await db
    .update(ticketCategories)
    .set({ pingStaffOnOpen: value })
    .where(and(eq(ticketCategories.id, categoryId), eq(ticketCategories.businessId, row.businessId)))
    .returning({ key: ticketCategories.key })
  if (!updated) throw new Error('Category not found in this team')
  await writeIntegrationAudit({
    integrationId: row.id,
    businessId: row.businessId,
    actorUserId: session.user.id,
    action: 'category.ping_staff_on_open',
    metadata: { categoryId, key: updated.key, pingStaffOnOpen: value },
  })
  revalidatePath(`/admin/integrations/${row.id}`)
}
