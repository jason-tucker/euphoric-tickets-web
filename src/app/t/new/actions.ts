'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import { businesses, ticketCategories, tickets, ticketMessages } from '@/db/schema'
import { resolveBusinessAccess, requireSession } from '@/server/permissions'
import { postWebhook } from '@/lib/discord'
import { avatarUrl } from '@/lib/format'

const schema = z.object({
  businessSlug: z.string().min(1),
  categoryId: z.string().uuid().optional().or(z.literal('')),
  subject: z.string().min(3).max(120),
  body: z.string().min(3).max(1900),
})

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

  let categoryId: string | null = null
  if (parsed.data.categoryId) {
    const [c] = await db
      .select()
      .from(ticketCategories)
      .where(eq(ticketCategories.id, parsed.data.categoryId))
      .limit(1)
    if (c && c.businessId === access.business.id) categoryId = c.id
  }

  const [row] = await db
    .insert(tickets)
    .values({
      businessId: access.business.id,
      openerUserId: session.user.id,
      categoryId,
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

  // Fire-and-forget webhook notice so staff sees the new ticket in Discord
  // immediately. Best-effort — the ticket exists in the web DB regardless.
  if (access.business.webhookUrl) {
    try {
      await postWebhook({
        webhookUrl: access.business.webhookUrl,
        username: session.user.name ?? 'Web user',
        avatarUrl: avatarUrl(session.user.discordId, session.user.avatarHash ?? null, 64),
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
