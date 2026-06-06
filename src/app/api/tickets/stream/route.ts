// Global live-refresh SSE for the tickets console. Mirrors the per-ticket
// stream (`/api/tickets/[id]/messages/stream`) but is ticket-agnostic: any
// `ticket_activity` NOTIFY (a message insert or a ticket-row update, anywhere)
// forwards a single `refresh` event. The client debounces, then refetches
// `/api/tickets/list`, which re-applies per-user scope — so no row data and no
// ids cross this stream.

import { pgClient, ensureNotifyTriggers } from '@/db/client'
import { auth } from '@/server/auth'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return new Response('unauthorized', { status: 401 })

  await ensureNotifyTriggers().catch(() => {})

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
        // postgres-js fans one LISTEN connection out to every callback, so many
        // console viewers share a single dedicated connection.
        const handle = await pgClient.listen('ticket_activity', () => {
          send('event: refresh\ndata: 1\n\n')
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
