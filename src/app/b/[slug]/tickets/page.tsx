import Link from 'next/link'
import { and, asc, desc, eq, ilike, inArray, isNotNull, ne, type SQL } from 'drizzle-orm'
import { ExternalLink } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/app/status-badge'
import { SortHeader, parseSort } from '@/components/app/sort-header'
import { requireBusinessAccess } from '@/server/permissions'
import { db } from '@/db/client'
import { businesses, tickets, ticketStatuses, users, type TicketStatus } from '@/db/schema'
import { relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const SORT_KEYS = ['last', 'opened', 'id', 'subject', 'status', 'opener'] as const

export default async function TicketQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{
    status?: string
    sort?: string
    dir?: string
    q?: string
    // Browsers submit checkbox groups as repeated `?openers=a&openers=b`,
    // so Next.js types these as `string | string[]`. We accept either
    // shape and normalize below.
    openers?: string | string[]
    clients?: string | string[]
  }>
}) {
  const { slug } = await params
  const sp = await searchParams
  const { business } = await requireBusinessAccess(slug, 'admin')

  // Subject search — case-insensitive substring. Empty / whitespace-only
  // disables the filter so the URL stays clean and the page renders fully.
  const q = (sp.q ?? '').trim()
  const searchWhere: SQL | undefined = q ? ilike(tickets.subject, `%${q}%`) : undefined

  // Opener / client multi-selects — values arrive as repeated query params
  // (`?openers=a&openers=b`) from the checkbox form, but a hand-typed URL
  // with comma-separated ids is also accepted as a convenience. Bad input
  // is dropped (uuids only). Empty selection disables the filter — picking
  // every option is functionally the same as picking none.
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const normalizeIds = (raw: string | string[] | undefined): string[] =>
    (Array.isArray(raw) ? raw.flatMap((v) => v.split(',')) : (raw ?? '').split(','))
      .map((s) => s.trim())
      .filter((s) => UUID.test(s))
  const selectedOpenerIds = normalizeIds(sp.openers)
  const selectedClientIds = normalizeIds(sp.clients)
  const openerWhere: SQL | undefined = selectedOpenerIds.length
    ? inArray(tickets.openerUserId, selectedOpenerIds)
    : undefined
  const clientWhere: SQL | undefined = selectedClientIds.length
    ? inArray(tickets.clientBusinessId, selectedClientIds)
    : undefined

  // Default 'active' (everything except closed). 'all' = no filter. A specific
  // status = exactly that. Mirrors the All-tickets board so both queues share
  // the same buttons + default.
  const filter = sp.status ?? 'active'
  const statusWhere: SQL | undefined =
    filter === 'all'
      ? undefined
      : filter === 'active'
        ? ne(tickets.status, 'closed')
        : (ticketStatuses as readonly string[]).includes(filter)
          ? eq(tickets.status, filter as TicketStatus)
          : ne(tickets.status, 'closed')

  const { sort, dir } = parseSort(sp, SORT_KEYS, 'last')
  const d = dir === 'asc' ? asc : desc
  const orderBy: SQL = (() => {
    switch (sort) {
      case 'opened': return d(tickets.openedAt)
      case 'id': return d(tickets.id)
      case 'subject': return d(tickets.subject)
      case 'status': return d(tickets.status)
      case 'opener': return d(users.name)
      default: return d(tickets.lastActivityAt)
    }
  })()
  const hp = {
    status: sp.status,
    sort,
    dir,
    q: q || undefined,
    openers: selectedOpenerIds.length ? selectedOpenerIds.join(',') : undefined,
    clients: selectedClientIds.length ? selectedClientIds.join(',') : undefined,
  }

  // Client-kind business → queue is tickets where THIS business is the
  // client_business_id (across whatever host operates them). Host-kind →
  // tickets where business_id = this business.
  const businessFilter =
    business.kind === 'client'
      ? eq(tickets.clientBusinessId, business.id)
      : eq(tickets.businessId, business.id)

  const clientBusinessAlias = businesses

  const rows = await db
    .select({
      id: tickets.id,
      subject: tickets.subject,
      status: tickets.status,
      openerId: tickets.openerUserId,
      openerName: users.name,
      openerImage: users.image,
      openedAt: tickets.openedAt,
      lastActivityAt: tickets.lastActivityAt,
      assigneeId: tickets.assigneeUserId,
      clientBusinessId: tickets.clientBusinessId,
      clientBusinessName: clientBusinessAlias.name,
      discordChannelId: tickets.discordChannelId,
    })
    .from(tickets)
    .leftJoin(users, eq(users.id, tickets.openerUserId))
    .leftJoin(clientBusinessAlias, eq(clientBusinessAlias.id, tickets.clientBusinessId))
    .where(and(businessFilter, statusWhere, searchWhere, openerWhere, clientWhere))
    .orderBy(orderBy)
    .limit(200)

  // Build the universe of openers + clients for the filter UI. Universe is
  // scoped to `businessFilter` only (not the active opener/client/search/
  // status filters) so the checkboxes don't disappear as you select them.
  // Two extra cheap queries; rendering them as <details> keeps the page
  // quiet for users who never expand the filters.
  const allOpeners = await db
    .selectDistinct({ id: users.id, name: users.name, image: users.image })
    .from(tickets)
    .innerJoin(users, eq(users.id, tickets.openerUserId))
    .where(businessFilter)
    .orderBy(asc(users.name))
  const allClients = await db
    .selectDistinct({ id: clientBusinessAlias.id, name: clientBusinessAlias.name })
    .from(tickets)
    .innerJoin(clientBusinessAlias, eq(clientBusinessAlias.id, tickets.clientBusinessId))
    .where(and(businessFilter, isNotNull(tickets.clientBusinessId)))
    .orderBy(asc(clientBusinessAlias.name))

  return (
    <main className="container max-w-6xl space-y-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Tickets</h1>
        <p className="text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? 'ticket' : 'tickets'} ·{' '}
          <span className="font-medium text-foreground">
            {filter === 'all' ? 'all statuses' : filter === 'active' ? 'active' : filter}
          </span>
        </p>
      </div>

      <BoardSearch
        slug={slug}
        q={q}
        status={sp.status}
        sort={sort}
        dir={dir}
        selectedOpenerIds={selectedOpenerIds}
        selectedClientIds={selectedClientIds}
        allOpeners={allOpeners}
        allClients={allClients}
      />

      <FilterBar slug={slug} active={filter} sort={sort} dir={dir} />

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No tickets match this filter.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <SortHeader label="#" sortKey="id" activeSort={sort} activeDir={dir} basePath={`/b/${slug}/tickets`} params={hp} />
                  </TableHead>
                  <TableHead>
                    <SortHeader label="Subject" sortKey="subject" activeSort={sort} activeDir={dir} basePath={`/b/${slug}/tickets`} params={hp} />
                  </TableHead>
                  <TableHead className="hidden md:table-cell">
                    <SortHeader label="Opener" sortKey="opener" activeSort={sort} activeDir={dir} basePath={`/b/${slug}/tickets`} params={hp} />
                  </TableHead>
                  {business.kind === 'host' && (
                    <TableHead className="hidden md:table-cell">Client</TableHead>
                  )}
                  <TableHead className="w-20">
                    <SortHeader label="Status" sortKey="status" activeSort={sort} activeDir={dir} basePath={`/b/${slug}/tickets`} params={hp} />
                  </TableHead>
                  <TableHead className="hidden w-32 sm:table-cell">
                    <SortHeader label="Last activity" sortKey="last" activeSort={sort} activeDir={dir} basePath={`/b/${slug}/tickets`} params={hp} />
                  </TableHead>
                  <TableHead className="hidden w-10 lg:table-cell" aria-label="Discord" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => {
                  const discordUrl =
                    t.discordChannelId && business.discordGuildId
                      ? `https://discord.com/channels/${business.discordGuildId}/${t.discordChannelId}`
                      : null
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{t.id}</TableCell>
                      <TableCell className="max-w-[40ch] truncate">
                        <Link href={`/b/${slug}/tickets/${t.id}`} className="font-medium hover:underline">
                          {t.subject}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden text-sm md:table-cell">
                        <span className="text-muted-foreground">{t.openerName ?? '?'}</span>
                      </TableCell>
                      {business.kind === 'host' && (
                        <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                          {t.clientBusinessName ?? '—'}
                        </TableCell>
                      )}
                      <TableCell><StatusBadge status={t.status} /></TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                        {relativeTime(t.lastActivityAt)}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {discordUrl && (
                          <a
                            href={discordUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open in Discord"
                            aria-label="Open in Discord"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

// Server-form board search + filters. One form submits `q`, the opener
// checkbox set, and the client checkbox set together. Hidden inputs carry
// status/sort/dir forward so the FilterBar above and the SortHeader cells
// below all stay consistent across submissions. Filters live behind a
// <details> so unexpanded boards keep their visual weight low; the trigger
// label includes a count when filters are active.
function BoardSearch({
  slug,
  q,
  status,
  sort,
  dir,
  selectedOpenerIds,
  selectedClientIds,
  allOpeners,
  allClients,
}: {
  slug: string
  q: string
  status: string | undefined
  sort: string
  dir: string
  selectedOpenerIds: string[]
  selectedClientIds: string[]
  allOpeners: Array<{ id: string; name: string | null; image: string | null }>
  allClients: Array<{ id: string; name: string }>
}) {
  const activeFilterCount = selectedOpenerIds.length + selectedClientIds.length
  const baseParams = new URLSearchParams({
    ...(status ? { status } : {}),
    ...(sort !== 'last' ? { sort } : {}),
    ...(dir !== 'desc' ? { dir } : {}),
  })
  return (
    <form action={`/b/${slug}/tickets`} method="get" className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search subject…"
          className="h-9 max-w-xs"
          aria-label="Search ticket subjects"
        />
        {status && <input type="hidden" name="status" value={status} />}
        {sort !== 'last' && <input type="hidden" name="sort" value={sort} />}
        {dir !== 'desc' && <input type="hidden" name="dir" value={dir} />}
        <button
          type="submit"
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
        >
          Apply
        </button>
        {(q || activeFilterCount > 0) && (
          <Link
            href={`/b/${slug}/tickets${baseParams.toString() ? `?${baseParams.toString()}` : ''}`}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </Link>
        )}
      </div>

      {(allOpeners.length > 0 || allClients.length > 0) && (
        <details className="rounded-md border" open={activeFilterCount > 0}>
          <summary className="cursor-pointer select-none px-3 py-1.5 text-sm hover:bg-accent">
            Filters {activeFilterCount > 0 && <span className="ml-1 text-muted-foreground">({activeFilterCount} active)</span>}
          </summary>
          <div className="space-y-3 border-t p-3">
            {allOpeners.length > 0 && (
              <fieldset className="space-y-1">
                <legend className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Opener</legend>
                <div className="flex max-h-48 flex-wrap gap-x-3 gap-y-1 overflow-y-auto">
                  {allOpeners.map((o) => (
                    <label key={o.id} className="inline-flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        name="openers"
                        value={o.id}
                        defaultChecked={selectedOpenerIds.includes(o.id)}
                        className="h-3.5 w-3.5 rounded border-input accent-foreground"
                      />
                      {o.name ?? <span className="font-mono text-xs text-muted-foreground">?</span>}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {allClients.length > 0 && (
              <fieldset className="space-y-1">
                <legend className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Client</legend>
                <div className="flex max-h-48 flex-wrap gap-x-3 gap-y-1 overflow-y-auto">
                  {allClients.map((c) => (
                    <label key={c.id} className="inline-flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        name="clients"
                        value={c.id}
                        defaultChecked={selectedClientIds.includes(c.id)}
                        className="h-3.5 w-3.5 rounded border-input accent-foreground"
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </div>
        </details>
      )}
    </form>
  )
}

function FilterBar({ slug, active, sort, dir }: { slug: string; active: string; sort: string; dir: string }) {
  const tabs = [
    { key: 'active', label: 'Active' },
    { key: 'open', label: 'Open' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'waiting', label: 'Waiting' },
    { key: 'on_hold', label: 'On Hold' },
    { key: 'completed', label: 'Completed' },
    { key: 'closed', label: 'Closed' },
    { key: 'all', label: 'All' },
  ]
  return (
    <div className="flex flex-wrap gap-1">
      {tabs.map((t) => {
        const sp = new URLSearchParams()
        sp.set('status', t.key)
        if (sort !== 'last') sp.set('sort', sort)
        if (dir !== 'desc') sp.set('dir', dir)
        return (
          <Link
            key={t.key}
            href={`/b/${slug}/tickets?${sp.toString()}`}
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm transition-colors',
              active === t.key ? 'border-primary/40 bg-primary/10 text-primary' : 'hover:bg-accent',
            )}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
