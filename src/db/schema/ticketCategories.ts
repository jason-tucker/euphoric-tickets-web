import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
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

    // Discord channel category (type GUILD_CATEGORY) under which to create
    // per-ticket channels for tickets opened in this category. Falls through
    // to businesses.discord_fallback_category_id when null.
    discordParentCategoryId: text('discord_parent_category_id'),

    // Per-category override for "where closed tickets go". Falls through to
    // businesses.discord_closed_category_id when null.
    discordClosedCategoryId: text('discord_closed_category_id'),

    // P1 (lantern): per-category permission tiers — bot + web enforce these
    // in P2. Empty string = inherit (anyone-can-open for allow_role_ids,
    // businesses.admin_role_ids for staff_role_ids). CSV of role snowflakes.
    allowRoleIds: text('allow_role_ids').notNull().default(''),
    staffRoleIds: text('staff_role_ids').notNull().default(''),

    // P1 (lantern, used by P4): optional custom template the bot renders as
    // the ticket's first message instead of the default welcome card.
    // Supports {{user}}, {{ticketId}}, {{subject}}, {{category}} placeholders.
    firstMessageTemplate: text('first_message_template'),

    // Staff-only destination — when true, this category is hidden from the
    // open-ticket flow everywhere (web /t/new, bot panel buttons). Staff can
    // still MOVE existing tickets into it via the change-category dropdown,
    // so it's useful for triage/archive landing zones that should never be
    // a fresh-ticket option. Distinct from `allowRoleIds`, which gates by
    // specific roles; `staffOnly` means "destination only, no opens".
    staffOnly: boolean('staff_only').notNull().default(false),

    // Default ticket kind for tickets opened in this category. `'normal'` =
    // one-off issue; `'project'` = long-term work with sub-tickets. The
    // previous Type picker on /t/new is gone — type is now a per-category
    // property. Existing tickets keep their own `tickets.kind`; this only
    // affects newly-opened ones. Sub-tickets always force `kind='normal'`
    // regardless of their category's setting.
    kind: text('kind', { enum: ['normal', 'project'] as const }).notNull().default('normal'),

    // Integration API (v0.12.0): when true, tickets in this category can ONLY
    // be opened by an integration (the bot's integration open route). The web
    // /t/new picker hides it and the action refuses it; the bot refuses panel
    // buttons for it. Sudo toggles it on /admin/integrations.
    integrationOnly: boolean('integration_only').notNull().default(false),

    // v0.12.3: when true (the default — existing behaviour), the bot's
    // ticket-open message pings the opener AND every staff role of this
    // category. When false it pings ONLY the opener; staff still get channel
    // access (permissions untouched) and the welcome card still lists the
    // staff roles without pinging them. Used for high-volume categories such
    // as the EFM Music Portal's newsong / songedit / songremoval. Editable on
    // the team settings page and on /admin/integrations/[id].
    pingStaffOnOpen: boolean('ping_staff_on_open').notNull().default(true),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ businessKey: uniqueIndex('ticket_categories_business_key_uq').on(t.businessId, t.key) }),
)

export type TicketCategory = typeof ticketCategories.$inferSelect
export type NewTicketCategory = typeof ticketCategories.$inferInsert
