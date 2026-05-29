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

  // Legacy single-channel webhook — used as a fallback when per-ticket
  // channels can't be created (bot token missing or guild misconfigured).
  // Format: full https://discord.com/api/webhooks/<id>/<token>
  webhookUrl: text('webhook_url'),

  // Discord channel category (type GUILD_CATEGORY) under which to create
  // per-ticket channels when the ticket's own category doesn't define one.
  // If both this and the per-category mapping are null, we fall back to
  // posting to webhookUrl in a single shared channel.
  discordFallbackCategoryId: text('discord_fallback_category_id'),

  // Free-form JSON for forward-compat (color, custom labels, etc.).
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Business = typeof businesses.$inferSelect
export type NewBusiness = typeof businesses.$inferInsert
