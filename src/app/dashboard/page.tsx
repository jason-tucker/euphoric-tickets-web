import Link from 'next/link'
import { and, desc, eq, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm'
import { Plus, Building2 } from 'lucide-react'
import { AppChrome } from '@/components/app/app-chrome'
import { StatusBadge } from '@/components/app/status-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { listMyBusinesses, listMyStaffCategoryIds, requireSession } from '@/server/permissions'
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
  // Categories I hold a staff role in (across every team I'm actually in, admin
  // teams included) — the "because of my team" tier. See listMyStaffCategoryIds.
  const teamCategoryIds = await listMyStaffCategoryIds()
  const isAdmin = adminBusinessIds.length > 0
  const hasTeam = teamCategoryIds.length > 0

  // Three views, surfaced as a toggle. Each is the *reason* I can see a ticket,
  // and the buckets are disjoint — every ticket lands in exactly one tab:
  //   mine  — I opened it OR was explicitly added (ticket_external_members)
  //   team  — not mine, but I hold a staff role in its category
  //   admin — not mine, not staffed by me, but I administer the team
  // Admins always get all three toggles; their Team tab is empty (with a note)
  // when they hold no staff role of their own. A plain end user sees no toggle.
  const showTeamTab = hasTeam || isAdmin
  const sp = await searchParams
  let mode: 'mine' | 'team' | 'admin' = 'mine'
  if (sp.mode === 'admin' && isAdmin) mode = 'admin'
  else if (sp.mode === 'team' && showTeamTab) mode = 'team'
  // Closed tickets are hidden by default in every mode — `?closed=1` reveals them.
  const showClosed = sp.closed === '1'
  const closedWhere = showClosed ? undefined : ne(tickets.status, 'closed')

  // Build a /dashboard URL preserving the (mode, closed) pair across the toggles.
  const dashHref = (m: 'mine' | 'team' | 'admin', closed: boolean) => {
    const params = new URLSearchParams()
    if (m !== 'mine') params.set('mode', m)
    if (closed) params.set('closed', '1')
    const qs = params.toString()
    return qs ? `/dashboard?${qs}` : '/dashboard'
  }

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

  if (mode === 'mine') {
    // Mine: tickets I opened OR was explicitly added to — across ANY team,
    // INCLUDING teams whose Discord I'm not in. An external user added to a
    // ticket but not in that server must still see it here; this is intentionally
    // NOT gated by guild membership. Per-ticket access is re-checked on detail.
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
  } else if (mode === 'team' && teamCategoryIds.length > 0) {
    // Team: tickets in a category I hold a staff role in, where I'm NEITHER the
    // opener NOR an explicit member — the queue I reach only because of my team.
    // Each staffed category already pins its tickets to a single team, so no
    // business filter is needed. (Empty teamCategoryIds → no query, empty state.)
    myTickets = await db
      .select(selectShape)
      .from(tickets)
      .innerJoin(businesses, eq(businesses.id, tickets.businessId))
      .where(
        and(
          inArray(tickets.categoryId, teamCategoryIds),
          ne(tickets.openerUserId, session.user.id),
          notInArray(tickets.id, myMemberTicketIds),
          closedWhere,
        ),
      )
      .orderBy(desc(tickets.lastActivityAt))
      .limit(50)
  } else if (mode === 'admin' && adminBusinessIds.length > 0) {
    // Admin: every ticket in a team I administer where I'm NEITHER the opener
    // NOR an explicit member, AND not in a category I personally staff (those
    // live under Team — this subtraction keeps the buckets disjoint). NULL
    // category isn't staffed, so it's kept (a bare `NOT IN` would drop NULLs).
    myTickets = await db
      .select(selectShape)
      .from(tickets)
      .innerJoin(businesses, eq(businesses.id, tickets.businessId))
      .where(
        and(
          inArray(tickets.businessId, adminBusinessIds),
          sql`${tickets.openerUserId} != ${session.user.id}`,
          notInArray(tickets.id, myMemberTicketIds),
          teamCategoryIds.length > 0
            ? or(isNull(tickets.categoryId), notInArray(tickets.categoryId, teamCategoryIds))
            : undefined,
          closedWhere,
        ),
      )
      .orderBy(desc(tickets.lastActivityAt))
      .limit(50)
  }

  const adminOf = myBusinesses.filter((b) => b.level === 'admin' || b.level === 'owner')

  return (
    <AppChrome>
      <main className="container max-w-6xl space-y-6 py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight">My tickets</h1>
            <p className="text-sm text-muted-foreground">
              {mode === 'mine' ? (
                <>Tickets you&apos;ve opened or been added to across {myBusinesses.length} {myBusinesses.length === 1 ? 'team' : 'teams'}.</>
              ) : mode === 'team' ? (
                <>Tickets you can reach through a staff role on your team that you aren&apos;t personally on.</>
              ) : (
                <>Tickets in {adminBusinessIds.length} {adminBusinessIds.length === 1 ? 'team' : 'teams'} you administer — beyond your own and your team&apos;s queues.</>
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {showTeamTab && (
                <div className="inline-flex gap-1 rounded-md border border-input bg-background p-0.5 text-xs">
                  <Button asChild size="sm" variant={mode === 'mine' ? 'secondary' : 'ghost'} className="h-7 px-3">
                    <Link href={dashHref('mine', showClosed)}>Mine</Link>
                  </Button>
                  <Button asChild size="sm" variant={mode === 'team' ? 'secondary' : 'ghost'} className="h-7 px-3">
                    <Link href={dashHref('team', showClosed)}>Team</Link>
                  </Button>
                  {isAdmin && (
                    <Button asChild size="sm" variant={mode === 'admin' ? 'secondary' : 'ghost'} className="h-7 px-3">
                      <Link href={dashHref('admin', showClosed)}>Admin</Link>
                    </Button>
                  )}
                </div>
              )}
              <Button asChild size="sm" variant={showClosed ? 'secondary' : 'outline'} className="h-7 px-3 text-xs">
                <Link href={dashHref(mode, !showClosed)}>
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
                <CardTitle>
                  {mode === 'mine'
                    ? 'No tickets yet'
                    : mode === 'team'
                      ? 'Nothing in your team queue'
                      : 'Nothing in your admin queue'}
                </CardTitle>
                <CardDescription>
                  {mode === 'mine'
                    ? 'When you open a ticket here, or get added to one by staff, it shows up in this list.'
                    : mode === 'team'
                      ? hasTeam
                        ? 'No open tickets in the categories you hold a staff role for right now — the ones you opened or were added to live under Mine.'
                        : 'You don’t hold a staff role in any category yet, so there’s nothing in your team queue. Tickets you opened or were added to live under Mine; everything in your teams lives under Admin.'
                      : 'Every open ticket in your admin teams is one you opened, were added to, or staff directly — nothing left in the residual admin view.'}
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
                <Link key={business.id} href={`/tickets?team=${business.slug}`} className="block">
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
    </AppChrome>
  )
}
