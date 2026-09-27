// Shared fixtures for the DB-backed Integration API suites. Everything is
// created with random ids/slugs so suites never collide; no secrets are
// fixtures — keys are generated per run.

import { randomBytes, randomUUID } from 'node:crypto'
import { describe, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import {
  businesses,
  integrationTicketState,
  integrations,
  ticketCategories,
  tickets,
  users,
  type Business,
  type Integration,
  type IntegrationScope,
  type Ticket,
} from '@/db/schema'
import { generateIntegrationKey } from '@/server/integrations/keys'
import type { ApiDeps } from '@/server/integrations/api'
import { encryptSecret } from '@/server/integrations/crypto'

export const hasDb = !!process.env.TEST_DATABASE_URL
export const describeDb = hasDb ? describe : describe.skip

export function snowflake(): string {
  return (BigInt('100000000000000000') + BigInt('0x' + randomBytes(6).toString('hex'))).toString()
}

export function rand(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex')}`
}

export async function makeUser(discordId = snowflake(), name = 'User'): Promise<{ id: string; discordId: string }> {
  const [u] = await db.insert(users).values({ discordId, name }).returning({ id: users.id, discordId: users.discordId })
  return u!
}

export async function makeBusiness(over: Partial<typeof businesses.$inferInsert> = {}): Promise<Business> {
  const [b] = await db
    .insert(businesses)
    .values({
      slug: rand('biz'),
      name: 'Biz',
      discordGuildId: snowflake(),
      adminRoleIds: snowflake(),
      staffRoleIds: '',
      ...over,
    })
    .returning()
  return b!
}

export async function makeCategory(businessId: string, key: string, over: Partial<typeof ticketCategories.$inferInsert> = {}) {
  const [c] = await db
    .insert(ticketCategories)
    .values({ businessId, key, label: key, staffRoleIds: '', ...over })
    .returning()
  return c!
}

export async function makeIntegration(
  businessId: string,
  over: Partial<typeof integrations.$inferInsert> & { scopes?: IntegrationScope[] } = {},
): Promise<{ integration: Integration; key: string; webhookSecret: string }> {
  const k = generateIntegrationKey()
  const id = randomUUID()
  const webhookSecret = randomBytes(32).toString('base64url')
  const [row] = await db
    .insert(integrations)
    .values({
      id,
      businessId,
      name: 'EFM Music',
      slug: rand('int'),
      keyPrefix: k.prefix,
      keyHash: k.hash,
      scopes: ['tickets:read', 'tickets:write', 'tickets:close', 'guild:read'],
      allowedCategoryKeys: ['newsong'],
      linkOrigin: 'https://music.test',
      actorImpersonation: true,
      webhookSecretEnc: encryptSecret(webhookSecret, id),
      ...over,
    })
    .returning()
  return { integration: row!, key: k.key, webhookSecret }
}

export async function makeIntegrationTicket(
  opts: { businessId: string; integrationId: string | null; openerUserId: string; categoryId?: string | null },
  over: Partial<typeof tickets.$inferInsert> = {},
): Promise<Ticket> {
  const [t] = await db
    .insert(tickets)
    .values({
      businessId: opts.businessId,
      openerUserId: opts.openerUserId,
      categoryId: opts.categoryId ?? null,
      subject: 'Batch 1',
      integrationId: opts.integrationId,
      externalRef: opts.integrationId ? rand('ref') : null,
      discordChannelId: snowflake(),
      discordWebhookUrl: `https://discord.com/api/v10/webhooks/${snowflake()}/${randomBytes(24).toString('base64url')}`,
      ...over,
    })
    .returning()
  return t!
}

export async function stateOf(ticketId: number) {
  const [s] = await db.select().from(integrationTicketState).where(eq(integrationTicketState.ticketId, ticketId))
  return s ?? null
}

export function apiRequest(
  method: string,
  path: string,
  opts: { key?: string; body?: unknown; headers?: Record<string, string>; ip?: string } = {},
): Request {
  const headers: Record<string, string> = { host: 'tickets-web:3000', 'x-forwarded-for': opts.ip ?? '10.9.8.7', ...(opts.headers ?? {}) }
  if (opts.key) headers.authorization = `Bearer ${opts.key}`
  let body: string | undefined
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json'
    body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)
  }
  return new Request(`http://tickets-web:3000${path}`, { method, headers, body })
}

// ApiDeps with every network edge faked. Tests override what they exercise.
export function fakeDeps(
  over: {
    bot?: Partial<ApiDeps['bot']>
    discord?: Partial<ApiDeps['discord']>
    botToken?: ApiDeps['botToken']
    notify?: ApiDeps['notify']
  } = {},
): ApiDeps & {
  calls: { posts: number }
} {
  const calls = { posts: 0 }
  const deps = {
    bot: {
      openTicket: vi.fn(async () => {
        throw new Error('openTicket not faked')
      }),
      closeTicket: vi.fn(async () => ({ ok: true as const, closedBy: 'bot' as const })),
      ensureWebhook: vi.fn(async () => ({
        webhookUrl: `https://discord.com/api/v10/webhooks/${snowflake()}/${randomBytes(24).toString('base64url')}`,
        webhookId: snowflake(),
      })),
      ...(over.bot ?? {}),
    },
    discord: {
      postWebhook: vi.fn(async () => {
        calls.posts++
        return { id: snowflake() }
      }),
      fetchGuildMember: vi.fn(async () => null),
      fetchGuildRoles: vi.fn(async () => []),
      postChannelStatus: vi.fn(async () => {}),
      ...(over.discord ?? {}),
    },
    botToken: over.botToken ?? (() => 'test-bot-token-not-real'),
    notify: over.notify ?? (async () => {}),
    calls,
  }
  return deps as unknown as ApiDeps & { calls: { posts: number } }
}

export function resetLimiters(): void {
  globalThis.__integrationLimiters = undefined
}
