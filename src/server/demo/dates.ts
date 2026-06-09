// Date algorithm for the demo. Each ticket carries a FIXED structural offset
// expressed in milliseconds-ago (date-independent); we PROJECT it against the
// current time on every request. Anchoring to `now` means the corpus slides
// forward continuously — always genuinely fresh data — and, because the offsets
// carry millisecond precision, every ticket gets a DISTINCT timestamp, so
// nothing piles up at a single instant (the old absolute-time clamp made
// hundreds of tickets share `now`, which then sorted into per-team blocks).

import type { Rng } from './rng'

export const DAY_MS = 86_400_000
export const MIN_MS = 60_000

// ~3 years of spread for the oldest tickets.
export const SPREAD_DAYS = 365 * 3
const MAX_WINDOW_MIN = 30 * 1440 + 720 // active window cap (~30 days)

// Local-server-tz day key (YYYY-MM-DD). Handy for cheap per-day memoization.
export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// Fixed structural offset for one ticket. `openedAgoMs` = how long before now it
// opened; `activeMs` = how long after opening the last activity was (0 ≤ activeMs
// < openedAgoMs), so opened ≤ last < now after projection.
export type TicketOffset = {
  openedAgoMs: number
  activeMs: number
}

// `todayCluster` lands the ticket within the last ~16h (reads as "today/fresh");
// otherwise it's spread over the last ~3 years, biased toward recent (pow 2.2).
// Minute base + a seconds jitter keep every opening on a distinct millisecond.
export function makeOffset(rng: Rng, todayCluster: boolean): TicketOffset {
  let opensAgoMin: number
  if (todayCluster) {
    opensAgoMin = rng.int(5, 16 * 60)
  } else {
    const days = Math.max(1, Math.floor(Math.pow(rng.float(), 2.2) * SPREAD_DAYS))
    opensAgoMin = days * 1440 + rng.int(0, 1439)
  }
  const openedAgoMs = opensAgoMin * MIN_MS + rng.int(0, 59) * 1000

  // Active window: time from open to last activity, bounded and strictly less
  // than the ticket's age (so an old ticket doesn't show activity "just now",
  // and last activity always lands before now).
  const windowMin = rng.int(0, Math.min(opensAgoMin - 1, MAX_WINDOW_MIN))
  const activeMs = windowMin * MIN_MS + rng.int(0, 59) * 1000

  return { openedAgoMs, activeMs }
}

// Whole days since opening — derived from the fixed offset (drives the status mix).
export function openDaysAgo(off: TicketOffset): number {
  return Math.floor(off.openedAgoMs / DAY_MS)
}

export function projectOpenedAt(off: TicketOffset, now: Date = new Date()): Date {
  return new Date(now.getTime() - off.openedAgoMs)
}

export function projectLastActivityAt(off: TicketOffset, now: Date = new Date()): Date {
  return new Date(now.getTime() - off.openedAgoMs + off.activeMs)
}
