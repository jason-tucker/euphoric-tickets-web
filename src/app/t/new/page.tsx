import { TopNav } from '@/components/app/top-nav'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { listMyBusinesses, requireSession } from '@/server/permissions'
import { db } from '@/db/client'
import { ticketCategories } from '@/db/schema'
import { inArray } from 'drizzle-orm'
import { openTicketAction } from './actions'

export default async function NewTicketPage({ searchParams }: { searchParams: Promise<{ b?: string }> }) {
  await requireSession()
  const sp = await searchParams
  const myBusinesses = await listMyBusinesses()

  if (myBusinesses.length === 0) {
    return (
      <>
        <TopNav />
        <main className="container max-w-xl py-6">
          <Card>
            <CardHeader>
              <CardTitle>No communities yet</CardTitle>
              <CardDescription>
                You can&apos;t open a ticket because you&apos;re not in any Discord community connected to this app.
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
  const selectedBusiness = myBusinesses.find((b) => b.business.slug === selectedSlug)!.business

  const businessIds = myBusinesses.map((b) => b.business.id)
  const allCats = businessIds.length
    ? await db
        .select()
        .from(ticketCategories)
        .where(inArray(ticketCategories.businessId, businessIds))
    : []
  const cats = allCats.filter((c) => c.businessId === selectedBusiness.id)

  return (
    <>
      <TopNav activeBusinessSlug={selectedSlug} />
      <main className="container max-w-2xl space-y-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Open a ticket</h1>
          <p className="text-sm text-muted-foreground">
            Describe what you need help with — staff will reply in this conversation and in Discord.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6">
            <form action={openTicketAction} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="businessSlug">Community</Label>
                <select
                  id="businessSlug"
                  name="businessSlug"
                  defaultValue={selectedSlug}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  {myBusinesses.map(({ business }) => (
                    <option key={business.id} value={business.slug}>{business.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <Label htmlFor="categoryId">Category</Label>
                <select
                  id="categoryId"
                  name="categoryId"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">— pick one —</option>
                  {cats.map((c) => (
                    <option key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ''}{c.label}</option>
                  ))}
                </select>
                {cats.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    This community has no categories yet. An admin can add them in business settings.
                  </p>
                )}
              </div>

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

              <Button type="submit">Open ticket</Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  )
}
