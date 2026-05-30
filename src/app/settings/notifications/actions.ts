'use server'

import { revalidatePath } from 'next/cache'
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '@/db/client'
import { userNotificationPrefs } from '@/db/schema'
import { requireSession } from '@/server/permissions'

const COMBOS = [
  { event: 'new_ticket', channel: 'ntfy' },
  { event: 'new_ticket', channel: 'dm' },
  { event: 'reply', channel: 'ntfy' },
  { event: 'reply', channel: 'dm' },
] as const

// P13 — save global (all-teams, all-categories) notification toggles + ntfy
// topic. Each checked combo becomes a row; unchecked removes it.
export async function saveNotificationPrefs(formData: FormData): Promise<void> {
  const session = await requireSession()
  const userId = session.user.id
  const ntfyTopic = String(formData.get('ntfyTopic') ?? '').trim() || null

  for (const c of COMBOS) {
    const key = `${c.event}:${c.channel}`
    const on = formData.get(key) === 'on'
    const where = and(
      eq(userNotificationPrefs.userId, userId),
      isNull(userNotificationPrefs.businessId),
      isNull(userNotificationPrefs.categoryId),
      eq(userNotificationPrefs.event, c.event),
      eq(userNotificationPrefs.channel, c.channel),
    )
    const [existing] = await db.select({ id: userNotificationPrefs.id }).from(userNotificationPrefs).where(where).limit(1)

    if (!on) {
      if (existing) await db.delete(userNotificationPrefs).where(eq(userNotificationPrefs.id, existing.id))
      continue
    }
    if (existing) {
      await db
        .update(userNotificationPrefs)
        .set({ enabled: true, ntfyTopic: c.channel === 'ntfy' ? ntfyTopic : null })
        .where(eq(userNotificationPrefs.id, existing.id))
    } else {
      await db.insert(userNotificationPrefs).values({
        userId,
        businessId: null,
        categoryId: null,
        event: c.event,
        channel: c.channel,
        enabled: true,
        ntfyTopic: c.channel === 'ntfy' ? ntfyTopic : null,
      })
    }
  }

  revalidatePath('/settings/notifications')
}
