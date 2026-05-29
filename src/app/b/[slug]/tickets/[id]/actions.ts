'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { businesses, tickets, ticketMessages, users } from '@/db/schema'
import { requireBusinessAccess, requireSession } from '@/server/permissions'
import { postWebhook } from '@/lib/discord'
import { avatarUrl } from '@/lib/format'

const replySchema = z.object({
  body: z.string().min(1, 'Reply cannot be empty').max(2000, 'Discord limits messages to 2000 chars'),
})

export async function replyToTicket(
  slug: string,
  ticketId: number,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await requireSession()
  const access = await requireBusinessAccess(slug, 'member')

  const parsed = replySchema.safeParse({ body: String(formData.get('body') ?? '') })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  // Pull the ticket and verify business + opener-vs-admin access.
  const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1)
  if (!t || t.businessId !== access.business.id) return { ok: false, error: 'Ticket not found' }

  const isAdmin = access.level === 'admin' || access.level === 'owner'
  const isOpener = t.openerUserId === session.user.id
  if (!isAdmin && !isOpener) return { ok: false, error: 'You cannot reply to this ticket' }
  if (t.status === 'closed') return { ok: false, error: 'Cannot reply to a closed ticket' }

  // Post via the business's Discord webhook as the user (per-user spoof).
  const business = access.business
  let discordMessageId: string | null = null
  if (business.webhookUrl) {
    try {
      const result = await postWebhook({
        webhookUrl: business.webhookUrl,
        username: session.user.name ?? 'Web user',
        avatarUrl: avatarUrl(session.user.discordId, session.user.avatarHash ?? null, 64),
        content: `**Ticket #${t.id}** — ${parsed.data.body}`,
      })
      discordMessageId = result?.id ?? null
    } catch (err) {
      return { ok: false, error: 'Discord rejected the webhook post: ' + String(err) }
    }
  }

  // Record the reply locally.
  await db.insert(ticketMessages).values({
    ticketId: t.id,
    authorUserId: session.user.id,
    body: parsed.data.body,
    source: 'web',
    discordMessageId,
  })

  await db
    .update(tickets)
    .set({ lastActivityAt: sql`now()` })
    .where(eq(tickets.id, t.id))

  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
  return { ok: true }
}

export async function claimTicket(slug: string, ticketId: number): Promise<void> {
  const session = await requireSession()
  const access = await requireBusinessAccess(slug, 'admin')
  await db
    .update(tickets)
    .set({ status: 'claimed', assigneeUserId: session.user.id, lastActivityAt: sql`now()` })
    .where(and(eq(tickets.id, ticketId), eq(tickets.businessId, access.business.id)))
  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
}

export async function closeTicket(slug: string, ticketId: number): Promise<void> {
  const session = await requireSession()
  const access = await requireBusinessAccess(slug, 'member')
  const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1)
  if (!t || t.businessId !== access.business.id) return
  const isAdmin = access.level === 'admin' || access.level === 'owner'
  const isOpener = t.openerUserId === session.user.id
  if (!isAdmin && !isOpener) return
  await db
    .update(tickets)
    .set({ status: 'closed', closedAt: sql`now()`, closedByUserId: session.user.id, lastActivityAt: sql`now()` })
    .where(eq(tickets.id, ticketId))
  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
}

export async function reopenTicket(slug: string, ticketId: number): Promise<void> {
  await requireBusinessAccess(slug, 'admin')
  await db
    .update(tickets)
    .set({ status: 'open', closedAt: null, closedByUserId: null, lastActivityAt: sql`now()` })
    .where(eq(tickets.id, ticketId))
  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
}
