import Link from 'next/link'
import { getPersonaKey } from '@/server/demo/cookie'
import { getPersona } from '@/server/demo/personas'
import { getDemoBotDashboard } from '@/server/demo/extras'
import { PersonaGate } from '@/components/demo/views/gate'
import { DemoBotName } from '@/components/demo/views/bot-name'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { relativeTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function DemoBotPage() {
  const persona = getPersona(await getPersonaKey())
  if (!persona.isSudo) return <PersonaGate title="Sudo — Bot dashboard" need="the bot owner (Sudo persona)" />

  const d = getDemoBotDashboard(new Date())
  const stat = (label: string, value: number | string) => (
    <div className="rounded-md border bg-background/40 p-3">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )

  return (
    <main className="container max-w-4xl space-y-6 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Bot dashboard</h1>
        <p className="text-sm text-muted-foreground">Sudo-only. System health, plus bot-owner controls.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Bot identity</CardTitle>
          <CardDescription>Sets the bot’s global Discord username (saved in your browser for this demo).</CardDescription>
        </CardHeader>
        <CardContent>
          <DemoBotName initial={d.botName} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Servers ({d.guilds.length})</CardTitle>
          <CardDescription>Every guild the bot is in. (Force-leave is disabled in the demo.)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {d.guilds.map((g) => {
            const teams = d.teamsByGuild[g.id] ?? []
            return (
              <div key={g.id} className="flex items-center gap-3 border-t py-2 text-sm first:border-t-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{g.name}</div>
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="font-mono">{g.id}</span>
                    {teams.map((t) => (
                      <Link key={t.slug} href={`/demo/b/${t.slug}`} className="text-primary hover:underline">/{t.slug}</Link>
                    ))}
                  </div>
                </div>
                <button type="button" disabled title="Disabled in the demo" className="rounded-md border px-2.5 py-1 text-xs text-muted-foreground opacity-60">Leave</button>
              </div>
            )
          })}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stat('Teams', d.counts.teams)}
        {stat('Open tickets', d.counts.openTickets)}
        {stat('Needs attention', d.counts.attention)}
        {stat('Errors (24h)', d.errorAgg.last24)}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Recent errors</CardTitle>
            <CardDescription>{d.errorAgg.total} total · {d.errorAgg.errors} errors · {d.errorAgg.warns} warnings</CardDescription>
          </div>
          <Link href="/demo/admin/errors" className="text-sm text-primary hover:underline">View all →</Link>
        </CardHeader>
        <CardContent className="space-y-2">
          {d.recentErrors.map((r) => (
            <div key={r.id} className="flex items-start gap-2 border-t py-1.5 text-sm first:border-t-0">
              <span className={`text-[10px] font-medium uppercase ${r.level === 'error' ? 'text-red-500' : r.level === 'warn' ? 'text-amber-500' : 'text-muted-foreground'}`}>{r.level}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{r.source ?? '—'}</span>
              <span className="flex-1 break-words">{r.message}</span>
              <span className="whitespace-nowrap text-xs text-muted-foreground">{relativeTime(r.createdAt)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  )
}
