import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Building2, Settings, ChevronRight } from 'lucide-react'
import { TopNav } from '@/components/app/top-nav'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireSession } from '@/server/permissions'
import { ticketsConsoleScope } from '@/server/tickets'

// Settings hub — the "Settings" header tab lands here when you administer more
// than one team (one team links straight to its own settings). Pick a team to
// edit its webhook, admin roles, and categories.
export default async function TeamSettingsHubPage() {
  await requireSession()
  const { adminTeams } = await ticketsConsoleScope()
  if (adminTeams.length === 0) redirect('/dashboard')
  // A single-team admin who lands here directly — send them straight in.
  if (adminTeams.length === 1) redirect(`/b/${adminTeams[0].slug}/settings`)

  return (
    <>
      <TopNav />
      <main className="container max-w-3xl space-y-6 py-6">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Choose a team to configure its webhook, admin roles, and categories.
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {adminTeams.map((t) => (
            <Link key={t.id} href={`/b/${t.slug}/settings`} className="block">
              <Card className="transition-colors hover:bg-accent/50">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2 text-base">
                    <span className="flex min-w-0 items-center gap-2">
                      <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{t.name}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </CardTitle>
                  <CardDescription className="font-mono text-xs">/{t.slug}</CardDescription>
                </CardHeader>
                <CardContent className="pt-0 text-sm text-muted-foreground">Manage team settings</CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </main>
    </>
  )
}
