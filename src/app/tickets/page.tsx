import Link from 'next/link'
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import { TopNav } from '@/components/app/top-nav'
import { StatusBadge } from '@/components/app/status-badge'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { listMyBusinesses, requireSession } from '@/server/permissions'
import { db } from '@/db/client'
import { businesses, tickets, users } from '@/db/schema'
import { relativeTime } from '@/lib/format'

// P8 (lantern) — "All tickets I can see". Cross-business view: every ticket in
// a team the signed-in user administers, plus their own tickets in any team
// they belong to. One query, no fan-out.
export default async function AllTicketsPage() {
  const session = await requireSession()
  const my = await listMyBusinesses()

  const allIds = my.map((b) => b.business.id)
  const adminIds = my.filter((b) => b.level === 'admin' || b.level === 'owner').map((b) => b.business.id)

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
            or(
              adminIds.length ? inArray(tickets.businessId, adminIds) : sql`false`,
              and(eq(tickets.openerUserId, session.user.id), inArray(tickets.businessId, allIds)),
            ),
          )
          .orderBy(desc(tickets.lastActivityAt))
          .limit(300)

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
            {allIds.length === 1 ? 'team' : 'teams'} you can see.
          </p>
        </div>

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
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead className="hidden md:table-cell">Team</TableHead>
                    <TableHead className="hidden lg:table-cell">Opener</TableHead>
                    <TableHead className="w-20">Status</TableHead>
                    <TableHead className="hidden w-32 sm:table-cell">Last activity</TableHead>
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
