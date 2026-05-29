import { index, integer, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { businesses } from './businesses'
import { ticketCategories } from './ticketCategories'
import { users } from './users'

export const ticketStatuses = ['open', 'claimed', 'waiting', 'closed'] as const
export type TicketStatus = (typeof ticketStatuses)[number]

export const tickets = pgTable(
  'tickets',
  {
    id: serial('id').primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    openerUserId: uuid('opener_user_id')
      .notNull()
      .references(() => users.id),
    categoryId: uuid('category_id').references(() => ticketCategories.id),
    subject: text('subject').notNull(),
    status: text('status', { enum: ticketStatuses }).notNull().default('open'),
    assigneeUserId: uuid('assignee_user_id').references(() => users.id),

    // If the bot already has a Discord channel for this ticket, store it
    // here. Lets the web UI deep-link "Open in Discord" and dedupe inbound
    // sync events.
    discordChannelId: text('discord_channel_id'),

    priority: integer('priority').notNull().default(2), // 1=urgent .. 4=low
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedByUserId: uuid('closed_by_user_id').references(() => users.id),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byBusinessStatus: index('tickets_business_status_idx').on(t.businessId, t.status),
    byOpener: index('tickets_opener_idx').on(t.openerUserId),
    byAssignee: index('tickets_assignee_idx').on(t.assigneeUserId),
  }),
)

export type Ticket = typeof tickets.$inferSelect
export type NewTicket = typeof tickets.$inferInsert
