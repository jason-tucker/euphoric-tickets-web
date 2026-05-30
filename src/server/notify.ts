import 'server-only'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { db } from '@/db/client'
import { tickets, users, userNotificationPrefs, type NotifyEvent } from '@/db/schema'

// P13 (lantern) — notification dispatcher. Both the web (reply/open server
// actions) and the bot (via /api/internal/notify) call this. It reads
// user_notification_prefs and fans out to ntfy (HTTP POST) and/or Discord DM
// (POST to the bot's /api/internal/dm). Entirely best-effort.

export type NotifyContext = {
  event: NotifyEvent
  businessId: string
  categoryId: string | null
  ticketId: number
  subject: string
  slug: string
  actorUserId?: string | null
}

const NTFY_BASE = process.env.NTFY_BASE_URL ?? 'https://ntfy.sh'

// Best-effort ntfy publish.
async function postNtfy(topic: string, title: string, body: string, clickUrl: string): Promise<void> {
  try {
    await fetch(`${NTFY_BASE}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: { Title: title, Click: clickUrl },
      body,
    })
  } catch (err) {
    console.error('[notify] ntfy failed', err)
  }
}

// Best-effort DM via the bot's internal endpoint.
async function postBotDm(discordUserId: string, content: string): Promise<void> {
  const token = process.env.INTERNAL_TOKEN
  const base = process.env.BOT_INTERNAL_URL // e.g. http://euphoric-tickets:8787
  if (!token || !base) return
  try {
    await fetch(`${base}/api/internal/dm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': token },
      body: JSON.stringify({ discordUserId, content }),
    })
  } catch (err) {
    console.error('[notify] bot DM failed', err)
  }
}

// Returns the most-specific enabled pref per channel for a user + event.
function pickPrefs(
  rows: Array<{ businessId: string | null; categoryId: string | null; channel: string; enabled: boolean; ntfyTopic: string | null }>,
) {
  // Specificity: category-scoped > business-scoped > global.
  const score = (r: { businessId: string | null; categoryId: string | null }) =>
    (r.categoryId ? 2 : 0) + (r.businessId ? 1 : 0)
  const best: Record<string, (typeof rows)[number]> = {}
  for (const r of rows) {
    const cur = best[r.channel]
    if (!cur || score(r) > score(cur)) best[r.channel] = r
  }
  return best
}

export async function notify(ctx: NotifyContext): Promise<void> {
  const { event, businessId, categoryId, ticketId, subject, slug, actorUserId } = ctx

  // Build the recipient set.
  let recipientIds: string[] = []
  if (event === 'new_ticket') {
    const rows = await db
      .selectDistinct({ userId: userNotificationPrefs.userId })
      .from(userNotificationPrefs)
      .where(
        and(
          eq(userNotificationPrefs.event, 'new_ticket'),
          eq(userNotificationPrefs.enabled, true),
          or(isNull(userNotificationPrefs.businessId), eq(userNotificationPrefs.businessId, businessId)),
          or(
            isNull(userNotificationPrefs.categoryId),
            categoryId ? eq(userNotificationPrefs.categoryId, categoryId) : isNull(userNotificationPrefs.categoryId),
          ),
        ),
      )
    recipientIds = rows.map((r) => r.userId)
  } else if (event === 'reply') {
    const [t] = await db
      .select({ opener: tickets.openerUserId, assignee: tickets.assigneeUserId })
      .from(tickets)
      .where(eq(tickets.id, ticketId))
      .limit(1)
    if (t) recipientIds = [t.opener, t.assignee].filter((x): x is string => !!x)
  }

  recipientIds = [...new Set(recipientIds)].filter((id) => id && id !== actorUserId)
  if (recipientIds.length === 0) return

  const clickUrl = `${process.env.PUBLIC_BASE_URL ?? 'https://tickets.euphoric.fm'}/b/${slug}/tickets/${ticketId}`
  const title = event === 'new_ticket' ? `New ticket #${ticketId}` : `Reply on ticket #${ticketId}`
  const body = subject.slice(0, 200)

  // Resolve discord ids for DM, in one query.
  const recips = await db
    .select({ id: users.id, discordId: users.discordId })
    .from(users)
    .where(inArray(users.id, recipientIds))
  const discordById = new Map(recips.map((r) => [r.id, r.discordId]))

  for (const uid of recipientIds) {
    const prefRows = await db
      .select({
        businessId: userNotificationPrefs.businessId,
        categoryId: userNotificationPrefs.categoryId,
        channel: userNotificationPrefs.channel,
        enabled: userNotificationPrefs.enabled,
        ntfyTopic: userNotificationPrefs.ntfyTopic,
      })
      .from(userNotificationPrefs)
      .where(
        and(
          eq(userNotificationPrefs.userId, uid),
          eq(userNotificationPrefs.event, event),
          eq(userNotificationPrefs.enabled, true),
          or(isNull(userNotificationPrefs.businessId), eq(userNotificationPrefs.businessId, businessId)),
          or(
            isNull(userNotificationPrefs.categoryId),
            categoryId ? eq(userNotificationPrefs.categoryId, categoryId) : isNull(userNotificationPrefs.categoryId),
          ),
        ),
      )
    if (prefRows.length === 0) continue
    const best = pickPrefs(prefRows)

    if (best.ntfy?.ntfyTopic) {
      await postNtfy(best.ntfy.ntfyTopic, title, body, clickUrl)
    }
    if (best.dm) {
      const did = discordById.get(uid)
      if (did) await postBotDm(did, `**${title}** — ${body}\n${clickUrl}`)
    }
  }
}
