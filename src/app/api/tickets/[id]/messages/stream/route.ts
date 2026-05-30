// P7 (lantern) — live-refresh SSE stream.
//
// GET /api/tickets/<id>/messages/stream
//
// Permission-checked (must be able to see the ticket), then LISTENs on the
// Postgres `ticket_activity` channel. When a message is inserted or the
// ticket row changes (triggers in db/client.ts), Postgres notifies with the
// ticket id; we forward a `refresh` event and the client calls
// router.refresh() to re-run the server component. No row data crosses the
// stream — the SSR render stays the single source of truth.

import { eq } from 'drizzle-orm'
import { db, pgClient, ensureNotifyTriggers } from '@/db/client'
import { businesses, tickets } from '@/db/schema'
import { auth } from '@/server/auth'
import { resolveBusinessAccess, resolveTicketAccess } from '@/server/permissions'

export const dynamic = 'force-dynamic'

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const ticketId = Number(id)
  if (!Number.isInteger(ticketId)) return new Response('bad id', { status: 400 })

  const session = await auth()
  if (!session?.user?.id) return new Response('unauthorized', { status: 401 })

  const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1)
  if (!t) return new Response('not found', { status: 404 })
  const [biz] = await db.select().from(businesses).where(eq(businesses.id, t.businessId)).limit(1)
  if (!biz) return new Response('not found', { status: 404 })

  const resolved = await resolveBusinessAccess(biz.slug)
  if (!resolved) return new Response('forbidden', { status: 403 })
  const flags = await resolveTicketAccess({
    business: resolved.business,
    level: resolved.level,
    ticket: { id: t.id, openerUserId: t.openerUserId, categoryId: t.categoryId },
    session: { user: { id: session.user.id, discordId: session.user.discordId } },
  })
  if (!flags.canSee) return new Response('forbidden', { status: 403 })

  await ensureNotifyTriggers().catch(() => {})

  const target = String(ticketId)
  const encoder = new TextEncoder()
  let unlisten: (() => Promise<void>) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null

  const stream = new ReadableStream({
    async start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(encoder.encode(s))
        } catch {
          /* stream closed */
        }
      }
      send('retry: 5000\n\n')
      try {
        const handle = await pgClient.listen('ticket_activity', (payload) => {
          if (payload === target) send('event: refresh\ndata: 1\n\n')
        })
        unlisten = handle.unlisten
      } catch {
        // If LISTEN can't be established the client's polling fallback covers it.
      }
      // Heartbeat keeps proxies (cloudflared / Caddy) from closing an idle stream.
      heartbeat = setInterval(() => send(': ping\n\n'), 25000)
    },
    async cancel() {
      if (heartbeat) clearInterval(heartbeat)
      if (unlisten) await unlisten().catch(() => {})
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
