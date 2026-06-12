import { cache } from 'react'
import { redirect } from 'next/navigation'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { auth, type DiscordGuildSnapshot } from './auth'
import { db } from '@/db/client'
import {
  businesses,
  businessMembers,
  ticketCategories,
  ticketExternalMembers,
  users,
  type Business,
} from '@/db/schema'

export type AccessLevel = 'member' | 'admin' | 'owner'

export type ResolvedBusiness = {
  business: Business
  level: AccessLevel
}

const LEVEL_RANK: Record<AccessLevel, number> = { member: 0, admin: 1, owner: 2 }

function hasAtLeast(actual: AccessLevel, required: AccessLevel): boolean {
  return LEVEL_RANK[actual] >= LEVEL_RANK[required]
}

function parseCsv(input: string): string[] {
  return input.split(',').map((s) => s.trim()).filter(Boolean)
}

// Derive an access level for a single business from the user's Discord
// guild snapshot. `null` means the user is not in this business's guild
// (and so doesn't see the business at all).
function deriveLevel(b: Business, guilds: DiscordGuildSnapshot[]): AccessLevel | null {
  const g = guilds.find((g) => g.id === b.discordGuildId)
  if (!g) return null

  // Discord guild permissions bitfield: ADMINISTRATOR = 1 << 3 = 8,
  // MANAGE_GUILD ("Manage Server") = 1 << 5 = 32.
  const perms = BigInt(g.permissions || '0')
  if ((perms & 8n) === 8n) return 'owner'
  if ((perms & 32n) === 32n) return 'admin'

  // Otherwise the user may still be a role-level admin ("Ticket Master" — a
  // role in the team's admin_role_ids). We don't have per-role data on the
  // snapshot; the OAuth scope `guilds` alone returns only owner / permissions.
  // That role-level check needs the bot's view of the member and is done in
  // `resolveBusinessAccess` below.
  return 'member'
}

// Cheap path: list businesses the user can see without making extra Discord
// API calls. Returns `member`-level on each; if you need to know whether
// the user is an admin, call `resolveBusinessAccess(slug)` per business.
//
// Sudo users see every business as `owner`, regardless of guild membership.
//
// Wrapped in React.cache so a single request that hits both the app chrome and a
// page-level call returns the same DB result (Postgres round-trip once).
export const listMyBusinesses = cache(async function listMyBusinesses(): Promise<ResolvedBusiness[]> {
  const session = await auth()
  if (!session?.user?.id) return []

  if (await isSudo(session.user.id)) {
    const rows = await db.select().from(businesses)
    return rows.map((b) => ({ business: b, level: 'owner' as const }))
  }

  const guilds = session.guilds ?? []
  if (guilds.length === 0) return []

  const guildIds = guilds.map((g) => g.id)
  const rows = await db
    .select()
    .from(businesses)
    .where(inArray(businesses.discordGuildId, guildIds))

  const out: ResolvedBusiness[] = []
  for (const b of rows) {
    const level = deriveLevel(b, guilds)
    if (level) out.push({ business: b, level })
  }
  return out
})

async function isSudo(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ isSudo: users.isSudo })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return !!row?.isSudo
}

// The set of `ticket_categories.id` the signed-in user staffs **because of
// their team** — i.e. categories whose `staff_role_ids` intersect a Discord
// role the user actually holds in that team's guild. This is the "staff" tier
// from `resolveTicketAccess`; the dashboard's **Team** tab is built from it.
//
// Scope is the user's REAL Discord guild membership (the OAuth `guilds`
// snapshot), not `listMyBusinesses` — which expands to every business for sudo
// users. A team-role only means something for a guild you're genuinely in, and
// anchoring here also bounds the live-role fallback to the user's own guild
// count instead of every team in the system. Admin teams are included: an admin
// may also personally hold a staff role in one of their own categories, and
// that's exactly the Team tier for them (the dashboard keeps Team and Admin
// disjoint by subtracting these category IDs from the Admin query).
//
// Roles are read LIVE from Discord per guild (cached ~5 min by
// `fetchGuildMemberRoles`), not from the `business_members` snapshot — that
// snapshot is empty for admins/owners/sudo (their roles are never fetched once
// Manage-Server/Administrator grants access), so it would wrongly report "no
// staff role" and leave their Team tab / the console's staff scope empty.
// Cached per-request too.
export const listMyStaffCategoryIds = cache(async function listMyStaffCategoryIds(): Promise<string[]> {
  const session = await auth()
  if (!session?.user?.id) return []

  const guilds = session.guilds ?? []
  if (guilds.length === 0) return []
  const guildIds = guilds.map((g) => g.id)
  const biz = await db
    .select()
    .from(businesses)
    .where(inArray(businesses.discordGuildId, guildIds))
  if (biz.length === 0) return []

  const bizIds = biz.map((b) => b.id)
  // Only categories that actually gate staff by role can grant staff access —
  // an empty `staff_role_ids` inherits admin-only, which a staff role can't clear.
  const cats = await db
    .select({
      id: ticketCategories.id,
      businessId: ticketCategories.businessId,
      staffRoleIds: ticketCategories.staffRoleIds,
    })
    .from(ticketCategories)
    .where(and(inArray(ticketCategories.businessId, bizIds), ne(ticketCategories.staffRoleIds, '')))
  if (cats.length === 0) return []

  // Resolve the user's CURRENT roles per guild via the bot (cached ~5 min). We
  // do NOT use the business_members snapshot here — it's empty for admins/sudo.
  const botToken = process.env.DISCORD_BOT_TOKEN
  if (!botToken) return []
  const { fetchGuildMemberRoles } = await import('@/lib/discord')

  const bizById = new Map(biz.map((b) => [b.id, b]))
  const neededBizIds = [...new Set(cats.map((c) => c.businessId))]
  const rolesByBiz = new Map<string, string[]>()
  await Promise.all(
    neededBizIds.map(async (bid) => {
      const b = bizById.get(bid)
      if (!b) return
      const roles = await fetchGuildMemberRoles(botToken, b.discordGuildId, session.user.discordId)
      if (roles) rolesByBiz.set(bid, roles)
    }),
  )

  const out: string[] = []
  for (const cat of cats) {
    const roles = rolesByBiz.get(cat.businessId)
    if (!roles) continue
    const staffIds = parseCsv(cat.staffRoleIds)
    if (staffIds.some((r) => roles.includes(r))) out.push(cat.id)
  }
  return out
})

// Full resolution: looks up the user's roles in this business's guild via
// the bot's permissions, then matches against `business.adminRoleIds`.
// Falls back to `member` if the user is in the guild but role lookup fails.
// Sudo users are treated as `owner` of every business regardless of guild.
//
// Cached per-request so /b/[slug]/layout and the page underneath share one
// Discord API call + one DB round-trip.
export const resolveBusinessAccess = cache(async function resolveBusinessAccess(slug: string): Promise<ResolvedBusiness | null> {
  const session = await auth()
  if (!session?.user?.id) return null

  const [b] = await db.select().from(businesses).where(eq(businesses.slug, slug)).limit(1)
  if (!b) return null

  if (await isSudo(session.user.id)) {
    await touchMember(b.id, session.user.id, 'owner', [])
    return { business: b, level: 'owner' }
  }

  const guild = (session.guilds ?? []).find((g) => g.id === b.discordGuildId)
  if (!guild) return null

  const adminRoleIds = parseCsv(b.adminRoleIds)
  const perms = BigInt(guild.permissions || '0')

  // Owner check — guild ADMINISTRATOR (and the guild owner) overrides everything.
  if ((perms & 8n) === 8n) {
    await touchMember(b.id, session.user.id, 'owner', [])
    return { business: b, level: 'owner' }
  }

  let level: AccessLevel = 'member'
  let roleSnapshot: string[] = []

  // Manage Server → admin: per-guild settings, panels, and the ticket queue.
  if ((perms & 32n) === 32n) level = 'admin'

  // Role-level "Ticket Master" admin — any role in admin_role_ids. Requires the
  // bot's view of the member; skip the Discord round-trip when Manage Server
  // already granted admin. We only do this on protected routes, so one Discord
  // request per gated page view is affordable.
  const botToken = process.env.DISCORD_BOT_TOKEN
  if (level !== 'admin' && botToken && adminRoleIds.length > 0) {
    try {
      const { fetchGuildMemberAsBot } = await import('@/lib/discord')
      const member = await fetchGuildMemberAsBot(botToken, b.discordGuildId, session.user.discordId)
      if (member) {
        roleSnapshot = member.roles
        const isAdmin = member.roles.some((r) => adminRoleIds.includes(r))
        if (isAdmin) level = 'admin'
      }
    } catch {
      // Bot may not be in the guild yet; fall through as member.
    }
  }

  await touchMember(b.id, session.user.id, level, roleSnapshot)
  return { business: b, level }
})

async function touchMember(
  businessId: string,
  userId: string,
  level: AccessLevel,
  roleSnapshot: string[],
): Promise<void> {
  await db
    .insert(businessMembers)
    .values({
      businessId,
      userId,
      role: level,
      discordRolesSnapshot: JSON.stringify(roleSnapshot),
    })
    .onConflictDoUpdate({
      target: [businessMembers.businessId, businessMembers.userId],
      set: {
        role: level,
        discordRolesSnapshot: JSON.stringify(roleSnapshot),
        lastSeenAt: sql`now()`,
      },
    })
}

export async function requireSession() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  return session
}

export async function requireBusinessAccess(slug: string, level: AccessLevel = 'member') {
  const session = await requireSession()
  const resolved = await resolveBusinessAccess(slug)
  if (!resolved) redirect('/dashboard')
  if (!hasAtLeast(resolved.level, level)) redirect(`/b/${slug}`)
  return { session, ...resolved }
}

// Lantern P2 — per-ticket access flags, used to drive both UI visibility and
// server-action gates on `/b/[slug]/tickets/[id]`. See the lantern plan's M1
// section for the mapping table.
//
// Tiers:
//   admin     — `level === 'admin' | 'owner'`. Only tier allowed to delete
//               the underlying Discord channel, change a ticket's category,
//               or edit settings.
//   staff     — admin OR holds any role in `ticket_categories.staff_role_ids`
//               of the ticket's category. Falls back to admin if the column
//               is empty.
//   opener    — `tickets.opener_user_id === session.user.id`.
//   member    — none of the above; can't see the ticket.
export type TicketAccessFlags = {
  isAdmin: boolean
  isStaff: boolean
  isOpener: boolean
  canSee: boolean
  canReply: boolean
  canClaim: boolean
  canClose: boolean
  canChangeCategory: boolean
  canManageMembers: boolean
  canDeleteChannel: boolean
}

function parseCsvLocal(input: string | null | undefined): string[] {
  if (!input) return []
  return input.split(',').map((s) => s.trim()).filter(Boolean)
}

export const resolveTicketAccess = cache(async function resolveTicketAccess(opts: {
  business: Business
  level: AccessLevel
  ticket: { id?: number; openerUserId: string; categoryId: string | null }
  session: { user: { id: string; discordId: string } }
}): Promise<TicketAccessFlags> {
  const isAdmin = opts.level === 'admin' || opts.level === 'owner'
  const isOpener = opts.ticket.openerUserId === opts.session.user.id

  // P16: external members (not in the guild) can see + reply via the web.
  let isExternal = false
  if (!isAdmin && !isOpener && opts.ticket.id) {
    const [ext] = await db
      .select({ userId: ticketExternalMembers.userId })
      .from(ticketExternalMembers)
      .where(
        and(
          eq(ticketExternalMembers.ticketId, opts.ticket.id),
          eq(ticketExternalMembers.userId, opts.session.user.id),
        ),
      )
      .limit(1)
    isExternal = !!ext
  }

  let isStaff = isAdmin
  if (!isStaff && opts.ticket.categoryId) {
    const [cat] = await db
      .select({ staffRoleIds: ticketCategories.staffRoleIds })
      .from(ticketCategories)
      .where(eq(ticketCategories.id, opts.ticket.categoryId))
      .limit(1)
    const staffIds = parseCsvLocal(cat?.staffRoleIds)
    if (staffIds.length > 0) {
      // Perf: prefer the cached role snapshot from business_members (written by
      // resolveBusinessAccess→touchMember each time the user hits a team page),
      // so the hot path (every ticket render, including SSE-driven re-renders)
      // avoids a live Discord round-trip. Only fall back to Discord when we
      // have no snapshot for this user/business yet.
      const [bm] = await db
        .select({ snapshot: businessMembers.discordRolesSnapshot })
        .from(businessMembers)
        .where(
          and(
            eq(businessMembers.businessId, opts.business.id),
            eq(businessMembers.userId, opts.session.user.id),
          ),
        )
        .limit(1)

      let roles: string[] | null = null
      if (bm) {
        try {
          roles = JSON.parse(bm.snapshot) as string[]
        } catch {
          roles = []
        }
      }

      if (roles) {
        if (roles.some((r) => staffIds.includes(r))) isStaff = true
      } else {
        const botToken = process.env.DISCORD_BOT_TOKEN
        if (botToken) {
          try {
            const { fetchGuildMemberAsBot } = await import('@/lib/discord')
            const member = await fetchGuildMemberAsBot(
              botToken,
              opts.business.discordGuildId,
              opts.session.user.discordId,
            )
            if (member && member.roles.some((r) => staffIds.includes(r))) isStaff = true
          } catch {
            // Network error or member not in guild — fall through as non-staff.
          }
        }
      }
    }
  }

  return {
    isAdmin,
    isStaff,
    isOpener,
    canSee: isAdmin || isStaff || isOpener || isExternal,
    canReply: isAdmin || isStaff || isOpener || isExternal,
    canClaim: isAdmin || isStaff,
    canClose: isAdmin || isStaff || isOpener,
    canChangeCategory: isAdmin,
    canManageMembers: isAdmin || isStaff,
    canDeleteChannel: isAdmin,
  }
})
