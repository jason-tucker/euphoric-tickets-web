'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { ticketCategories, tickets, ticketMessages } from '@/db/schema'
import { requireBusinessAccess, requireSession } from '@/server/permissions'
import {
  archiveTicketChannel,
  deleteDiscordChannel,
  postWebhook,
  resolveWebhookIdentity,
} from '@/lib/discord'
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

  // Prefer the per-ticket channel webhook; fall back to the business-wide
  // webhook for tickets opened before the per-ticket flow was wired up.
  const replyWebhook = t.discordWebhookUrl ?? access.business.webhookUrl ?? null
  let discordMessageId: string | null = null
  if (replyWebhook) {
    try {
      const identity = await resolveWebhookIdentity({
        botToken: process.env.DISCORD_BOT_TOKEN,
        guildId: access.business.discordGuildId,
        discordUserId: session.user.discordId,
        globalName: session.user.name ?? 'Web user',
        globalAvatarUrl: avatarUrl(session.user.discordId, session.user.avatarHash ?? null, 64),
      })
      const result = await postWebhook({
        webhookUrl: replyWebhook,
        username: identity.username,
        avatarUrl: identity.avatarUrl,
        // Per-ticket channels are dedicated to one ticket, so the prefix
        // adds noise. Keep it only on the business-wide fallback channel.
        content: t.discordWebhookUrl ? parsed.data.body : `**Ticket #${t.id}** — ${parsed.data.body}`,
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

// Release a claimed ticket back to the unassigned open pool. Allowed for
// the current assignee (so they can hand it off) and any admin.
export async function unclaimTicket(slug: string, ticketId: number): Promise<void> {
  const session = await requireSession()
  const access = await requireBusinessAccess(slug, 'member')
  const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1)
  if (!t || t.businessId !== access.business.id) return
  const isAdmin = access.level === 'admin' || access.level === 'owner'
  const isAssignee = t.assigneeUserId === session.user.id
  if (!isAdmin && !isAssignee) return
  await db
    .update(tickets)
    .set({ status: 'open', assigneeUserId: null, lastActivityAt: sql`now()` })
    .where(eq(tickets.id, ticketId))
  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
}

// Assign a ticket to a specific staff member (admin-only). Bumps to claimed
// status. Passing assigneeId === '' is equivalent to unclaim.
export async function assignTicket(
  slug: string,
  ticketId: number,
  formData: FormData,
): Promise<void> {
  await requireSession()
  const access = await requireBusinessAccess(slug, 'admin')
  const raw = String(formData.get('assigneeId') ?? '').trim()
  if (!raw) {
    await db
      .update(tickets)
      .set({ status: 'open', assigneeUserId: null, lastActivityAt: sql`now()` })
      .where(and(eq(tickets.id, ticketId), eq(tickets.businessId, access.business.id)))
  } else {
    if (!/^[0-9a-f-]{36}$/i.test(raw)) throw new Error('Bad assignee id')
    await db
      .update(tickets)
      .set({ status: 'claimed', assigneeUserId: raw, lastActivityAt: sql`now()` })
      .where(and(eq(tickets.id, ticketId), eq(tickets.businessId, access.business.id)))
  }
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

  // Best-effort: rename + move the per-ticket channel into the configured
  // closed-tickets Discord category (per-category override → business
  // fallback → no move). Failure here doesn't undo the DB close.
  const botToken = process.env.DISCORD_BOT_TOKEN
  if (botToken && t.discordChannelId) {
    let closedCategoryId: string | null = access.business.discordClosedCategoryId ?? null
    if (t.categoryId) {
      const [c] = await db
        .select({ override: ticketCategories.discordClosedCategoryId })
        .from(ticketCategories)
        .where(eq(ticketCategories.id, t.categoryId))
        .limit(1)
      if (c?.override) closedCategoryId = c.override
    }
    try {
      await archiveTicketChannel({
        botToken,
        channelId: t.discordChannelId,
        closedCategoryId,
      })
    } catch (err) {
      console.error('[closeTicket] archive channel failed', err)
    }
  }

  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
}

// Hard-delete the Discord channel attached to a closed ticket. Keeps the
// DB row + ticket_messages so the transcript is still viewable from the web.
// Admin-only and only allowed when the ticket is already closed.
export async function deleteTicketChannel(slug: string, ticketId: number): Promise<void> {
  await requireSession()
  const access = await requireBusinessAccess(slug, 'admin')
  const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1)
  if (!t || t.businessId !== access.business.id) return
  if (t.status !== 'closed') throw new Error('Ticket must be closed before its channel is deleted')

  const botToken = process.env.DISCORD_BOT_TOKEN
  if (botToken && t.discordChannelId) {
    await deleteDiscordChannel({ botToken, channelId: t.discordChannelId })
  }

  await db
    .update(tickets)
    .set({
      discordChannelId: null,
      discordWebhookId: null,
      discordWebhookUrl: null,
      discordInternalThreadId: null,
    })
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
