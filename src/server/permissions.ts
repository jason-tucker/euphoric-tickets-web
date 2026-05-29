import { redirect } from 'next/navigation'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { auth, type DiscordGuildSnapshot } from './auth'
import { db } from '@/db/client'
import { businesses, businessMembers, users, type Business } from '@/db/schema'

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

  // Discord guild permissions bitfield: ADMINISTRATOR = 1 << 3 = 8.
  const perms = BigInt(g.permissions || '0')
  const isGuildAdmin = (perms & 8n) === 8n
  if (isGuildAdmin) return 'owner'

  // Admin if the user has any role in the configured admin role IDs.
  // We don't have per-role data on the snapshot; the OAuth scope `guilds`
  // alone returns only owner / permissions. For role-level admin checks
  // we'd need `guilds.members.read` + a separate /users/@me/guilds/{id}/member
  // request. Implemented in `resolveBusinessAccess` below.
  return 'member'
}

// Cheap path: list businesses the user can see without making extra Discord
// API calls. Returns `member`-level on each; if you need to know whether
// the user is an admin, call `resolveBusinessAccess(slug)` per business.
//
// Sudo users see every business as `owner`, regardless of guild membership.
export async function listMyBusinesses(): Promise<ResolvedBusiness[]> {
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
}

async function isSudo(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ isSudo: users.isSudo })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return !!row?.isSudo
}

// Full resolution: looks up the user's roles in this business's guild via
// the bot's permissions, then matches against `business.adminRoleIds`.
// Falls back to `member` if the user is in the guild but role lookup fails.
// Sudo users are treated as `owner` of every business regardless of guild.
export async function resolveBusinessAccess(slug: string): Promise<ResolvedBusiness | null> {
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

  // Owner check — guild ADMINISTRATOR permission overrides everything.
  const isGuildAdmin = (BigInt(guild.permissions || '0') & 8n) === 8n
  if (isGuildAdmin) {
    await touchMember(b.id, session.user.id, 'owner', [])
    return { business: b, level: 'owner' }
  }

  // Role-level admin check requires the bot's view of the member.
  // Available via the bot token; we only do this on protected routes so we
  // can afford one Discord request per gated page view.
  let level: AccessLevel = 'member'
  let roleSnapshot: string[] = []
  const botToken = process.env.DISCORD_BOT_TOKEN
  if (botToken && adminRoleIds.length > 0) {
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
}

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
