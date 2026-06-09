// Lazy per-ticket detail for the demo. Messages + audit for a single ticket are
// generated only when that ticket's detail page is viewed (seeded by the ticket
// id, so they're stable), keeping the ~13k-ticket corpus from ever materializing
// its conversations. Everything here is serializable (ISO timestamps) so it
// crosses cleanly to the interactive client view, where the visitor's own
// replies/edits are layered on from localStorage.

import { avatarUrl } from '@/lib/format'
import { getDemoDataset } from './data'
import { MIN_MS, projectLastActivityAt, projectOpenedAt } from './dates'
import { demoTicketAccess, projectTicket, type DemoTicket, type PersonaKey } from './personas'
import { rngFor } from './rng'

export type DemoMessage = {
  id: string
  body: string
  source: 'web' | 'discord' | 'system' | 'internal'
  createdAt: string
  authorId: string | null
  authorName: string | null
  authorImage: string | null
  authorDiscordId: string | null
}

export type DemoAudit = {
  id: string
  action: string
  metadata: Record<string, unknown>
  createdAt: string
  actorName: string | null
  actorDiscordId: string | null
}

export type DemoPerson = {
  discordId: string
  name: string | null
  image: string | null
  isExternal: boolean
  isOpener: boolean
}

export type DemoTicketBase = {
  ticket: DemoTicket
  access: {
    isAdmin: boolean
    isStaff: boolean
    isOpener: boolean
    canReply: boolean
    canClaim: boolean
    canClose: boolean
    canChangeCategory: boolean
    canManageMembers: boolean
    canDeleteChannel: boolean
  }
  messages: DemoMessage[]
  internalNotes: DemoMessage[]
  audit: DemoAudit[]
  people: DemoPerson[]
  accessRoles: { id: string; name: string }[]
  categories: { id: string; key: string; label: string; emoji: string | null }[]
  assignable: { id: string; name: string; image: string | null }[]
}

const USER_LINES = [
  'Hey, I’m still seeing this issue.',
  'Any update on this?',
  'Thanks, that worked!',
  'Here’s a screenshot of what I’m seeing.',
  'It started happening after the last update.',
  'I tried that but no luck.',
  'Appreciate the quick response!',
  'Still broken on my end.',
  'Could you escalate this?',
  'Works now — thank you!',
]
const STAFF_LINES = [
  'Thanks for reaching out — looking into it now.',
  'Can you try clearing your cache and retrying?',
  'I’ve escalated this to the team.',
  'Could you share the email on your account?',
  'We’ve pushed a fix — can you confirm it’s resolved?',
  'Marking this as sorted; reach back out if it returns.',
  'Sorry for the trouble! Investigating.',
  'That should be working now.',
  'We rolled the change back.',
  'I’ve refunded the duplicate charge.',
]

function uname(userId: string | null): { name: string | null; image: string | null; discordId: string | null } {
  if (!userId) return { name: null, image: null, discordId: null }
  const u = getDemoDataset().userById.get(userId)
  if (!u) return { name: null, image: null, discordId: null }
  return { name: u.name, image: avatarUrl(u.discordId, u.image), discordId: u.discordId }
}

export function getDemoTicketBase(personaKey: PersonaKey, slug: string, id: number, now: Date = new Date()): DemoTicketBase | null {
  const ds = getDemoDataset()
  const entry = ds.ticketIndex.get(id)
  if (!entry || entry.team.business.slug !== slug) return null
  const { team, header } = entry
  const persona = ds.personas[personaKey]
  const flags = demoTicketAccess(persona, team, header)
  const personalScope = header.openerId === persona.userId || (header.categoryId != null && persona.staffCategoryIds.has(header.categoryId))
  const ticket = projectTicket(ds, team, header, now, personalScope)

  const openedMs = projectOpenedAt(header.offset, now).getTime()
  const lastMs = projectLastActivityAt(header.offset, now).getTime()
  const span = Math.max(MIN_MS, lastMs - openedMs)

  const r = rngFor('detail', id)
  const opener = uname(header.openerId)
  const cat = header.categoryId ? ds.categoryById.get(header.categoryId) : null

  // A staff voice for replies — the assignee if present, else a team staffer.
  const teamStaff = rngFor('teamstaff', team.business.id).sample(
    ds.users.filter((u) => u.id.startsWith('staff-')),
    6,
  )
  const staffUserId = header.assigneeId ?? (teamStaff[0]?.id ?? null)
  const staff = uname(staffUserId)

  // ── conversation ──
  const count = header.status === 'closed' || header.status === 'completed' ? r.int(3, 12) : r.int(1, 8)
  const messages: DemoMessage[] = []
  const firstBody = cat?.firstMessageTemplate
    ? cat.firstMessageTemplate
        .replace(/\{\{user\}\}/g, opener.name ?? 'there')
        .replace(/\{\{ticketId\}\}/g, String(id))
        .replace(/\{\{subject\}\}/g, header.subject)
        .replace(/\{\{category\}\}/g, cat?.label ?? '')
    : `${header.subject}. ${r.pick(USER_LINES)}`
  for (let i = 0; i < count; i++) {
    const fromStaff = i === 0 ? false : r.bool(0.5)
    const who = fromStaff ? staff : opener
    const at = openedMs + Math.floor((span * (i + 1)) / (count + 1))
    messages.push({
      id: `m-${id}-${i}`,
      body: i === 0 ? firstBody : fromStaff ? r.pick(STAFF_LINES) : r.pick(USER_LINES),
      source: r.bool(0.5) ? 'discord' : 'web',
      createdAt: new Date(at).toISOString(),
      authorId: fromStaff ? staffUserId : header.openerId,
      authorName: who.name,
      authorImage: who.image,
      authorDiscordId: who.discordId,
    })
  }

  // ── internal notes (staff-only; only returned to staff personas) ──
  const internalNotes: DemoMessage[] = []
  if (flags.isStaff && r.bool(0.5)) {
    const notes = r.int(1, 3)
    for (let i = 0; i < notes; i++) {
      internalNotes.push({
        id: `in-${id}-${i}`,
        body: r.pick(['Looped in billing.', 'Customer is on the legacy plan.', 'Waiting on the upstream fix.', 'VIP — handle with care.', 'Duplicate of an earlier report.']),
        source: 'internal',
        createdAt: new Date(openedMs + Math.floor(span * (0.3 + 0.2 * i))).toISOString(),
        authorId: staffUserId,
        authorName: staff.name,
        authorImage: staff.image,
        authorDiscordId: staff.discordId,
      })
    }
  }

  // ── audit / lifecycle ──
  const audit: DemoAudit[] = []
  const push = (action: string, atMs: number, actorId: string | null, metadata: Record<string, unknown> = {}) => {
    const a = uname(actorId)
    audit.push({ id: `a-${id}-${audit.length}`, action, metadata, createdAt: new Date(atMs).toISOString(), actorName: a.name, actorDiscordId: a.discordId })
  }
  push('opened', openedMs, header.openerId, cat ? { categoryLabel: cat.label } : {})
  if (header.assigneeId) {
    const a = uname(header.assigneeId)
    push('assigned', openedMs + Math.floor(span * 0.2), staffUserId, { assigneeDiscordId: a.discordId, assigneeName: a.name })
  }
  if (header.status === 'in_progress' || header.status === 'claimed') push('claimed', openedMs + Math.floor(span * 0.25), staffUserId)
  if (header.status === 'waiting' || header.status === 'on_hold') push('status_changed', openedMs + Math.floor(span * 0.5), staffUserId, { to: header.status })
  if (header.status === 'completed') push('status_changed', lastMs - MIN_MS, staffUserId, { to: 'completed' })
  if (header.status === 'closed') push('closed', lastMs, staffUserId)

  // ── people + roles (synthetic; the live panel would read channel overwrites) ──
  const people: DemoPerson[] = []
  if (opener.discordId) people.push({ discordId: opener.discordId, name: opener.name, image: opener.image, isExternal: false, isOpener: true })
  const extra = rngFor('people', id).sample(teamStaff, r.int(1, 3))
  for (const u of extra) {
    if (u.discordId === opener.discordId) continue
    people.push({ discordId: u.discordId, name: u.name, image: avatarUrl(u.discordId, u.image), isExternal: false, isOpener: false })
  }
  const accessRoles = [{ id: rngFor('role', team.business.id).snowflake(), name: 'Support Team' }]

  return {
    ticket,
    access: {
      isAdmin: flags.isAdmin,
      isStaff: flags.isStaff,
      isOpener: flags.isOpener,
      canReply: flags.canReply,
      canClaim: flags.canClaim,
      canClose: flags.canClose,
      canChangeCategory: flags.canChangeCategory,
      canManageMembers: flags.canManageMembers,
      canDeleteChannel: flags.canDeleteChannel,
    },
    messages,
    internalNotes,
    audit,
    people,
    accessRoles,
    categories: team.categories
      .map((c) => ({ id: c.id, key: c.key, label: c.label, emoji: c.emoji }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    assignable: teamStaff.map((u) => ({ id: u.id, name: u.name, image: avatarUrl(u.discordId, u.image) })),
  }
}
