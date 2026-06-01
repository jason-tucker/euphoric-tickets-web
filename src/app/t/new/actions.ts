'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { businesses, ticketCategories, tickets, ticketMessages } from '@/db/schema'
import { listMyBusinesses, resolveBusinessAccess, requireSession } from '@/server/permissions'
import {
  createChannelWebhook,
  createTicketChannel,
  postWebhook,
  resolveWebhookIdentity,
} from '@/lib/discord'
import { avatarUrl } from '@/lib/format'

const schema = z.object({
  businessSlug: z.string().min(1),
  categoryId: z.string().uuid().optional().or(z.literal('')),
  subject: z.string().min(3).max(120),
  body: z.string().min(3).max(1900),
  // Removed in v0.6.37: ticket kind is now derived from the chosen
  // category's `kind` column (set in team-settings), not picked per-ticket.
  // Sub-tickets still force `normal` regardless of the parent category.
  parentTicketId: z.string().regex(/^\d+$/).optional().or(z.literal('')),
  // If submitting from a client-kind business slug, the form posts the
  // selected business id here; the action ensures the ticket lands on the
  // right host (the client's parent) with client_business_id set.
  asClientBusinessId: z.string().uuid().optional().or(z.literal('')),
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
    asClientBusinessId: String(formData.get('asClientBusinessId') ?? '') || undefined,
  })
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '))

  const access = await resolveBusinessAccess(parsed.data.businessSlug)
  if (!access) throw new Error('You are not a member of that community.')

  // Resolve the HOST that will operate this ticket vs the CLIENT it's for.
  // If the form was submitted from a client-kind business, the ticket
  // actually belongs to that client's parent host with client_business_id
  // pointing back at the client. Validates that the user belongs to the
  // client they're claiming to open on behalf of.
  let hostBusiness = access.business
  let clientBusinessId: string | null = null
  if (access.business.kind === 'client' && access.business.parentBusinessId) {
    const [host] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, access.business.parentBusinessId))
      .limit(1)
    if (!host) throw new Error('This client has no parent host configured.')
    hostBusiness = host
    clientBusinessId = access.business.id
  } else if (parsed.data.asClientBusinessId) {
    // User explicitly tagged a client business — allowed when they're a
    // member of that client and the host they're posting from is its parent.
    const [client] = await db
      .select()
      .from(businesses)
      .where(eq(businesses.id, parsed.data.asClientBusinessId))
      .limit(1)
    if (client && client.kind === 'client' && client.parentBusinessId === hostBusiness.id) {
      const my = await listMyBusinesses()
      if (my.some((b) => b.business.id === client.id)) {
        clientBusinessId = client.id
      }
    }
  }

  // Dedupe rapid resubmits before doing any DB writes / Discord calls.
  const key = dedupeKey(session.user.id, hostBusiness.id, parsed.data.subject)
  const recent = recentSubmits.get(key)
  if (recent && Date.now() - recent.at < SUBMIT_DEDUPE_MS) {
    redirect(`/b/${hostBusiness.slug}/tickets/${recent.ticketId}`)
  }

  // Categories belong to the HOST that operates them — same regardless of
  // whether the opener is the host's own staff or a client's member.
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

  const [row] = await db
    .insert(tickets)
    .values({
      businessId: hostBusiness.id,
      clientBusinessId,
      openerUserId: session.user.id,
      categoryId: category?.id ?? null,
      subject: parsed.data.subject,
      status: 'open',
      // Sub-tickets are always normal; only top-level tickets can be projects.
      // Derive kind from the chosen category — sub-tickets force 'normal'.
      kind: parentTicketId ? 'normal' : (category?.kind ?? 'normal'),
      parentTicketId,
    })
    .returning()

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

  // Per-ticket Discord channel + webhook lives under the HOST's guild
  // (the operator). Best-effort: if the bot token, guild config, or
  // category target isn't set, fall back to the legacy single host webhook.
  const botToken = process.env.DISCORD_BOT_TOKEN
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
        topic: `Opened by ${session.user.name ?? session.user.discordId} from the web — #${row.id}`,
        openerDiscordId: session.user.discordId,
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

      // Mention the client business in the header so the host can spot
      // which incoming org this ticket belongs to without clicking through.
      const clientLabel = clientBusinessId
        ? ` _(via client: ${access.business.kind === 'client' ? access.business.name : 'unknown'})_`
        : ''

      const posted = await postWebhook({
        webhookUrl: webhook.url,
        username: identity.username,
        avatarUrl: identity.avatarUrl,
        content:
          `🎫 **#${row.id}** — *${parsed.data.subject}*` +
          (category ? ` _(${category.label})_` : '') +
          clientLabel +
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
  // Always redirect to the HOST's ticket detail (the canonical operating
  // surface). Client-side views read host-scoped URLs but filter by
  // client_business_id.
  redirect(`/b/${hostBusiness.slug}/tickets/${row.id}`)
}
