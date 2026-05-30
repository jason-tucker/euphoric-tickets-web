import Link from 'next/link'
import { desc, sql } from 'drizzle-orm'
import { TopNav } from '@/components/app/top-nav'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireSudo } from '@/server/sudo'
import { db } from '@/db/client'
import { botErrors, businesses, tickets } from '@/db/schema'
import { relativeTime } from '@/lib/format'

// P15 (lantern) — sudo-only bot dashboard: health-at-a-glance + recent errors
// + system-wide counts. Bot-questions tab folded in as a counts row (the
// dedicated is_bot_questions category flag is a follow-up).
export default async function AdminBotPage() {
  await requireSudo()

  const [errorAgg] = await db
    .select({
      total: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${botErrors.level} = 'error')::int`,
      warns: sql<number>`count(*) filter (where ${botErrors.level} = 'warn')::int`,
      last24: sql<number>`count(*) filter (where ${botErrors.createdAt} > now() - interval '24 hours')::int`,
    })
    .from(botErrors)

  const [counts] = await db
    .select({
      teams: sql<number>`count(distinct ${businesses.id})::int`,
    })
    .from(businesses)

  const [ticketCounts] = await db
    .select({
      open: sql<number>`count(*) filter (where ${tickets.status} <> 'closed')::int`,
      attention: sql<number>`count(*) filter (where ${tickets.needsAttention})::int`,
    })
    .from(tickets)

  const recent = await db.select().from(botErrors).orderBy(desc(botErrors.createdAt)).limit(10)

  const stat = (label: string, value: number | string) => (
    <div className="rounded-md border bg-background/40 p-3">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )

  return (
    <>
      <TopNav />
      <main className="container max-w-4xl space-y-6 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Bot dashboard</h1>
          <p className="text-sm text-muted-foreground">Sudo-only. System health at a glance.</p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {stat('Teams', counts?.teams ?? 0)}
          {stat('Open tickets', ticketCounts?.open ?? 0)}
          {stat('Needs attention', ticketCounts?.attention ?? 0)}
          {stat('Errors (24h)', errorAgg?.last24 ?? 0)}
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Recent errors</CardTitle>
              <CardDescription>
                {errorAgg?.total ?? 0} total · {errorAgg?.errors ?? 0} errors · {errorAgg?.warns ?? 0} warnings
              </CardDescription>
            </div>
            <Link href="/admin/errors" className="text-sm text-primary hover:underline">
              View all →
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No errors logged. 🎉</p>
            ) : (
              recent.map((r) => (
                <div key={r.id} className="flex items-start gap-2 border-t py-1.5 text-sm first:border-t-0">
                  <span
                    className={`text-[10px] font-medium uppercase ${
                      r.level === 'error' ? 'text-red-500' : r.level === 'warn' ? 'text-amber-500' : 'text-muted-foreground'
                    }`}
                  >
                    {r.level}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">{r.source ?? '—'}</span>
                  <span className="flex-1 break-words">{r.message}</span>
                  <span className="whitespace-nowrap text-xs text-muted-foreground">{relativeTime(r.createdAt)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Health notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-muted-foreground">
            <p>• The bot runs a startup resync on every connect (orphan scan + message backfill).</p>
            <p>• Errors are retained 5 days, swept hourly.</p>
            <p>• Live conversation refresh runs over Postgres LISTEN/NOTIFY → SSE.</p>
          </CardContent>
        </Card>
      </main>
    </>
  )
}
