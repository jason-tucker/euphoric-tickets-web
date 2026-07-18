import Link from 'next/link'
import { Building2, Briefcase, MessageSquare, Clock, Plus } from 'lucide-react'
import { getPersonaKey } from '@/server/demo/cookie'
import { demoTeamsRollup, getPersona } from '@/server/demo/personas'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { relativeTime } from '@/lib/format'

export const dynamic = 'force-dynamic'

// Mirror of /teams: admin rollup cards + member-level communities. Pure links
// over the base dataset — nothing here writes, so no client view is needed.
export default async function DemoTeamsPage() {
  const persona = getPersona(await getPersonaKey())
  const { adminTeams, memberTeams } = demoTeamsRollup(persona, new Date())

  return (
    <main className="container max-w-5xl space-y-6 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Teams</h1>
        <p className="text-sm text-muted-foreground">
          {persona.isSudo
            ? 'Every team in the system.'
            : 'Teams you administer and communities you belong to.'}
        </p>
      </div>

      {adminTeams.length === 0 && memberTeams.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">No teams yet</CardTitle>
            <CardDescription>
              This persona isn’t in any Discord team connected to Euphoric Tickets.
              Switch persona with “Viewing as” in the top-right to explore.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {adminTeams.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">You administer</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {adminTeams.map((t) => (
              // Stretched link: the whole card opens the console filtered to
              // this team; the small Overview link sits above it (z-10).
              <Card key={t.slug} className="relative transition-colors hover:bg-accent/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <Link href={`/demo/tickets?team=${t.slug}`} className="after:absolute after:inset-0">
                      {t.name}
                    </Link>
                  </CardTitle>
                  <CardDescription className="flex items-center justify-between font-mono text-xs">
                    <span>/{t.slug}</span>
                    <Link
                      href={`/demo/b/${t.slug}`}
                      className="relative z-10 font-sans hover:text-foreground hover:underline"
                    >
                      Overview
                    </Link>
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="font-semibold text-foreground text-sm">{t.open}</div>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <MessageSquare className="h-3 w-3" />
                        open
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold text-foreground text-sm">{t.projects}</div>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Briefcase className="h-3 w-3" />
                        projects
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold text-foreground text-sm">
                        {t.lastActivity ? relativeTime(t.lastActivity) : '—'}
                      </div>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        active
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {memberTeams.length > 0 && (
        <section>
          <h2 className="mb-2 text-lg font-semibold">Your communities</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {memberTeams.map((t) => (
              <Card key={t.slug} className="relative transition-colors hover:bg-accent/50">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <Link href={`/demo/b/${t.slug}`} className="after:absolute after:inset-0">
                      {t.name}
                    </Link>
                  </CardTitle>
                  <CardDescription className="font-mono text-xs">/{t.slug}</CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  {t.ticketMode === 'tickettool' ? (
                    <p className="text-xs text-muted-foreground">
                      Tickets for this team open in Discord.
                    </p>
                  ) : (
                    <Button asChild size="sm" variant="outline" className="relative z-10">
                      <Link href={`/demo/t/new?b=${t.slug}`}>
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
  )
}
