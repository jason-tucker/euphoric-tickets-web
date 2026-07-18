import Link from 'next/link'
import { Building2, Briefcase, MessageSquare, Clock, Plus } from 'lucide-react'
import { desc, sql } from 'drizzle-orm'
import { TopNav } from '@/components/app/top-nav'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { db } from '@/db/client'
import { businesses, tickets } from '@/db/schema'
import { requireSession, listMyBusinesses } from '@/server/permissions'
import { currentUserIsSudo } from '@/server/sudo'
import { relativeTime } from '@/lib/format'

// Every team the caller can see. Admin/owner teams get the rollup cards (open
// count, project count, last activity → the console); member-level teams are
// "communities" — a card per team with an open-ticket entry point.
export default async function TeamsPage() {
  await requireSession()
  const isSudo = await currentUserIsSudo()

  // Sudo administers everything; everyone else splits into teams they
  // administer and communities they just belong to.
  const myBusinesses = await listMyBusinesses()
  const adminScope = isSudo
    ? await db.select().from(businesses).orderBy(desc(businesses.createdAt))
    : myBusinesses
        .filter((b) => b.level === 'admin' || b.level === 'owner')
        .map((b) => b.business)
  const memberScope = isSudo
    ? []
    : myBusinesses.filter((b) => b.level === 'member').map((b) => b.business)

  // Rollup counts per team — the tickets it operates (business_id).
  const stats = await db
    .select({
      businessId: tickets.businessId,
      open: sql<number>`count(*) filter (where ${tickets.status} != 'closed')::int`,
      projects: sql<number>`count(*) filter (where ${tickets.kind} = 'project' and ${tickets.status} != 'closed')::int`,
      lastActivity: sql<Date | null>`max(${tickets.lastActivityAt})`,
    })
    .from(tickets)
    .groupBy(tickets.businessId)

  const statsByBusiness = new Map<string, { open: number; projects: number; lastActivity: Date | null }>()
  for (const s of stats) {
    statsByBusiness.set(s.businessId, { open: s.open, projects: s.projects, lastActivity: s.lastActivity })
  }

  return (
    <>
      <TopNav />
      <main className="container max-w-5xl space-y-6 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Teams</h1>
          <p className="text-sm text-muted-foreground">
            {isSudo
              ? 'Every team in the system.'
              : 'Teams you administer and communities you belong to.'}
          </p>
        </div>

        {adminScope.length === 0 && memberScope.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">No teams yet</CardTitle>
              <CardDescription>
                You&apos;re not a member of any Discord team that&apos;s connected to Euphoric Tickets.
                Ask an admin to add you, then sign out and back in.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {adminScope.length > 0 && (
          <section>
            <h2 className="mb-2 text-lg font-semibold">You administer</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {adminScope.map((b) => {
                const s = statsByBusiness.get(b.id)
                return (
                  // Stretched link: the whole card opens the console filtered to
                  // this team; the small Overview link sits above it (z-10).
                  <Card key={b.id} className="relative transition-colors hover:bg-accent/50">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <Link href={`/tickets?team=${b.slug}`} className="after:absolute after:inset-0">
                          {b.name}
                        </Link>
                      </CardTitle>
                      <CardDescription className="flex items-center justify-between font-mono text-xs">
                        <span>/{b.slug}</span>
                        <Link
                          href={`/b/${b.slug}`}
                          className="relative z-10 font-sans hover:text-foreground hover:underline"
                        >
                          Overview
                        </Link>
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <div className="font-semibold text-foreground text-sm">{s?.open ?? 0}</div>
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <MessageSquare className="h-3 w-3" />
                            open
                          </div>
                        </div>
                        <div>
                          <div className="font-semibold text-foreground text-sm">{s?.projects ?? 0}</div>
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Briefcase className="h-3 w-3" />
                            projects
                          </div>
                        </div>
                        <div>
                          <div className="font-semibold text-foreground text-sm">
                            {s?.lastActivity ? relativeTime(s.lastActivity) : '—'}
                          </div>
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            active
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </section>
        )}

        {memberScope.length > 0 && (
          <section>
            <h2 className="mb-2 text-lg font-semibold">Your communities</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {memberScope.map((b) => (
                <Card key={b.id} className="relative transition-colors hover:bg-accent/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <Link href={`/b/${b.slug}`} className="after:absolute after:inset-0">
                        {b.name}
                      </Link>
                    </CardTitle>
                    <CardDescription className="font-mono text-xs">/{b.slug}</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    {b.ticketMode === 'tickettool' ? (
                      // TicketTool-mode teams open tickets from the TicketTool
                      // panel in Discord, not through this app — same rule as /t/new.
                      <p className="text-xs text-muted-foreground">
                        Tickets for this team open in Discord.
                      </p>
                    ) : (
                      <Button asChild size="sm" variant="outline" className="relative z-10">
                        <Link href={`/t/new?b=${b.slug}`}>
                          <Plus />
                          Open a ticket
                        </Link>
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  )
}
