'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { ticketCategories, ticketExternalMembers, tickets, ticketMessages, users } from '@/db/schema'
import { resolveBusinessAccess, requireSession } from '@/server/permissions'
import {
  createChannelWebhook,
  createTicketChannel,
  fetchDiscordUser,
  fetchGuildMemberIdentity,
  postWebhook,
  resolveWebhookIdentity,
} from '@/lib/discord'
import { avatarUrl } from '@/lib/format'
import { writeAudit } from '@/server/audit'
import { postBotDm } from '@/server/notify'

const schema = z.object({
  businessSlug: z.string().min(1),
  categoryId: z.string().uuid().optional().or(z.literal('')),
  subject: z.string().min(3).max(120),
  body: z.string().min(3).max(1900),
  // Removed in v0.6.37: ticket kind is now derived from the chosen
  // category's `kind` column (set in team-settings), not picked per-ticket.
  // Sub-tickets still force `normal` regardless of the parent category.
  parentTicketId: z.string().regex(/^\d+$/).optional().or(z.literal('')),
  // Admin-only: open on behalf of this Discord user (they become the opener).
  openAsDiscordId: z.string().regex(/^\d{17,20}$/).optional().or(z.literal('')),
})

// Tiny per-process dedupe: same opener + business + subject within 5s →
// treat it as a re-submit of the in-flight one, not a new ticket. Belt-
// and-suspenders for `<SubmitButton>`'s client-side disable. Resets on
// process restart, which is the point.
const recentSubmits = new Map<string, { ticketId: number; at: number }>()
const SUBMIT_DEDUPE_MS = 5_000

function dedupeKey(userId: string, businessId: string, subject: string): string {
  return `${userId}:${businessId}:${subject.trim().toLowerCase()}`
}

function channelSlug(subject: string, id: number): string {
  // Discord channel names: lowercase, hyphens, no spaces. Keep it human.
  const slug = subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return `${id}-${slug || 'ticket'}`
}

export async function openTicketAction(formData: FormData): Promise<void> {
  const session = await requireSession()

  const parsed = schema.safeParse({
    businessSlug: String(formData.get('businessSlug') ?? ''),
    categoryId: String(formData.get('categoryId') ?? '') || undefined,
    subject: String(formData.get('subject') ?? ''),
    body: String(formData.get('body') ?? ''),
    parentTicketId: String(formData.get('parentTicketId') ?? '') || undefined,
    openAsDiscordId: String(formData.get('openAsDiscordId') ?? '') || undefined,
  })
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '))

  const access = await resolveBusinessAccess(parsed.data.businessSlug)
  if (!access) throw new Error('You are not a member of that community.')
  // TicketTool-mode teams don't open tickets through euphoric.
  if (access.business.ticketMode === 'tickettool') {
    throw new Error('This team uses TicketTool — open a ticket from its panel in Discord.')
  }

  // The team that will operate this ticket.
  const hostBusiness = access.business

  // Dedupe rapid resubmits before doing any DB writes / Discord calls.
  const key = dedupeKey(session.user.id, hostBusiness.id, parsed.data.subject)
  const recent = recentSubmits.get(key)
  if (recent && Date.now() - recent.at < SUBMIT_DEDUPE_MS) {
    redirect(`/b/${hostBusiness.slug}/tickets/${recent.ticketId}`)
  }

  // Categories belong to the team that operates them.
  // Staff-only destinations are NEVER selectable here — they only exist as
  // move-into targets in the staff change-category flow.
  let category: typeof ticketCategories.$inferSelect | null = null
  if (parsed.data.categoryId) {
    const [c] = await db
      .select()
      .from(ticketCategories)
      .where(eq(ticketCategories.id, parsed.data.categoryId))
      .limit(1)
    if (c && c.businessId === hostBusiness.id) {
      if (c.staffOnly) throw new Error('That category is staff-only — pick another.')
      category = c
    }
  }

  // Validate parent — must exist, belong to the same host, and be a project
  // ticket. Sub-tickets inherit kind='normal'.
  let parentTicketId: number | null = null
  if (parsed.data.parentTicketId) {
    const pid = Number(parsed.data.parentTicketId)
    const [parent] = await db.select().from(tickets).where(eq(tickets.id, pid)).limit(1)
    if (!parent) throw new Error('Parent ticket not found.')
    if (parent.businessId !== hostBusiness.id) throw new Error('Parent ticket is for a different host.')
    if (parent.kind !== 'project') throw new Error('Parent must be a project ticket.')
    parentTicketId = pid
  }

  // Admin-only: open this ticket on behalf of another Discord user — the
  // target becomes the opener (dashboard + channel access) while the admin
  // stays the first message's author and the audit actor.
  const botToken = process.env.DISCORD_BOT_TOKEN
  let openerUserId = session.user.id
  let openerDiscordId = session.user.discordId
  let openerDisplayName: string | null = null
  let openAsExternal: { userId: string; name: string } | null = null
  const openAsDiscordId = parsed.data.openAsDiscordId || null
  if (openAsDiscordId && openAsDiscordId !== session.user.discordId) {
    if (access.level !== 'admin' && access.level !== 'owner') {
      throw new Error('Only team admins can open a ticket on behalf of someone else.')
    }
    if (!botToken) throw new Error('Bot not configured — cannot look up that user.')
    // Canonical per-guild identity (nick + guild avatar, 5-min cached) — the
    // same resolver the console uses, so the open-as user looks identical.
    const ident = await fetchGuildMemberIdentity(botToken, hostBusiness.discordGuildId, openAsDiscordId).catch(
      () => null,
    )
    if (ident) {
      const [u] = await db
        .insert(users)
        .values({ discordId: openAsDiscordId, name: ident.name, image: ident.image })
        .onConflictDoUpdate({ target: users.discordId, set: { updatedAt: sql`now()` } })
        .returning({ id: users.id })
      openerUserId = u.id
      openerDiscordId = openAsDiscordId
      openerDisplayName = ident.name
    } else {
      // A null identity can be "not in guild" OR a transient Discord failure —
      // the external path still works either way, but if the global lookup
      // also fails, say "try again" rather than claiming the ID is invalid.
      const du = await fetchDiscordUser(botToken, openAsDiscordId)
      if (!du) throw new Error('Could not look up that Discord user — check the ID or try again.')
      const [u] = await db
        .insert(users)
        .values({ discordId: du.id, name: du.name, image: du.image })
        .onConflictDoUpdate({ target: users.discordId, set: { updatedAt: sql`now()` } })
        .returning({ id: users.id })
      openerUserId = u.id
      openerDiscordId = openAsDiscordId
      openAsExternal = { userId: u.id, name: du.name }
    }
  }
  const onBehalf = openerUserId !== session.user.id

  // Self-opens stamp the snapshot too — same cached per-guild identity the
  // console resolves, so web-opened tickets carry the server name from birth.
  if (!onBehalf && botToken && hostBusiness.discordGuildId) {
    const ident = await fetchGuildMemberIdentity(botToken, hostBusiness.discordGuildId, session.user.discordId).catch(
      () => null,
    )
    openerDisplayName = ident?.name ?? null
  }

  const [row] = await db
    .insert(tickets)
    .values({
      businessId: hostBusiness.id,
      openerUserId,
      openerDisplayName,
      categoryId: category?.id ?? null,
      subject: parsed.data.subject,
      status: 'open',
      // Sub-tickets are always normal; only top-level tickets can be projects.
      // Derive kind from the chosen category — sub-tickets force 'normal'.
      kind: parentTicketId ? 'normal' : (category?.kind ?? 'normal'),
      parentTicketId,
    })
    .returning()

  // Audit the open event — the bot writes its own 'opened' row for panel
  // opens, this covers /t/new opens.
  await writeAudit({
    businessId: hostBusiness.id,
    ticketId: row.id,
    actorUserId: session.user.id,
    action: 'opened',
    metadata: {
      via: 'web',
      categoryId: category?.id ?? null,
      parentTicketId,
      ...(onBehalf
        ? {
            onBehalfOfDiscordId: openAsDiscordId,
            // Name snapshot so the audit line survives the target leaving.
            onBehalfOfName: openerDisplayName ?? openAsExternal?.name ?? null,
          }
        : {}),
    },
  })

  // Record successful insert for the dedupe window. Best-effort: also
  // garbage-collect stale entries so the map doesn't grow forever.
  recentSubmits.set(key, { ticketId: row.id, at: Date.now() })
  if (recentSubmits.size > 256) {
    const cutoff = Date.now() - SUBMIT_DEDUPE_MS
    for (const [k, v] of recentSubmits) {
      if (v.at < cutoff) recentSubmits.delete(k)
    }
  }

  await db.insert(ticketMessages).values({
    ticketId: row.id,
    authorUserId: session.user.id,
    body: parsed.data.body,
    source: 'web',
  })

  // Out-of-guild open-as target: the external-member row is what puts the
  // ticket on their /dashboard, and the DM is their only pointer to it.
  if (openAsExternal) {
    await db
      .insert(ticketExternalMembers)
      .values({ ticketId: row.id, userId: openAsExternal.userId, addedByUserId: session.user.id })
      .onConflictDoNothing()

    // Best-effort DM with the web link, via the shared bot-bridge helper.
    const webBase = process.env.PUBLIC_BASE_URL ?? 'https://tickets.euphoric.fm'
    void postBotDm(
      openAsDiscordId!,
      `Ticket #${row.id} — *${parsed.data.subject}* was opened for you in **${hostBusiness.name}**. ` +
        `View it here (sign in with Discord): ${webBase}/b/${hostBusiness.slug}/tickets/${row.id}`,
    ).catch(() => {})
  }

  // Per-ticket Discord channel + webhook lives under the HOST's guild
  // (the operator). Best-effort: if the bot token, guild config, or
  // category target isn't set, fall back to the legacy single host webhook.
  const parentCategoryId =
    category?.discordParentCategoryId ?? hostBusiness.discordFallbackCategoryId ?? null

  let postedToPerTicketChannel = false
  if (botToken && hostBusiness.discordGuildId && parentCategoryId) {
    try {
      const channel = await createTicketChannel({
        botToken,
        guildId: hostBusiness.discordGuildId,
        parentCategoryId,
        name: channelSlug(parsed.data.subject, row.id),
        topic: onBehalf
          ? `Opened for ${openerDisplayName ?? openAsExternal?.name ?? openerDiscordId} by ${session.user.name ?? session.user.discordId} from the web — #${row.id}`
          : `Opened by ${session.user.name ?? session.user.discordId} from the web — #${row.id}`,
        openerDiscordId,
      })

      const webhook = await createChannelWebhook({
        botToken,
        channelId: channel.id,
        name: 'Euphoric Tickets',
      })

      await db
        .update(tickets)
        .set({
          discordChannelId: channel.id,
          discordWebhookId: webhook.id,
          discordWebhookUrl: webhook.url,
        })
        .where(eq(tickets.id, row.id))

      const identity = await resolveWebhookIdentity({
        botToken,
        guildId: hostBusiness.discordGuildId,
        discordUserId: session.user.discordId,
        globalName: session.user.name ?? 'Web user',
        globalAvatarUrl: avatarUrl(session.user.discordId, session.user.avatarHash ?? null, 64),
      })

      const posted = await postWebhook({
        webhookUrl: webhook.url,
        username: identity.username,
        avatarUrl: identity.avatarUrl,
        content:
          `🎫 **#${row.id}** — *${parsed.data.subject}*` +
          (category ? ` _(${category.label})_` : '') +
          `\n\n${parsed.data.body.slice(0, 1700)}`,
      })

      if (posted?.id) {
        await db
          .update(ticketMessages)
          .set({ discordMessageId: posted.id })
          .where(eq(ticketMessages.ticketId, row.id))
      }

      postedToPerTicketChannel = true
    } catch (err) {
      console.error('[openTicket] per-ticket channel setup failed; falling back', err)
    }
  }

  // Fallback: post a notice into the host's single webhook channel.
  if (!postedToPerTicketChannel && hostBusiness.webhookUrl) {
    try {
      const identity = await resolveWebhookIdentity({
        botToken,
        guildId: hostBusiness.discordGuildId,
        discordUserId: session.user.discordId,
        globalName: session.user.name ?? 'Web user',
        globalAvatarUrl: avatarUrl(session.user.discordId, session.user.avatarHash ?? null, 64),
      })
      await postWebhook({
        webhookUrl: hostBusiness.webhookUrl,
        username: identity.username,
        avatarUrl: identity.avatarUrl,
        content:
          `🎫 **New ticket #${row.id}** — *${parsed.data.subject}*\n\n` +
          parsed.data.body.slice(0, 1500),
      })
    } catch {
      // Webhook hiccup: don't fail the form submission.
    }
  }

  revalidatePath('/dashboard')
  revalidatePath(`/b/${hostBusiness.slug}`)
  redirect(`/b/${hostBusiness.slug}/tickets/${row.id}`)
}
