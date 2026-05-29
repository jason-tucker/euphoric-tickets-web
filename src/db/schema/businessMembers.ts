import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { businesses } from './businesses'
import { users } from './users'

// Snapshot of "this Discord user is in this business's guild, at this role
// level" — refreshed on every login (so a Discord role removal is reflected
// the next time the user signs in). Plus DB-authoritative `role` for cases
// where Discord roles don't map cleanly (e.g. an external client we want to
// give per-business member access without a Discord role).
export const businessMembers = pgTable(
  'business_members',
  {
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['member', 'admin', 'owner'] }).notNull().default('member'),
    // Snapshot of the Discord role IDs the user had in this business's guild
    // at last login. Stored as JSON-encoded array of snowflake strings for
    // simplicity (this gets overwritten, never queried by individual role).
    discordRolesSnapshot: text('discord_roles_snapshot').notNull().default('[]'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.businessId, t.userId] }) }),
)

export type BusinessMember = typeof businessMembers.$inferSelect
export type NewBusinessMember = typeof businessMembers.$inferInsert
