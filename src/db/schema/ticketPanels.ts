import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { businesses } from './businesses'

// One row per posted ticket-panel message. Used by the bot's
// `/panel post` and `/panel refresh` commands to find the message it
// previously posted in a channel. Tracked on the shared DB even though
// only the bot currently writes to it — the web will gain panel-management
// surfaces in a follow-up (Phase C, euphoric-tickets#6).
export const ticketPanels = pgTable('ticket_panels', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').references(() => businesses.id, { onDelete: 'cascade' }),
  // Discord guild + channel + message snowflakes. Guild is denormalised so
  // panel-lookup paths don't need to join businesses; business_id is the
  // canonical FK.
  guildId: text('guild_id').notNull(),
  channelId: text('channel_id').notNull(),
  messageId: text('message_id').notNull().unique(),
  postedByDiscordId: text('posted_by_discord_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type TicketPanel = typeof ticketPanels.$inferSelect
export type NewTicketPanel = typeof ticketPanels.$inferInsert
