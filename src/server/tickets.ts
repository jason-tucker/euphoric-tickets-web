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

import { and, desc, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '@/db/client'
import { businesses, ticketCategories, ticketMessages, tickets, users } from '@/db/schema'
import { auth } from './auth'
import { listMyBusinesses, listMyStaffCategoryIds } from './permissions'

// All dates are ISO strings so the SSR-embedded payload and the JSON refetch
// are byte-identical — the client never has to special-case Date vs string.
export type ConsoleTicket = {
  id: number
  subject: string
  status: string
  kind: string
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

export type ConsoleTeam = { id: string; name: string; slug: string; admin: boolean; staff: boolean }

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
  adminTeams: { id: string; name: string; slug: string }[]
}

export async function ticketsConsoleScope(): Promise<ConsoleScope> {
  const session = await auth()
  if (!session?.user?.id) return { canUse: false, isAdminAnywhere: false, adminTeams: [] }

  const my = await listMyBusinesses()
  const adminTeams = my
    .filter((b) => b.level === 'admin' || b.level === 'owner')
    .map((b) => ({ id: b.business.id, name: b.business.name, slug: b.business.slug }))
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

// Normalize an aggregate timestamp (Date or ISO string, depending on the
// driver) to an ISO string, falling back to `fallback` when there's no value.
function toIso(d: Date | string | null | undefined, fallback: Date): string {
  if (d == null) return fallback.toISOString()
  return (typeof d === 'string' ? new Date(d) : d).toISOString()
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
      openerDiscordId: users.discordId,
      assigneeId: tickets.assigneeUserId,
      assigneeName: assignee.name,
      assigneeImage: assignee.image,
      assigneeDiscordId: assignee.discordId,
    })
    .from(tickets)
    .innerJoin(businesses, eq(businesses.id, tickets.businessId))
    .leftJoin(users, eq(users.id, tickets.openerUserId))
    .leftJoin(assignee, eq(assignee.id, tickets.assigneeUserId))
    .leftJoin(ticketCategories, eq(ticketCategories.id, tickets.categoryId))
    .where(scopeWhere)
    .orderBy(desc(tickets.lastActivityAt))
    .limit(1000)

  // Opened / Last activity should track the real conversation, not the ticket
  // row's bookkeeping columns (which drift for ingested TicketTool tickets):
  // first message timestamp = opened, last message timestamp = last activity.
  // One grouped aggregate over ticket_messages; fall back to the ticket columns
  // when a ticket has no messages yet.
  const ids = rows.map((r) => r.id)
  const msgTimes = new Map<number, { first: Date | string | null; last: Date | string | null }>()
  if (ids.length) {
    const agg = await db
      .select({
        ticketId: ticketMessages.ticketId,
        firstAt: sql<Date | null>`min(${ticketMessages.createdAt})`,
        lastAt: sql<Date | null>`max(${ticketMessages.createdAt})`,
      })
      .from(ticketMessages)
      .where(inArray(ticketMessages.ticketId, ids))
      .groupBy(ticketMessages.ticketId)
    for (const a of agg) msgTimes.set(a.ticketId, { first: a.firstAt, last: a.lastAt })
  }

  // Opener/assignee identities should match what shows inside a Discord ticket
  // — the per-guild server nickname + server avatar, not the global account.
  // resolveGuildIdentities is cached ~5 min per (guild,user), so the live
  // refetch path stays cheap; we fall back to the global users.* on any miss.
  const identityByGuild = new Map<string, Map<string, { name: string; image: string | null }>>()
  const botToken = process.env.DISCORD_BOT_TOKEN
  if (botToken) {
    const byGuild = new Map<string, Set<string>>()
    for (const r of rows) {
      if (!r.discordGuildId) continue
      const set = byGuild.get(r.discordGuildId) ?? new Set<string>()
      if (r.openerDiscordId) set.add(r.openerDiscordId)
      if (r.assigneeDiscordId) set.add(r.assigneeDiscordId)
      byGuild.set(r.discordGuildId, set)
    }
    const { resolveGuildIdentities } = await import('@/lib/discord')
    await Promise.all(
      [...byGuild.entries()].map(async ([gid, gids]) => {
        try {
          identityByGuild.set(gid, await resolveGuildIdentities(botToken, gid, [...gids]))
        } catch {
          /* guild unreachable — fall back to global identities */
        }
      }),
    )
  }

  const ticketsOut: ConsoleTicket[] = rows.map((r) => {
    const gm = r.discordGuildId ? identityByGuild.get(r.discordGuildId) : undefined
    const openerIdent = r.openerDiscordId ? gm?.get(r.openerDiscordId) : undefined
    const assigneeIdent = r.assigneeDiscordId ? gm?.get(r.assigneeDiscordId) : undefined
    const mt = msgTimes.get(r.id)
    return {
      id: r.id,
      subject: r.subject,
      status: r.status,
      kind: r.kind,
      needsAttention: r.needsAttention,
      externalSource: r.externalSource,
      openedAt: toIso(mt?.first, r.openedAt),
      lastActivityAt: toIso(mt?.last, r.lastActivityAt),
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
      openerName: openerIdent?.name ?? r.openerName,
      openerImage: openerIdent?.image ?? r.openerImage,
      assigneeId: r.assigneeId,
      assigneeName: assigneeIdent?.name ?? r.assigneeName,
      assigneeImage: assigneeIdent?.image ?? r.assigneeImage,
    }
  })

  // Which teams the viewer actually *staffs* (holds a Discord staff role in one
  // of its ticket categories) vs only administers. Staff is the *primary* reason
  // for access; admin is the fallback for categories you'd otherwise never reach
  // — so a team you both admin AND staff must read as "staff" (shown by default),
  // not "admin" (hidden by default).
  //
  // This deliberately uses the viewer's LIVE guild roles, not the cached
  // business_members snapshot: resolveBusinessAccess stores an empty role list
  // for admins and sudo users (it never fetches their roles), so the snapshot
  // would falsely report "no staff role" and mislabel every such team as admin.
  // fetchGuildMemberRoles is cached ~5 min per (guild,user).
  const staffTeamIds = new Set<string>()
  if (botToken && allIds.length) {
    const staffCats = await db
      .select({ businessId: ticketCategories.businessId, staffRoleIds: ticketCategories.staffRoleIds })
      .from(ticketCategories)
      .where(and(inArray(ticketCategories.businessId, allIds), ne(ticketCategories.staffRoleIds, '')))
    if (staffCats.length) {
      const guildByBiz = new Map(my.map((b) => [b.business.id, b.business.discordGuildId]))
      const guildsNeeded = new Set<string>()
      for (const c of staffCats) {
        const g = guildByBiz.get(c.businessId)
        if (g) guildsNeeded.add(g)
      }
      const { fetchGuildMemberRoles } = await import('@/lib/discord')
      const rolesByGuild = new Map<string, string[]>()
      await Promise.all(
        [...guildsNeeded].map(async (g) => {
          const r = await fetchGuildMemberRoles(botToken, g, session.user.discordId)
          if (r) rolesByGuild.set(g, r)
        }),
      )
      for (const c of staffCats) {
        const g = guildByBiz.get(c.businessId)
        const userRoles = g ? rolesByGuild.get(g) : undefined
        if (!userRoles) continue
        const staffIds = c.staffRoleIds.split(',').map((s) => s.trim()).filter(Boolean)
        if (staffIds.some((r) => userRoles.includes(r))) staffTeamIds.add(c.businessId)
      }
    }
  }

  // The team facet is *every* team the user can see — not just teams that
  // currently have a ticket — so the multi-select stays stable as you filter.
  const teams: ConsoleTeam[] = my
    .map((b) => ({
      id: b.business.id,
      name: b.business.name,
      slug: b.business.slug,
      admin: b.level === 'admin' || b.level === 'owner',
      staff: staffTeamIds.has(b.business.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return { tickets: ticketsOut, teams, generatedAt: new Date().toISOString() }
}
