// The deterministic, in-memory demo dataset — the read-only BASE that every
// demo page renders. It is generated once (pure JS, no DB, no Discord, no Node
// APIs) and memoized for the life of the process. Timestamps are NOT baked in
// here: each ticket header carries a fixed structural offset, and callers
// project it against "now" so the corpus stays fresh daily (see ./dates).
//
// Visitor edits (replies, claims, settings, new tickets) are NOT stored here —
// they live in a per-browser localStorage overlay on the client
// (src/components/demo/store.tsx) and are merged on top of this base. So this
// module is, and must stay, 100% read-only and never imports '@/db/client'.

import { rngFor, Rng } from './rng'
import { makeOffset, type TicketOffset } from './dates'
import type { TicketStatus, TicketKind } from '@/db/schema'

// ─── shapes ──────────────────────────────────────────────────────────────

export type DemoGuild = { id: string; name: string; icon: string | null }

export type DemoUser = {
  id: string
  discordId: string
  name: string
  image: string | null
  isSudo: boolean
}

export type DemoCategory = {
  id: string
  businessId: string
  key: string
  label: string
  emoji: string | null
  description: string | null
  sortOrder: string
  discordParentCategoryId: string | null
  discordClosedCategoryId: string | null
  allowRoleIds: string
  staffRoleIds: string
  firstMessageTemplate: string | null
  staffOnly: boolean
  kind: TicketKind
}

// A `businesses`-row-shaped object (the fields the pages actually read).
export type DemoBusiness = {
  id: string
  slug: string
  name: string
  description: string | null
  discordGuildId: string
  adminRoleIds: string
  webhookUrl: string | null
  discordFallbackCategoryId: string | null
  discordClosedCategoryId: string | null
  deleteClosedAfterDays: number | null
  ticketMode: 'euphoric' | 'tickettool'
  ticketToolCategoryIds: string
  ticketToolPrefix: string
  settings: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type DemoTeam = {
  business: DemoBusiness
  guildId: string
  categories: DemoCategory[]
  ticketCount: number
}

export type DemoTicketHeader = {
  id: number
  businessId: string
  subject: string
  status: TicketStatus
  kind: TicketKind
  needsAttention: boolean
  externalSource: 'euphoric' | 'tickettool'
  categoryId: string | null
  openerId: string
  assigneeId: string | null
  priority: number
  offset: TicketOffset
}

export type PersonaKey = 'enduser' | 'staff' | 'admin' | 'sudo'

export type DemoPersonaSpec = {
  key: PersonaKey
  userId: string
  guildIds: Set<string>
  adminTeamIds: Set<string>
  staffCategoryIds: Set<string>
  isSudo: boolean
}

export type DemoDataset = {
  guilds: DemoGuild[]
  teams: DemoTeam[]
  users: DemoUser[]
  personas: Record<PersonaKey, DemoPersonaSpec>
  headersByTeam: Map<string, DemoTicketHeader[]>
  ticketIndex: Map<number, { team: DemoTeam; header: DemoTicketHeader }>
  teamBySlug: Map<string, DemoTeam>
  teamById: Map<string, DemoTeam>
  userById: Map<string, DemoUser>
  categoryById: Map<string, DemoCategory>
}

// ─── content pools ─────────────────────────────────────────────────────────

const GUILDS: { name: string; teams: { slug: string; name: string; tickettool?: boolean }[] }[] = [
  {
    name: 'Aurora Collective',
    teams: [
      { slug: 'aurora-storefront', name: 'Aurora Storefront' },
      { slug: 'aurora-studios', name: 'Aurora Studios' },
      { slug: 'aurora-labs', name: 'Aurora Labs' },
      { slug: 'aurora-care', name: 'Aurora Care' },
    ],
  },
  {
    name: 'Nimbus Network',
    teams: [
      { slug: 'nimbus-hosting', name: 'Nimbus Hosting' },
      { slug: 'nimbus-games', name: 'Nimbus Games' },
      { slug: 'nimbus-cloud', name: 'Nimbus Cloud' },
    ],
  },
  {
    name: 'Helix Community',
    teams: [
      { slug: 'helix-esports', name: 'Helix Esports' },
      { slug: 'helix-merch', name: 'Helix Merch', tickettool: true },
      { slug: 'helix-academy', name: 'Helix Academy' },
    ],
  },
  {
    name: 'Solstice Hub',
    teams: [
      { slug: 'solstice-support', name: 'Solstice Support' },
      { slug: 'solstice-mods', name: 'Solstice Mods' },
      { slug: 'solstice-vip', name: 'Solstice VIP' },
    ],
  },
]

const CATEGORY_TEMPLATES: Omit<DemoCategory, 'id' | 'businessId' | 'discordParentCategoryId' | 'discordClosedCategoryId' | 'allowRoleIds' | 'staffRoleIds'>[] = [
  { key: 'support', label: 'General Support', emoji: '💬', description: 'Anything that doesn’t fit elsewhere.', sortOrder: '0', firstMessageTemplate: 'Thanks {{user}} — a team member will be with you shortly. (Ticket #{{ticketId}})', staffOnly: false, kind: 'normal' },
  { key: 'billing', label: 'Billing', emoji: '💳', description: 'Charges, refunds, and subscriptions.', sortOrder: '1', firstMessageTemplate: null, staffOnly: false, kind: 'normal' },
  { key: 'technical', label: 'Technical Issue', emoji: '🛠️', description: 'Bugs, errors, and outages.', sortOrder: '2', firstMessageTemplate: null, staffOnly: false, kind: 'normal' },
  { key: 'account', label: 'Account & Access', emoji: '🔐', description: 'Login, passwords, and permissions.', sortOrder: '3', firstMessageTemplate: null, staffOnly: false, kind: 'normal' },
  { key: 'feedback', label: 'Feedback', emoji: '✨', description: 'Feature requests and ideas.', sortOrder: '4', firstMessageTemplate: null, staffOnly: false, kind: 'normal' },
  { key: 'projects', label: 'Projects', emoji: '📦', description: 'Long-running work with sub-tickets.', sortOrder: '5', firstMessageTemplate: null, staffOnly: false, kind: 'project' },
  { key: 'partnerships', label: 'Partnerships', emoji: '🤝', description: 'Collabs and business enquiries.', sortOrder: '6', firstMessageTemplate: null, staffOnly: false, kind: 'normal' },
  { key: 'archive', label: 'Triage / Archive', emoji: '🗂️', description: 'Staff-only landing zone.', sortOrder: '9', firstMessageTemplate: null, staffOnly: true, kind: 'normal' },
]

const SUBJECTS = [
  'Can’t log in to my account', 'Refund for a duplicate charge', 'Game crashes on launch', 'Feature request: dark mode',
  'Payment failed but my card was charged', 'How do I reset my password?', 'Avatar won’t update', 'Question about pricing tiers',
  'Partnership enquiry', 'My order hasn’t shipped yet', 'Server is down again', 'Two-factor codes not arriving',
  'Subscription renewed unexpectedly', 'Can I transfer my licence?', 'Discord role didn’t sync', 'Export my data request',
  'Voice chat keeps disconnecting', 'Where do I download invoices?', 'Bug: timestamps are off by an hour', 'Account flagged by mistake',
  'Need help with the API', 'Coupon code isn’t applying', 'Lag spikes during peak hours', 'Request: bulk import tool',
  'Profile picture is broken', 'Cancel my subscription', 'Missing items after update', 'Webhook stopped firing',
  'Double-charged for one seat', 'How do I add a teammate?', 'Slow load times on mobile', 'Translation looks wrong',
  'Notifications not coming through', 'Upgrade my plan', 'Can’t join the server', 'Order arrived damaged',
  'Reset my 2FA please', 'Dashboard shows a 500 error', 'Sponsorship opportunity', 'Beta access request',
]

const FIRST_NAMES = ['Alex','Jordan','Taylor','Casey','Riley','Morgan','Jamie','Avery','Quinn','Rowan','Sage','Skyler','Drew','Reese','Emerson','Finley','Harper','Kai','Logan','Parker','Charlie','Devon','Elliot','Frankie','Gray','Hayden','Indie','Jules','Karter','Lane','Marlowe','Noor','Oakley','Phoenix','River','Shiloh','Tatum','Wren','Zion','Blair']
const LAST_NAMES = ['Chen','Diaz','Avery','Patel','Kim','Nguyen','Okafor','Rossi','Silva','Ahmed','Brooks','Cole','Dunn','Ellis','Flores','Garcia','Hughes','Ito','Jensen','Khan','Lopez','Mori','Novak','Owens','Park','Quintero','Reyes','Singh','Tran','Underwood','Vance','Walsh','Xu','Young','Zhao','Bauer','Cruz','Ford','Greer','Holt']

// ─── status / role helpers ──────────────────────────────────────────────────

function pickStatus(rng: Rng, openDaysAgo: number): TicketStatus {
  if (openDaysAgo === 0) {
    return rng.weighted<TicketStatus>([
      ['open', 5], ['in_progress', 3], ['waiting', 2], ['on_hold', 1], ['completed', 1], ['closed', 1],
    ])
  }
  if (openDaysAgo < 7) {
    return rng.weighted<TicketStatus>([
      ['open', 3], ['in_progress', 3], ['waiting', 2], ['on_hold', 1], ['completed', 2], ['closed', 3],
    ])
  }
  if (openDaysAgo < 90) {
    return rng.weighted<TicketStatus>([
      ['open', 1], ['in_progress', 1], ['waiting', 1], ['on_hold', 1], ['completed', 3], ['closed', 6],
    ])
  }
  return rng.weighted<TicketStatus>([['completed', 2], ['on_hold', 1], ['closed', 12]])
}

const ASSIGNED_STATUSES = new Set<TicketStatus>(['in_progress', 'claimed', 'on_hold', 'completed', 'closed'])

// Stable synthetic role snowflakes per team.
function teamRoleIds(rng: Rng): { admin: string[]; staff: string[] } {
  return {
    admin: [rng.snowflake(), rng.snowflake()],
    staff: [rng.snowflake(), rng.snowflake(), rng.snowflake()],
  }
}

// ─── builder ─────────────────────────────────────────────────────────────

function buildDataset(): DemoDataset {
  const guilds: DemoGuild[] = []
  const teams: DemoTeam[] = []
  const teamBySlug = new Map<string, DemoTeam>()
  const teamById = new Map<string, DemoTeam>()
  const categoryById = new Map<string, DemoCategory>()

  let teamCounter = 0
  for (let gi = 0; gi < GUILDS.length; gi++) {
    const grng = rngFor('guild', gi)
    const guildId = grng.snowflake()
    guilds.push({ id: guildId, name: GUILDS[gi].name, icon: null })

    for (const tdef of GUILDS[gi].teams) {
      const bizId = `biz-${teamCounter}`
      const trng = rngFor('team', bizId)
      const roles = teamRoleIds(trng)
      const ticketCount = trng.int(402, 1673)

      // 4–6 categories per team, always including the first three core ones.
      const extras = trng.sample(CATEGORY_TEMPLATES.slice(3), trng.int(1, 3))
      const chosen = [...CATEGORY_TEMPLATES.slice(0, 3), ...extras]
      const categories: DemoCategory[] = chosen.map((c, ci) => {
        const id = `cat-${teamCounter}-${c.key}`
        const cat: DemoCategory = {
          ...c,
          id,
          businessId: bizId,
          sortOrder: String(ci),
          discordParentCategoryId: trng.snowflake(),
          discordClosedCategoryId: null,
          allowRoleIds: '',
          // Some categories gate staff by a specific role; others inherit admin.
          staffRoleIds: trng.bool(0.6) ? roles.staff.slice(0, trng.int(1, roles.staff.length)).join(',') : '',
        }
        categoryById.set(id, cat)
        return cat
      })

      const business: DemoBusiness = {
        id: bizId,
        slug: tdef.slug,
        name: tdef.name,
        description: `${tdef.name} — a demo team in the ${GUILDS[gi].name} server.`,
        discordGuildId: guildId,
        adminRoleIds: roles.admin.join(','),
        webhookUrl: `https://discord.com/api/webhooks/${trng.snowflake()}/demo-webhook-token-redacted`,
        discordFallbackCategoryId: trng.snowflake(),
        discordClosedCategoryId: trng.snowflake(),
        deleteClosedAfterDays: trng.bool(0.5) ? trng.int(14, 90) : null,
        ticketMode: tdef.tickettool ? 'tickettool' : 'euphoric',
        ticketToolCategoryIds: tdef.tickettool ? trng.snowflake() : '',
        ticketToolPrefix: '$',
        settings: {},
        createdAt: '2023-01-15T12:00:00.000Z',
        updatedAt: '2023-01-15T12:00:00.000Z',
      }

      const team: DemoTeam = { business, guildId, categories, ticketCount }
      teams.push(team)
      teamBySlug.set(tdef.slug, team)
      teamById.set(bizId, team)
      teamCounter++
    }
  }

  // ── users ──────────────────────────────────────────────────────────────
  const urng = rngFor('users')
  const users: DemoUser[] = []
  const userById = new Map<string, DemoUser>()
  const mkUser = (id: string, isSudo = false): DemoUser => {
    const u: DemoUser = {
      id,
      discordId: urng.snowflake(),
      name: `${urng.pick(FIRST_NAMES)} ${urng.pick(LAST_NAMES)}`,
      image: null, // default Discord avatar via avatarUrl(discordId, null)
      isSudo,
    }
    users.push(u)
    userById.set(id, u)
    return u
  }

  // Four named personas — these ARE demo users.
  const personaUsers: Record<PersonaKey, DemoUser> = {
    enduser: { id: 'persona-enduser', discordId: rngFor('persona', 'enduser').snowflake(), name: 'Jordan Avery', image: null, isSudo: false },
    staff: { id: 'persona-staff', discordId: rngFor('persona', 'staff').snowflake(), name: 'Riley Chen', image: null, isSudo: false },
    admin: { id: 'persona-admin', discordId: rngFor('persona', 'admin').snowflake(), name: 'Morgan Diaz', image: null, isSudo: false },
    sudo: { id: 'persona-sudo', discordId: rngFor('persona', 'sudo').snowflake(), name: 'Casey Quinn', image: null, isSudo: true },
  }
  for (const u of Object.values(personaUsers)) {
    users.push(u)
    userById.set(u.id, u)
  }

  const staffUsers: DemoUser[] = []
  for (let i = 0; i < 30; i++) staffUsers.push(mkUser(`staff-${i}`))
  const customerUsers: DemoUser[] = []
  for (let i = 0; i < 140; i++) customerUsers.push(mkUser(`cust-${i}`))

  // ── persona memberships (curated, mirrors the real permission model) ──────
  const guild0 = guilds[0].id // Aurora — enduser's home
  const guild1 = guilds[1].id // Nimbus — admin's domain
  const auroraTeams = teams.filter((t) => t.guildId === guild0)
  const nimbusTeams = teams.filter((t) => t.guildId === guild1)
  const helixTeams = teams.filter((t) => t.guildId === guilds[2].id)

  const firstCat = (t: DemoTeam) => t.categories.find((c) => !c.staffOnly) ?? t.categories[0]

  const personas: Record<PersonaKey, DemoPersonaSpec> = {
    enduser: {
      key: 'enduser',
      userId: personaUsers.enduser.id,
      guildIds: new Set([guild0]),
      adminTeamIds: new Set(),
      staffCategoryIds: new Set(),
      isSudo: false,
    },
    staff: {
      key: 'staff',
      userId: personaUsers.staff.id,
      guildIds: new Set([guild0, guild1, guilds[2].id]),
      adminTeamIds: new Set(),
      // Staffs one category each on three teams across three guilds.
      staffCategoryIds: new Set([
        firstCat(auroraTeams[3]).id, // Aurora Care
        firstCat(nimbusTeams[0]).id, // Nimbus Hosting
        firstCat(helixTeams[2]).id, // Helix Academy
      ]),
      isSudo: false,
    },
    admin: {
      key: 'admin',
      userId: personaUsers.admin.id,
      guildIds: new Set([guild1]),
      adminTeamIds: new Set(nimbusTeams.map((t) => t.business.id)),
      // Admins may also personally staff a category in one of their own teams.
      staffCategoryIds: new Set([firstCat(nimbusTeams[1]).id]),
      isSudo: false,
    },
    sudo: {
      key: 'sudo',
      userId: personaUsers.sudo.id,
      guildIds: new Set(guilds.map((g) => g.id)),
      adminTeamIds: new Set(teams.map((t) => t.business.id)),
      staffCategoryIds: new Set(),
      isSudo: true,
    },
  }

  // ── ticket headers ───────────────────────────────────────────────────────
  const headersByTeam = new Map<string, DemoTicketHeader[]>()
  const ticketIndex = new Map<number, { team: DemoTeam; header: DemoTicketHeader }>()
  let nextId = 1

  for (const team of teams) {
    const bizId = team.business.id
    const openCats = team.categories.filter((c) => !c.staffOnly)
    const teamStaff = rngFor('teamstaff', bizId).sample(staffUsers, 8) // a recurring handful per team
    const teamCustomers = rngFor('teamcust', bizId).sample(customerUsers, 60)
    const headers: DemoTicketHeader[] = []

    for (let n = 0; n < team.ticketCount; n++) {
      const id = nextId++
      const r = rngFor('ticket', bizId, n)
      const todayCluster = r.bool(0.035) // ~3.5% land "today"
      const offset = makeOffset(r, todayCluster)
      const status = pickStatus(r, offset.openDaysAgo)
      const cat = r.pick(openCats)
      const assigned = ASSIGNED_STATUSES.has(status) && r.bool(0.85)
      const header: DemoTicketHeader = {
        id,
        businessId: bizId,
        subject: r.pick(SUBJECTS),
        status,
        kind: cat.kind,
        needsAttention: status !== 'closed' && r.bool(0.02),
        externalSource: team.business.ticketMode === 'tickettool' && r.bool(0.9) ? 'tickettool' : 'euphoric',
        categoryId: cat.id,
        openerId: r.pick(teamCustomers).id,
        assigneeId: assigned ? r.pick(teamStaff).id : null,
        priority: r.weighted([[2, 6], [3, 3], [1, 1], [4, 1]]),
        offset,
      }
      headers.push(header)
      ticketIndex.set(id, { team, header })
    }
    headersByTeam.set(bizId, headers)
  }

  // ── persona attribution overlay (make each persona feel like a live user) ──
  const attribute = (spec: DemoPersonaSpec) => {
    // Open some tickets as this persona in every team in their guild.
    for (const team of teams) {
      if (!spec.guildIds.has(team.guildId)) continue
      const headers = headersByTeam.get(team.business.id)!
      const ar = rngFor('attr-open', spec.key, team.business.id)
      const openIdx = ar.sample(headers.map((_, i) => i), ar.int(6, 18))
      for (const i of openIdx) headers[i].openerId = spec.userId

      // Assign some tickets to this persona where they staff/admin.
      const staffsHere = team.categories.some((c) => spec.staffCategoryIds.has(c.id))
      const adminsHere = spec.adminTeamIds.has(team.business.id)
      if (staffsHere || adminsHere) {
        const sr = rngFor('attr-assign', spec.key, team.business.id)
        const pool = headers.filter(
          (h) =>
            ASSIGNED_STATUSES.has(h.status) &&
            (adminsHere || (h.categoryId != null && spec.staffCategoryIds.has(h.categoryId))),
        )
        for (const h of sr.sample(pool, sr.int(10, 30))) h.assigneeId = spec.userId
      }
    }
  }
  attribute(personas.enduser)
  attribute(personas.staff)
  attribute(personas.admin)
  // sudo intentionally not attributed as opener everywhere — it's the bird's-eye persona.

  return {
    guilds,
    teams,
    users,
    personas,
    headersByTeam,
    ticketIndex,
    teamBySlug,
    teamById,
    userById,
    categoryById,
  }
}

let _dataset: DemoDataset | null = null

// Build-once accessor. The dataset is date-independent (timestamps are projected
// by callers), so a single process-lifetime memo is correct and cheap.
export function getDemoDataset(): DemoDataset {
  if (!_dataset) _dataset = buildDataset()
  return _dataset
}
