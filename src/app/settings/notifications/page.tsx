import { eq, inArray, asc } from 'drizzle-orm'
import { TopNav } from '@/components/app/top-nav'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SubmitButton } from '@/components/app/submit-button'
import { listMyBusinesses, requireSession } from '@/server/permissions'
import { db } from '@/db/client'
import { ticketCategories, userNotificationPrefs } from '@/db/schema'
import { saveNotificationPrefs } from './actions'

// P13+ — dynamic per-user notification matrix: a global default plus per-team
// and per-category overrides. Most-specific enabled row wins at dispatch time,
// so you can (e.g.) turn notifications on globally but mute one noisy category.
export default async function NotificationSettingsPage() {
  const session = await requireSession()
  const my = await listMyBusinesses()
  const teamIds = my.map((b) => b.business.id)

  const [prefs, cats] = await Promise.all([
    db.select().from(userNotificationPrefs).where(eq(userNotificationPrefs.userId, session.user.id)),
    teamIds.length
      ? db
          .select({ id: ticketCategories.id, businessId: ticketCategories.businessId, label: ticketCategories.label, emoji: ticketCategories.emoji })
          .from(ticketCategories)
          .where(inArray(ticketCategories.businessId, teamIds))
          .orderBy(asc(ticketCategories.sortOrder), asc(ticketCategories.label))
      : Promise.resolve([] as { id: string; businessId: string; label: string; emoji: string | null }[]),
  ])

  // Lookup: is (bid, cid, event, channel) enabled?
  const on = (bid: string, cid: string, event: string, channel: string) =>
    prefs.some(
      (p) =>
        (p.businessId ?? '') === bid &&
        (p.categoryId ?? '') === cid &&
        p.event === event &&
        p.channel === channel &&
        p.enabled,
    )
  const ntfyTopic = prefs.find((p) => p.channel === 'ntfy')?.ntfyTopic ?? ''
  const ntfyServer = prefs.find((p) => p.channel === 'ntfy')?.ntfyServer ?? ''

  // Build the scope list the action will iterate (global + each team + each category).
  const scopes: { bid: string; cid: string }[] = [{ bid: '', cid: '' }]
  for (const b of my) {
    scopes.push({ bid: b.business.id, cid: '' })
    for (const c of cats.filter((c) => c.businessId === b.business.id)) {
      scopes.push({ bid: b.business.id, cid: c.id })
    }
  }

  return (
    <>
      <TopNav />
      <main className="container max-w-2xl space-y-6 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            Get pinged when tickets happen. Set a global default, then fine-tune per team or category —
            the most specific setting wins.
          </p>
        </div>

        <form action={saveNotificationPrefs} className="space-y-6">
          <input type="hidden" name="scopes" value={JSON.stringify(scopes)} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">ntfy push</CardTitle>
              <CardDescription>
                Free push notifications via{' '}
                <a className="underline" href="https://ntfy.sh" target="_blank" rel="noreferrer">ntfy</a>.
                Pick a hard-to-guess topic and subscribe to it in the ntfy app. Self-hosting? Point it
                at your own server.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="ntfyTopic">Topic</Label>
                <Input id="ntfyTopic" name="ntfyTopic" defaultValue={ntfyTopic} placeholder="e.g. euphoric-tickets-7f3a9c" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ntfyServer">Custom server (optional)</Label>
                <Input id="ntfyServer" name="ntfyServer" defaultValue={ntfyServer} placeholder="https://ntfy.sh (default)" />
                <p className="text-xs text-muted-foreground">Leave blank to use ntfy.sh. Set a full URL for a self-hosted server.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Global default</CardTitle>
              <CardDescription>Applies everywhere unless a team or category below overrides it.</CardDescription>
            </CardHeader>
            <CardContent>
              <Matrix bid="" cid="" on={on} />
            </CardContent>
          </Card>

          {my.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Per team &amp; category</CardTitle>
                <CardDescription>Overrides for specific teams. Expand a team to tune its categories.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {my.map((b) => {
                  const teamCats = cats.filter((c) => c.businessId === b.business.id)
                  return (
                    <details key={b.business.id} className="rounded-md border bg-background/40 p-3">
                      <summary className="cursor-pointer text-sm font-medium">{b.business.name}</summary>
                      <div className="mt-3 space-y-3">
                        <div>
                          <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">Whole team</div>
                          <Matrix bid={b.business.id} cid="" on={on} />
                        </div>
                        {teamCats.map((c) => (
                          <div key={c.id}>
                            <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                              {c.emoji ? `${c.emoji} ` : ''}{c.label}
                            </div>
                            <Matrix bid={b.business.id} cid={c.id} on={on} />
                          </div>
                        ))}
                      </div>
                    </details>
                  )
                })}
              </CardContent>
            </Card>
          )}

          <SubmitButton pendingChildren="Saving…">Save notification settings</SubmitButton>
        </form>
      </main>
    </>
  )
}

// One event × channel checkbox grid for a given scope.
function Matrix({
  bid,
  cid,
  on,
}: {
  bid: string
  cid: string
  on: (bid: string, cid: string, event: string, channel: string) => boolean
}) {
  const rows: { event: 'new_ticket' | 'reply'; label: string }[] = [
    { event: 'new_ticket', label: 'New ticket' },
    { event: 'reply', label: 'Reply on a ticket I’m on' },
  ]
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.event} className="flex items-center justify-between text-sm">
          <span>{r.label}</span>
          <div className="flex items-center gap-4">
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" name={`pref:${bid}:${cid}:${r.event}:ntfy`} defaultChecked={on(bid, cid, r.event, 'ntfy')} /> ntfy
            </label>
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" name={`pref:${bid}:${cid}:${r.event}:dm`} defaultChecked={on(bid, cid, r.event, 'dm')} /> DM
            </label>
          </div>
        </div>
      ))}
    </div>
  )
}
