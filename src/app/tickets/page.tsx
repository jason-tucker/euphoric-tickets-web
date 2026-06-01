import Link from 'next/link'
import { and, asc, desc, eq, ilike, inArray, ne, or, sql, type SQL } from 'drizzle-orm'
import { TopNav } from '@/components/app/top-nav'
import { StatusBadge } from '@/components/app/status-badge'
import { SortHeader, parseSort } from '@/components/app/sort-header'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { listMyBusinesses, requireSession } from '@/server/permissions'
import { db } from '@/db/client'
import { businesses, tickets, ticketStatuses, users, type TicketStatus } from '@/db/schema'
import { relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const SORT_KEYS = ['last', 'opened', 'id', 'subject', 'status', 'team', 'opener'] as const

// P8 (lantern) — "All tickets I can see". Cross-business view: every ticket in
// a team the signed-in user administers, plus their own tickets in any team
// they belong to. One query, no fan-out. P9 adds URL sort state. Defaults to
// ACTIVE (closed hidden) so the board stays clean; Closed is a filter button.
export default async function AllTicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string; status?: string; q?: string }>
}) {
  const session = await requireSession()
  const my = await listMyBusinesses()
  const sp = await searchParams
  const { sort, dir } = parseSort(sp, SORT_KEYS, 'last')

  // Subject search — case-insensitive substring. Empty / whitespace-only
  // disables the filter.
  const q = (sp.q ?? '').trim()
  const searchWhere: SQL | undefined = q ? ilike(tickets.subject, `%${q}%`) : undefined

  // status: default 'active' (everything except closed). 'all' = no filter.
  // A specific status = exactly that.
  const filter = sp.status ?? 'active'
  const statusWhere: SQL | undefined =
    filter === 'all'
      ? undefined
      : filter === 'active'
        ? ne(tickets.status, 'closed')
        : (ticketStatuses as readonly string[]).includes(filter)
          ? eq(tickets.status, filter as TicketStatus)
          : ne(tickets.status, 'closed')

  const allIds = my.map((b) => b.business.id)
  const adminIds = my.filter((b) => b.level === 'admin' || b.level === 'owner').map((b) => b.business.id)

  const d = dir === 'asc' ? asc : desc
  const orderBy: SQL = (() => {
    switch (sort) {
      case 'opened': return d(tickets.openedAt)
      case 'id': return d(tickets.id)
      case 'subject': return d(tickets.subject)
      case 'status': return d(tickets.status)
      case 'team': return d(businesses.name)
      case 'opener': return d(users.name)
      default: return d(tickets.lastActivityAt)
    }
  })()

  const rows =
    allIds.length === 0
      ? []
      : await db
          .select({
            id: tickets.id,
            subject: tickets.subject,
            status: tickets.status,
            openedAt: tickets.openedAt,
            lastActivityAt: tickets.lastActivityAt,
            openerName: users.name,
            businessName: businesses.name,
            businessSlug: businesses.slug,
            businessId: tickets.businessId,
          })
          .from(tickets)
          .innerJoin(businesses, eq(businesses.id, tickets.businessId))
          .leftJoin(users, eq(users.id, tickets.openerUserId))
          .where(
            and(
              or(
                adminIds.length ? inArray(tickets.businessId, adminIds) : sql`false`,
                and(eq(tickets.openerUserId, session.user.id), inArray(tickets.businessId, allIds)),
              ),
              statusWhere,
              searchWhere,
            ),
          )
          .orderBy(orderBy)
          .limit(300)

  const hp = { sort, dir, status: sp.status, q: q || undefined }

  // Admins land on the team queue view of a row; non-admins on their own ticket.
  const adminSet = new Set(adminIds)

  return (
    <>
      <TopNav />
      <main className="container max-w-6xl space-y-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold">All tickets</h1>
          <p className="text-sm text-muted-foreground">
            {rows.length} {rows.length === 1 ? 'ticket' : 'tickets'} across {allIds.length}{' '}
            {allIds.length === 1 ? 'team' : 'teams'} ·{' '}
            <span className="font-medium text-foreground">
              {filter === 'all' ? 'all statuses' : filter === 'active' ? 'active' : filter}
            </span>
          </p>
        </div>

        <BoardSearch q={q} status={sp.status} sort={sort} dir={dir} />

        <FilterBar active={filter} sort={sort} dir={dir} />

        {rows.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nothing here yet</CardTitle>
              <CardDescription>
                Tickets you administer or opened across all your teams will show up here.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <SortHeader label="#" sortKey="id" activeSort={sort} activeDir={dir} basePath="/tickets" params={hp} />
                    </TableHead>
                    <TableHead>
                      <SortHeader label="Subject" sortKey="subject" activeSort={sort} activeDir={dir} basePath="/tickets" params={hp} />
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      <SortHeader label="Team" sortKey="team" activeSort={sort} activeDir={dir} basePath="/tickets" params={hp} />
                    </TableHead>
                    <TableHead className="hidden lg:table-cell">
                      <SortHeader label="Opener" sortKey="opener" activeSort={sort} activeDir={dir} basePath="/tickets" params={hp} />
                    </TableHead>
                    <TableHead className="w-20">
                      <SortHeader label="Status" sortKey="status" activeSort={sort} activeDir={dir} basePath="/tickets" params={hp} />
                    </TableHead>
                    <TableHead className="hidden w-32 sm:table-cell">
                      <SortHeader label="Last activity" sortKey="last" activeSort={sort} activeDir={dir} basePath="/tickets" params={hp} />
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((t) => {
                    const href = adminSet.has(t.businessId)
                      ? `/b/${t.businessSlug}/tickets/${t.id}`
                      : `/b/${t.businessSlug}/tickets/${t.id}`
                    return (
                      <TableRow key={`${t.businessSlug}-${t.id}`}>
                        <TableCell className="font-mono text-xs text-muted-foreground">{t.id}</TableCell>
                        <TableCell className="max-w-[40ch] truncate">
                          <Link href={href} className="font-medium hover:underline">
                            {t.subject}
                          </Link>
                        </TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                          {t.businessName}
                        </TableCell>
                        <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                          {t.openerName ?? '?'}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={t.status} />
                        </TableCell>
                        <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                          {relativeTime(t.lastActivityAt)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  )
}

// Mirror of /b/[slug]/tickets/page.tsx::BoardSearch but for the cross-team
// view — submits to /tickets and carries the other URL params forward.
function BoardSearch({
  q,
  status,
  sort,
  dir,
}: {
  q: string
  status: string | undefined
  sort: string
  dir: string
}) {
  return (
    <form action="/tickets" method="get" className="flex items-center gap-2">
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
          href={`/tickets${status || sort !== 'last' || dir !== 'desc' ? '?' : ''}${
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

function FilterBar({ active, sort, dir }: { active: string; sort: string; dir: string }) {
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
            href={`/tickets?${sp.toString()}`}
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
