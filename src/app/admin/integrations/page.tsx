import Link from 'next/link'
import { asc, desc, eq } from 'drizzle-orm'
import { Plug } from 'lucide-react'
import { TopNav } from '@/components/app/top-nav'
import { db } from '@/db/client'
import { businesses, integrations, integrationScopes } from '@/db/schema'
import { requireSudo } from '@/server/sudo'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { OneTimeSecretForm } from '@/components/app/one-time-secret-form'
import { relativeTime } from '@/lib/format'
import { createIntegrationAction } from './actions'

// Sudo-only: Integration API clients (plan §4.2). Business admins see a
// read-only list on their team's settings page instead.
export default async function AdminIntegrationsPage() {
  await requireSudo()
  const rows = await db
    .select({ integration: integrations, businessName: businesses.name, businessSlug: businesses.slug })
    .from(integrations)
    .innerJoin(businesses, eq(businesses.id, integrations.businessId))
    .orderBy(desc(integrations.createdAt))
  const teams = await db.select({ id: businesses.id, name: businesses.name, slug: businesses.slug }).from(businesses).orderBy(asc(businesses.name))

  return (
    <>
      <TopNav />
      <main className="container max-w-3xl space-y-6 py-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Integrations</h1>
          <p className="text-sm text-muted-foreground">
            API clients that open and update tickets for a team (e.g. the EFM Music Portal). Keys are shown once;
            only their hash is stored. The API is reachable on the internal docker networks only.
          </p>
          <Link href="/admin" className="text-sm underline underline-offset-2">
            ← Sudo
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create integration</CardTitle>
            <CardDescription>
              Scopes, categories and the link origin can be changed later. The webhook URL is set on the integration
              page after you add an allowlist row.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OneTimeSecretForm action={createIntegrationAction} submitLabel="Create integration" pendingLabel="Creating…" showOpenLink>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="businessId">Team</Label>
                  <select
                    id="businessId"
                    name="businessId"
                    required
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} (/{t.slug})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" required maxLength={60} placeholder="EFM Music" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="slug">Slug</Label>
                  <Input id="slug" name="slug" required pattern="[a-z0-9][a-z0-9-]{0,38}[a-z0-9]" placeholder="efm-music" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="linkOrigin">Link origin</Label>
                  <Input id="linkOrigin" name="linkOrigin" placeholder="https://music.euphoric.fm" />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="allowedCategoryKeys">Allowed category keys</Label>
                <Input id="allowedCategoryKeys" name="allowedCategoryKeys" placeholder="newsong, songedit, songremoval" />
                <p className="text-xs text-muted-foreground">Comma-separated keys of the chosen team&apos;s categories.</p>
              </div>
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium">Scopes</legend>
                <div className="flex flex-wrap gap-3">
                  {integrationScopes.map((s) => (
                    <label key={s} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" name="scopes" value={s} className="h-4 w-4" /> <code>{s}</code>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="actorImpersonation" className="h-4 w-4" />
                Allow <code>actorDiscordId</code> (post / close as a verified staff member or the opener)
              </label>
            </OneTimeSecretForm>
          </CardContent>
        </Card>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">All integrations ({rows.length})</h2>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <div className="grid gap-3">
              {rows.map(({ integration: i, businessName, businessSlug }) => (
                <Link key={i.id} href={`/admin/integrations/${i.id}`} className="block">
                  <Card className="transition-colors hover:bg-accent/50">
                    <CardHeader className="space-y-1">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        <Plug className="h-4 w-4 text-muted-foreground" aria-hidden />
                        {i.name}
                        <span className="font-mono text-xs text-muted-foreground">{i.slug}</span>
                        {i.enabled ? <Badge variant="secondary">enabled</Badge> : <Badge variant="destructive">disabled</Badge>}
                      </CardTitle>
                      <CardDescription className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        <span>
                          {businessName} (/{businessSlug})
                        </span>
                        <span className="font-mono">etk.{i.keyPrefix}.…</span>
                        <span>{i.scopes.join(', ') || 'no scopes'}</span>
                        <span>{i.lastUsedAt ? `used ${relativeTime(i.lastUsedAt)}` : 'never used'}</span>
                      </CardDescription>
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  )
}
