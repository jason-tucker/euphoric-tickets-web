import { asc, eq } from 'drizzle-orm'
import { Trash2 } from 'lucide-react'
import { requireBusinessAccess } from '@/server/permissions'
import { env } from '@/lib/env'
import { db } from '@/db/client'
import { ticketCategories } from '@/db/schema'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { SubmitButton } from '@/components/app/submit-button'
import { DiscordPicker } from '@/components/app/discord-picker'
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
          Connect this team to Discord. Roles, webhook, and categories live here.
        </p>
      </div>

      <form action={saveBusinessSettings.bind(null, slug)} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Team</CardTitle>
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
              The Discord guild and which roles count as admins of this team.
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
              <Label htmlFor="adminRoleIds">Admin / manager roles</Label>
              <DiscordPicker
                kind="role"
                multi
                guildId={business.discordGuildId}
                name="adminRoleIds"
                defaultValue={business.adminRoleIds}
                triggerLabel="Choose admin roles…"
              />
              <p className="text-xs text-muted-foreground">
                Members with any of these roles get full admin access to this team — including channel deletion and settings edits. Type to filter, click to add, or paste a raw Discord role ID.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="discordFallbackCategoryId">Fallback Discord channel category</Label>
              <DiscordPicker
                kind="category"
                guildId={business.discordGuildId}
                name="discordFallbackCategoryId"
                defaultValue={business.discordFallbackCategoryId ?? ''}
                triggerLabel="Choose a category…"
              />
              <p className="text-xs text-muted-foreground">
                Per-ticket channels open under this Discord category when the ticket&apos;s own category doesn&apos;t set one.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="discordClosedCategoryId">Closed-tickets Discord category (optional)</Label>
              <DiscordPicker
                kind="category"
                guildId={business.discordGuildId}
                name="discordClosedCategoryId"
                defaultValue={business.discordClosedCategoryId ?? ''}
                triggerLabel="Choose a category…"
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
            <CardTitle className="text-base">TicketTool coexistence</CardTitle>
            <CardDescription>
              Ingest tickets the third-party TicketTool bot opens in this server and control them
              from here. Channels TicketTool opens under the categories below are added to your
              archive and become two-way replyable; euphoric never deletes or owns them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ticketMode">Ticket system for this team</Label>
              <select
                id="ticketMode"
                name="ticketMode"
                defaultValue={business.ticketMode}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                <option value="euphoric">Euphoric Tickets (native panels + web)</option>
                <option value="tickettool">TicketTool (ingest + control its tickets)</option>
              </select>
              <p className="text-xs text-muted-foreground">
                <strong>TicketTool</strong> mode disables euphoric&apos;s own ticket-opening (panels +
                the web &quot;Open a ticket&quot; form) for this team — all new tickets come from
                TicketTool, and euphoric ingests &amp; controls them. The settings below apply in
                TicketTool mode.
              </p>
            </div>
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">One-time setup in TicketTool</p>
              <p className="mt-1">
                In TicketTool&apos;s dashboard → <strong>Server Configs → Bot</strong>, add this bot&apos;s
                user ID so TicketTool obeys its commands:
              </p>
              <code className="mt-1 inline-block select-all rounded bg-background px-1.5 py-0.5 font-mono text-foreground">
                {env.AUTH_DISCORD_ID}
              </code>
              <p className="mt-1">Without this, rename / add / remove / close-request won&apos;t reach TicketTool.</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ticketToolCategoryIds">Watched TicketTool categories</Label>
              <DiscordPicker
                kind="category"
                multi
                guildId={business.discordGuildId}
                name="ticketToolCategoryIds"
                defaultValue={business.ticketToolCategoryIds}
                triggerLabel="Leave empty — TicketTool ingest off"
              />
              <p className="text-xs text-muted-foreground">
                The Discord categories TicketTool opens its ticket channels under. Empty = the
                whole feature is off.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ticketToolPrefix">TicketTool command prefix</Label>
              <Input
                id="ticketToolPrefix"
                name="ticketToolPrefix"
                defaultValue={business.ticketToolPrefix}
                maxLength={5}
                placeholder="$"
                className="w-24"
              />
              <p className="text-xs text-muted-foreground">
                Matches your server&apos;s TicketTool prefix (Server Configs → Prefix). Default is{' '}
                <code>$</code>. The bot uses it when emitting control commands.
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
                        <CategoryFormFields idPrefix={`edit-${c.id}-`} defaults={c} guildId={business.discordGuildId} />
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
            <CategoryFormFields idPrefix="new-" guildId={business.discordGuildId} />
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
  guildId,
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
    staffOnly: boolean
    kind: 'normal' | 'project'
  }
  guildId: string
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
          <p className="text-xs text-muted-foreground">Internal id, lowercase. Unique per team.</p>
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
          <Label htmlFor={`${idPrefix}discordParentCategoryId`}>Open Discord category</Label>
          <DiscordPicker
            kind="category"
            guildId={guildId}
            name="discordParentCategoryId"
            defaultValue={v?.discordParentCategoryId ?? ''}
            triggerLabel="Choose a category…"
          />
          <p className="text-xs text-muted-foreground">Per-ticket channels open here. Leave empty → team fallback.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}discordClosedCategoryId`}>Closed Discord category</Label>
          <DiscordPicker
            kind="category"
            guildId={guildId}
            name="discordClosedCategoryId"
            defaultValue={v?.discordClosedCategoryId ?? ''}
            triggerLabel="Choose a category…"
          />
          <p className="text-xs text-muted-foreground">Closed channels move here. Leave empty → team fallback.</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}allowRoleIds`}>Allow-to-open roles</Label>
          <DiscordPicker
            kind="role"
            multi
            guildId={guildId}
            name="allowRoleIds"
            defaultValue={v?.allowRoleIds ?? ''}
            triggerLabel="Leave empty — anyone may open"
          />
          <p className="text-xs text-muted-foreground">
            If set, only members holding any of these roles can click the panel button for this category.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}staffRoleIds`}>Category staff roles</Label>
          <DiscordPicker
            kind="role"
            multi
            guildId={guildId}
            name="staffRoleIds"
            defaultValue={v?.staffRoleIds ?? ''}
            triggerLabel="Leave empty — fall back to team admins"
          />
          <p className="text-xs text-muted-foreground">
            Staff can claim/close/reply on tickets in this category. They cannot delete channels — that stays admin-only.
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}kind`}>Type</Label>
          <select
            id={`${idPrefix}kind`}
            name="kind"
            defaultValue={v?.kind ?? 'normal'}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="normal">Normal — one-off issue</option>
            <option value="project">Project — long-term work / retainer with sub-tickets</option>
          </select>
          <p className="text-xs text-muted-foreground">
            Decides whether tickets opened in this category support sub-tickets.
          </p>
        </div>
        <div className="flex items-start gap-3 rounded-md border border-input bg-background/40 p-3">
          <input
            id={`${idPrefix}staffOnly`}
            name="staffOnly"
            type="checkbox"
            defaultChecked={!!v?.staffOnly}
            className="mt-0.5 h-4 w-4 rounded border-input accent-foreground"
          />
          <div className="space-y-0.5">
            <Label htmlFor={`${idPrefix}staffOnly`} className="cursor-pointer">Staff-only destination</Label>
            <p className="text-xs text-muted-foreground">
              Hides this category from the open-ticket form everywhere — the web&apos;s <code>/t/new</code>
              picker and the Discord panel buttons. Staff can still <strong>move</strong> existing tickets
              into it from the ticket detail page. Useful for triage/archive landing zones.
            </p>
          </div>
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
          <code> {'{{category}}'}</code>. Blank = default welcome card. The bot uses this as the
          ticket&apos;s first message in the Discord channel.
        </p>
      </div>
    </>
  )
}
