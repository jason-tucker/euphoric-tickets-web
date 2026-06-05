import Link from 'next/link'
import { and, desc, eq, inArray, ne, notInArray, or, sql } from 'drizzle-orm'
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
  searchParams: Promise<{ mode?: string; closed?: string }>
}) {
  const session = await requireSession()
  const myBusinesses = await listMyBusinesses()
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
  // Closed tickets are hidden by default in both modes — `?closed=1` reveals them.
  const showClosed = sp.closed === '1'
  const closedWhere = showClosed ? undefined : ne(tickets.status, 'closed')

  let myTickets: Array<{
    id: number
    subject: string
    status: string
    lastActivityAt: Date
    businessName: string
    businessSlug: string
  }> = []
  // ticket_external_members holds every explicit add — externals get a row at
  // add time (P16), and as of v0.6.39 in-guild adds get one too. So the subquery
  // is the single "tickets I'm personally on" signal for the web.
  const myMemberTicketIds = db
    .select({ ticketId: ticketExternalMembers.ticketId })
    .from(ticketExternalMembers)
    .where(eq(ticketExternalMembers.userId, session.user.id))

  const selectShape = {
    id: tickets.id,
    subject: tickets.subject,
    status: tickets.status,
    lastActivityAt: tickets.lastActivityAt,
    businessName: businesses.name,
    businessSlug: businesses.slug,
  }

  if (mode === 'user') {
    // Tickets I opened OR was explicitly added to — across ANY team, INCLUDING
    // teams whose Discord I'm not in. An external user added to a ticket but not
    // in that server must still see it here; this is intentionally NOT gated by
    // guild membership. Per-ticket access is re-checked on the detail page.
    myTickets = await db
      .select(selectShape)
      .from(tickets)
      .innerJoin(businesses, eq(businesses.id, tickets.businessId))
      .where(
        and(
          or(
            eq(tickets.openerUserId, session.user.id),
            inArray(tickets.id, myMemberTicketIds),
          ),
          closedWhere,
        ),
      )
      .orderBy(desc(tickets.lastActivityAt))
      .limit(50)
  } else if (adminBusinessIds.length > 0) {
    // Staff view: tickets in my admin businesses where I'm NEITHER the opener
    // NOR an explicit member — the "residual" queue I see only via my staff role.
    myTickets = await db
      .select(selectShape)
      .from(tickets)
      .innerJoin(businesses, eq(businesses.id, tickets.businessId))
      .where(
        and(
          inArray(tickets.businessId, adminBusinessIds),
          sql`${tickets.openerUserId} != ${session.user.id}`,
          notInArray(tickets.id, myMemberTicketIds),
          closedWhere,
        ),
      )
      .orderBy(desc(tickets.lastActivityAt))
      .limit(50)
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
            <div className="flex flex-wrap items-center gap-2">
              {isStaff && (
                <div className="inline-flex gap-1 rounded-md border border-input bg-background p-0.5 text-xs">
                  <Button asChild size="sm" variant={mode === 'user' ? 'secondary' : 'ghost'} className="h-7 px-3">
                    <Link href={showClosed ? '/dashboard?closed=1' : '/dashboard'}>User</Link>
                  </Button>
                  <Button asChild size="sm" variant={mode === 'staff' ? 'secondary' : 'ghost'} className="h-7 px-3">
                    <Link href={showClosed ? '/dashboard?mode=staff&closed=1' : '/dashboard?mode=staff'}>Staff</Link>
                  </Button>
                </div>
              )}
              <Button asChild size="sm" variant={showClosed ? 'secondary' : 'outline'} className="h-7 px-3 text-xs">
                <Link
                  href={(() => {
                    const params = new URLSearchParams()
                    if (mode === 'staff') params.set('mode', 'staff')
                    if (!showClosed) params.set('closed', '1')
                    const qs = params.toString()
                    return qs ? `/dashboard?${qs}` : '/dashboard'
                  })()}
                >
                  {showClosed ? 'Hide closed' : 'Show closed'}
                </Link>
              </Button>
            </div>
          </div>
          <Button asChild>
            <Link href="/t/new">
              <Plus />
              Open a ticket
            </Link>
          </Button>
        </div>

        {myBusinesses.length === 0 && myTickets.length === 0 && (
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
            <CardContent className="p-0 sm:p-0">
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
