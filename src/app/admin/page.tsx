import Link from 'next/link'
import { desc } from 'drizzle-orm'
import { Building2 } from 'lucide-react'
import { TopNav } from '@/components/app/top-nav'
import { db } from '@/db/client'
import { businesses } from '@/db/schema'
import { requireSudo } from '@/server/sudo'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { SubmitButton } from '@/components/app/submit-button'
import { createBusinessAction } from './actions'

export default async function AdminPage() {
  await requireSudo()
  const allBusinesses = await db.select().from(businesses).orderBy(desc(businesses.createdAt))

  return (
    <>
      <TopNav />
      <main className="container max-w-3xl space-y-6 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="text-sm text-muted-foreground">
            Sudo-only. Create and list every business in the app.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Create business</CardTitle>
            <CardDescription>
              Each business is one Discord guild + one URL slug. You can edit everything else from
              its own settings page after.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createBusinessAction} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="slug">URL slug</Label>
                  <Input id="slug" name="slug" placeholder="euphoric" pattern="[a-z0-9][a-z0-9-]*[a-z0-9]" required />
                  <p className="text-xs text-muted-foreground">/b/&lt;slug&gt; — lowercase, hyphens allowed.</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="name">Display name</Label>
                  <Input id="name" name="name" placeholder="Euphoric HQ" required />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="discordGuildId">Discord guild ID</Label>
                <Input id="discordGuildId" name="discordGuildId" pattern="\d{17,20}" required />
                <p className="text-xs text-muted-foreground">
                  Discord → Developer Mode → right-click server → Copy Server ID.
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="description">Description (optional)</Label>
                <Textarea id="description" name="description" rows={2} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="webhookUrl">Outbound webhook URL (optional)</Label>
                <Input
                  id="webhookUrl"
                  name="webhookUrl"
                  placeholder="https://discord.com/api/webhooks/…"
                />
              </div>
              <SubmitButton pendingChildren="Creating…">Create business</SubmitButton>
            </form>
          </CardContent>
        </Card>

        <section>
          <h2 className="mb-2 mt-8 text-lg font-semibold">All businesses</h2>
          {allBusinesses.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">None yet</CardTitle>
                <CardDescription>
                  Use the form above to create the first one.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {allBusinesses.map((b) => (
                <Link key={b.id} href={`/b/${b.slug}`} className="block">
                  <Card className="transition-colors hover:bg-accent/50">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        {b.name}
                      </CardTitle>
                      <CardDescription className="flex items-center justify-between">
                        <span>/{b.slug}</span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          guild {b.discordGuildId}
                        </span>
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
