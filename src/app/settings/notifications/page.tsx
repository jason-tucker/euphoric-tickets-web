import { and, eq, isNull } from 'drizzle-orm'
import { TopNav } from '@/components/app/top-nav'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SubmitButton } from '@/components/app/submit-button'
import { requireSession } from '@/server/permissions'
import { db } from '@/db/client'
import { userNotificationPrefs } from '@/db/schema'
import { saveNotificationPrefs } from './actions'

// P13 (lantern) — per-user notification preferences (global scope). ntfy topic
// + a toggle grid of (new-ticket / reply) × (ntfy / DM).
export default async function NotificationSettingsPage() {
  const session = await requireSession()
  const rows = await db
    .select()
    .from(userNotificationPrefs)
    .where(
      and(
        eq(userNotificationPrefs.userId, session.user.id),
        isNull(userNotificationPrefs.businessId),
        isNull(userNotificationPrefs.categoryId),
      ),
    )

  const on = (event: string, channel: string) =>
    rows.some((r) => r.event === event && r.channel === channel && r.enabled)
  const ntfyTopic = rows.find((r) => r.channel === 'ntfy')?.ntfyTopic ?? ''

  const Row = ({ event, label }: { event: 'new_ticket' | 'reply'; label: string }) => (
    <div className="flex items-center justify-between border-t py-2 first:border-t-0">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-4 text-sm">
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" name={`${event}:ntfy`} defaultChecked={on(event, 'ntfy')} /> ntfy
        </label>
        <label className="inline-flex items-center gap-1">
          <input type="checkbox" name={`${event}:dm`} defaultChecked={on(event, 'dm')} /> Discord DM
        </label>
      </div>
    </div>
  )

  return (
    <>
      <TopNav />
      <main className="container max-w-2xl space-y-6 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            Get pinged when tickets happen. Applies across every team you&apos;re in.
          </p>
        </div>

        <form action={saveNotificationPrefs} className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">ntfy</CardTitle>
              <CardDescription>
                Push notifications via <a className="underline" href="https://ntfy.sh" target="_blank" rel="noreferrer">ntfy.sh</a>.
                Pick a hard-to-guess topic and subscribe to it in the ntfy app.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                <Label htmlFor="ntfyTopic">ntfy topic</Label>
                <Input id="ntfyTopic" name="ntfyTopic" defaultValue={ntfyTopic} placeholder="e.g. euphoric-tickets-7f3a9c" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">When to notify me</CardTitle>
            </CardHeader>
            <CardContent>
              <Row event="new_ticket" label="A new ticket is opened" />
              <Row event="reply" label="Someone replies on a ticket I opened or am assigned" />
            </CardContent>
          </Card>

          <SubmitButton pendingChildren="Saving…">Save notification settings</SubmitButton>
        </form>
      </main>
    </>
  )
}
