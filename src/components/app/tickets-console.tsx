'use client'

// The cross-team tickets console — a dense, ConnectWise-Manage-style data grid.
// Everything here is client-side: sorting, the multi-team filter, the per-column
// filter row, and the status/assignee filters all run in memory off one dataset,
// so once you're on the page there are no navigations, no URL changes and no spinners.
// The dataset stays live via an SSE nudge (`/api/tickets/stream`) that triggers a
// silent background refetch of `/api/tickets/list`, with a 20s poll + tab-focus
// refetch as a fallback. View preferences persist to localStorage.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  ChevronDown,
  Check,
  ExternalLink,
  Rows3,
  Rows2,
  RefreshCw,
  AlertTriangle,
  ShieldCheck,
  CalendarRange,
  X,
} from 'lucide-react'
import type { ConsoleTeam, ConsoleTicket, TicketsConsoleData } from '@/server/tickets'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { StatusBadge } from '@/components/app/status-badge'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

type SortKey =
  | 'id'
  | 'subject'
  | 'team'
  | 'category'
  | 'status'
  | 'opener'
  | 'assignee'
  | 'opened'
  | 'last'

type Dir = 'asc' | 'desc'
type Assignee = 'all' | 'mine' | 'unassigned'
type Density = 'comfortable' | 'compact'

const STATUS_TABS = [
  { key: 'active', label: 'Active' },
  { key: 'open', label: 'Open' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'waiting', label: 'Waiting' },
  { key: 'on_hold', label: 'On Hold' },
  { key: 'completed', label: 'Completed' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
] as const

// Sort rank for the status column — open work first, closed last.
const STATUS_ORDER: Record<string, number> = {
  open: 0,
  claimed: 1,
  in_progress: 1,
  waiting: 2,
  on_hold: 3,
  completed: 4,
  closed: 5,
}

const LS_KEY = 'et-tickets-console-v4'

function statusMatches(s: string, filter: string): boolean {
  if (filter === 'all') return true
  if (filter === 'active') return s !== 'closed'
  if (filter === 'in_progress') return s === 'in_progress' || s === 'claimed'
  return s === filter
}

// Inclusive [from, to] date-range test for an ISO timestamp. Bounds come from a
// native date input ('YYYY-MM-DD') or are '' for an open end. Blank/blank is
// always true, so an untouched range never filters anything out.
function inDateRange(iso: string, from: string, to: string): boolean {
  if (!from && !to) return true
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return false
  if (from && ts < Date.parse(`${from}T00:00:00`)) return false
  if (to && ts > Date.parse(`${to}T23:59:59.999`)) return false
  return true
}

function initials(name: string | null): string {
  if (!name) return '?'
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

// TicketTool ticket subjects come in as channel names prefixed with `#`; strip
// it for display. Their "category" is the third-party system itself.
function displaySubject(t: ConsoleTicket): string {
  if (t.externalSource !== 'tickettool') return t.subject
  return t.subject.replace(/^#+\s*/, '').trim() || t.subject
}
function displayCategory(t: ConsoleTicket): string | null {
  return t.categoryLabel ?? (t.externalSource === 'tickettool' ? 'TicketTool' : null)
}

type Column = {
  key: SortKey
  label: string
  thClass?: string
  numeric?: boolean
}
// thClass carries the responsive hide + width per column; the matching <td>s
// mirror it. On a phone (<sm) we keep only Subject · Status · Last activity and
// drop the fixed Status/Last widths so the grid reflows to fit ~360px instead of
// scrolling sideways (the # and Discord-link columns hide; team shows under the
// subject, the rest return at their breakpoints).
const COLUMNS: Column[] = [
  { key: 'id', label: '#', thClass: 'hidden w-14 sm:table-cell', numeric: true },
  { key: 'subject', label: 'Subject' },
  { key: 'team', label: 'Team', thClass: 'hidden md:table-cell' },
  { key: 'category', label: 'Category', thClass: 'hidden lg:table-cell' },
  { key: 'status', label: 'Status', thClass: 'sm:w-28' },
  { key: 'opener', label: 'Opener', thClass: 'hidden sm:table-cell' },
  { key: 'assignee', label: 'Assignee', thClass: 'hidden xl:table-cell' },
  { key: 'opened', label: 'Opened', thClass: 'hidden 2xl:table-cell w-28' },
  { key: 'last', label: 'Last activity', thClass: 'sm:w-32' },
]

type ColFilters = {
  id: string
  subject: string
  opener: string
  assignee: string
  categories: string[]
  openedFrom: string
  openedTo: string
  lastFrom: string
  lastTo: string
}
const EMPTY_COL_FILTERS: ColFilters = {
  id: '',
  subject: '',
  opener: '',
  assignee: '',
  categories: [],
  openedFrom: '',
  openedTo: '',
  lastFrom: '',
  lastTo: '',
}

export function TicketsConsole({
  initial,
  meId,
  initialTeamSlug,
}: {
  initial: TicketsConsoleData
  meId: string
  initialTeamSlug?: string
}) {
  const router = useRouter()
  const [data, setData] = useState<TicketsConsoleData>(initial)
  const [selectedTeams, setSelectedTeams] = useState<string[]>([])
  // Admin view OFF (default) = only tickets you reach without admin (staff /
  // opened / added). ON = every ticket in teams you administer.
  const [adminView, setAdminView] = useState(false)
  const [status, setStatus] = useState<string>('active')
  const [assignee, setAssignee] = useState<Assignee>('all')
  const [colFilters, setColFilters] = useState<ColFilters>(EMPTY_COL_FILTERS)
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: 'last', dir: 'desc' })
  const [density, setDensity] = useState<Density>('comfortable')
  const [live, setLive] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const hydrated = useRef(false)

  // Restore persisted view once, on mount; a `?team=` deep-link wins over the
  // persisted team selection (and reveals that team if it's admin-only).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      if (raw) {
        const p = JSON.parse(raw) as Partial<{
          teams: string[]
          adminView: boolean
          status: string
          assignee: Assignee
          sort: { key: SortKey; dir: Dir }
          density: Density
        }>
        if (Array.isArray(p.teams)) setSelectedTeams(p.teams)
        if (typeof p.adminView === 'boolean') setAdminView(p.adminView)
        if (typeof p.status === 'string') setStatus(p.status)
        if (p.assignee) setAssignee(p.assignee)
        if (p.sort?.key) setSort({ key: p.sort.key, dir: p.sort.dir === 'asc' ? 'asc' : 'desc' })
        if (p.density) setDensity(p.density)
      }
    } catch {
      /* ignore malformed storage */
    }
    if (initialTeamSlug) {
      const team = initial.teams.find((t) => t.slug === initialTeamSlug)
      if (team) {
        setSelectedTeams([team.id])
        // Drop the query param so in-view filtering stays URL-free.
        try {
          window.history.replaceState(null, '', '/tickets')
        } catch {
          /* no-op */
        }
      }
    }
    hydrated.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Persist on change (after the initial restore so we don't clobber storage
  // with defaults during the first render).
  useEffect(() => {
    if (!hydrated.current) return
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ teams: selectedTeams, adminView, status, assignee, sort, density }),
      )
    } catch {
      /* storage full / disabled — non-fatal */
    }
  }, [selectedTeams, adminView, status, assignee, sort, density])

  // Live data: SSE nudge → debounced silent refetch, with poll + focus fallback.
  const refetch = useCallback(async () => {
    try {
      setRefreshing(true)
      const res = await fetch('/api/tickets/list', { cache: 'no-store' })
      if (res.ok) setData((await res.json()) as TicketsConsoleData)
    } catch {
      /* leave the last-good data in place */
    } finally {
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    let es: EventSource | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let debounce: ReturnType<typeof setTimeout> | null = null
    let closed = false

    const startPolling = () => {
      if (!pollTimer) pollTimer = setInterval(refetch, 20000)
    }
    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    }
    const scheduleRefetch = () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(refetch, 800)
    }

    const connect = () => {
      if (closed) return
      es = new EventSource('/api/tickets/stream')
      es.addEventListener('open', () => {
        setLive(true)
        stopPolling()
      })
      es.addEventListener('refresh', scheduleRefetch)
      es.onerror = () => {
        setLive(false)
        es?.close()
        es = null
        if (closed) return
        startPolling()
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null
            connect()
          }, 8000)
        }
      }
    }
    connect()

    const onVisible = () => {
      if (document.visibilityState === 'visible') refetch()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      closed = true
      es?.close()
      stopPolling()
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (debounce) clearTimeout(debounce)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refetch])

  const teams = data.teams

  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const t of data.tickets) {
      const c = displayCategory(t)
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    return [...counts.entries()]
      .map(([value, count]) => ({ value, label: value, count }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [data.tickets])

  const toggleSort = (key: SortKey) => {
    setSort((cur) => (cur.key === key ? { key, dir: cur.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }))
  }
  const setCol = (patch: Partial<ColFilters>) => setColFilters((p) => ({ ...p, ...patch }))

  // Everything except the status filter — so status-chip counts stay stable as
  // you flip between statuses.
  const baseFiltered = useMemo(() => {
    const allowedTeams = selectedTeams.length ? new Set(selectedTeams) : null
    const cf = colFilters
    const fId = cf.id.trim()
    const fSubject = cf.subject.trim().toLowerCase()
    const fOpener = cf.opener.trim().toLowerCase()
    const fAssignee = cf.assignee.trim().toLowerCase()
    return data.tickets.filter((t) => {
      if (allowedTeams && !allowedTeams.has(t.teamId)) return false
      // Admin view off → only tickets you'd reach without admin access.
      if (!adminView && !t.personalScope) return false
      if (assignee === 'mine' && t.assigneeId !== meId) return false
      if (assignee === 'unassigned' && t.assigneeId) return false
      const subj = displaySubject(t)
      const cat = displayCategory(t)
      if (fId && !String(t.id).includes(fId)) return false
      if (fSubject && !subj.toLowerCase().includes(fSubject)) return false
      if (fOpener && !(t.openerName ?? '').toLowerCase().includes(fOpener)) return false
      if (fAssignee && !(t.assigneeName ?? '').toLowerCase().includes(fAssignee)) return false
      if (cf.categories.length && (!cat || !cf.categories.includes(cat))) return false
      if (!inDateRange(t.openedAt, cf.openedFrom, cf.openedTo)) return false
      if (!inDateRange(t.lastActivityAt, cf.lastFrom, cf.lastTo)) return false
      return true
    })
  }, [data.tickets, selectedTeams, adminView, assignee, meId, colFilters])

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const tab of STATUS_TABS) counts[tab.key] = 0
    for (const t of baseFiltered) {
      for (const tab of STATUS_TABS) if (statusMatches(t.status, tab.key)) counts[tab.key]++
    }
    return counts
  }, [baseFiltered])

  const rows = useMemo(() => {
    const filtered = baseFiltered.filter((t) => statusMatches(t.status, status))
    const dir = sort.dir === 'asc' ? 1 : -1
    const cmp = (a: ConsoleTicket, b: ConsoleTicket): number => {
      switch (sort.key) {
        case 'id':
          return (a.id - b.id) * dir
        case 'subject':
          return displaySubject(a).localeCompare(displaySubject(b)) * dir
        case 'team':
          return a.teamName.localeCompare(b.teamName) * dir
        case 'category':
          return (displayCategory(a) ?? '~').localeCompare(displayCategory(b) ?? '~') * dir
        case 'status':
          return ((STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)) * dir
        case 'opener':
          return (a.openerName ?? '~').localeCompare(b.openerName ?? '~') * dir
        case 'assignee':
          return (a.assigneeName ?? '~').localeCompare(b.assigneeName ?? '~') * dir
        case 'opened':
          return (Date.parse(a.openedAt) - Date.parse(b.openedAt)) * dir
        default:
          return (Date.parse(a.lastActivityAt) - Date.parse(b.lastActivityAt)) * dir
      }
    }
    return [...filtered].sort(cmp)
  }, [baseFiltered, status, sort])

  const colFiltersActive =
    !!(colFilters.id || colFilters.subject || colFilters.opener || colFilters.assignee) ||
    colFilters.categories.length > 0 ||
    !!(colFilters.openedFrom || colFilters.openedTo || colFilters.lastFrom || colFilters.lastTo)
  const filtersActive =
    selectedTeams.length > 0 || status !== 'active' || assignee !== 'all' || colFiltersActive
  const clearAll = () => {
    setSelectedTeams([])
    setStatus('active')
    setAssignee('all')
    setColFilters(EMPTY_COL_FILTERS)
  }

  const cellPad = density === 'compact' ? 'py-1.5' : 'py-2.5'
  const teamsInView = selectedTeams.length || teams.length

  const renderColFilter = (key: SortKey) => {
    switch (key) {
      case 'id':
        return <ColInput value={colFilters.id} onChange={(v) => setCol({ id: v })} placeholder="#" numeric />
      case 'subject':
        return <ColInput value={colFilters.subject} onChange={(v) => setCol({ subject: v })} placeholder="Filter…" />
      case 'team':
        return <TeamFilter teams={teams} selected={selectedTeams} onChange={setSelectedTeams} />
      case 'category':
        return (
          <OptionFilter
            label="Category"
            options={categoryOptions}
            selected={colFilters.categories}
            onChange={(v) => setCol({ categories: v })}
          />
        )
      case 'status':
        return <StatusFilter value={status} onChange={setStatus} counts={statusCounts} />
      case 'opener':
        return <ColInput value={colFilters.opener} onChange={(v) => setCol({ opener: v })} placeholder="Filter…" />
      case 'assignee':
        return <ColInput value={colFilters.assignee} onChange={(v) => setCol({ assignee: v })} placeholder="Filter…" />
      case 'opened':
        return (
          <DateRangeFilter
            label="Opened"
            from={colFilters.openedFrom}
            to={colFilters.openedTo}
            onChange={(from, to) => setCol({ openedFrom: from, openedTo: to })}
          />
        )
      case 'last':
        return (
          <DateRangeFilter
            label="Activity"
            from={colFilters.lastFrom}
            to={colFilters.lastTo}
            onChange={(from, to) => setCol({ lastFrom: from, lastTo: to })}
          />
        )
      default:
        return null
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      {/* Board header — the admin-view + assignee toggles and the live result
          count. The per-column filter row in the grid below owns the team,
          status, category, opened / last-activity and the free-text (id /
          subject / opener / assignee) filters — together these cover every
          field, so the old global "search everything" box was removed. */}
      <div className="space-y-3 border-b p-3">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <AdminViewToggle value={adminView} onChange={setAdminView} />

          <AssigneeFilter value={assignee} onChange={setAssignee} hasMe={!!meId} />

          <div className="ml-auto flex items-center gap-2">
            <DensityToggle value={density} onChange={setDensity} />
            <button
              type="button"
              onClick={refetch}
              title="Refresh now"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
            </button>
            <span
              className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex"
              title={live ? 'Live — updates stream in automatically' : 'Reconnecting — polling for updates'}
            >
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  live ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/50',
                )}
              />
              {live ? 'Live' : 'Polling'}
            </span>
          </div>
        </div>

        {/* Result summary + clear-all */}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            Showing <span className="font-medium text-foreground tabular-nums">{rows.length}</span> of{' '}
            <span className="tabular-nums">{data.tickets.length}</span>{' '}
            {data.tickets.length === 1 ? 'ticket' : 'tickets'} · {teamsInView}{' '}
            {teamsInView === 1 ? 'team' : 'teams'}
          </span>
          {filtersActive && (
            <button
              type="button"
              onClick={clearAll}
              className="inline-flex shrink-0 items-center gap-1 hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* The grid */}
      <div className="max-h-[calc(100vh-18rem)] overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b">
              {COLUMNS.map((col) => {
                const isActive = sort.key === col.key
                return (
                  <th
                    key={col.key}
                    className={cn(
                      'h-10 select-none px-3 text-left align-middle text-[11px] font-medium uppercase tracking-wider text-muted-foreground',
                      col.numeric && 'text-right',
                      col.thClass,
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className={cn(
                        'inline-flex items-center gap-1 hover:text-foreground',
                        col.numeric && 'flex-row-reverse',
                        isActive && 'text-foreground',
                      )}
                    >
                      {col.label}
                      {isActive ? (
                        sort.dir === 'desc' ? (
                          <ArrowDown className="h-3 w-3" />
                        ) : (
                          <ArrowUp className="h-3 w-3" />
                        )
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 opacity-30" />
                      )}
                    </button>
                  </th>
                )
              })}
              <th className="hidden w-10 px-2 sm:table-cell" aria-label="Open in Discord" />
            </tr>
            {/* Live per-column filter row */}
            <tr className="border-b bg-card">
              {COLUMNS.map((col) => (
                <th key={col.key} className={cn('px-2 pb-1.5 align-top font-normal', col.thClass)}>
                  {renderColFilter(col.key)}
                </th>
              ))}
              <th className="hidden px-2 sm:table-cell" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLUMNS.length + 1} className="px-3 py-10 text-center text-sm text-muted-foreground">
                  {data.tickets.length === 0 ? (
                    'No tickets in your teams yet.'
                  ) : !adminView ? (
                    <>
                      Showing only tickets you staff, opened, or were added to. Turn on{' '}
                      <span className="font-medium text-foreground">Admin view</span> to see every ticket in the teams
                      you administer.
                    </>
                  ) : (
                    'No tickets match these filters.'
                  )}
                </td>
              </tr>
            ) : (
              rows.map((t) => {
                const href = `/b/${t.teamSlug}/tickets/${t.id}`
                const discordUrl =
                  t.discordChannelId && t.discordGuildId
                    ? `https://discord.com/channels/${t.discordGuildId}/${t.discordChannelId}`
                    : null
                const cat = displayCategory(t)
                return (
                  <tr
                    key={`${t.teamSlug}-${t.id}`}
                    onClick={() => router.push(href)}
                    className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/40"
                  >
                    <td className={cn('hidden px-3 text-right font-mono text-xs text-muted-foreground sm:table-cell', cellPad)}>
                      {t.id}
                    </td>
                    <td className={cn('max-w-[36ch] px-3', cellPad)}>
                      <div className="flex items-center gap-1.5">
                        {t.needsAttention && (
                          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-label="Needs attention" />
                        )}
                        <Link
                          href={href}
                          onClick={(e) => e.stopPropagation()}
                          className="truncate font-medium hover:underline"
                        >
                          {displaySubject(t)}
                        </Link>
                        {t.externalSource === 'tickettool' && (
                          <span className="shrink-0 rounded bg-muted px-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                            TT
                          </span>
                        )}
                      </div>
                      {/* Team shows under the subject on small screens where the Team column is hidden. */}
                      <div className="mt-0.5 truncate text-xs text-muted-foreground md:hidden">{t.teamName}</div>
                    </td>
                    <td className={cn('hidden px-3 text-sm text-muted-foreground md:table-cell', cellPad)}>
                      <span className="truncate">{t.teamName}</span>
                    </td>
                    <td className={cn('hidden px-3 text-sm text-muted-foreground lg:table-cell', cellPad)}>
                      {cat ? (
                        <span className="inline-flex items-center gap-1">
                          {t.categoryEmoji && <span>{t.categoryEmoji}</span>}
                          <span className="truncate">{cat}</span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className={cn('px-3', cellPad)}>
                      <StatusBadge status={t.status} />
                    </td>
                    <td className={cn('hidden px-3 sm:table-cell', cellPad)}>
                      <UserCell name={t.openerName} image={t.openerImage} />
                    </td>
                    <td className={cn('hidden px-3 xl:table-cell', cellPad)}>
                      {t.assigneeId ? (
                        <UserCell name={t.assigneeName} image={t.assigneeImage} />
                      ) : (
                        <span className="text-xs text-muted-foreground/50">Unassigned</span>
                      )}
                    </td>
                    <td
                      className={cn('hidden px-3 text-xs text-muted-foreground 2xl:table-cell', cellPad)}
                      title={new Date(t.openedAt).toLocaleString()}
                    >
                      {relativeTime(t.openedAt)}
                    </td>
                    <td
                      className={cn('px-3 text-xs text-muted-foreground', cellPad)}
                      title={new Date(t.lastActivityAt).toLocaleString()}
                    >
                      {relativeTime(t.lastActivityAt)}
                    </td>
                    <td className={cn('hidden px-2 sm:table-cell', cellPad)}>
                      {discordUrl && (
                        <a
                          href={discordUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          title="Open in Discord"
                          aria-label="Open in Discord"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ColInput({
  value,
  onChange,
  placeholder,
  numeric,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  numeric?: boolean
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'h-7 w-full min-w-0 rounded border border-input bg-background px-2 text-xs outline-none placeholder:text-muted-foreground/50 focus:border-primary/50',
        numeric && 'text-right',
      )}
    />
  )
}

function OptionFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: { value: string; label: string; count: number }[]
  selected: string[]
  onChange: (v: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const sel = new Set(selected)
  const toggle = (v: string) => {
    const n = new Set(sel)
    if (n.has(v)) n.delete(v)
    else n.add(v)
    onChange([...n])
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-7 w-full min-w-0 items-center justify-between gap-1 rounded border bg-background px-2 text-xs text-muted-foreground hover:bg-accent',
            selected.length > 0 && 'border-primary/40 text-foreground',
          )}
        >
          <span className="truncate">
            {label}
            {selected.length > 0 && ` · ${selected.length}`}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        {options.length === 0 ? (
          <div className="px-2 py-2 text-xs text-muted-foreground">No values</div>
        ) : (
          <div className="max-h-64 overflow-auto">
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
                      sel.has(o.value) ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                    )}
                  >
                    {sel.has(o.value) && <Check className="h-3 w-3" />}
                  </span>
                  <span className="truncate">{o.label}</span>
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">{o.count}</span>
              </button>
            ))}
          </div>
        )}
        {selected.length > 0 && (
          <div className="border-t p-1">
            <button
              type="button"
              onClick={() => onChange([])}
              className="w-full rounded-sm px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Clear
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

function UserCell({ name, image }: { name: string | null; image: string | null }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar className="h-5 w-5">
        {image && <AvatarImage src={image} alt="" />}
        <AvatarFallback className="text-[9px]">{initials(name)}</AvatarFallback>
      </Avatar>
      <span className="truncate text-sm">{name ?? <span className="text-muted-foreground">?</span>}</span>
    </span>
  )
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-4 w-7 shrink-0 rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-muted',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 h-3 w-3 rounded-full bg-background transition-all',
          checked ? 'left-[14px]' : 'left-0.5',
        )}
      />
    </button>
  )
}

function TeamFilter({
  teams,
  selected,
  onChange,
}: {
  teams: ConsoleTeam[]
  selected: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const selectedSet = new Set(selected)
  const toggle = (id: string) => {
    const next = new Set(selectedSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange([...next])
  }
  const label =
    selected.length === 0
      ? 'All teams'
      : selected.length === 1
        ? teams.find((t) => t.id === selected[0])?.name ?? '1 team'
        : `${selected.length} teams`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-7 w-full min-w-0 items-center justify-between gap-1 rounded border bg-background px-2 text-xs text-muted-foreground hover:bg-accent',
            selected.length > 0 && 'border-primary/40 text-foreground',
          )}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Filter teams…" />
          <CommandList>
            <CommandEmpty>No teams found.</CommandEmpty>
            <CommandItem value="__all_teams__" onSelect={() => onChange([])} className="justify-between">
              <span>All teams</span>
              {selected.length === 0 && <Check className="h-4 w-4" />}
            </CommandItem>
            {teams.map((t) => {
              const checked = selectedSet.has(t.id)
              return (
                <CommandItem key={t.id} value={t.name} onSelect={() => toggle(t.id)} className="justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border',
                        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                      )}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{t.name}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    {t.staff && (
                      <span className="rounded bg-primary/15 px-1 text-[9px] uppercase tracking-wider text-primary">
                        Staff
                      </span>
                    )}
                    {t.admin && (
                      <span className="rounded bg-muted px-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                        Admin
                      </span>
                    )}
                  </span>
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function AssigneeFilter({
  value,
  onChange,
  hasMe,
}: {
  value: Assignee
  onChange: (v: Assignee) => void
  hasMe: boolean
}) {
  const opts: { key: Assignee; label: string }[] = [
    { key: 'all', label: 'Anyone' },
    ...(hasMe ? [{ key: 'mine' as const, label: 'Mine' }] : []),
    { key: 'unassigned', label: 'Unassigned' },
  ]
  return (
    <div className="inline-flex h-9 items-center rounded-md border bg-card p-0.5 text-xs">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            'rounded px-2.5 py-1 transition-colors',
            value === o.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function AdminViewToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      className={cn(
        'inline-flex h-9 items-center gap-2 rounded-md border bg-card px-2.5 text-sm',
        value && 'border-primary/40',
      )}
      title={
        value
          ? 'Admin view on — every ticket in teams you administer'
          : 'Admin view off — only tickets you staff, opened, or were added to'
      }
    >
      <ShieldCheck className={cn('h-4 w-4', value ? 'text-primary' : 'text-muted-foreground')} />
      <span className={cn('hidden sm:inline', value ? 'text-foreground' : 'text-muted-foreground')}>Admin view</span>
      <Switch checked={value} onChange={onChange} />
    </div>
  )
}

function DensityToggle({ value, onChange }: { value: Density; onChange: (v: Density) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(value === 'comfortable' ? 'compact' : 'comfortable')}
      title={value === 'comfortable' ? 'Switch to compact rows' : 'Switch to comfortable rows'}
      aria-label="Toggle row density"
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {value === 'comfortable' ? <Rows2 className="h-4 w-4" /> : <Rows3 className="h-4 w-4" />}
    </button>
  )
}

// Single-select status dropdown — replaces the old chip row. Lists every status
// bucket with its live count; "Active" is the default and shows un-highlighted.
function StatusFilter({
  value,
  onChange,
  counts,
}: {
  value: string
  onChange: (v: string) => void
  counts: Record<string, number>
}) {
  const [open, setOpen] = useState(false)
  const current = STATUS_TABS.find((s) => s.key === value) ?? STATUS_TABS[0]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-7 w-full min-w-0 items-center justify-between gap-1 rounded border bg-background px-2 text-xs text-muted-foreground hover:bg-accent',
            value !== 'active' && 'border-primary/40 text-foreground',
          )}
        >
          <span className="truncate">{current.label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-1">
        {STATUS_TABS.map((s) => {
          const active = s.key === value
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => {
                onChange(s.key)
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent',
                active && 'bg-accent',
              )}
            >
              <span className="flex items-center gap-2">
                <Check className={cn('h-3.5 w-3.5', active ? 'opacity-100' : 'opacity-0')} />
                {s.label}
              </span>
              <span className="text-[10px] text-muted-foreground tabular-nums">{counts[s.key] ?? 0}</span>
            </button>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

// Per-column date-range filter (Opened, Last activity). Two native date inputs
// in a popover; either bound may be left blank for an open end, and blank/blank
// means "no filter" — the default, so everything shows until you pick a date.
function DateRangeFilter({
  label,
  from,
  to,
  onChange,
}: {
  label: string
  from: string
  to: string
  onChange: (from: string, to: string) => void
}) {
  const [open, setOpen] = useState(false)
  const active = !!(from || to)
  const summary = active ? `${from || '…'} → ${to || '…'}` : label
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-7 w-full min-w-0 items-center justify-between gap-1 rounded border bg-background px-2 text-xs text-muted-foreground hover:bg-accent',
            active && 'border-primary/40 text-foreground',
          )}
        >
          <span className="flex min-w-0 items-center gap-1">
            <CalendarRange className="h-3 w-3 shrink-0 opacity-60" />
            <span className="truncate">{summary}</span>
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 space-y-2 p-2">
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">From</span>
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => onChange(e.target.value, to)}
            className="h-8 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:border-primary/50"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] font-medium text-muted-foreground">To</span>
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => onChange(from, e.target.value)}
            className="h-8 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:border-primary/50"
          />
        </label>
        {active && (
          <button
            type="button"
            onClick={() => onChange('', '')}
            className="w-full rounded-sm border px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Clear
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
