import { boolean, index, integer, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { businesses } from './businesses'
import { ticketCategories } from './ticketCategories'
import { users } from './users'

// 'claimed' is legacy (kept for old rows) — new claims set 'in_progress'.
export const ticketStatuses = [
  'open',
  'claimed',
  'in_progress',
  'waiting',
  'on_hold',
  'completed',
  'closed',
] as const
export type TicketStatus = (typeof ticketStatuses)[number]

export const ticketKinds = ['normal', 'project'] as const
export type TicketKind = (typeof ticketKinds)[number]

export const tickets = pgTable(
  'tickets',
  {
    id: serial('id').primaryKey(),
    // The team operating this ticket. Always set.
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    openerUserId: uuid('opener_user_id')
      .notNull()
      .references(() => users.id),
    categoryId: uuid('category_id').references(() => ticketCategories.id),
    subject: text('subject').notNull(),
    status: text('status', { enum: ticketStatuses }).notNull().default('open'),
    kind: text('kind', { enum: ticketKinds }).notNull().default('normal'),
    // Sub-tickets reference a `kind='project'` parent. Normal tickets are
    // always null. See euphoric-tickets-web#6.
    parentTicketId: integer('parent_ticket_id'),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id),

    // Per-ticket Discord channel, created on open by whichever side opens
    // first (web via bot token, or bot via gateway). Lets the web UI
    // deep-link "Open in Discord" and dedupes inbound sync events.
    discordChannelId: text('discord_channel_id'),

    // Webhook created on the per-ticket channel for posting user-spoofed
    // replies from the web. Stored so we don't recreate one per reply.
    discordWebhookId: text('discord_webhook_id'),
    discordWebhookUrl: text('discord_webhook_url'),

    // Discord thread created lazily off the channel for internal staff notes.
    // Null until the first internal note is posted. See euphoric-tickets-web#5.
    discordInternalThreadId: text('discord_internal_thread_id'),

    priority: integer('priority').notNull().default(2), // 1=urgent .. 4=low
    // P11: set by the bot's startup resync when a ticket's Discord channel
    // has vanished, so staff can spot orphaned tickets on the web.
    needsAttention: boolean('needs_attention').notNull().default(false),

    // Origin of the ticket. 'euphoric' = opened through this system (panel,
    // /tickets, or web). 'tickettool' = a channel the third-party TicketTool
    // bot opened that we ingest into the unified archive and control via its
    // $-prefix commands. See euphoric-tickets#TicketTool-coexistence.
    externalSource: text('external_source').notNull().default('euphoric'),
    // Optional tickettool.xyz transcript URL captured from a TicketTool ticket.
    externalTranscriptUrl: text('external_transcript_url'),

    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedByUserId: uuid('closed_by_user_id').references(() => users.id),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byBusinessStatus: index('tickets_business_status_idx').on(t.businessId, t.status),
    byOpener: index('tickets_opener_idx').on(t.openerUserId),
    byAssignee: index('tickets_assignee_idx').on(t.assigneeUserId),
    byExternalSource: index('tickets_external_source_idx').on(t.externalSource),
  }),
)

// Values for tickets.external_source. Kept as a plain text column (not a pg
// enum) so drizzle-kit push --force stays friction-free; this const is the
// app-level source of truth.
export const ticketExternalSources = ['euphoric', 'tickettool'] as const
export type TicketExternalSource = (typeof ticketExternalSources)[number]

export type Ticket = typeof tickets.$inferSelect
export type NewTicket = typeof tickets.$inferInsert
