'use server'

import { revalidatePath } from 'next/cache'
import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { businesses, ticketCategories, tickets, ticketMessages, ticketExternalMembers, users } from '@/db/schema'
import {
  requireBusinessAccess,
  requireSession,
  resolveBusinessAccess,
  resolveTicketAccess,
  type TicketAccessFlags,
} from '@/server/permissions'
import {
  addChannelMember,
  archiveTicketChannel,
  changeTicketChannelCategory,
  createChannelWebhook,
  createPrivateThread,
  createTicketChannel,
  deleteDiscordChannel,
  fetchDiscordUser,
  fetchGuildMemberAsBot,
  postBotMessageToThread,
  postChannelStatus,
  postWebhook,
  removeChannelMember,
  renameDiscordChannel,
  resolveWebhookIdentity,
  unarchiveTicketChannel,
} from '@/lib/discord'
import { avatarUrl, statusLabel } from '@/lib/format'
import { notify } from '@/server/notify'
import { writeAudit } from '@/server/audit'
import { emitTicketToolCommand } from '@/server/tickettool'
import type { Ticket, TicketStatus } from '@/db/schema'
import type { Session } from 'next-auth'

// A ticket the third-party TicketTool bot owns. euphoric ingests + controls it
// via TicketTool's $-prefix commands, and must NEVER mutate its channel
// directly (no archive/delete/category move).
function isTicketTool(t: Pick<Ticket, 'externalSource'>): boolean {
  return t.externalSource === 'tickettool'
}

// Workflow statuses a staffer can set directly (closed is the Close button,
// which has side effects; claimed is legacy).
const SETTABLE_STATUSES = ['open', 'in_progress', 'waiting', 'on_hold', 'completed'] as const

// Posts a silent `-# ` status footer into the ticket's Discord channel for a
// lifecycle event. Best-effort + no-op when the channel or bot token is
// missing. NEVER used for internal notes.
async function postStatus(ticket: Pick<Ticket, 'discordChannelId'>, text: string): Promise<void> {
  const botToken = process.env.DISCORD_BOT_TOKEN
  if (!botToken || !ticket.discordChannelId) return
  await postChannelStatus({ botToken, channelId: ticket.discordChannelId, text })
}

// Resolves a users.id (uuid) to the assignee's Discord identity (id + display
// name). Used so the assign audit can render the SAME name shown in the
// conversation (guild nickname → stored name) instead of a raw `<@id>`.
async function assigneeIdentity(userId: string): Promise<{ discordId: string | null; name: string | null }> {
  const [u] = await db
    .select({ discordId: users.discordId, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return { discordId: u?.discordId ?? null, name: u?.name ?? null }
}

// P2: shared loader for every ticket-detail server action. Looks up the
// ticket and resolves the per-ticket access flags (admin / staff / opener
// / external tiers — see TicketAccessFlags). Returns null if the user
// can't see the ticket; callers should treat null as a denial and return
// without mutating.
//
// Soft auth — does NOT call requireBusinessAccess, which would redirect
// an external user (no guild membership) to /dashboard. Externals reach
// these actions via their canSee/canReply flags (set from
// ticket_external_members), mirroring how the ticket detail page handles
// them under P16. Without this soft path, an external user clicking
// "Send reply" got redirected mid-action and lost their reply.
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
  const [b] = await db.select().from(businesses).where(eq(businesses.slug, slug)).limit(1)
  if (!b) return null
  const resolved = await resolveBusinessAccess(slug)
  // External members have no resolved business access (not in the guild) but
  // can still act on this ticket if ticket_external_members covers them.
  // Default their access level to 'member' so downstream flags compute
  // sensibly; resolveTicketAccess will down-shift canManageMembers/canClose
  // by checking isExternal directly.
  const level = resolved?.level ?? ('member' as const)
  const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1)
  if (!t || t.businessId !== b.id) return null
  const flags = await resolveTicketAccess({
    business: b,
    level,
    ticket: { id: t.id, openerUserId: t.openerUserId, categoryId: t.categoryId },
    session: { user: { id: session.user.id, discordId: session.user.discordId } },
  })
  if (!flags.canSee) return null
  return {
    session: session as never,
    business: b,
    level,
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

  // P13: notify the opener/assignee of a web-origin reply (best-effort).
  void notify({
    event: 'reply',
    businessId: t.businessId,
    categoryId: t.categoryId,
    ticketId: t.id,
    subject: t.subject,
    slug,
    actorUserId: session.user.id,
  }).catch(() => {})

  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
  return { ok: true }
}

// Staff sets the workflow status directly (Open / In Progress / Waiting /
// On Hold / Completed). Closing is the Close button.
export async function setTicketStatus(
  slug: string,
  ticketId: number,
  formData: FormData,
): Promise<void> {
  const ctx = await loadTicketAccess(slug, ticketId)
  if (!ctx) return
  if (!ctx.flags.canClaim) return
  const status = String(formData.get('status') ?? '')
  if (!(SETTABLE_STATUSES as readonly string[]).includes(status)) return
  const prev = ctx.ticket.status
  await db
    .update(tickets)
    .set({ status: status as TicketStatus, lastActivityAt: sql`now()` })
    .where(eq(tickets.id, ticketId))
  await postStatus(ctx.ticket, `Ticket status set to ${statusLabel(status)} by <@${ctx.session.user.discordId}>`)
  await writeAudit({
    businessId: ctx.business.id,
    ticketId,
    actorUserId: ctx.session.user.id,
    action: 'status_changed',
    metadata: { from: prev, to: status },
  })
  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
}

export async function claimTicket(slug: string, ticketId: number): Promise<void> {
  const ctx = await loadTicketAccess(slug, ticketId)
  if (!ctx) return
  if (!ctx.flags.canClaim) return
  await db
    .update(tickets)
    .set({ status: 'in_progress', assigneeUserId: ctx.session.user.id, lastActivityAt: sql`now()` })
    .where(eq(tickets.id, ticketId))
  await postStatus(ctx.ticket, `Ticket claimed by <@${ctx.session.user.discordId}>`)
  await writeAudit({
    businessId: ctx.business.id,
    ticketId,
    actorUserId: ctx.session.user.id,
    action: 'claimed',
  })
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
  await postStatus(ctx.ticket, `Ticket unclaimed by <@${ctx.session.user.discordId}>`)
  await writeAudit({
    businessId: ctx.business.id,
    ticketId,
    actorUserId: ctx.session.user.id,
    action: 'unclaimed',
  })
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
  const actor = `<@${ctx.session.user.discordId}>`
  if (!raw) {
    await db
      .update(tickets)
      .set({ status: 'open', assigneeUserId: null, lastActivityAt: sql`now()` })
      .where(eq(tickets.id, ticketId))
    await postStatus(ctx.ticket, `Ticket unassigned by ${actor}`)
    await writeAudit({
      businessId: ctx.business.id,
      ticketId,
      actorUserId: ctx.session.user.id,
      action: 'unassigned',
    })
  } else {
    if (!/^[0-9a-f-]{36}$/i.test(raw)) throw new Error('Bad assignee id')
    await db
      .update(tickets)
      .set({ status: 'in_progress', assigneeUserId: raw, lastActivityAt: sql`now()` })
      .where(eq(tickets.id, ticketId))
    const assignee = await assigneeIdentity(raw)
    // Discord footer keeps the `<@id>` mention — Discord renders it as the
    // member's in-channel display name. The web audit reads the resolved
    // id + name (below) so it shows that same name, not a raw mention.
    const target = assignee.discordId ? `<@${assignee.discordId}>` : 'a staff member'
    await postStatus(ctx.ticket, `Ticket assigned to ${target} by ${actor}`)
    await writeAudit({
      businessId: ctx.business.id,
      ticketId,
      actorUserId: ctx.session.user.id,
      action: 'assigned',
      metadata: {
        assigneeUserId: raw,
        assigneeDiscordId: assignee.discordId,
        assigneeName: assignee.name,
        // Kept for backward-compat with older readers; the page prefers the
        // resolved id + name above.
        assigneeMention: target,
      },
    })
  }
  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
}

export async function closeTicket(slug: string, ticketId: number): Promise<void> {
  const ctx = await loadTicketAccess(slug, ticketId)
  if (!ctx) return
  if (!ctx.flags.canClose) return
  // TicketTool owns its channel — never archive/move it from here. Use
  // requestCloseTicket ($closeRequest) instead; the UI hides the hard Close
  // button for these tickets.
  if (isTicketTool(ctx.ticket)) return
  const { session, business: businessRow, ticket: t } = ctx
  const access = { business: businessRow }
  await db
    .update(tickets)
    .set({ status: 'closed', closedAt: sql`now()`, closedByUserId: session.user.id, lastActivityAt: sql`now()` })
    .where(eq(tickets.id, ticketId))

  // Status footer before the archive move (the channel survives the move).
  await postStatus(t, `Ticket closed by <@${session.user.discordId}>`)
  await writeAudit({
    businessId: ctx.business.id,
    ticketId,
    actorUserId: session.user.id,
    action: 'closed',
  })

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
  // Never delete a TicketTool-owned channel from here.
  if (isTicketTool(t)) throw new Error('TicketTool owns this channel — delete it in TicketTool')
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

  await writeAudit({
    businessId: ctx.business.id,
    ticketId,
    actorUserId: ctx.session.user.id,
    action: 'channel_deleted',
  })
  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
}

// P5: move a ticket to a different category (admin-only). Validates the
// target belongs to the same team, updates the DB, best-effort moves the
// Discord channel + grants the new category's staff roles, posts a footer.
export async function changeTicketCategory(
  slug: string,
  ticketId: number,
  formData: FormData,
): Promise<void> {
  const ctx = await loadTicketAccess(slug, ticketId)
  if (!ctx) return
  if (!ctx.flags.canChangeCategory) return
  // TicketTool tickets have no euphoric category and we don't move their
  // channel — no-op.
  if (isTicketTool(ctx.ticket)) return

  const newCategoryId = String(formData.get('categoryId') ?? '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(newCategoryId)) return

  const [cat] = await db
    .select()
    .from(ticketCategories)
    .where(and(eq(ticketCategories.id, newCategoryId), eq(ticketCategories.businessId, ctx.business.id)))
    .limit(1)
  if (!cat) return
  if (cat.id === ctx.ticket.categoryId) return

  await db
    .update(tickets)
    .set({ categoryId: cat.id, lastActivityAt: sql`now()` })
    .where(eq(tickets.id, ticketId))

  const botToken = process.env.DISCORD_BOT_TOKEN
  if (botToken && ctx.ticket.discordChannelId) {
    const parentId = cat.discordParentCategoryId ?? ctx.business.discordFallbackCategoryId ?? null
    const staffRoles = (cat.staffRoleIds && cat.staffRoleIds.trim().length > 0
      ? cat.staffRoleIds
      : ctx.business.adminRoleIds
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    await changeTicketChannelCategory({
      botToken,
      channelId: ctx.ticket.discordChannelId,
      parentId,
      grantRoleIds: staffRoles,
    })
  }

  await postStatus(ctx.ticket, `Ticket category changed to ${cat.label} by <@${ctx.session.user.discordId}>`)
  await writeAudit({
    businessId: ctx.business.id,
    ticketId,
    actorUserId: ctx.session.user.id,
    action: 'category_changed',
    metadata: { fromCategoryId: ctx.ticket.categoryId, toCategoryId: cat.id, toCategoryLabel: cat.label },
  })
  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
}

// P6: add a guild member to the ticket channel (staff/admin). Upserts a
// users row so they attribute correctly, grants the channel overwrite, and
// posts a status footer.
export async function addTicketMember(
  slug: string,
  ticketId: number,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await loadTicketAccess(slug, ticketId)
  if (!ctx) return { ok: false, error: 'Not found' }
  if (!ctx.flags.canManageMembers) return { ok: false, error: 'Staff only' }

  const discordUserId = String(formData.get('userId') ?? '').trim()
  if (!/^\d{17,20}$/.test(discordUserId)) return { ok: false, error: 'Pick a user' }

  // TicketTool ticket: don't touch the channel overwrites or post our own
  // status — ask TicketTool to add the user via `$add <@id>`. TicketTool owns
  // the access AND the "added X" log message (it has its own logging settings),
  // which we ingest. We record a quiet external-member row so the user sees the
  // ticket on their /dashboard, but write NO audit/status of our own.
  if (isTicketTool(ctx.ticket)) {
    const emitted = await emitTicketToolCommand({
      ticketId: ctx.ticket.id,
      action: 'add',
      discordUserId,
    })
    if (!emitted.ok) return { ok: false, error: emitted.error }
    const [u] = await db
      .insert(users)
      .values({ discordId: discordUserId, name: null, image: null })
      .onConflictDoUpdate({ target: users.discordId, set: { updatedAt: sql`now()` } })
      .returning({ id: users.id })
    await db
      .insert(ticketExternalMembers)
      .values({ ticketId: ctx.ticket.id, userId: u.id, addedByUserId: ctx.session.user.id })
      .onConflictDoNothing()
    revalidatePath(`/b/${slug}/tickets/${ticketId}`)
    return { ok: true }
  }

  const botToken = process.env.DISCORD_BOT_TOKEN
  if (!botToken) return { ok: false, error: 'Bot not configured' }

  // Is this user in the team's guild?
  const member = await fetchGuildMemberAsBot(botToken, ctx.business.discordGuildId, discordUserId).catch(() => null)

  if (member && ctx.ticket.discordChannelId) {
    // In-guild: grant a channel overwrite (P6 path).
    const name = member.nick ?? member.user?.global_name ?? member.user?.username ?? null
    const image = member.user?.avatar
      ? `https://cdn.discordapp.com/avatars/${discordUserId}/${member.user.avatar}.png`
      : null
    const [u] = await db
      .insert(users)
      .values({ discordId: discordUserId, name, image })
      .onConflictDoUpdate({ target: users.discordId, set: { updatedAt: sql`now()` } })
      .returning({ id: users.id })
    try {
      await addChannelMember(botToken, ctx.ticket.discordChannelId, discordUserId)
    } catch (err) {
      return { ok: false, error: 'Discord rejected the add: ' + String(err) }
    }
    // Also stamp a ticket_external_members row for in-guild adds — that's
    // the DB-queryable "explicitly added to this ticket" signal used by
    // /dashboard to surface tickets the user is on. Channel-overwrite alone
    // can't be joined from SQL, so without this the dashboard would miss
    // every in-guild-add membership. canSee already short-circuits through
    // guild membership for these users, so the extra row is informational
    // rather than authoritative.
    await db
      .insert(ticketExternalMembers)
      .values({ ticketId: ctx.ticket.id, userId: u.id, addedByUserId: ctx.session.user.id })
      .onConflictDoNothing()
    await postStatus(ctx.ticket, `<@${discordUserId}> was added to the ticket by <@${ctx.session.user.discordId}>`)
    await writeAudit({
      businessId: ctx.business.id,
      ticketId,
      actorUserId: ctx.session.user.id,
      action: 'member_added',
      metadata: { discordUserId, name, isExternal: false },
    })
    revalidatePath(`/b/${slug}/tickets/${ticketId}`)
    return { ok: true }
  }

  // P16: external user — not in the guild. Grant web-only access + DM the link.
  const du = await fetchDiscordUser(botToken, discordUserId)
  if (!du) return { ok: false, error: 'No such Discord user' }
  const [u] = await db
    .insert(users)
    .values({ discordId: du.id, name: du.name, image: du.image })
    .onConflictDoUpdate({ target: users.discordId, set: { name: du.name, image: du.image, updatedAt: sql`now()` } })
    .returning({ id: users.id })

  await db
    .insert(ticketExternalMembers)
    .values({ ticketId: ctx.ticket.id, userId: u.id, addedByUserId: ctx.session.user.id })
    .onConflictDoNothing()

  // Best-effort DM with the web link via the bot internal endpoint. Auth with
  // INTERNAL_TOKEN if set, else the shared bot token.
  const internalToken = process.env.INTERNAL_TOKEN ?? process.env.DISCORD_BOT_TOKEN
  const botBase = process.env.BOT_INTERNAL_URL
  const webBase = process.env.PUBLIC_BASE_URL ?? 'https://tickets.euphoric.fm'
  if (internalToken && botBase) {
    void fetch(`${botBase}/api/internal/dm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': internalToken },
      body: JSON.stringify({
        discordUserId: du.id,
        content:
          `You've been added to ticket #${ctx.ticket.id} in **${ctx.business.name}**. ` +
          `View it here (sign in with Discord): ${webBase}/b/${slug}/tickets/${ctx.ticket.id}`,
      }),
    }).catch(() => {})
  }

  await postStatus(
    ctx.ticket,
    `${du.name} (external) was added to the ticket by <@${ctx.session.user.discordId}>`,
  )
  await writeAudit({
    businessId: ctx.business.id,
    ticketId,
    actorUserId: ctx.session.user.id,
    action: 'member_added',
    metadata: { discordUserId, name: du.name, isExternal: true },
  })
  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
  return { ok: true }
}

// P6 + P16: remove a member. Handles both Discord channel overwrites (in-guild
// members) and the `ticket_external_members` row (web-only access). Refuses
// the opener — close the ticket instead.
export async function removeTicketMember(slug: string, ticketId: number, discordUserId: string): Promise<void> {
  const ctx = await loadTicketAccess(slug, ticketId)
  if (!ctx) return
  if (!ctx.flags.canManageMembers) return
  if (!/^\d{17,20}$/.test(discordUserId)) return

  // Don't remove the opener — close the ticket instead.
  const [opener] = await db
    .select({ discordId: users.discordId })
    .from(users)
    .where(eq(users.id, ctx.ticket.openerUserId))
    .limit(1)
  if (opener?.discordId === discordUserId) return

  // TicketTool ticket: ask TicketTool to remove them via `$remove <@id>` and
  // let TicketTool post its own "removed X" log. We only clean up our quiet
  // external-member row; NO euphoric status/audit of our own.
  if (isTicketTool(ctx.ticket)) {
    const emitted = await emitTicketToolCommand({ ticketId: ctx.ticket.id, action: 'remove', discordUserId })
    if (!emitted.ok) return
    const [u] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.discordId, discordUserId))
      .limit(1)
    if (u) {
      await db
        .delete(ticketExternalMembers)
        .where(and(eq(ticketExternalMembers.ticketId, ctx.ticket.id), eq(ticketExternalMembers.userId, u.id)))
    }
    revalidatePath(`/b/${slug}/tickets/${ticketId}`)
    return
  }

  // Discord side (euphoric ticket): best-effort revoke of the channel overwrite
  // (skips silently when the ticket has no channel or the user was external-only).
  const botToken = process.env.DISCORD_BOT_TOKEN
  if (botToken && ctx.ticket.discordChannelId) {
    await removeChannelMember(botToken, ctx.ticket.discordChannelId, discordUserId).catch(() => {})
  }

  // P16: also delete the web-only access row. Without this, an "external"
  // member kept seeing + replying via their bookmark/DM link after staff hit
  // the Remove button. Resolve discordId → users.id first.
  const [u] = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.discordId, discordUserId))
    .limit(1)
  if (u) {
    await db
      .delete(ticketExternalMembers)
      .where(
        and(
          eq(ticketExternalMembers.ticketId, ctx.ticket.id),
          eq(ticketExternalMembers.userId, u.id),
        ),
      )
  }

  // Status footer in the Discord channel. For external removes use the
  // stored display name (the `<@id>` mention won't resolve for someone not
  // in the guild, so it would just render as a raw id).
  const actor = `<@${ctx.session.user.discordId}>`
  const subject = u?.name ? `${u.name} (external/Discord)` : `<@${discordUserId}>`
  await postStatus(ctx.ticket, `${subject} was removed from the ticket by ${actor}`)
  await writeAudit({
    businessId: ctx.business.id,
    ticketId,
    actorUserId: ctx.session.user.id,
    action: 'member_removed',
    metadata: { discordUserId, name: u?.name ?? null },
  })
  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
}

// Promote a ticket member to be the ticket's owner (opener). Staff/admin only.
// The target is already on the ticket (listed under People), so they keep their
// channel access; we just repoint `opener_user_id`.
export async function setTicketOwner(slug: string, ticketId: number, discordUserId: string): Promise<void> {
  const ctx = await loadTicketAccess(slug, ticketId)
  if (!ctx) return
  if (!ctx.flags.canManageMembers) return
  if (!/^\d{17,20}$/.test(discordUserId)) return

  // Resolve to a local users row, upserting display identity from the guild so
  // someone who only ever appeared as a channel overwrite still gets a row.
  const botToken = process.env.DISCORD_BOT_TOKEN
  let name: string | null = null
  let image: string | null = null
  if (botToken) {
    const member = await fetchGuildMemberAsBot(botToken, ctx.business.discordGuildId, discordUserId).catch(() => null)
    if (member) {
      name = member.nick ?? member.user?.global_name ?? member.user?.username ?? null
      image = member.user?.avatar
        ? `https://cdn.discordapp.com/avatars/${discordUserId}/${member.user.avatar}.png`
        : null
    }
  }
  const [u] = await db
    .insert(users)
    .values({ discordId: discordUserId, name, image })
    .onConflictDoUpdate({ target: users.discordId, set: { updatedAt: sql`now()` } })
    .returning({ id: users.id })
  if (!u || u.id === ctx.ticket.openerUserId) return

  await db
    .update(tickets)
    .set({ openerUserId: u.id, lastActivityAt: sql`now()` })
    .where(eq(tickets.id, ticketId))

  await postStatus(ctx.ticket, `<@${discordUserId}> is now the ticket owner (set by <@${ctx.session.user.discordId}>)`)
  await writeAudit({
    businessId: ctx.business.id,
    ticketId,
    actorUserId: ctx.session.user.id,
    action: 'owner_changed',
    metadata: { discordUserId, name },
  })
  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
}

// Rename a NATIVE euphoric ticket (staff+). Updates the subject and renames the
// Discord channel to `ticket-<id>-<slug>` (mirrors the bot's /tickets rename),
// posts a status footer, and writes a `renamed` audit. TicketTool tickets use
// renameTicketToolTicket instead (euphoric doesn't own their channel).
export async function renameTicket(
  slug: string,
  ticketId: number,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await loadTicketAccess(slug, ticketId)
  if (!ctx) return { ok: false, error: 'Not found' }
  if (!ctx.flags.canManageMembers) return { ok: false, error: 'Staff only' }
  if (isTicketTool(ctx.ticket)) return { ok: false, error: 'Use the TicketTool rename' }
  if (ctx.ticket.status === 'closed') return { ok: false, error: 'Cannot rename a closed ticket' }

  const raw = String(formData.get('name') ?? '').trim()
  if (raw.length < 1 || raw.length > 100) return { ok: false, error: 'Name must be 1–100 chars' }
  const sluglet = raw.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
  if (!sluglet) return { ok: false, error: 'Name needs letters or digits' }

  await db
    .update(tickets)
    .set({ subject: raw, lastActivityAt: sql`now()` })
    .where(eq(tickets.id, ticketId))

  const botToken = process.env.DISCORD_BOT_TOKEN
  if (botToken && ctx.ticket.discordChannelId) {
    const finalName = `ticket-${ctx.ticket.id}-${sluglet}`.slice(0, 100)
    await renameDiscordChannel(botToken, ctx.ticket.discordChannelId, finalName).catch(() => {})
    await postStatus(ctx.ticket, `Channel renamed to \`#${finalName}\` by <@${ctx.session.user.discordId}>`)
  }
  await writeAudit({
    businessId: ctx.business.id,
    ticketId,
    actorUserId: ctx.session.user.id,
    action: 'renamed',
    metadata: { name: raw },
  })
  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
  return { ok: true }
}

// TicketTool control: rename the ticket channel via `$rename <name>`. Staff+.
// We optimistically update the DB subject; TicketTool renames the channel.
export async function renameTicketToolTicket(
  slug: string,
  ticketId: number,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await loadTicketAccess(slug, ticketId)
  if (!ctx) return { ok: false, error: 'Not found' }
  if (!ctx.flags.canManageMembers) return { ok: false, error: 'Staff only' }
  if (!isTicketTool(ctx.ticket)) return { ok: false, error: 'Not a TicketTool ticket' }

  const name = String(formData.get('name') ?? '').trim()
  if (name.length < 1 || name.length > 100) return { ok: false, error: 'Name must be 1–100 chars' }

  const emitted = await emitTicketToolCommand({ ticketId: ctx.ticket.id, action: 'rename', name })
  if (!emitted.ok) return { ok: false, error: emitted.error }

  // Quietly track the new subject so the web title matches; TicketTool posts its
  // own rename log, so we write no euphoric status/audit of our own.
  await db
    .update(tickets)
    .set({ subject: name, lastActivityAt: sql`now()` })
    .where(eq(tickets.id, ticketId))
  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
  return { ok: true }
}

// TicketTool control: send a close request via `$closeRequest`. Non-destructive
// — TicketTool posts its own confirm prompt; the actual close (and our DB close)
// follows when a human confirms and TicketTool deletes the channel (handled by
// the bot's channelDelete / startup reconcile). Does NOT change status here.
export async function requestCloseTicketToolTicket(
  slug: string,
  ticketId: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await loadTicketAccess(slug, ticketId)
  if (!ctx) return { ok: false, error: 'Not found' }
  if (!ctx.flags.canClose) return { ok: false, error: 'You cannot close this ticket' }
  if (!isTicketTool(ctx.ticket)) return { ok: false, error: 'Not a TicketTool ticket' }

  const emitted = await emitTicketToolCommand({ ticketId: ctx.ticket.id, action: 'closeRequest' })
  if (!emitted.ok) return { ok: false, error: emitted.error }

  // TicketTool posts its own close-request prompt; no euphoric status/audit.
  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
  return { ok: true }
}

// Channel slug for a freshly-created reopened ticket channel — matches the
// `${id}-${slug}` shape used by /t/new so reopens are visually consistent.
function reopenChannelSlug(subject: string, id: number): string {
  const slug = subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return `${id}-${slug || 'ticket'}`
}

// Replay the most-recent user-facing messages into a freshly-created channel
// via the per-ticket webhook. Internal staff notes are NEVER replayed (they'd
// leak to the opener once the channel exists). Each post is silenced
// (SUPPRESS_NOTIFICATIONS) and paced ~500ms apart to stay well inside the
// per-webhook rate budget (5 req / 2s). Capped at the last 20 to keep the
// whole replay under ~12s — anything larger is summarized in the header.
const REPLAY_CAP = 20
const REPLAY_INTERVAL_MS = 500

type ReplayableMessage = {
  body: string
  createdAt: Date
  source: 'web' | 'discord' | 'system' | 'internal'
  authorDiscordId: string | null
  authorName: string | null
  authorImage: string | null
  attachmentCount: number
}

async function loadReplayableMessages(ticketId: number): Promise<ReplayableMessage[]> {
  const rows = await db
    .select({
      body: ticketMessages.body,
      createdAt: ticketMessages.createdAt,
      source: ticketMessages.source,
      attachments: ticketMessages.attachments,
      authorDiscordId: users.discordId,
      authorName: users.name,
      authorImage: users.image,
    })
    .from(ticketMessages)
    .leftJoin(users, eq(users.id, ticketMessages.authorUserId))
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(asc(ticketMessages.createdAt))
  return rows
    .filter((r) => r.source !== 'internal')
    .map((r) => ({
      body: r.body,
      createdAt: r.createdAt,
      source: r.source as ReplayableMessage['source'],
      authorDiscordId: r.authorDiscordId,
      authorName: r.authorName,
      authorImage: r.authorImage,
      attachmentCount: Array.isArray(r.attachments) ? r.attachments.length : 0,
    }))
}

async function replayConversationViaWebhook(opts: {
  webhookUrl: string
  botToken: string | undefined
  guildId: string
  messages: ReplayableMessage[]
}): Promise<void> {
  for (const m of opts.messages) {
    const fallbackName = m.authorName ?? 'Past message'
    const identity =
      opts.botToken && m.authorDiscordId
        ? await resolveWebhookIdentity({
            botToken: opts.botToken,
            guildId: opts.guildId,
            discordUserId: m.authorDiscordId,
            globalName: fallbackName,
            globalAvatarUrl: m.authorImage,
          })
        : { username: fallbackName, avatarUrl: m.authorImage }
    const stamp = new Date(m.createdAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
    const attachmentNote =
      m.attachmentCount > 0
        ? `\n_(${m.attachmentCount} attachment${m.attachmentCount === 1 ? '' : 's'} — see the web for original media)_`
        : ''
    const body = (m.body || '_(no text)_').slice(0, 1800)
    const content = `-# 📜 ${stamp}\n${body}${attachmentNote}`
    try {
      await postWebhook({
        webhookUrl: opts.webhookUrl,
        username: identity.username.slice(0, 80),
        avatarUrl: identity.avatarUrl,
        content,
        silent: true,
      })
    } catch (err) {
      console.error('[reopenTicket] replay post failed; continuing', err)
    }
    await new Promise((r) => setTimeout(r, REPLAY_INTERVAL_MS))
  }
}

export async function reopenTicket(slug: string, ticketId: number): Promise<void> {
  const ctx = await loadTicketAccess(slug, ticketId)
  if (!ctx) return
  if (!ctx.flags.canClaim) return
  const { session, business: businessRow, ticket: t } = ctx
  const wasTicketTool = isTicketTool(t)
  // TicketTool gate: reopen is only allowed when the channel was deleted.
  // While the channel still exists, TicketTool owns the lifecycle and the
  // user should use `$reopen` from inside the channel instead.
  if (wasTicketTool && t.discordChannelId) return

  const botToken = process.env.DISCORD_BOT_TOKEN
  const channelExists = Boolean(t.discordChannelId)

  // Path A — native ticket with the archived channel still present: unarchive
  // (move back to the original parent + strip `closed-` prefix). No replay.
  if (channelExists && !wasTicketTool && botToken && t.discordChannelId) {
    let parentId: string | null = businessRow.discordFallbackCategoryId ?? null
    if (t.categoryId) {
      const [c] = await db
        .select({ override: ticketCategories.discordParentCategoryId })
        .from(ticketCategories)
        .where(eq(ticketCategories.id, t.categoryId))
        .limit(1)
      if (c?.override) parentId = c.override
    }
    try {
      await unarchiveTicketChannel({
        botToken,
        channelId: t.discordChannelId,
        parentId,
      })
    } catch (err) {
      console.error('[reopenTicket] unarchive failed', err)
    }
  }

  // Path B — no channel (native was hard-deleted, or TicketTool deleted its
  // own channel). Create a fresh native channel + webhook, post a header
  // embed, and replay the last 20 user-facing messages via silent webhook
  // posts. If this was a TicketTool ticket, also promote it to native — the
  // channel is gone and TicketTool no longer owns the lifecycle.
  let newChannelInfo: { id: string; name: string } | null = null
  let newWebhookInfo: { id: string; url: string } | null = null
  if (!channelExists && botToken && businessRow.discordGuildId) {
    const parentId =
      (t.categoryId
        ? (
            await db
              .select({ override: ticketCategories.discordParentCategoryId })
              .from(ticketCategories)
              .where(eq(ticketCategories.id, t.categoryId))
              .limit(1)
          )[0]?.override
        : null) ?? businessRow.discordFallbackCategoryId ?? null

    // Resolve opener's discord id so the new channel grants them view+send.
    const [opener] = await db
      .select({ discordId: users.discordId })
      .from(users)
      .where(eq(users.id, t.openerUserId))
      .limit(1)

    try {
      const channel = await createTicketChannel({
        botToken,
        guildId: businessRow.discordGuildId,
        parentCategoryId: parentId,
        name: reopenChannelSlug(t.subject, t.id),
        topic: `Reopened ticket #${t.id} — replayed history below`,
        openerDiscordId: opener?.discordId ?? undefined,
      })
      // Claim the channel in `newChannelInfo` as soon as Discord acked the
      // create — even if the webhook step below throws, the DB will still
      // link the new channel to this ticket (no leaked orphan channels).
      newChannelInfo = channel
      const webhook = await createChannelWebhook({
        botToken,
        channelId: channel.id,
        name: 'Euphoric Tickets',
      })
      newWebhookInfo = { id: webhook.id, url: webhook.url }

      const messages = await loadReplayableMessages(t.id)
      const totalCount = messages.length
      const toReplay = messages.slice(-REPLAY_CAP)
      const truncated = totalCount > REPLAY_CAP

      // Header embed — orients staff so the replayed lines below have context.
      const headerLines: string[] = [
        `**Subject:** ${t.subject}`,
        `**Opener:** ${opener?.discordId ? `<@${opener.discordId}>` : 'unknown'}`,
        `**Originally opened:** <t:${Math.floor(new Date(t.openedAt).getTime() / 1000)}:f>`,
      ]
      if (t.closedAt) {
        headerLines.push(`**Previously closed:** <t:${Math.floor(new Date(t.closedAt).getTime() / 1000)}:R>`)
      }
      headerLines.push(`**Reopened by:** <@${session.user.discordId}>`)
      if (wasTicketTool) {
        headerLines.push(`_This was a TicketTool ticket; promoted to native because the original channel was deleted._`)
      }
      if (totalCount === 0) {
        headerLines.push(`_No prior conversation to replay._`)
      } else {
        headerLines.push(
          truncated
            ? `_Replaying the last **${toReplay.length}** of **${totalCount}** messages (silent)._`
            : `_Replaying **${toReplay.length}** message${toReplay.length === 1 ? '' : 's'} (silent)._`,
        )
      }
      try {
        await postWebhook({
          webhookUrl: webhook.url,
          username: 'Euphoric Tickets',
          avatarUrl: null,
          content: '',
          silent: true,
          embeds: [
            {
              title: `🔓 Ticket #${t.id} reopened`,
              description: headerLines.join('\n'),
              color: 0x22c55e,
              timestamp: new Date().toISOString(),
            },
          ],
        })
      } catch (err) {
        console.error('[reopenTicket] header embed post failed', err)
      }

      if (toReplay.length > 0) {
        await replayConversationViaWebhook({
          webhookUrl: webhook.url,
          botToken,
          guildId: businessRow.discordGuildId,
          messages: toReplay,
        })
      }
    } catch (err) {
      console.error('[reopenTicket] channel recreation failed', err)
    }
  }

  // DB writes — flip status; promote tickettool→euphoric if we recreated the
  // channel; persist the new channel/webhook ids; mark needsAttention cleared
  // (the channel is healthy again).
  await db
    .update(tickets)
    .set({
      status: 'open',
      closedAt: null,
      closedByUserId: null,
      lastActivityAt: sql`now()`,
      needsAttention: false,
      ...(newChannelInfo
        ? {
            discordChannelId: newChannelInfo.id,
            discordWebhookId: newWebhookInfo?.id ?? null,
            discordWebhookUrl: newWebhookInfo?.url ?? null,
            discordInternalThreadId: null,
          }
        : {}),
      ...(wasTicketTool && newChannelInfo ? { externalSource: 'euphoric' as const } : {}),
    })
    .where(eq(tickets.id, ticketId))

  // Post the reopen footer into whichever channel is live now (existing
  // archive-unarchived, or the fresh one). For path B `postStatus` needs the
  // new channelId — use it directly rather than the stale ticket row.
  const liveChannelId = newChannelInfo?.id ?? t.discordChannelId
  if (botToken && liveChannelId) {
    await postChannelStatus({
      botToken,
      channelId: liveChannelId,
      text: `Ticket reopened by <@${session.user.discordId}>`,
    })
  }

  await writeAudit({
    businessId: ctx.business.id,
    ticketId,
    actorUserId: session.user.id,
    action: 'reopened',
    metadata: {
      recreatedChannel: Boolean(newChannelInfo),
      promotedFromTicketTool: wasTicketTool && Boolean(newChannelInfo),
    },
  })
  revalidatePath(`/b/${slug}/tickets/${ticketId}`)
}
