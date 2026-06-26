// The demo's permission + projection layer. Pure functions over the in-memory
// dataset that REPRODUCE the real permission model (listMyBusinesses /
// listMyStaffCategoryIds / ticketsConsoleScope / resolveTicketAccess) without
// any DB or Discord, plus projection of fixed ticket offsets to serializable,
// today-anchored "views" that cross to the client.

import { avatarUrl } from '@/lib/format'
import type { TicketAccessFlags } from '@/server/permissions'
import { getDemoDataset, type DemoDataset, type DemoPersonaSpec, type DemoTeam, type DemoTicketHeader, type PersonaKey } from './data'
import { MIN_MS, projectLastActivityAt, projectOpenedAt } from './dates'

export type { PersonaKey } from './data'
export { PERSONA_META } from './meta'

export function getPersona(key: PersonaKey): DemoPersonaSpec {
  return getDemoDataset().personas[key]
}

// ─── serializable ticket view (today-anchored; ConsoleTicket-compatible) ─────

export type DemoTicket = {
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
  openerDiscordId: string | null
  assigneeId: string | null
  assigneeName: string | null
  assigneeImage: string | null
  assigneeDiscordId: string | null
  priority: number
  personalScope: boolean
}

export type DemoConsoleTeam = { id: string; name: string; slug: string; admin: boolean; staff: boolean }

export type DemoScope = {
  personaKey: PersonaKey
  personaUserId: string
  personaName: string
  isSudo: boolean
  canUseConsole: boolean
  isAdminAnywhere: boolean
  businesses: { id: string; slug: string; name: string; level: 'member' | 'admin' | 'owner' | 'staff' }[]
  adminTeamIds: string[]
  staffTeamIds: string[]
  staffCategoryIds: string[]
  settingsHref: string | null
}

function userImg(ds: DemoDataset, userId: string | null): { name: string | null; image: string | null; discordId: string | null } {
  if (!userId) return { name: null, image: null, discordId: null }
  const u = ds.userById.get(userId)
  if (!u) return { name: null, image: null, discordId: null }
  return { name: u.name, image: avatarUrl(u.discordId, u.image), discordId: u.discordId }
}

export function projectTicket(
  ds: DemoDataset,
  team: DemoTeam,
  header: DemoTicketHeader,
  now: Date,
  personalScope: boolean,
): DemoTicket {
  const opener = userImg(ds, header.openerId)
  const assignee = userImg(ds, header.assigneeId)
  const cat = header.categoryId ? ds.categoryById.get(header.categoryId) : null
  const last = projectLastActivityAt(header.offset, now)
  return {
    id: header.id,
    subject: header.subject,
    status: header.status,
    kind: header.kind,
    needsAttention: header.needsAttention,
    externalSource: header.externalSource,
    openedAt: projectOpenedAt(header.offset, now).toISOString(),
    lastActivityAt: last.toISOString(),
    closedAt: header.status === 'closed' ? last.toISOString() : null,
    teamId: team.business.id,
    teamName: team.business.name,
    teamSlug: team.business.slug,
    // Null so the demo never renders a dead "Open in Discord" deep-link.
    discordGuildId: null,
    discordChannelId: null,
    categoryId: header.categoryId,
    categoryLabel: cat?.label ?? null,
    categoryEmoji: cat?.emoji ?? null,
    openerId: header.openerId,
    openerName: opener.name,
    openerImage: opener.image,
    openerDiscordId: opener.discordId,
    assigneeId: header.assigneeId,
    assigneeName: assignee.name,
    assigneeImage: assignee.image,
    assigneeDiscordId: assignee.discordId,
    priority: header.priority,
    personalScope,
  }
}

// ─── the real-model mirror ───────────────────────────────────────────────

// teams the persona can "see" with a resolved level (mirror of listMyBusinesses).
// 'staff' is the new team-wide tier: can see/claim/reply/close all tickets but
// cannot edit settings or delete channels.
export function demoListMyBusinesses(persona: DemoPersonaSpec): { team: DemoTeam; level: 'member' | 'admin' | 'owner' | 'staff' }[] {
  const ds = getDemoDataset()
  if (persona.isSudo) return ds.teams.map((team) => ({ team, level: 'owner' as const }))
  const out: { team: DemoTeam; level: 'member' | 'admin' | 'owner' | 'staff' }[] = []
  for (const team of ds.teams) {
    if (!persona.guildIds.has(team.guildId)) continue
    const bizId = team.business.id
    const level: 'member' | 'admin' | 'owner' | 'staff' = persona.adminTeamIds.has(bizId)
      ? 'admin'
      : persona.staffTeamIds.has(bizId)
      ? 'staff'
      : 'member'
    out.push({ team, level })
  }
  return out
}

function adminTeamIdSet(persona: DemoPersonaSpec): Set<string> {
  if (persona.isSudo) return new Set(getDemoDataset().teams.map((t) => t.business.id))
  return persona.adminTeamIds
}

function staffTeamIdSet(persona: DemoPersonaSpec): Set<string> {
  if (persona.isSudo) return new Set() // sudo is admin everywhere; staff tier is redundant
  return persona.staffTeamIds
}

export function demoScope(persona: DemoPersonaSpec): DemoScope {
  const ds = getDemoDataset()
  const mine = demoListMyBusinesses(persona)
  const adminTeams = mine.filter((m) => m.level === 'admin' || m.level === 'owner')
  const isAdminAnywhere = adminTeams.length > 0
  // Console is accessible to admins, category-level staff, AND team-wide staff.
  const canUseConsole = isAdminAnywhere || persona.staffCategoryIds.size > 0 || persona.staffTeamIds.size > 0
  const businesses = mine
    .map((m) => ({ id: m.team.business.id, slug: m.team.business.slug, name: m.team.business.name, level: m.level }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const firstAdmin = adminTeams.slice().sort((a, b) => a.team.business.name.localeCompare(b.team.business.name))[0]
  return {
    personaKey: persona.key,
    personaUserId: persona.userId,
    personaName: ds.userById.get(persona.userId)?.name ?? 'Demo user',
    isSudo: persona.isSudo,
    canUseConsole,
    isAdminAnywhere,
    businesses,
    adminTeamIds: [...adminTeamIdSet(persona)],
    staffTeamIds: [...staffTeamIdSet(persona)],
    staffCategoryIds: [...persona.staffCategoryIds],
    settingsHref: firstAdmin ? `/demo/b/${firstAdmin.team.business.slug}/settings` : null,
  }
}

// Every ticket the persona can see, today-anchored, sorted by last activity, and
// capped (mirror of getTicketsConsoleData scope + the real 1000-row limit). Used
// to seed the dashboard and the console; the client merges its localStorage
// overlay on top.
export function demoVisibleTickets(persona: DemoPersonaSpec, now: Date, cap = 1000): DemoTicket[] {
  const ds = getDemoDataset()
  const adminIds = adminTeamIdSet(persona)
  const staffIds = staffTeamIdSet(persona)
  const staffCats = persona.staffCategoryIds
  const visibleTeams = demoListMyBusinesses(persona).map((m) => m.team)

  type Cand = { team: DemoTeam; header: DemoTicketHeader; lastMs: number; personalScope: boolean }
  const cands: Cand[] = []
  for (const team of visibleTeams) {
    const isAdminTeam = adminIds.has(team.business.id)
    // Team-wide staff can see ALL tickets in the team (not just their category).
    const isStaffTeam = staffIds.has(team.business.id)
    for (const header of ds.headersByTeam.get(team.business.id) ?? []) {
      const isOpener = header.openerId === persona.userId
      const isStaffCat = header.categoryId != null && staffCats.has(header.categoryId)
      if (!isOpener && !isStaffCat && !isAdminTeam && !isStaffTeam) continue
      cands.push({
        team,
        header,
        lastMs: projectLastActivityAt(header.offset, now).getTime(),
        // Team-wide staff (like category-staff) reach these WITHOUT admin, so
        // they count as personal scope — shown with the console's Admin view off.
        // Mirrors the real app (staffBizSet → personalScope in getTicketsConsoleData).
        personalScope: isOpener || isStaffCat || isStaffTeam,
      })
    }
  }
  cands.sort((a, b) => b.lastMs - a.lastMs || a.header.id - b.header.id)
  return cands.slice(0, cap).map((c) => projectTicket(ds, c.team, c.header, now, c.personalScope))
}

export function demoConsoleTeams(persona: DemoPersonaSpec): DemoConsoleTeam[] {
  const ds = getDemoDataset()
  const adminIds = adminTeamIdSet(persona)
  const teamWideStaffIds = staffTeamIdSet(persona)
  // Category-level staff: derive the team IDs from the staffed category IDs.
  const catStaffTeamIds = new Set<string>()
  for (const catId of persona.staffCategoryIds) {
    const cat = ds.categoryById.get(catId)
    if (cat) catStaffTeamIds.add(cat.businessId)
  }
  return demoListMyBusinesses(persona)
    .map((m) => ({
      id: m.team.business.id,
      name: m.team.business.name,
      slug: m.team.business.slug,
      admin: adminIds.has(m.team.business.id),
      // staff = true for both category-level and team-wide staff — single flag,
      // matching the real ConsoleTeam (no separate team-wide badge).
      staff: catStaffTeamIds.has(m.team.business.id) || teamWideStaffIds.has(m.team.business.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Per-ticket access flags (mirror of resolveTicketAccess) — drives which live
// controls the demo ticket page shows for the active persona.
export function demoTicketAccess(persona: DemoPersonaSpec, team: DemoTeam, header: DemoTicketHeader): TicketAccessFlags {
  const isAdmin = persona.isSudo || persona.adminTeamIds.has(team.business.id)
  const isOpener = header.openerId === persona.userId
  // isStaff = true for category-level staff OR team-wide staff (new tier).
  const isTeamWideStaff = persona.staffTeamIds.has(team.business.id)
  const isStaff = isAdmin || isTeamWideStaff || (header.categoryId != null && persona.staffCategoryIds.has(header.categoryId))
  return {
    isAdmin,
    isStaff,
    isOpener,
    canSee: isAdmin || isStaff || isOpener,
    canReply: isAdmin || isStaff || isOpener,
    canClaim: isAdmin || isStaff,
    canClose: isAdmin || isStaff || isOpener,
    // Team-wide staff cannot change category or delete channel (matches real spec).
    canChangeCategory: isAdmin,
    canManageMembers: isAdmin || isStaff,
    canDeleteChannel: isAdmin,
  }
}

export type DemoTeamOverview = {
  team: { slug: string; name: string; description: string | null }
  visible: boolean
  isAdmin: boolean
  stats: { open: number; claimed: number; waiting: number; closedToday: number }
  myTickets: DemoTicket[]
}

// Per-team overview (mirror of /b/[slug]): admin stat tiles + the persona's own
// recent tickets in this team.
export function demoTeamOverview(persona: DemoPersonaSpec, slug: string, now: Date): DemoTeamOverview | null {
  const ds = getDemoDataset()
  const team = ds.teamBySlug.get(slug)
  if (!team) return null
  const entry = demoListMyBusinesses(persona).find((m) => m.team.business.id === team.business.id)
  const base = { slug: team.business.slug, name: team.business.name, description: team.business.description }
  if (!entry) return { team: base, visible: false, isAdmin: false, stats: { open: 0, claimed: 0, waiting: 0, closedToday: 0 }, myTickets: [] }

  const isAdmin = entry.level === 'admin' || entry.level === 'owner'
  const headers = ds.headersByTeam.get(team.business.id) ?? []
  const dayAgo = now.getTime() - 24 * 60 * MIN_MS
  let open = 0
  let claimed = 0
  let waiting = 0
  let closedToday = 0
  for (const h of headers) {
    if (h.status === 'open') open++
    else if (h.status === 'in_progress' || h.status === 'claimed') claimed++
    else if (h.status === 'waiting') waiting++
    else if (h.status === 'closed' && projectLastActivityAt(h.offset, now).getTime() > dayAgo) closedToday++
  }
  const myTickets = headers
    .filter((h) => h.openerId === persona.userId)
    .map((h) => ({ header: h, lastMs: projectLastActivityAt(h.offset, now).getTime() }))
    .sort((a, b) => b.lastMs - a.lastMs)
    .slice(0, 10)
    .map(({ header }) => projectTicket(ds, team, header, now, true))

  return { team: base, visible: true, isAdmin, stats: { open, claimed, waiting, closedToday }, myTickets }
}
