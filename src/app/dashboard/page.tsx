import Link from 'next/link'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { Plus, Building2 } from 'lucide-react'
import { TopNav } from '@/components/app/top-nav'
import { StatusBadge } from '@/components/app/status-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { listMyBusinesses, requireSession } from '@/server/permissions'
import { db } from '@/db/client'
import { businesses, tickets } from '@/db/schema'
import { relativeTime } from '@/lib/format'

export default async function DashboardPage() {
  const session = await requireSession()
  const myBusinesses = await listMyBusinesses()
  const businessIds = myBusinesses.map((b) => b.business.id)

  let myTickets: Array<{
    id: number
    subject: string
    status: string
    lastActivityAt: Date
    businessName: string
    businessSlug: string
  }> = []
  if (businessIds.length > 0) {
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
      .where(and(eq(tickets.openerUserId, session.user.id), inArray(tickets.businessId, businessIds)))
      .orderBy(desc(tickets.lastActivityAt))
      .limit(20)
  }

  const adminOf = myBusinesses.filter((b) => b.level === 'admin' || b.level === 'owner')

  return (
    <>
      <TopNav />
      <main className="container max-w-6xl space-y-6 py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">My tickets</h1>
            <p className="text-sm text-muted-foreground">
              Tickets you've opened across {myBusinesses.length} {myBusinesses.length === 1 ? 'community' : 'communities'}.
            </p>
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
              <CardTitle>No communities yet</CardTitle>
              <CardDescription>
                You're not a member of any Discord community that's connected to Euphoric Tickets.
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
                    <TableHead className="hidden md:table-cell">Community</TableHead>
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
                <CardTitle>No tickets yet</CardTitle>
                <CardDescription>
                  When you open a ticket here or via your community's Discord panel, it'll show up in this list.
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
