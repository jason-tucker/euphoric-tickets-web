import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { tickets } from './tickets'
import { users } from './users'

// 'internal' = staff-only note; lives in a Discord thread off the main
// ticket channel (lazily created). See euphoric-tickets-web#5.
export const messageSources = ['web', 'discord', 'system', 'internal'] as const
export type MessageSource = (typeof messageSources)[number]

// Who wrote a row. 'integration' = posted through POST
// /api/v1/tickets/:id/messages; EVERY other insert path (web replies, bot
// relay, internal notes, system rows) leaves the column at its 'human'
// default. The webhook dispatcher never echoes 'integration' rows back to the
// integration that wrote them.
export const messageAuthorKinds = ['human', 'integration'] as const
export type MessageAuthorKind = (typeof messageAuthorKinds)[number]

// One captured Discord attachment. `url` is Discord's signed CDN URL, which
// expires (~24h) — the web never relies on it directly; it refreshes a fresh
// URL on demand via the bot token (audio playback streams from Discord's CDN,
// nothing is stored on the VPS). We keep `url` only as a last-resort fallback.
export type MessageAttachment = {
  id: string
  name: string
  url: string
  contentType: string | null
  size: number
}

export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ticketId: integer('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').references(() => users.id),
    body: text('body').notNull(),
    source: text('source', { enum: messageSources }).notNull(),

    // Discord webhook returns the message ID we created; store it so we can
    // dedupe inbound bot-relay events that re-broadcast the same message.
    discordMessageId: text('discord_message_id'),

    // Captured Discord attachments (audio, images, files). Empty array when
    // the message had none. URLs here are signed + expiring; the web
    // refreshes them on demand via the bot token.
    attachments: jsonb('attachments').$type<MessageAttachment[]>().notNull().default([]),

    // Integration API (v0.12.0). `metadata` carries {integrationId, itemRef,
    // actorDiscordId, kind} on integration-authored rows; `{}` elsewhere.
    // `idempotency_key` is the client's Idempotency-Key header; unique per
    // ticket (NULLs distinct, so non-integration rows never collide).
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    authorKind: text('author_kind', { enum: messageAuthorKinds }).notNull().default('human'),
    idempotencyKey: text('idempotency_key'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTicket: index('ticket_messages_ticket_idx').on(t.ticketId, t.createdAt),
    // The bot dedupes every relayed Discord message (and the convert/backfill
    // paths) by discord_message_id. Plain index, NOT unique — uniqueness would
    // make drizzle-kit push fail if prod ever holds a duplicate row.
    byDiscordMessage: index('ticket_messages_discord_message_idx').on(t.discordMessageId),
    idempotencyUq: uniqueIndex('ticket_messages_ticket_idempotency_uq').on(t.ticketId, t.idempotencyKey),
  }),
)

export type TicketMessage = typeof ticketMessages.$inferSelect
export type NewTicketMessage = typeof ticketMessages.$inferInsert
