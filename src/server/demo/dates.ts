// Date algorithm for the demo. Each ticket carries a FIXED structural offset
// chosen at generation time (date-independent); we PROJECT it against the
// current date on every request. Fixed offset + advancing "now" ⇒ the whole
// corpus slides forward one day each day, and the "today" cluster is always
// genuinely today — so there's fresh data every day without ever mutating
// anything.

import type { Rng } from './rng'

export const DAY_MS = 86_400_000
export const MIN_MS = 60_000

// ~3 years of spread for the oldest tickets.
export const SPREAD_DAYS = 365 * 3

// Local-server-tz day key (YYYY-MM-DD) — only used to memoize cheap per-request
// work, never baked into the structural dataset.
export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function startOfToday(now: Date = new Date()): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

// The fixed, structural offset for one ticket. Never changes; only the
// projection moves.
export type TicketOffset = {
  openDaysAgo: number // whole days before today the ticket opened (0 = today cluster)
  openMinute: number // minute-of-day jitter [0, 1439]
  activityMins: number // minutes from open to last activity (≥ 0)
}

// Build a ticket's fixed offset. `todayCluster` forces openDaysAgo = 0 so a slice
// of every team is always "today". The spread is biased toward recent (pow 2.2)
// so the last ~3 years are covered, denser near now.
export function makeOffset(rng: Rng, todayCluster: boolean): TicketOffset {
  if (todayCluster) {
    return { openDaysAgo: 0, openMinute: rng.int(0, 1439), activityMins: rng.int(0, 600) }
  }
  const openDaysAgo = Math.max(1, Math.floor(Math.pow(rng.float(), 2.2) * SPREAD_DAYS))
  const openMinute = rng.int(0, 1439)
  // Activity window grows with age but stays bounded so "last activity" varies.
  const windowDays = Math.min(openDaysAgo, rng.int(0, 30))
  const activityMins = rng.int(0, windowDays * 1440 + 720)
  return { openDaysAgo, openMinute, activityMins }
}

// Projected open time, clamped to strictly before now.
export function projectOpenedAt(off: TicketOffset, now: Date = new Date()): Date {
  const base = startOfToday(now)
  const t = base - off.openDaysAgo * DAY_MS + off.openMinute * MIN_MS
  return new Date(Math.min(t, now.getTime() - MIN_MS))
}

// Projected last-activity time: open + activity window, clamped to now and never
// before open.
export function projectLastActivityAt(off: TicketOffset, now: Date = new Date()): Date {
  const opened = projectOpenedAt(off, now).getTime()
  const t = Math.min(opened + off.activityMins * MIN_MS, now.getTime())
  return new Date(Math.max(t, opened))
}
