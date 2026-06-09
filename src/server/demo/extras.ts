// Remaining read-only demo content: team settings, the open-ticket form, and the
// sudo surfaces (team list, bot dashboard, bot errors). All deterministic; error
// timestamps are anchored to "now" so the log stays fresh day to day.

import { getDemoDataset, type DemoBusiness, type DemoCategory } from './data'
import { MIN_MS } from './dates'
import { demoListMyBusinesses, type PersonaKey } from './personas'
import { rngFor } from './rng'

export type DemoSettings = {
  business: DemoBusiness
  categories: DemoCategory[]
  adminTeams: { slug: string; name: string }[]
}

export function getDemoSettings(personaKey: PersonaKey, slug: string): DemoSettings | null {
  const ds = getDemoDataset()
  const team = ds.teamBySlug.get(slug)
  if (!team) return null
  const persona = ds.personas[personaKey]
  const adminTeams = demoListMyBusinesses(persona)
    .filter((m) => m.level === 'admin' || m.level === 'owner')
    .map((m) => ({ slug: m.team.business.slug, name: m.team.business.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    business: team.business,
    categories: team.categories.slice().sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder) || a.label.localeCompare(b.label)),
    adminTeams,
  }
}

export type DemoNewTicketForm = {
  teams: { id: string; slug: string; name: string }[]
  categoriesByTeam: Record<string, { key: string; label: string; emoji: string | null }[]>
}

export function getDemoNewTicketForm(personaKey: PersonaKey): DemoNewTicketForm {
  const ds = getDemoDataset()
  const persona = ds.personas[personaKey]
  const teams = demoListMyBusinesses(persona).map((m) => m.team)
  const categoriesByTeam: Record<string, { key: string; label: string; emoji: string | null }[]> = {}
  for (const t of teams) {
    categoriesByTeam[t.business.slug] = t.categories
      .filter((c) => !c.staffOnly)
      .map((c) => ({ key: c.key, label: c.label, emoji: c.emoji }))
  }
  return {
    teams: teams
      .map((t) => ({ id: t.business.id, slug: t.business.slug, name: t.business.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    categoriesByTeam,
  }
}

export function getDemoSudoTeams(): { slug: string; name: string; guildId: string; guildName: string }[] {
  const ds = getDemoDataset()
  const guildName = new Map(ds.guilds.map((g) => [g.id, g.name]))
  return ds.teams
    .map((t) => ({ slug: t.business.slug, name: t.business.name, guildId: t.guildId, guildName: guildName.get(t.guildId) ?? t.guildId }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export type DemoBotError = {
  id: number
  level: 'error' | 'warn' | 'info'
  source: string | null
  message: string
  context: Record<string, unknown> | null
  createdAt: string
}

const ERROR_SPECS: { level: 'error' | 'warn' | 'info'; source: string; message: string }[] = [
  { level: 'warn', source: 'startup-resync', message: 'Channel for ticket #482 missing — flagged needs_attention.' },
  { level: 'error', source: 'messageCreate', message: 'Webhook POST failed (429) — retrying with backoff.' },
  { level: 'info', source: 'guildCreate', message: 'Joined a new guild — provisioned a team.' },
  { level: 'warn', source: 'tickettool', message: 'Could not parse a TicketTool close embed; skipped.' },
  { level: 'error', source: 'permissions', message: 'Discord 403 fetching member roles — falling back to snapshot.' },
  { level: 'info', source: 'sweep', message: 'Hourly cleanup removed 12 stale error rows.' },
  { level: 'warn', source: 'reply', message: 'Attachment URL expired; refreshed from the CDN.' },
  { level: 'error', source: 'channel', message: 'Failed to move closed channel — category full.' },
  { level: 'info', source: 'startup-resync', message: 'Backfilled 38 messages across 9 channels.' },
  { level: 'warn', source: 'rate-limit', message: 'Username change bounced — Discord rate limit; will retry.' },
]

// A deterministic synthetic error log. Each row has a FIXED minute-offset that we
// project against now, so timestamps slide forward daily like the tickets do.
function allErrors(now: Date): DemoBotError[] {
  const r = rngFor('botErrors')
  const out: DemoBotError[] = []
  const FIVE_DAYS_MIN = 5 * 24 * 60
  for (let i = 0; i < 48; i++) {
    const spec = ERROR_SPECS[i % ERROR_SPECS.length]
    const minsAgo = r.int(1, FIVE_DAYS_MIN)
    out.push({
      id: 10_000 - i,
      level: spec.level,
      source: spec.source,
      message: spec.message,
      context: r.bool(0.3) ? { businessSlug: rngFor('errctx', i).pick(getDemoDataset().teams).business.slug } : null,
      createdAt: new Date(now.getTime() - minsAgo * MIN_MS).toISOString(),
    })
  }
  return out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

export function getDemoBotErrors(level: string | undefined, now: Date = new Date()): DemoBotError[] {
  const rows = allErrors(now)
  const filtered = level && ['error', 'warn', 'info'].includes(level) ? rows.filter((r) => r.level === level) : rows
  return filtered.slice(0, 200)
}

export type DemoBotDashboard = {
  botName: string
  guilds: { id: string; name: string; icon: string | null }[]
  teamsByGuild: Record<string, { slug: string; name: string }[]>
  counts: { teams: number; openTickets: number; attention: number }
  errorAgg: { total: number; errors: number; warns: number; last24: number }
  recentErrors: DemoBotError[]
}

export function getDemoBotDashboard(now: Date = new Date()): DemoBotDashboard {
  const ds = getDemoDataset()
  const teamsByGuild: Record<string, { slug: string; name: string }[]> = {}
  for (const t of ds.teams) {
    ;(teamsByGuild[t.guildId] ??= []).push({ slug: t.business.slug, name: t.business.name })
  }
  let openTickets = 0
  let attention = 0
  for (const headers of ds.headersByTeam.values()) {
    for (const h of headers) {
      if (h.status !== 'closed') openTickets++
      if (h.needsAttention) attention++
    }
  }
  const errors = allErrors(now)
  const dayAgo = now.getTime() - 24 * 60 * MIN_MS
  const errorAgg = {
    total: errors.length,
    errors: errors.filter((e) => e.level === 'error').length,
    warns: errors.filter((e) => e.level === 'warn').length,
    last24: errors.filter((e) => Date.parse(e.createdAt) > dayAgo).length,
  }
  return {
    botName: 'Euphoric Tickets',
    guilds: ds.guilds,
    teamsByGuild,
    counts: { teams: ds.teams.length, openTickets, attention },
    errorAgg,
    recentErrors: errors.slice(0, 10),
  }
}
