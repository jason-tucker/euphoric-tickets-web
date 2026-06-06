// Cross-team "tickets console" data layer. One query returns every ticket the
// signed-in user can see across all their teams, with every field the grid
// renders. Used by BOTH the SSR shell (`/tickets`) and the JSON refetch route
// (`/api/tickets/list`) so the live client and the first paint share one shape.
//
// Scope (a ticket is visible if ANY of):
//   - it lives in a team the user administers (admin/owner), OR
//   - it lives in a category the user holds a staff role in, OR
//   - the user opened it (in any team they belong to).
// Sudo users administer every team, so they see everything.

import { and, desc, eq, inArray, or, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '@/db/client'
import { businesses, ticketCategories, tickets, users } from '@/db/schema'
import { auth } from './auth'
import { listMyBusinesses, listMyStaffCategoryIds } from './permissions'

// All dates are ISO strings so the SSR-embedded payload and the JSON refetch
// are byte-identical — the client never has to special-case Date vs string.
export type ConsoleTicket = {
  id: number
  subject: string
  status: string
  kind: string
  priority: number
  needsAttention: boolean
  externalSource: string
  openedAt: string
  lastActivityAt: string
  closedAt: string | null
  teamId: string
  teamName: string
  teamSlug: string
  discordGuildId: string | null
  discordChannelId: string | null
  categoryId: string | null
  categoryLabel: string | null
  categoryEmoji: string | null
  openerId: string | null
  openerName: string | null
  openerImage: string | null
  assigneeId: string | null
  assigneeName: string | null
  assigneeImage: string | null
}

export type ConsoleTeam = { id: string; name: string; slug: string; admin: boolean }

export type TicketsConsoleData = {
  tickets: ConsoleTicket[]
  teams: ConsoleTeam[]
  generatedAt: string
}

const EMPTY: TicketsConsoleData = { tickets: [], teams: [], generatedAt: '' }

// Whether the current user has any reason to use the cross-team console at all
// (admins a team, or staffs a category). Drives the nav tab + the page gate.
export type ConsoleScope = {
  canUse: boolean
  isAdminAnywhere: boolean
  adminTeams: ConsoleTeam[]
}

export async function ticketsConsoleScope(): Promise<ConsoleScope> {
  const session = await auth()
  if (!session?.user?.id) return { canUse: false, isAdminAnywhere: false, adminTeams: [] }

  const my = await listMyBusinesses()
  const adminTeams: ConsoleTeam[] = my
    .filter((b) => b.level === 'admin' || b.level === 'owner')
    .map((b) => ({ id: b.business.id, name: b.business.name, slug: b.business.slug, admin: true }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const isAdminAnywhere = adminTeams.length > 0

  // Admins always get the console, so only pay for the (heavier) staff-category
  // resolution when the user isn't already an admin somewhere. TopNav renders on
  // every page, so skipping this for admins keeps most navigations cheap.
  let canUse = isAdminAnywhere
  if (!isAdminAnywhere) {
    const staffCatIds = await listMyStaffCategoryIds()
    canUse = staffCatIds.length > 0
  }
  return { canUse, isAdminAnywhere, adminTeams }
}

export async function getTicketsConsoleData(): Promise<TicketsConsoleData> {
  const session = await auth()
  if (!session?.user?.id) return EMPTY

  const [my, staffCatIds] = await Promise.all([listMyBusinesses(), listMyStaffCategoryIds()])
  const allIds = my.map((b) => b.business.id)
  if (allIds.length === 0) return { ...EMPTY, generatedAt: new Date().toISOString() }

  const adminIds = my
    .filter((b) => b.level === 'admin' || b.level === 'owner')
    .map((b) => b.business.id)

  // The visibility predicate — admin teams, staffed categories, and own tickets.
  const clauses: SQL[] = []
  if (adminIds.length) clauses.push(inArray(tickets.businessId, adminIds))
  if (staffCatIds.length) clauses.push(inArray(tickets.categoryId, staffCatIds))
  clauses.push(
    and(eq(tickets.openerUserId, session.user.id), inArray(tickets.businessId, allIds)) as SQL,
  )
  const scopeWhere = clauses.length === 1 ? clauses[0] : or(...clauses)

  // Assignee needs a second alias of `users` so it doesn't collide with the
  // opener join.
  const assignee = alias(users, 'assignee')

  const rows = await db
    .select({
      id: tickets.id,
      subject: tickets.subject,
      status: tickets.status,
      kind: tickets.kind,
      priority: tickets.priority,
      needsAttention: tickets.needsAttention,
      externalSource: tickets.externalSource,
      openedAt: tickets.openedAt,
      lastActivityAt: tickets.lastActivityAt,
      closedAt: tickets.closedAt,
      teamId: businesses.id,
      teamName: businesses.name,
      teamSlug: businesses.slug,
      discordGuildId: businesses.discordGuildId,
      discordChannelId: tickets.discordChannelId,
      categoryId: tickets.categoryId,
      categoryLabel: ticketCategories.label,
      categoryEmoji: ticketCategories.emoji,
      openerId: tickets.openerUserId,
      openerName: users.name,
      openerImage: users.image,
      assigneeId: tickets.assigneeUserId,
      assigneeName: assignee.name,
      assigneeImage: assignee.image,
    })
    .from(tickets)
    .innerJoin(businesses, eq(businesses.id, tickets.businessId))
    .leftJoin(users, eq(users.id, tickets.openerUserId))
    .leftJoin(assignee, eq(assignee.id, tickets.assigneeUserId))
    .leftJoin(ticketCategories, eq(ticketCategories.id, tickets.categoryId))
    .where(scopeWhere)
    .orderBy(desc(tickets.lastActivityAt))
    .limit(1000)

  const ticketsOut: ConsoleTicket[] = rows.map((r) => ({
    id: r.id,
    subject: r.subject,
    status: r.status,
    kind: r.kind,
    priority: r.priority,
    needsAttention: r.needsAttention,
    externalSource: r.externalSource,
    openedAt: r.openedAt.toISOString(),
    lastActivityAt: r.lastActivityAt.toISOString(),
    closedAt: r.closedAt ? r.closedAt.toISOString() : null,
    teamId: r.teamId,
    teamName: r.teamName,
    teamSlug: r.teamSlug,
    discordGuildId: r.discordGuildId,
    discordChannelId: r.discordChannelId,
    categoryId: r.categoryId,
    categoryLabel: r.categoryLabel,
    categoryEmoji: r.categoryEmoji,
    openerId: r.openerId,
    openerName: r.openerName,
    openerImage: r.openerImage,
    assigneeId: r.assigneeId,
    assigneeName: r.assigneeName,
    assigneeImage: r.assigneeImage,
  }))

  // The team facet is *every* team the user can see — not just teams that
  // currently have a ticket — so the multi-select stays stable as you filter.
  const teams: ConsoleTeam[] = my
    .map((b) => ({
      id: b.business.id,
      name: b.business.name,
      slug: b.business.slug,
      admin: b.level === 'admin' || b.level === 'owner',
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { tickets: ticketsOut, teams, generatedAt: new Date().toISOString() }
}
