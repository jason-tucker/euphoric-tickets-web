import Link from 'next/link'
import { and, asc, desc, eq, ilike, ne, type SQL } from 'drizzle-orm'
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
  searchParams: Promise<{ status?: string; sort?: string; dir?: string; q?: string }>
}) {
  const { slug } = await params
  const sp = await searchParams
  const { business } = await requireBusinessAccess(slug, 'admin')

  // Subject search — case-insensitive substring. Empty / whitespace-only
  // disables the filter so the URL stays clean and the page renders fully.
  const q = (sp.q ?? '').trim()
  const searchWhere: SQL | undefined = q ? ilike(tickets.subject, `%${q}%`) : undefined

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
  const hp = { status: sp.status, sort, dir, q: q || undefined }

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
    .where(and(businessFilter, statusWhere, searchWhere))
    .orderBy(orderBy)
    .limit(200)

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

// Lightweight server-form board search. Submitting reloads the page with
// `?q=…` so the SQL `ILIKE %q%` runs on the next render. Hidden inputs
// carry the other URL params forward so the existing status/sort/dir
// selection survives a search submit.
function BoardSearch({
  slug,
  q,
  status,
  sort,
  dir,
}: {
  slug: string
  q: string
  status: string | undefined
  sort: string
  dir: string
}) {
  return (
    <form action={`/b/${slug}/tickets`} method="get" className="flex items-center gap-2">
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
        Search
      </button>
      {q && (
        <Link
          href={`/b/${slug}/tickets${status || sort !== 'last' || dir !== 'desc' ? '?' : ''}${
            new URLSearchParams({
              ...(status ? { status } : {}),
              ...(sort !== 'last' ? { sort } : {}),
              ...(dir !== 'desc' ? { dir } : {}),
            }).toString()
          }`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Clear
        </Link>
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
