import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { businesses } from './businesses'

// Open-ticket form options. Each row is one button/dropdown item.
export const ticketCategories = pgTable(
  'ticket_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    emoji: text('emoji'),
    description: text('description'),
    sortOrder: text('sort_order').notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ businessKey: uniqueIndex('ticket_categories_business_key_uq').on(t.businessId, t.key) }),
)

export type TicketCategory = typeof ticketCategories.$inferSelect
export type NewTicketCategory = typeof ticketCategories.$inferInsert
