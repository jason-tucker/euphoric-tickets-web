import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

// One row per tenant. Multiple businesses MAY share a Discord guild — the
// web is slug-scoped (/b/<slug>) and `listMyBusinesses` already iterates
// every business whose guild the user is in, so several tenants can live in
// one server. The slug stays globally unique; the guild id does not.
export const businesses = pgTable('businesses', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),

  // The Discord guild this business lives in. NOT unique — a guild can host
  // multiple businesses. (Bot ticket-opening still resolves one business per
  // guild via getBusinessByGuildId; that's a known follow-up if a guild needs
  // multiple bot-driven panels.)
  discordGuildId: text('discord_guild_id').notNull(),

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

  // Per-business "Closed tickets" Discord category. On ticket close the
  // per-ticket channel is moved here (instead of just renamed). Per-category
  // override lives on ticket_categories.discord_closed_category_id.
  discordClosedCategoryId: text('discord_closed_category_id'),

  // Auto-delete closed tickets older than this many days. Null = keep forever.
  // Bot scheduled job consumes this (issue: euphoric-tickets#5).
  deleteClosedAfterDays: integer('delete_closed_after_days'),

  // 'business' or 'client' — affects UI nouns. See euphoric-tickets-web#9.
  terminology: text('terminology', { enum: ['business', 'client'] }).notNull().default('business'),

  // Structural distinction (web#12).
  //   host   = vendor that operates the ticket system (e.g. EuphoricFM).
  //   client = visitor org whose members come in and open tickets at a host
  //            (e.g. Echo Studios working with EuphoricFM).
  // Client businesses must have parent_business_id pointing at a host.
  kind: text('kind', { enum: ['host', 'client'] }).notNull().default('host'),
  parentBusinessId: uuid('parent_business_id'),

  // Which ticket system this team runs. 'euphoric' (default) = native tickets
  // via panels + web. 'tickettool' = the team is run by the third-party
  // TicketTool bot; euphoric disables its own ticket-opening and instead
  // ingests + controls TicketTool's tickets (see ticketToolCategoryIds).
  ticketMode: text('ticket_mode').notNull().default('euphoric'),

  // TicketTool coexistence. CSV of GUILD_CATEGORY snowflakes that the
  // third-party TicketTool bot opens its ticket channels under. The bot
  // watches these categories (when ticket_mode='tickettool'), ingests those
  // channels as tickets (external_source='tickettool'), and controls them via
  // TicketTool's $-prefix commands.
  ticketToolCategoryIds: text('ticket_tool_category_ids').notNull().default(''),
  // The command prefix configured in this server's TicketTool (Server Configs
  // → Prefix). Used when the bot emits control commands. Default '$'.
  ticketToolPrefix: text('ticket_tool_prefix').notNull().default('$'),

  // Free-form JSON for forward-compat (color, custom labels, etc.).
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Values for businesses.ticket_mode. Plain text column (not a pg enum) to keep
// drizzle-kit push --force friction-free; this const is the app-level truth.
export const ticketModes = ['euphoric', 'tickettool'] as const
export type TicketMode = (typeof ticketModes)[number]

export type Business = typeof businesses.$inferSelect
export type NewBusiness = typeof businesses.$inferInsert
