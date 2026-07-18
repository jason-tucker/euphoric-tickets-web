import { notFound, redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { tickets, businesses } from '@/db/schema'
import { requireSession, resolveBusinessAccess, resolveTicketAccess } from '@/server/permissions'

// Convenience redirect: end users get a stable per-ticket URL that resolves
// to the canonical /b/<slug>/tickets/<id>. Anyone who can see the ticket
// will be redirected; anyone else 404s without leaking the business slug.
export default async function TicketRedirect({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const { id } = await params
  const ticketId = Number(id)
  if (!Number.isInteger(ticketId)) notFound()

  const [row] = await db
    .select({ ticket: tickets, business: businesses })
    .from(tickets)
    .innerJoin(businesses, eq(businesses.id, tickets.businessId))
    .where(eq(tickets.id, ticketId))
    .limit(1)
  if (!row) notFound()

  // Same per-ticket gate as the detail page — a 404 here (not a redirect)
  // keeps probing /t/1, /t/2, … from enumerating business slugs.
  const resolved = await resolveBusinessAccess(row.business.slug)
  const ticketAccess = await resolveTicketAccess({
    business: row.business,
    level: resolved?.level ?? ('member' as const),
    ticket: { id: row.ticket.id, openerUserId: row.ticket.openerUserId, categoryId: row.ticket.categoryId },
    session: { user: { id: session.user.id, discordId: session.user.discordId } },
  })
  if (!ticketAccess.canSee) notFound()
  redirect(`/b/${row.business.slug}/tickets/${row.ticket.id}`)
}
