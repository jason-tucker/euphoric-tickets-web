import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// Bot-owner ("sudo") global settings that aren't scoped to a single business —
// e.g. the bot's display name. A flat key/value store so new sudo settings
// don't each need a column/migration. Written from the web's Sudo surfaces
// (/admin/bot); the bot applies select keys (the username is pushed to Discord
// via the internal HTTP endpoint at save time).
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type AppSetting = typeof appSettings.$inferSelect
export type NewAppSetting = typeof appSettings.$inferInsert
