// In-process sliding-window rate limiter for the Integration API (plan §4.2):
//   • 60 requests / minute per key, 10 opens / minute per key;
//   • failed-auth (401) attempts per client IP.
//
// State is per process. tickets-web runs as a single container, and these
// limits are abuse brakes rather than billing, so in-memory is proportionate.
// Each key's log is capped at `limit` timestamps, and the map is pruned when
// it grows.

export type LimitResult = { allowed: boolean; retryAfterSec: number }

export class SlidingWindowLimiter {
  private readonly logs = new Map<string, number[]>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  private live(key: string, t: number): number[] {
    const log = this.logs.get(key)
    if (!log) return []
    const cutoff = t - this.windowMs
    let i = 0
    while (i < log.length && log[i]! <= cutoff) i++
    const kept = i === 0 ? log : log.slice(i)
    if (kept.length === 0) this.logs.delete(key)
    else if (kept !== log) this.logs.set(key, kept)
    return kept
  }

  private retryAfter(log: number[], t: number): number {
    return Math.max(1, Math.ceil((log[0]! + this.windowMs - t) / 1000))
  }

  // Would a hit now be refused? Does not record anything.
  check(key: string): LimitResult {
    const t = this.now()
    const log = this.live(key, t)
    if (log.length >= this.limit) return { allowed: false, retryAfterSec: this.retryAfter(log, t) }
    return { allowed: true, retryAfterSec: 0 }
  }

  // Record a hit if under the limit; refused hits are not recorded.
  hit(key: string): LimitResult {
    const t = this.now()
    const log = this.live(key, t)
    if (log.length >= this.limit) return { allowed: false, retryAfterSec: this.retryAfter(log, t) }
    const next = log.length ? [...log, t] : [t]
    this.logs.set(key, next)
    if (this.logs.size > 10_000) this.prune(t)
    return { allowed: true, retryAfterSec: 0 }
  }

  private prune(t: number): void {
    for (const key of [...this.logs.keys()]) this.live(key, t)
  }

  reset(): void {
    this.logs.clear()
  }
}

// Client IP for per-IP limiting: `cf-connecting-ip`, then the first
// `x-forwarded-for` hop. Next's Node server fills `x-forwarded-for` from the
// socket when the client sent none, so a header-less caller still gets its
// real address. Both headers are caller-controlled on the internal docker
// networks; this is a brute-force brake, not an identity.
export function clientIp(headers: Headers): string {
  const cf = headers.get('cf-connecting-ip')?.trim()
  if (cf) return cf.slice(0, 64)
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first.slice(0, 64)
  }
  return 'unknown'
}

export const RATE = {
  perKeyPerMin: 60,
  opensPerKeyPerMin: 10,
  authFailuresPerIp: 20,
  authFailureWindowMs: 10 * 60_000,
} as const

type Limiters = { perKey: SlidingWindowLimiter; opens: SlidingWindowLimiter; authFail: SlidingWindowLimiter }

declare global {
  var __integrationLimiters: Limiters | undefined
}

// One shared set per process (survives dev hot-reload).
export function limiters(): Limiters {
  if (!globalThis.__integrationLimiters) {
    globalThis.__integrationLimiters = {
      perKey: new SlidingWindowLimiter(RATE.perKeyPerMin, 60_000),
      opens: new SlidingWindowLimiter(RATE.opensPerKeyPerMin, 60_000),
      authFail: new SlidingWindowLimiter(RATE.authFailuresPerIp, RATE.authFailureWindowMs),
    }
  }
  return globalThis.__integrationLimiters
}
