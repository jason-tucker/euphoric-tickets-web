import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { businesses } from './businesses'
import { users } from './users'

// Integration API (v0.12.0) — "other services talk to the ticket system".
//
// One row per API client (e.g. the EFM Music Portal worker). A key is
// `etk.<key_prefix>.<secret>`; only sha256(secret) is stored (`key_hash`) and
// the prefix is the lookup handle. Every public `/api/v1/*` call is scoped to
// (`id`, `business_id`) of the row the key resolves to.
//
// This file is the source of truth for the integration tables; the bot repo
// mirrors it by name (see docs/INTEGRATION_SCHEMA.md). Do not rename columns.
export const integrationScopes = ['tickets:read', 'tickets:write', 'tickets:close', 'guild:read'] as const
export type IntegrationScope = (typeof integrationScopes)[number]

export const integrations = pgTable(
  'integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Used in audit `via='integration:<slug>'` and in the Discord footer.
    slug: text('slug').notNull(),
    // 10 base62 chars; the public, non-secret half of the key.
    keyPrefix: text('key_prefix').notNull(),
    // hex sha256 of the 43-char secret half. Never the secret itself.
    keyHash: text('key_hash').notNull(),
    // No column DEFAULT on the two arrays: drizzle-kit 0.31 re-diffs array
    // defaults on every push ('{}' vs '{}'::text[]), which would break the
    // "second push emits nothing" gate. The admin action always sets them.
    scopes: text('scopes').array().notNull(),
    // ticket_categories.key values (within business_id) this key may open in.
    allowedCategoryKeys: text('allowed_category_keys').array().notNull(),
    // `card.link.url` must have exactly this origin (e.g. https://music.euphoric.fm).
    linkOrigin: text('link_origin'),
    // When false, `actorDiscordId` on messages / close is refused (403).
    actorImpersonation: boolean('actor_impersonation').notNull().default(false),
    // Outbound webhook target. Must exactly match an allowlist row at save time.
    webhookUrl: text('webhook_url'),
    // AES-256-GCM(INTEGRATION_ENC_KEY) of the HMAC signing secret.
    webhookSecretEnc: text('webhook_secret_enc'),
    enabled: boolean('enabled').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({
    keyPrefixUq: uniqueIndex('integrations_key_prefix_uq').on(t.keyPrefix),
    slugUq: uniqueIndex('integrations_slug_uq').on(t.slug),
    byBusiness: index('integrations_business_idx').on(t.businessId),
  }),
)

// Sudo-only SSRF allowlist for an integration's webhook URL. A webhook URL is
// accepted only if (scheme, host, port, path) matches a row EXACTLY, and at
// send time the resolved address must sit inside `expected_network_cidr`
// (the fixed subnet of the docker network the receiver lives on).
export const integrationWebhookAllowlist = pgTable(
  'integration_webhook_allowlist',
  {
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    scheme: text('scheme').notNull(), // 'http' | 'https'
    host: text('host').notNull(),
    port: integer('port').notNull(),
    path: text('path').notNull(),
    expectedNetworkCidr: text('expected_network_cidr').notNull(),
  },
  // Explicit short PK name: the generated one exceeds Postgres' 63-byte
  // identifier limit, gets truncated, and then re-diffs on every push.
  (t) => ({
    pk: primaryKey({
      name: 'integration_webhook_allowlist_pk',
      columns: [t.integrationId, t.scheme, t.host, t.port, t.path],
    }),
  }),
)

// Outbound webhook queue + delivery log. One row per (integration, event,
// source_key); the unique index is what absorbs the dispatcher's 60 s cursor
// lookback overlap (re-scanned messages insert ON CONFLICT DO NOTHING).
// Only the HTTP status and a coarse error class are recorded — never the
// response body or the URL.
export const integrationDeliveries = pgTable(
  'integration_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    sourceKey: text('source_key').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    attempts: integer('attempts').notNull().default(0),
    // NULL once delivered or given up (24 h backoff budget exhausted).
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    lastStatus: integer('last_status'),
    lastErrorClass: text('last_error_class'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceUq: uniqueIndex('integration_deliveries_source_uq').on(t.integrationId, t.event, t.sourceKey),
    byDue: index('integration_deliveries_due_idx').on(t.nextAttemptAt),
    byIntegration: index('integration_deliveries_integration_idx').on(t.integrationId, t.createdAt),
  }),
)

// Append-only audit trail for integration management + API lifecycle actions.
// Deliberately has NO foreign keys, so rows survive integration / business
// deletion. Never stores secrets, keys, or the Authorization header.
export const integrationAudit = pgTable(
  'integration_audit',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    integrationId: uuid('integration_id'),
    businessId: uuid('business_id'),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byIntegration: index('integration_audit_integration_idx').on(t.integrationId, t.createdAt) }),
)

export type Integration = typeof integrations.$inferSelect
export type NewIntegration = typeof integrations.$inferInsert
export type IntegrationWebhookAllow = typeof integrationWebhookAllowlist.$inferSelect
export type IntegrationDelivery = typeof integrationDeliveries.$inferSelect
export type IntegrationAuditRow = typeof integrationAudit.$inferSelect
