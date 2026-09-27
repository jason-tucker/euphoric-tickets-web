import { integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { integrations } from './integrations'
import { tickets } from './tickets'
import { users } from './users'

// Kept apart from integrations.ts so tickets.ts → integrations.ts has no
// import cycle (these two tables reference tickets).

// Per-ticket dispatcher state for integration tickets. `last_status` /
// `last_assignee` are diffed against the live ticket row on each sweep to emit
// status / claim / close events; (`msg_cursor_created_at`, `msg_cursor_id`) is
// the message cursor (swept with a 60 s lookback overlap).
export const integrationTicketState = pgTable('integration_ticket_state', {
  ticketId: integer('ticket_id')
    .primaryKey()
    .references(() => tickets.id, { onDelete: 'cascade' }),
  lastStatus: text('last_status'),
  lastAssignee: uuid('last_assignee').references(() => users.id, { onDelete: 'set null' }),
  msgCursorCreatedAt: timestamp('msg_cursor_created_at', { withTimezone: true }),
  msgCursorId: uuid('msg_cursor_id'),
})

// Idempotent-open claims, written by the BOT's open route (§4.4 of the plan):
// INSERT … ON CONFLICT DO NOTHING on (integration_id, external_ref) decides
// who opens the channel. The web only declares the table.
export const integrationOpenClaimStates = ['opening', 'open', 'failed'] as const
export type IntegrationOpenClaimState = (typeof integrationOpenClaimStates)[number]

export const integrationOpenClaims = pgTable(
  'integration_open_claims',
  {
    integrationId: uuid('integration_id')
      .notNull()
      .references(() => integrations.id, { onDelete: 'cascade' }),
    externalRef: text('external_ref').notNull(),
    state: text('state', { enum: integrationOpenClaimStates }).notNull(),
    channelId: text('channel_id'),
    ticketId: integer('ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.integrationId, t.externalRef] }) }),
)

export type IntegrationTicketState = typeof integrationTicketState.$inferSelect
export type IntegrationOpenClaim = typeof integrationOpenClaims.$inferSelect
