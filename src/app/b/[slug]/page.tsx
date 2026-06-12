import Link from 'next/link'
import { and, eq, inArray, or, sql } from 'drizzle-orm'
import { Plus } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/app/status-badge'
import { resolveBusinessAccess, requireSession } from '@/server/permissions'
import { db } from '@/db/client'
import { tickets } from '@/db/schema'
import { relativeTime } from '@/lib/format'
import { desc } from 'drizzle-orm'

export default async function BusinessOverviewPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const session = await requireSession()
  const { slug } = await params
  const resolved = await resolveBusinessAccess(slug)
  if (!resolved) return null

  const { business, level } = resolved
  const isAdmin = level === 'admin' || level === 'owner'

  // Members see only their own tickets in this business. Admins see top-line
  // stats — one GROUP BY query instead of a count round-trip per status.
  const [statRows, myTickets] = await Promise.all([
    isAdmin
      ? db
          .select({ status: tickets.status, n: sql<number>`count(*)` })
          .from(tickets)
          .where(
            and(
              eq(tickets.businessId, business.id),
              or(
                inArray(tickets.status, ['open', 'claimed', 'waiting']),
                and(
                  eq(tickets.status, 'closed'),
                  sql`${tickets.closedAt} > now() - interval '24 hours'`,
                ),
              ),
            ),
          )
          .groupBy(tickets.status)
      : Promise.resolve([]),
    db
      .select()
      .from(tickets)
      .where(and(eq(tickets.businessId, business.id), eq(tickets.openerUserId, session.user.id)))
      .orderBy(desc(tickets.lastActivityAt))
      .limit(10),
  ])
  const countByStatus = new Map(statRows.map((r) => [r.status, Number(r.n)]))
  const openCount = countByStatus.get('open') ?? 0
  const claimedCount = countByStatus.get('claimed') ?? 0
  const waitingCount = countByStatus.get('waiting') ?? 0
  const closedTodayCount = countByStatus.get('closed') ?? 0

  return (
    <main className="container max-w-6xl space-y-6 py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{business.name}</h1>
          {business.description && (
            <p className="text-sm text-muted-foreground">{business.description}</p>
          )}
        </div>
        <Button asChild>
          <Link href={`/t/new?b=${business.slug}`}>
            <Plus />
            Open a ticket
          </Link>
        </Button>
      </div>

      {isAdmin && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Open" value={openCount} tone="open" />
          <Stat label="Claimed" value={claimedCount} tone="claimed" />
          <Stat label="Waiting" value={waitingCount} tone="waiting" />
          <Stat label="Closed (24h)" value={closedTodayCount} tone="closed" />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">My recent tickets</CardTitle>
          <CardDescription>Tickets you've opened in {business.name}.</CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {myTickets.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground sm:p-6">No tickets yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead className="w-20">Status</TableHead>
                  <TableHead className="hidden w-32 sm:table-cell">Last activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myTickets.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{t.id}</TableCell>
                    <TableCell className="max-w-[40ch] truncate">
                      <Link href={`/b/${business.slug}/tickets/${t.id}`} className="font-medium hover:underline">
                        {t.subject}
                      </Link>
                    </TableCell>
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

function Stat({ label, value, tone }: { label: string; value: number; tone: 'open' | 'claimed' | 'waiting' | 'closed' }) {
  const colorByTone = {
    open: 'text-status-open',
    claimed: 'text-status-claimed',
    waiting: 'text-status-waiting',
    closed: 'text-status-closed',
  } as const
  return (
    <Card>
      <CardContent className="py-4 sm:py-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold ${colorByTone[tone]}`}>{value}</div>
      </CardContent>
    </Card>
  )
}
