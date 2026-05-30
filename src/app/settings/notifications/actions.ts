'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { userNotificationPrefs, notifyEvents, notifyChannels } from '@/db/schema'
import { requireSession } from '@/server/permissions'

const UUID = /^[0-9a-f-]{36}$/i

// P13+ — save the full per-user notification matrix: a global default plus
// per-team and per-category overrides. The page submits a `scopes` list of
// every (businessId, categoryId) pair it rendered, and one checkbox per
// scope × event × channel named `pref:<bid>:<cid>:<event>:<channel>`. We wipe
// the user's prefs and re-insert the checked ones (idempotent). ntfy topic +
// optional custom server are user-level, applied to every ntfy row.
export async function saveNotificationPrefs(formData: FormData): Promise<void> {
  const session = await requireSession()
  const userId = session.user.id

  const ntfyTopic = String(formData.get('ntfyTopic') ?? '').trim() || null
  let ntfyServer = String(formData.get('ntfyServer') ?? '').trim() || null
  // Only accept a sane http(s) URL for a custom server; ignore otherwise.
  if (ntfyServer && !/^https?:\/\/[^\s]+$/i.test(ntfyServer)) ntfyServer = null

  let scopes: { bid: string; cid: string }[] = []
  try {
    scopes = JSON.parse(String(formData.get('scopes') ?? '[]'))
  } catch {
    scopes = []
  }

  const rows: (typeof userNotificationPrefs.$inferInsert)[] = []
  for (const s of scopes) {
    const bid = s.bid && UUID.test(s.bid) ? s.bid : null
    const cid = s.cid && UUID.test(s.cid) ? s.cid : null
    for (const event of notifyEvents) {
      for (const channel of notifyChannels) {
        const key = `pref:${s.bid ?? ''}:${s.cid ?? ''}:${event}:${channel}`
        if (formData.get(key) !== 'on') continue
        rows.push({
          userId,
          businessId: bid,
          categoryId: cid,
          event,
          channel,
          enabled: true,
          ntfyTopic: channel === 'ntfy' ? ntfyTopic : null,
          ntfyServer: channel === 'ntfy' ? ntfyServer : null,
        })
      }
    }
  }

  await db.delete(userNotificationPrefs).where(eq(userNotificationPrefs.userId, userId))
  if (rows.length > 0) await db.insert(userNotificationPrefs).values(rows)

  revalidatePath('/settings/notifications')
}
