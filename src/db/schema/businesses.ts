import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

// One row per tenant. A business is uniquely tied to a Discord guild.
export const businesses = pgTable('businesses', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),

  // The Discord guild this business lives in. One business per guild.
  discordGuildId: text('discord_guild_id').notNull().unique(),

  // Comma-separated snowflakes (we keep it as text + parse on read so the
  // settings UI can post a single CSV form value).
  adminRoleIds: text('admin_role_ids').notNull().default(''),

  // Outbound webhook for posting web replies back to Discord. Required for
  // the per-user spoof flow to work. Format: full https://discord.com/api/webhooks/<id>/<token>
  webhookUrl: text('webhook_url'),

  // Free-form JSON for forward-compat (color, custom labels, etc.).
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Business = typeof businesses.$inferSelect
export type NewBusiness = typeof businesses.$inferInsert
