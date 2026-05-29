import { notFound, redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { tickets, businesses } from '@/db/schema'
import { requireSession } from '@/server/permissions'

// Convenience redirect: end users get a stable per-ticket URL that resolves
// to the canonical /b/<slug>/tickets/<id>. Anyone who can see the ticket
// will be redirected; anyone else 404s without leaking the business slug.
export default async function TicketRedirect({ params }: { params: Promise<{ id: string }> }) {
  await requireSession()
  const { id } = await params
  const ticketId = Number(id)
  if (!Number.isInteger(ticketId)) notFound()

  const [row] = await db
    .select({ id: tickets.id, slug: businesses.slug })
    .from(tickets)
    .innerJoin(businesses, eq(businesses.id, tickets.businessId))
    .where(eq(tickets.id, ticketId))
    .limit(1)
  if (!row) notFound()
  redirect(`/b/${row.slug}/tickets/${row.id}`)
}
