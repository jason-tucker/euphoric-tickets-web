import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { businesses } from './businesses'
import { tickets } from './tickets'
import { users } from './users'

// Lifecycle event log for tickets. Each row is one "something happened" event:
// claim, status change, add/remove a member, etc. Both the web (server
// actions) and the bot (slash commands + button handlers) write here.
//
// Separate from `ticket_messages` so the conversation feed and the audit
// timeline can have independent rendering decisions — chat bubbles vs.
// compact "X did Y" lines — without one fighting the other. The ticket
// detail page joins both streams by `created_at` for the merged conversation
// view (system events render as small Discord-style "joined the channel"
// lines), and the Log section beneath the conversation shows just the
// audit rows for the full lifecycle history.
//
// `business_id` is NOT NULL so the table can be used for business-scoped
// audits later (e.g. settings changes). `ticket_id` IS nullable for that
// same reason. Index on (ticket_id, created_at) is the hot path; the
// per-business index supports a future audit-tail view.
export const auditActions = [
  'opened',
  'claimed',
  'unclaimed',
  'status_changed',
  'assigned',
  'unassigned',
  'category_changed',
  'member_added',
  'member_removed',
  'owner_changed',
  'closed',
  'reopened',
  'channel_deleted',
  'renamed',
] as const
export type AuditAction = (typeof auditActions)[number]

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    ticketId: integer('ticket_id').references(() => tickets.id, { onDelete: 'cascade' }),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    action: text('action', { enum: auditActions }).notNull(),
    // Free-form per-action payload — `{from, to}` for status_changed /
    // category_changed, `{discordUserId, name}` for member_added /
    // member_removed / owner_changed / assigned, etc. Renderers read what
    // they expect for each action.
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byTicket: index('audit_logs_ticket_idx').on(t.ticketId, t.createdAt),
    byBusiness: index('audit_logs_business_idx').on(t.businessId, t.createdAt),
  }),
)

export type AuditLog = typeof auditLogs.$inferSelect
export type NewAuditLog = typeof auditLogs.$inferInsert
