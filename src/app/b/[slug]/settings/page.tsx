import { asc, eq } from 'drizzle-orm'
import { Trash2 } from 'lucide-react'
import { requireBusinessAccess } from '@/server/permissions'
import { db } from '@/db/client'
import { ticketCategories } from '@/db/schema'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { addCategoryAction, deleteCategoryAction, saveBusinessSettings } from './actions'

export default async function BusinessSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const { business } = await requireBusinessAccess(slug, 'admin')

  const cats = await db
    .select()
    .from(ticketCategories)
    .where(eq(ticketCategories.businessId, business.id))
    .orderBy(asc(ticketCategories.sortOrder), asc(ticketCategories.label))

  return (
    <main className="container max-w-2xl space-y-6 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Settings — {business.name}</h1>
        <p className="text-sm text-muted-foreground">
          Connect this business to Discord. Roles, webhook, and categories live here.
        </p>
      </div>

      <form action={saveBusinessSettings.bind(null, slug)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Business</CardTitle>
            <CardDescription>What end users and your team see.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" defaultValue={business.name} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" name="description" defaultValue={business.description ?? ''} rows={2} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Discord</CardTitle>
            <CardDescription>
              The Discord guild and which roles count as admins of this business.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="discordGuildId">Discord guild ID</Label>
              <Input
                id="discordGuildId"
                name="discordGuildId"
                defaultValue={business.discordGuildId}
                pattern="\d{17,20}"
                required
              />
              <p className="text-xs text-muted-foreground">Enable Developer Mode in Discord, right-click your server, &quot;Copy Server ID&quot;.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="adminRoleIds">Admin role IDs (comma-separated)</Label>
              <Input
                id="adminRoleIds"
                name="adminRoleIds"
                defaultValue={business.adminRoleIds}
                placeholder="e.g. 1234567890,9876543210"
              />
              <p className="text-xs text-muted-foreground">
                Members with any of these roles get admin access to this business.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="discordFallbackCategoryId">Fallback Discord channel category ID</Label>
              <Input
                id="discordFallbackCategoryId"
                name="discordFallbackCategoryId"
                defaultValue={business.discordFallbackCategoryId ?? ''}
                pattern="\d{17,20}"
                placeholder="e.g. 1234567890123456789"
              />
              <p className="text-xs text-muted-foreground">
                Per-ticket channels get created under this Discord category when the ticket&apos;s own category doesn&apos;t set one. Right-click a category → Copy Category ID (Developer Mode on).
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="webhookUrl">Fallback webhook URL (optional)</Label>
              <Input
                id="webhookUrl"
                name="webhookUrl"
                defaultValue={business.webhookUrl ?? ''}
                placeholder="https://discord.com/api/webhooks/…"
              />
              <p className="text-xs text-muted-foreground">
                Used only when per-ticket channel creation isn&apos;t configured (no bot token or no category mapped). Every reply goes to this one channel as a user-spoofed webhook post.
              </p>
            </div>
          </CardContent>
        </Card>

        <Button type="submit">Save settings</Button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ticket categories</CardTitle>
          <CardDescription>
            Drives the &quot;Open a ticket&quot; form&apos;s category picker. End users see the label and emoji.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {cats.length === 0 ? (
            <p className="text-sm text-muted-foreground">No categories yet — add one below.</p>
          ) : (
            <ul className="divide-y">
              {cats.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-2">
                  <span className="text-xl" aria-hidden>{c.emoji ?? '·'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{c.label}</div>
                    <div className="text-xs text-muted-foreground">
                      <span className="font-mono">{c.key}</span>
                      {c.description ? <> — {c.description}</> : null}
                    </div>
                    {c.discordParentCategoryId ? (
                      <div className="mt-0.5 text-[10px] font-mono text-muted-foreground">
                        Discord category → {c.discordParentCategoryId}
                      </div>
                    ) : (
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        Uses business fallback Discord category
                      </div>
                    )}
                  </div>
                  <form action={deleteCategoryAction.bind(null, slug, c.id)}>
                    <Button type="submit" variant="ghost" size="icon" aria-label={`Delete ${c.label}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <form action={addCategoryAction.bind(null, slug)} className="space-y-3 border-t pt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="cat-key">Key</Label>
                <Input id="cat-key" name="key" placeholder="billing" pattern="[a-z0-9][a-z0-9_-]*" required />
                <p className="text-xs text-muted-foreground">Internal id, lowercase. Unique per business.</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="cat-label">Label</Label>
                <Input id="cat-label" name="label" placeholder="Billing" required />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[6rem_1fr_6rem]">
              <div className="space-y-1">
                <Label htmlFor="cat-emoji">Emoji</Label>
                <Input id="cat-emoji" name="emoji" placeholder="💳" maxLength={8} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cat-description">Description</Label>
                <Input id="cat-description" name="description" placeholder="Charges, refunds, subscriptions." />
              </div>
              <div className="space-y-1">
                <Label htmlFor="cat-sortOrder">Sort</Label>
                <Input id="cat-sortOrder" name="sortOrder" defaultValue="0" pattern="-?\d+" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="cat-discordParentCategoryId">Discord channel category ID (optional)</Label>
              <Input
                id="cat-discordParentCategoryId"
                name="discordParentCategoryId"
                pattern="\d{17,20}"
                placeholder="e.g. 1234567890123456789"
              />
              <p className="text-xs text-muted-foreground">
                Per-ticket channels for this category get created under this Discord category. Leave blank to use the business&apos;s fallback.
              </p>
            </div>
            <Button type="submit" variant="secondary">Add category</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
