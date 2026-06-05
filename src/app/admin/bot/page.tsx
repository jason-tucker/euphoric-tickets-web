import Link from 'next/link'
import { desc, sql } from 'drizzle-orm'
import { TopNav } from '@/components/app/top-nav'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SubmitButton } from '@/components/app/submit-button'
import { requireSudo } from '@/server/sudo'
import { getAppSetting } from '@/server/appSettings'
import { fetchBotGuilds } from '@/lib/discord'
import { db } from '@/db/client'
import { botErrors, businesses, tickets } from '@/db/schema'
import { relativeTime } from '@/lib/format'
import { setBotNameAction } from './actions'
import { LeaveGuildButton } from './leave-guild-button'

// P15 (lantern) — sudo-only bot dashboard: health-at-a-glance + recent errors
// + system-wide counts. Sudo controls (bot name, force-leave guilds) live here
// too — this is the bot-owner surface behind the nav's "Sudo" tab.
export default async function AdminBotPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; warn?: string }>
}) {
  await requireSudo()
  const sp = await searchParams

  // Sudo controls data: persisted bot name + the bot's live guild list.
  const botName = await getAppSetting('bot_name')
  const botToken = process.env.DISCORD_BOT_TOKEN
  let guilds: Array<{ id: string; name: string; icon: string | null }> = []
  let guildsError: string | null = null
  if (!botToken) {
    guildsError = 'DISCORD_BOT_TOKEN is not set on the web service.'
  } else {
    try {
      guilds = await fetchBotGuilds(botToken)
      guilds.sort((a, b) => a.name.localeCompare(b.name))
    } catch (err) {
      guildsError = String(err)
    }
  }

  const teamRows = await db
    .select({ slug: businesses.slug, name: businesses.name, guildId: businesses.discordGuildId })
    .from(businesses)
  const teamsByGuild = new Map<string, Array<{ slug: string; name: string }>>()
  for (const t of teamRows) {
    const arr = teamsByGuild.get(t.guildId) ?? []
    arr.push({ slug: t.slug, name: t.name })
    teamsByGuild.set(t.guildId, arr)
  }

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
          <p className="text-sm text-muted-foreground">
            Sudo-only. System health, plus bot-owner controls (bot name, force-leave servers).
          </p>
        </div>

        {sp.ok && (
          <div className="rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-300">
            {sp.ok}
          </div>
        )}
        {sp.warn && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            {sp.warn}
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bot identity</CardTitle>
            <CardDescription>
              Sets the bot&apos;s global Discord username. Discord rate-limits username changes to
              roughly twice an hour — if it bounces, the name is still saved and the next attempt
              will apply it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={setBotNameAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1">
                <Label htmlFor="botName">Bot name</Label>
                <Input
                  id="botName"
                  name="botName"
                  defaultValue={botName ?? ''}
                  placeholder="Euphoric Tickets"
                  minLength={2}
                  maxLength={32}
                  required
                />
              </div>
              <SubmitButton pendingChildren="Saving…">Save name</SubmitButton>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Servers ({guilds.length})</CardTitle>
            <CardDescription>
              Every guild the bot is currently in. Force-leaving severs the bot&apos;s access there;
              the team&apos;s tickets stay in the database.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {guildsError ? (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Couldn&apos;t load the bot&apos;s servers: {guildsError}
              </p>
            ) : guilds.length === 0 ? (
              <p className="text-sm text-muted-foreground">The bot isn&apos;t in any server.</p>
            ) : (
              guilds.map((g) => {
                const teams = teamsByGuild.get(g.id) ?? []
                return (
                  <div
                    key={g.id}
                    className="flex items-center gap-3 border-t py-2 text-sm first:border-t-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{g.name}</div>
                      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span className="font-mono">{g.id}</span>
                        {teams.length > 0 ? (
                          teams.map((t) => (
                            <Link key={t.slug} href={`/b/${t.slug}`} className="text-primary hover:underline">
                              /{t.slug}
                            </Link>
                          ))
                        ) : (
                          <span className="italic">no team row</span>
                        )}
                      </div>
                    </div>
                    <LeaveGuildButton guildId={g.id} guildName={g.name} />
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

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
