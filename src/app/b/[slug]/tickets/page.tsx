import Link from 'next/link'
import { and, desc, eq, sql } from 'drizzle-orm'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/app/status-badge'
import { requireBusinessAccess } from '@/server/permissions'
import { db } from '@/db/client'
import { businesses, tickets, ticketStatuses, users, type TicketStatus } from '@/db/schema'
import { relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'

const ALL_STATUS = 'all' as const

export default async function TicketQueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ status?: string }>
}) {
  const { slug } = await params
  const sp = await searchParams
  const { business } = await requireBusinessAccess(slug, 'admin')

  const filter = sp.status ?? 'open'
  const isAll = filter === ALL_STATUS
  const isValid = isAll || (ticketStatuses as readonly string[]).includes(filter)
  const status = isValid && !isAll ? (filter as TicketStatus) : null

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
    })
    .from(tickets)
    .leftJoin(users, eq(users.id, tickets.openerUserId))
    .leftJoin(clientBusinessAlias, eq(clientBusinessAlias.id, tickets.clientBusinessId))
    .where(status ? and(businessFilter, eq(tickets.status, status)) : businessFilter)
    .orderBy(desc(tickets.lastActivityAt))
    .limit(200)

  return (
    <main className="container max-w-6xl space-y-4 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Tickets</h1>
        <p className="text-sm text-muted-foreground">
          {rows.length} {rows.length === 1 ? 'ticket' : 'tickets'} ·{' '}
          {status ? <span className="font-medium text-foreground">{status}</span> : 'all statuses'}
        </p>
      </div>

      <FilterBar slug={slug} active={filter} />

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No tickets match this filter.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead className="hidden md:table-cell">Opener</TableHead>
                  {business.kind === 'host' && (
                    <TableHead className="hidden md:table-cell">Client</TableHead>
                  )}
                  <TableHead className="w-20">Status</TableHead>
                  <TableHead className="hidden w-32 sm:table-cell">Last activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
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
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

function FilterBar({ slug, active }: { slug: string; active: string }) {
  const tabs = [
    { key: 'open', label: 'Open' },
    { key: 'claimed', label: 'Claimed' },
    { key: 'waiting', label: 'Waiting' },
    { key: 'closed', label: 'Closed' },
    { key: ALL_STATUS, label: 'All' },
  ]
  return (
    <div className="flex flex-wrap gap-1">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={`/b/${slug}/tickets?status=${t.key}`}
          className={cn(
            'rounded-md border px-3 py-1.5 text-sm transition-colors',
            active === t.key ? 'border-primary/40 bg-primary/10 text-primary' : 'hover:bg-accent',
          )}
        >
          {t.label}
        </Link>
      ))}
    </div>
  )
}
