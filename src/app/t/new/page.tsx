import { TopNav } from '@/components/app/top-nav'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { SubmitButton } from '@/components/app/submit-button'
import { TeamAndOpenAsFields } from '@/components/app/open-as-field'
import { listMyBusinesses, requireSession, resolveBusinessAccess } from '@/server/permissions'
import { db } from '@/db/client'
import { ticketCategories } from '@/db/schema'
import { inArray } from 'drizzle-orm'
import { openTicketAction } from './actions'

export default async function NewTicketPage({ searchParams }: { searchParams: Promise<{ b?: string; parent?: string }> }) {
  await requireSession()
  const sp = await searchParams
  const allMyBusinesses = await listMyBusinesses()
  // TicketTool-mode teams don't open tickets through euphoric — they're opened
  // in TicketTool. Hide them from this flow.
  const myBusinesses = allMyBusinesses.filter((b) => b.business.ticketMode !== 'tickettool')
  const parentId = sp.parent && /^\d+$/.test(sp.parent) ? Number(sp.parent) : null

  if (myBusinesses.length === 0) {
    const hasTicketToolTeam = allMyBusinesses.some((b) => b.business.ticketMode === 'tickettool')
    return (
      <>
        <TopNav />
        <main className="container max-w-xl py-6">
          <Card>
            <CardHeader>
              <CardTitle>{hasTicketToolTeam ? 'Open a ticket in TicketTool' : 'No teams yet'}</CardTitle>
              <CardDescription>
                {hasTicketToolTeam
                  ? 'Your team uses TicketTool for support. Open a ticket from the TicketTool panel in your Discord server — it’ll then appear here automatically.'
                  : 'You can’t open a ticket because you’re not in any Discord team connected to this app.'}
              </CardDescription>
            </CardHeader>
          </Card>
        </main>
      </>
    )
  }

  const selectedSlug = sp.b && myBusinesses.find((b) => b.business.slug === sp.b)
    ? sp.b
    : myBusinesses[0]!.business.slug

  // The cheap listMyBusinesses level settles admin/owner (and sudo = owner
  // everywhere) without any Discord round-trips; only cheap-'member' teams
  // need the full resolve to catch Ticket-Master admins (5-min role cache).
  const adminTeamSlugs = new Set<string>()
  const needsResolve: string[] = []
  for (const { business, level } of myBusinesses) {
    if (level === 'admin' || level === 'owner') adminTeamSlugs.add(business.slug)
    else needsResolve.push(business.slug)
  }
  const resolved = await Promise.all(needsResolve.map((slug) => resolveBusinessAccess(slug)))
  for (const a of resolved) {
    if (a && (a.level === 'admin' || a.level === 'owner')) adminTeamSlugs.add(a.business.slug)
  }

  const businessIds = myBusinesses.map((b) => b.business.id)
  const allCats = businessIds.length
    ? await db
        .select()
        .from(ticketCategories)
        .where(inArray(ticketCategories.businessId, businessIds))
    : []
  // Hide `staffOnly` destinations from the open-ticket picker — those exist
  // only as move-into targets for staff. Filter applies to everyone (member
  // and staff/admin alike), since staff still open tickets via this same flow
  // and a staff-only destination is by definition not a fresh-ticket option.
  // Grouped per team so the client-side team switch swaps the list in step.
  const catsByTeam: Record<string, { id: string; label: string; emoji: string | null }[]> = {}
  for (const { business } of myBusinesses) {
    catsByTeam[business.slug] = allCats
      .filter((c) => c.businessId === business.id && !c.staffOnly)
      .map((c) => ({ id: c.id, label: c.label, emoji: c.emoji }))
  }

  return (
    <>
      <TopNav />
      <main className="container max-w-2xl space-y-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Open a ticket</h1>
          <p className="text-sm text-muted-foreground">
            Describe what you need help with — staff will reply in this conversation and in Discord.
          </p>
        </div>

        <Card>
          <CardContent className="p-4 sm:p-6">
            <form action={openTicketAction} className="space-y-4">
              {parentId && <input type="hidden" name="parentTicketId" value={parentId} />}
              {parentId && (
                <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  Opening a sub-ticket of <span className="font-mono">#{parentId}</span>. Type is forced to Normal.
                </p>
              )}
              <TeamAndOpenAsFields
                teams={myBusinesses.map(({ business }) => ({
                  slug: business.slug,
                  name: business.name,
                  guildId: business.discordGuildId,
                  admin: adminTeamSlugs.has(business.slug),
                }))}
                defaultSlug={selectedSlug}
                catsByTeam={catsByTeam}
              />

              <div className="space-y-1">
                <Label htmlFor="subject">Subject</Label>
                <Input id="subject" name="subject" required maxLength={120} placeholder="One-line summary" />
              </div>

              <div className="space-y-1">
                <Label htmlFor="body">Details</Label>
                <Textarea
                  id="body"
                  name="body"
                  required
                  maxLength={1900}
                  rows={6}
                  placeholder="What&apos;s going on? Include any error messages, what you tried, and how to reproduce it."
                />
              </div>

              <SubmitButton pendingChildren="Opening…">Open ticket</SubmitButton>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  )
}
