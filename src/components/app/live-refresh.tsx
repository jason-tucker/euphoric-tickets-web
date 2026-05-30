'use client'

// P7 (lantern) — tiny live-refresh listener. Opens an SSE stream for the
// ticket; on a `refresh` event it calls router.refresh() to re-run the
// server component (so message rendering, attachments, and permission
// filtering all stay server-side). Falls back to 5s polling if the stream
// errors, and refreshes on tab focus to catch anything missed while hidden.

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function LiveRefresh({ ticketId }: { ticketId: number }) {
  const router = useRouter()

  useEffect(() => {
    let es: EventSource | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let closed = false

    const refresh = () => router.refresh()

    const startPolling = () => {
      if (!pollTimer) pollTimer = setInterval(refresh, 5000)
    }
    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    }

    const connect = () => {
      if (closed) return
      es = new EventSource(`/api/tickets/${ticketId}/messages/stream`)
      es.addEventListener('open', stopPolling)
      es.addEventListener('refresh', refresh)
      es.onerror = () => {
        es?.close()
        es = null
        if (closed) return
        startPolling() // cover the gap while disconnected
        if (!reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null
            connect()
          }, 8000)
        }
      }
    }

    connect()

    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      closed = true
      es?.close()
      stopPolling()
      if (reconnectTimer) clearTimeout(reconnectTimer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [ticketId, router])

  return null
}
