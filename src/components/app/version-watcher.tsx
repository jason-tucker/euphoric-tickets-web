'use client'

import * as React from 'react'
import { toast } from 'sonner'

// Polls /api/version; when the running build id changes (a new image deployed),
// shows a sticky toast asking the user to reload so they pick up the new client
// bundle. Fires at most once per page load. Pauses polling while the tab is
// hidden to avoid pointless background fetches.
export function VersionWatcher() {
  React.useEffect(() => {
    let baseline: string | null = null
    let prompted = false
    let stopped = false

    async function check() {
      if (stopped || prompted || document.visibilityState !== 'visible') return
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const { build } = (await res.json()) as { build?: string }
        if (!build) return
        if (baseline === null) {
          baseline = build
          return
        }
        if (build !== baseline) {
          prompted = true
          toast('A new version is available', {
            description: 'Reload to get the latest update.',
            duration: Infinity,
            action: { label: 'Reload', onClick: () => window.location.reload() },
          })
        }
      } catch {
        // network blip — try again next tick
      }
    }

    void check()
    const id = setInterval(check, 60_000)
    const onVisible = () => void check()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  return null
}
