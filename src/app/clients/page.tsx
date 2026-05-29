import Link from 'next/link'
import { Building2, Briefcase, MessageSquare, Clock } from 'lucide-react'
import { desc, eq, sql } from 'drizzle-orm'
import { TopNav } from '@/components/app/top-nav'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { db } from '@/db/client'
import { businesses, tickets } from '@/db/schema'
import { requireSession } from '@/server/permissions'
import { currentUserIsSudo } from '@/server/sudo'
import { listMyBusinesses } from '@/server/permissions'
import { titlePlural, nounPlural } from '@/lib/terminology'
import { relativeTime } from '@/lib/format'

// Top-level rollup view across every business (or every business the
// caller can administer if not sudo). One card per business + open count,
// project count, last activity.
export default async function ClientsPage() {
  const session = await requireSession()
  const isSudo = await currentUserIsSudo()

  // Sudo sees everything; everyone else sees only businesses where they're
  // admin or owner.
  const myBusinesses = await listMyBusinesses()
  const adminScope = isSudo
    ? await db.select().from(businesses).orderBy(desc(businesses.createdAt))
    : myBusinesses
        .filter((b) => b.level === 'admin' || b.level === 'owner')
        .map((b) => b.business)

  // Rollup counts per business.
  const stats = await db
    .select({
      businessId: tickets.businessId,
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${tickets.status} != 'closed')::int`,
      projects: sql<number>`count(*) filter (where ${tickets.kind} = 'project' and ${tickets.status} != 'closed')::int`,
      lastActivity: sql<Date | null>`max(${tickets.lastActivityAt})`,
    })
    .from(tickets)
    .groupBy(tickets.businessId)

  const statsByBusiness = new Map(stats.map((s) => [s.businessId, s]))

  // Pick the noun label using the FIRST business's terminology setting —
  // not perfect for mixed-mode setups, but good-enough since most users
  // run all-businesses-or-all-clients. Falls back to "business" if none.
  const mode = adminScope[0]?.terminology ?? 'business'

  return (
    <>
      <TopNav />
      <main className="container max-w-5xl space-y-6 py-6">
        <div>
          <h1 className="text-2xl font-semibold">{titlePlural(mode)}</h1>
          <p className="text-sm text-muted-foreground">
            {isSudo
              ? `Every ${nounPlural(mode)} in the system.`
              : `${titlePlural(mode)} you administer.`}
          </p>
        </div>

        {adminScope.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Nothing to show</CardTitle>
              <CardDescription>
                You don&apos;t administer any {nounPlural(mode)} yet.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {adminScope.map((b) => {
              const s = statsByBusiness.get(b.id)
              return (
                <Link key={b.id} href={`/b/${b.slug}/tickets`} className="block">
                  <Card className="transition-colors hover:bg-accent/50">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        {b.terminology === 'client' ? (
                          <Briefcase className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                        )}
                        {b.name}
                      </CardTitle>
                      <CardDescription className="font-mono text-xs">/{b.slug}</CardDescription>
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
                </Link>
              )
            })}
          </div>
        )}
      </main>
    </>
  )
}
