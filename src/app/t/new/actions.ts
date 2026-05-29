'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { ticketCategories, tickets, ticketMessages } from '@/db/schema'
import { resolveBusinessAccess, requireSession } from '@/server/permissions'
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
})

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
  })
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join('; '))

  const access = await resolveBusinessAccess(parsed.data.businessSlug)
  if (!access) throw new Error('You are not a member of that community.')

  let category: typeof ticketCategories.$inferSelect | null = null
  if (parsed.data.categoryId) {
    const [c] = await db
      .select()
      .from(ticketCategories)
      .where(eq(ticketCategories.id, parsed.data.categoryId))
      .limit(1)
    if (c && c.businessId === access.business.id) category = c
  }

  const [row] = await db
    .insert(tickets)
    .values({
      businessId: access.business.id,
      openerUserId: session.user.id,
      categoryId: category?.id ?? null,
      subject: parsed.data.subject,
      status: 'open',
    })
    .returning()

  await db.insert(ticketMessages).values({
    ticketId: row.id,
    authorUserId: session.user.id,
    body: parsed.data.body,
    source: 'web',
  })

  // Per-ticket Discord channel + webhook. Best-effort: if the bot token,
  // guild config, or category target isn't set, fall back to the legacy
  // single business webhook so the ticket still shows up somewhere.
  const botToken = process.env.DISCORD_BOT_TOKEN
  const parentCategoryId =
    category?.discordParentCategoryId ?? access.business.discordFallbackCategoryId ?? null

  let postedToPerTicketChannel = false
  if (botToken && access.business.discordGuildId && parentCategoryId) {
    try {
      const channel = await createTicketChannel({
        botToken,
        guildId: access.business.discordGuildId,
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
        guildId: access.business.discordGuildId,
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

  // Fallback: post a notice into the business-wide webhook channel so staff
  // still sees the ticket. Only runs when the per-ticket flow above didn't.
  if (!postedToPerTicketChannel && access.business.webhookUrl) {
    try {
      const identity = await resolveWebhookIdentity({
        botToken,
        guildId: access.business.discordGuildId,
        discordUserId: session.user.discordId,
        globalName: session.user.name ?? 'Web user',
        globalAvatarUrl: avatarUrl(session.user.discordId, session.user.avatarHash ?? null, 64),
      })
      await postWebhook({
        webhookUrl: access.business.webhookUrl,
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
  revalidatePath(`/b/${access.business.slug}`)
  redirect(`/b/${access.business.slug}/tickets/${row.id}`)
}
