import Link from 'next/link'
import { and, desc, eq, inArray, notInArray, or, sql } from 'drizzle-orm'
import { Plus, Building2 } from 'lucide-react'
import { TopNav } from '@/components/app/top-nav'
import { StatusBadge } from '@/components/app/status-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { listMyBusinesses, requireSession } from '@/server/permissions'
import { db } from '@/db/client'
import { businesses, ticketExternalMembers, tickets } from '@/db/schema'
import { relativeTime } from '@/lib/format'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>
}) {
  const session = await requireSession()
  const myBusinesses = await listMyBusinesses()
  const businessIds = myBusinesses.map((b) => b.business.id)
  const adminBusinessIds = myBusinesses
    .filter((b) => b.level === 'admin' || b.level === 'owner')
    .map((b) => b.business.id)
  const isStaff = adminBusinessIds.length > 0

  // `mode` toggle (staff/admin only):
  //   user  — tickets I opened OR was explicitly added to (ticket_external_members)
  //   staff — tickets in my admin businesses I'm NOT personally on
  // Non-staff users see the 'user' query only; the toggle UI is hidden.
  const sp = await searchParams
  const mode: 'user' | 'staff' = isStaff && sp.mode === 'staff' ? 'staff' : 'user'

  let myTickets: Array<{
    id: number
    subject: string
    status: string
    lastActivityAt: Date
    businessName: string
    businessSlug: string
  }> = []
  if (businessIds.length > 0) {
    // ticket_external_members holds every explicit add — externals get a row
    // at add time (P16), and as of v0.6.39 in-guild adds get one too. So the
    // subquery is the single "tickets I'm personally on" signal for the web.
    const myMemberTicketIds = db
      .select({ ticketId: ticketExternalMembers.ticketId })
      .from(ticketExternalMembers)
      .where(eq(ticketExternalMembers.userId, session.user.id))

    const userWhere = and(
      or(
        eq(tickets.openerUserId, session.user.id),
        inArray(tickets.id, myMemberTicketIds),
      ),
      inArray(tickets.businessId, businessIds),
    )

    if (mode === 'user') {
      myTickets = await db
        .select({
          id: tickets.id,
          subject: tickets.subject,
          status: tickets.status,
          lastActivityAt: tickets.lastActivityAt,
          businessName: businesses.name,
          businessSlug: businesses.slug,
        })
        .from(tickets)
        .innerJoin(businesses, eq(businesses.id, tickets.businessId))
        .where(userWhere)
        .orderBy(desc(tickets.lastActivityAt))
        .limit(50)
    } else {
      // Staff view: tickets in my admin businesses where I'm NEITHER the
      // opener NOR an explicit member. These are the ones I can see purely
      // because of my staff role — the "residual" queue.
      myTickets = await db
        .select({
          id: tickets.id,
          subject: tickets.subject,
          status: tickets.status,
          lastActivityAt: tickets.lastActivityAt,
          businessName: businesses.name,
          businessSlug: businesses.slug,
        })
        .from(tickets)
        .innerJoin(businesses, eq(businesses.id, tickets.businessId))
        .where(
          and(
            inArray(tickets.businessId, adminBusinessIds),
            sql`${tickets.openerUserId} != ${session.user.id}`,
            notInArray(tickets.id, myMemberTicketIds),
          ),
        )
        .orderBy(desc(tickets.lastActivityAt))
        .limit(50)
    }
  }

  const adminOf = myBusinesses.filter((b) => b.level === 'admin' || b.level === 'owner')

  return (
    <>
      <TopNav />
      <main className="container max-w-6xl space-y-6 py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">My tickets</h1>
            <p className="text-sm text-muted-foreground">
              {mode === 'user'
                ? <>Tickets you&apos;ve opened or been added to across {myBusinesses.length} {myBusinesses.length === 1 ? 'team' : 'teams'}.</>
                : <>Tickets in {adminBusinessIds.length} {adminBusinessIds.length === 1 ? 'team' : 'teams'} you administer that you aren&apos;t personally on.</>}
            </p>
            {isStaff && (
              <div className="inline-flex gap-1 rounded-md border border-input bg-background p-0.5 text-xs">
                <Button asChild size="sm" variant={mode === 'user' ? 'secondary' : 'ghost'} className="h-7 px-3">
                  <Link href="/dashboard">User</Link>
                </Button>
                <Button asChild size="sm" variant={mode === 'staff' ? 'secondary' : 'ghost'} className="h-7 px-3">
                  <Link href="/dashboard?mode=staff">Staff</Link>
                </Button>
              </div>
            )}
          </div>
          <Button asChild>
            <Link href="/t/new">
              <Plus />
              Open a ticket
            </Link>
          </Button>
        </div>

        {myBusinesses.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle>No teams yet</CardTitle>
              <CardDescription>
                You're not a member of any Discord team that's connected to Euphoric Tickets.
                Ask an admin to add you, then sign out and back in.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {myTickets.length > 0 ? (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">#</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead className="hidden md:table-cell">Team</TableHead>
                    <TableHead className="w-20">Status</TableHead>
                    <TableHead className="hidden w-32 sm:table-cell">Last activity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myTickets.map((t) => (
                    <TableRow key={`${t.businessSlug}-${t.id}`}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{t.id}</TableCell>
                      <TableCell className="max-w-[40ch] truncate">
                        <Link
                          href={`/b/${t.businessSlug}/tickets/${t.id}`}
                          className="font-medium hover:underline"
                        >
                          {t.subject}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                        {t.businessName}
                      </TableCell>
                      <TableCell><StatusBadge status={t.status} /></TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                        {relativeTime(t.lastActivityAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : (
          myBusinesses.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{mode === 'user' ? 'No tickets yet' : 'Nothing in the staff queue'}</CardTitle>
                <CardDescription>
                  {mode === 'user'
                    ? 'When you open a ticket here, or get added to one by staff, it shows up in this list.'
                    : 'Every open ticket in your admin teams is currently one you opened or were added to — nothing left in the residual staff view.'}
                </CardDescription>
              </CardHeader>
            </Card>
          )
        )}

        {adminOf.length > 0 && (
          <section>
            <h2 className="mb-2 mt-8 text-lg font-semibold">You administer</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {adminOf.map(({ business, level }) => (
                <Link key={business.id} href={`/b/${business.slug}/tickets`} className="block">
                  <Card className="transition-colors hover:bg-accent/50">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        {business.name}
                      </CardTitle>
                      <CardDescription className="flex items-center justify-between">
                        <span>/{business.slug}</span>
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary">
                          {level}
                        </span>
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  )
}
