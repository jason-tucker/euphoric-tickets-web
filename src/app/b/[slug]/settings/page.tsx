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
import { SubmitButton } from '@/components/app/submit-button'
import {
  addCategoryAction,
  deleteCategoryAction,
  saveBusinessSettings,
  updateCategoryAction,
} from './actions'

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
              <Label htmlFor="discordClosedCategoryId">Closed-tickets Discord category ID (optional)</Label>
              <Input
                id="discordClosedCategoryId"
                name="discordClosedCategoryId"
                defaultValue={business.discordClosedCategoryId ?? ''}
                pattern="\d{17,20}"
                placeholder="e.g. 1234567890123456789"
              />
              <p className="text-xs text-muted-foreground">
                On close the per-ticket channel is moved here (instead of just renamed). Per-category overrides win when set.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="deleteClosedAfterDays">Auto-delete closed channels after (days)</Label>
              <Input
                id="deleteClosedAfterDays"
                name="deleteClosedAfterDays"
                defaultValue={business.deleteClosedAfterDays ?? ''}
                pattern="\d+"
                placeholder="leave blank to never auto-delete"
              />
              <p className="text-xs text-muted-foreground">
                The bot sweep runs hourly. DB transcripts always survive.
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Display</CardTitle>
            <CardDescription>How this tenant is named in the UI.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-1">
              <Label htmlFor="terminology">Terminology</Label>
              <select
                id="terminology"
                name="terminology"
                defaultValue={business.terminology}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="business">Business</option>
                <option value="client">Client</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Affects navigation labels. Same data either way.
              </p>
            </div>
          </CardContent>
        </Card>

        <SubmitButton pendingChildren="Saving…">Save settings</SubmitButton>
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ticket categories</CardTitle>
          <CardDescription>
            Drives the &quot;Open a ticket&quot; form&apos;s category picker. End users see the label and emoji.
            Per-category role gates and the first-ticket message template live here too.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {cats.length === 0 ? (
            <p className="text-sm text-muted-foreground">No categories yet — add one below.</p>
          ) : (
            <ul className="divide-y">
              {cats.map((c) => (
                <li key={c.id} className="py-2">
                  <details>
                    <summary className="flex cursor-pointer list-none items-center gap-3 rounded-md px-1 py-1 hover:bg-accent/50">
                      <span className="text-xl" aria-hidden>{c.emoji ?? '·'}</span>
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{c.label}</div>
                        <div className="text-xs text-muted-foreground">
                          <span className="font-mono">{c.key}</span>
                          {c.description ? <> — {c.description}</> : null}
                        </div>
                      </div>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">edit</span>
                    </summary>
                    <div className="mt-3 space-y-3 rounded-md border bg-background/40 p-3">
                      <form action={updateCategoryAction.bind(null, slug, c.id)} className="space-y-3">
                        <CategoryFormFields idPrefix={`edit-${c.id}-`} defaults={c} />
                        <SubmitButton size="sm" variant="secondary" pendingChildren="Saving…">Save</SubmitButton>
                      </form>
                      <form
                        action={deleteCategoryAction.bind(null, slug, c.id)}
                        className="border-t pt-3"
                      >
                        <SubmitButton
                          variant="ghost"
                          size="sm"
                          aria-label={`Delete ${c.label}`}
                          pendingChildren="Deleting…"
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete category
                        </SubmitButton>
                      </form>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}

          <form action={addCategoryAction.bind(null, slug)} className="space-y-3 border-t pt-4">
            <p className="text-sm font-medium">Add a new category</p>
            <CategoryFormFields idPrefix="new-" />
            <SubmitButton variant="secondary" pendingChildren="Adding…">Add category</SubmitButton>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}

// Shared fields for both the add-new form and each per-row edit form.
// `defaults` is omitted on the add-new form (all empty); when supplied the
// inputs render with `defaultValue` so React doesn't fight the user mid-type.
function CategoryFormFields({
  idPrefix,
  defaults,
}: {
  idPrefix: string
  defaults?: {
    key: string
    label: string
    emoji: string | null
    description: string | null
    sortOrder: string
    discordParentCategoryId: string | null
    discordClosedCategoryId: string | null
    allowRoleIds: string
    staffRoleIds: string
    firstMessageTemplate: string | null
  }
}) {
  const v = defaults
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}key`}>Key</Label>
          <Input
            id={`${idPrefix}key`}
            name="key"
            placeholder="billing"
            pattern="[a-z0-9][a-z0-9_-]*"
            defaultValue={v?.key}
            required
          />
          <p className="text-xs text-muted-foreground">Internal id, lowercase. Unique per business.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}label`}>Label</Label>
          <Input id={`${idPrefix}label`} name="label" placeholder="Billing" defaultValue={v?.label} required />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-[6rem_1fr_6rem]">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}emoji`}>Emoji</Label>
          <Input id={`${idPrefix}emoji`} name="emoji" placeholder="💳" maxLength={8} defaultValue={v?.emoji ?? ''} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}description`}>Description</Label>
          <Input
            id={`${idPrefix}description`}
            name="description"
            placeholder="Charges, refunds, subscriptions."
            defaultValue={v?.description ?? ''}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}sortOrder`}>Sort</Label>
          <Input
            id={`${idPrefix}sortOrder`}
            name="sortOrder"
            defaultValue={v?.sortOrder ?? '0'}
            pattern="-?\d+"
          />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}discordParentCategoryId`}>Open Discord category ID</Label>
          <Input
            id={`${idPrefix}discordParentCategoryId`}
            name="discordParentCategoryId"
            pattern="\d{17,20}"
            placeholder="1234567890123456789"
            defaultValue={v?.discordParentCategoryId ?? ''}
          />
          <p className="text-xs text-muted-foreground">Per-ticket channels open here. Blank → business fallback.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}discordClosedCategoryId`}>Closed Discord category ID</Label>
          <Input
            id={`${idPrefix}discordClosedCategoryId`}
            name="discordClosedCategoryId"
            pattern="\d{17,20}"
            placeholder="1234567890123456789"
            defaultValue={v?.discordClosedCategoryId ?? ''}
          />
          <p className="text-xs text-muted-foreground">Closed channels move here. Blank → business fallback.</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}allowRoleIds`}>
            Allow-to-open role IDs <span className="text-muted-foreground">(comma-separated)</span>
          </Label>
          <Input
            id={`${idPrefix}allowRoleIds`}
            name="allowRoleIds"
            placeholder="leave blank — anyone may open"
            defaultValue={v?.allowRoleIds ?? ''}
          />
          <p className="text-xs text-muted-foreground">
            If set, only members holding any of these roles can click the panel button for this category.
            (P3 will replace this with a searchable picker.)
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}staffRoleIds`}>
            Category staff role IDs <span className="text-muted-foreground">(comma-separated)</span>
          </Label>
          <Input
            id={`${idPrefix}staffRoleIds`}
            name="staffRoleIds"
            placeholder="leave blank — falls back to business admins"
            defaultValue={v?.staffRoleIds ?? ''}
          />
          <p className="text-xs text-muted-foreground">
            Staff can claim/close/reply on tickets in this category. They cannot delete channels — that stays admin-only.
          </p>
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor={`${idPrefix}firstMessageTemplate`}>First-ticket message template (optional)</Label>
        <Textarea
          id={`${idPrefix}firstMessageTemplate`}
          name="firstMessageTemplate"
          rows={4}
          maxLength={2000}
          placeholder="e.g. Thanks {{user}} — staff will be with you shortly. Ticket #{{ticketId}} ({{category}})."
          defaultValue={v?.firstMessageTemplate ?? ''}
        />
        <p className="text-xs text-muted-foreground">
          Substitutes <code>{'{{user}}'}</code>, <code>{'{{ticketId}}'}</code>, <code>{'{{subject}}'}</code>,
          <code> {'{{category}}'}</code>. Blank = default welcome card. Used by the bot once P4 ships.
        </p>
      </div>
    </>
  )
}
