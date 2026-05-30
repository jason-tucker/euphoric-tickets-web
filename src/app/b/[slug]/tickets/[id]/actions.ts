'use server'

import { revalidatePath } from 'next/cache'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { ticketCategories, tickets, ticketMessages } from '@/db/schema'
import {
  requireBusinessAccess,
  requireSession,
  resolveTicketAccess,
  type TicketAccessFlags,
} from '@/server/permissions'
import {
  archiveTicketChannel,
  createPrivateThread,
  deleteDiscordChannel,
  postBotMessageToThread,
  postWebhook,
  resolveWebhookIdentity,
} from '@/lib/discord'
import { avatarUrl } from '@/lib/format'
import type { Ticket } from '@/db/schema'
import type { Session } from 'next-auth'

// P2: shared loader for every ticket-detail server action. Looks up the
// ticket, gates by business membership, and resolves the per-ticket access
// flags (admin / staff / opener tiers — see TicketAccessFlags). Returns
// null if the ticket isn't in this business; callers should treat null as
// a denial and return without mutating.
async function loadTicketAccess(
  slug: string,
  ticketId: number,
): Promise<
  | {
      session: Session & { user: { id: string; discordId: string; name?: string | null; avatarHash?: string | null } }
      business: Awaited<ReturnType<typeof requireBusinessAccess>>['business']
      level: Awaited<ReturnType<typeof requireBusinessAccess>>['level']
      ticket: Ticket
      flags: TicketAccessFlags
    }
  | null
> {
  const session = await requireSession()
  const access = await requireBusinessAccess(slug, 'member')
  const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1)
  if (!t || t.businessId !== access.business.id) return null
  const flags = await resolveTicketAccess({
    business: access.business,
    level: access.level,
    ticket: { openerUserId: t.openerUserId, categoryId: t.categoryId },
    session: { user: { id: session.user.id, discordId: session.user.discordId } },
  })
  return {
    session: session as never,
    business: access.business,
    level: access.level,
    ticket: t,
    flags,
  }
}

const replySchema = z.object({
  body: z.string().min(1, 'Reply cannot be empty').max(2000, 'Discord limits messages to 2000 chars'),
})

export async function replyToTicket(
  slug: string,
  ticketId: number,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = replySchema.safeParse({ body: String(formData.get('body') ?? '') })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  }

  const ctx = await loadTicketAccess(slug, ticketId)
  if (!ctx) return { ok: false, error: 'Ticket not found' }
  const { session, business: businessRow, ticket: t, flags } = ctx
  const access = { business: businessRow }
  if (!flags.canReply) return { ok: false, error: 'You cannot reply to this ticket' }
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
  const ctx = await loadTicketAccess(slug, ticketId)
  if (!ctx) return
  if (!ctx.flags.canClaim) return
  await db
    .update(tickets)
    .set({ status: 'claimed', assigneeUserId: ctx.session.user.id, lastActivityAt: sql`now()` })
    .where(eq(tickets.id, ticketId))
  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
}

// Release a claimed ticket back to the unassigned open pool. Allowed for
// staff/admin, and for the current assignee (so they can hand it off).
export async function unclaimTicket(slug: string, ticketId: number): Promise<void> {
  const ctx = await loadTicketAccess(slug, ticketId)
  if (!ctx) return
  const isAssignee = ctx.ticket.assigneeUserId === ctx.session.user.id
  if (!ctx.flags.canClaim && !isAssignee) return
  await db
    .update(tickets)
    .set({ status: 'open', assigneeUserId: null, lastActivityAt: sql`now()` })
    .where(eq(tickets.id, ticketId))
  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
}

// Assign a ticket to a specific staff member (staff-or-admin under P2).
// Passing assigneeId === '' is equivalent to unclaim.
export async function assignTicket(
  slug: string,
  ticketId: number,
  formData: FormData,
): Promise<void> {
  const ctx = await loadTicketAccess(slug, ticketId)
  if (!ctx) return
  if (!ctx.flags.canClaim) return
  const raw = String(formData.get('assigneeId') ?? '').trim()
  if (!raw) {
    await db
      .update(tickets)
      .set({ status: 'open', assigneeUserId: null, lastActivityAt: sql`now()` })
      .where(eq(tickets.id, ticketId))
  } else {
    if (!/^[0-9a-f-]{36}$/i.test(raw)) throw new Error('Bad assignee id')
    await db
      .update(tickets)
      .set({ status: 'claimed', assigneeUserId: raw, lastActivityAt: sql`now()` })
      .where(eq(tickets.id, ticketId))
  }
  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
}

export async function closeTicket(slug: string, ticketId: number): Promise<void> {
  const ctx = await loadTicketAccess(slug, ticketId)
  if (!ctx) return
  if (!ctx.flags.canClose) return
  const { session, business: businessRow, ticket: t } = ctx
  const access = { business: businessRow }
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

// Add a staff-only internal note. Inserts a ticket_messages row with
// source='internal'. Lazily creates a private Discord thread on the per-ticket
// channel on the first internal note and posts the note there too (as the
// bot — threads can't accept webhook spoofs the same way channels can, and
// internal notes are never opener-visible so identity matters less).
export async function addInternalNote(
  slug: string,
  ticketId: number,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const body = String(formData.get('body') ?? '').trim()
  if (!body) return { ok: false, error: 'Empty note' }
  if (body.length > 2000) return { ok: false, error: 'Note exceeds 2000 chars' }

  const ctx = await loadTicketAccess(slug, ticketId)
  if (!ctx) return { ok: false, error: 'Not found' }
  if (!ctx.flags.canManageMembers) return { ok: false, error: 'Staff only' }
  const { session, ticket: t } = ctx

  let threadId = t.discordInternalThreadId
  const botToken = process.env.DISCORD_BOT_TOKEN
  if (botToken && t.discordChannelId && !threadId) {
    try {
      const thread = await createPrivateThread({
        botToken,
        channelId: t.discordChannelId,
        name: `notes-${t.id}`,
      })
      threadId = thread.id
      await db
        .update(tickets)
        .set({ discordInternalThreadId: threadId })
        .where(eq(tickets.id, ticketId))
    } catch (err) {
      console.error('[addInternalNote] create thread failed; note saved web-only', err)
    }
  }

  let discordMessageId: string | null = null
  if (botToken && threadId) {
    try {
      const posted = await postBotMessageToThread({
        botToken,
        threadId,
        content: `📝 **${session.user.name ?? 'Staff'}**: ${body}`,
      })
      discordMessageId = posted.id
    } catch (err) {
      console.error('[addInternalNote] post to thread failed; note saved web-only', err)
    }
  }

  await db.insert(ticketMessages).values({
    ticketId: t.id,
    authorUserId: session.user.id,
    body,
    source: 'internal',
    discordMessageId,
  })

  await db
    .update(tickets)
    .set({ lastActivityAt: sql`now()` })
    .where(eq(tickets.id, ticketId))

  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
  return { ok: true }
}

// Hard-delete the Discord channel attached to a closed ticket. Keeps the
// DB row + ticket_messages so the transcript is still viewable from the web.
// Admin-only (P2 hard rule — staff cannot delete) and only allowed when the
// ticket is already closed.
export async function deleteTicketChannel(slug: string, ticketId: number): Promise<void> {
  const ctx = await loadTicketAccess(slug, ticketId)
  if (!ctx) return
  if (!ctx.flags.canDeleteChannel) throw new Error('Only admins can delete a ticket channel')
  const { ticket: t } = ctx
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
  const ctx = await loadTicketAccess(slug, ticketId)
  if (!ctx) return
  if (!ctx.flags.canClaim) return
  await db
    .update(tickets)
    .set({ status: 'open', closedAt: null, closedByUserId: null, lastActivityAt: sql`now()` })
    .where(eq(tickets.id, ticketId))
  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
}
