// In-process sliding-window rate limiter for the Integration API (plan §4.2):
//   • 60 requests / minute per key, 10 opens / minute per key;
//   • failed-auth attempts per client bucket (see clientBucket below).
//
// State is per process. tickets-web runs as a single container, and these
// limits are abuse brakes rather than billing, so in-memory is proportionate.
//
// Cost model (every call is O(limit + pruneBatch), never O(number of keys)):
//   • each key's log holds at most `limit` timestamps;
//   • the map holds at most `maxKeys` keys: inserting a new key when full
//     evicts the oldest one (Map insertion order);
//   • a key is re-inserted on every RECORDED hit, so Map order is the order of
//     each key's most recent hit. The head of the map therefore holds the
//     stalest key, and pruning walks from the head only: each hit examines at
//     most `pruneBatch` head keys and stops at the first one still live. No
//     hit ever scans the whole map (the previous per-hit O(N) prune made a
//     flood of distinct keys a CPU amplifier).

import { isIP } from 'node:net'

export type LimitResult = { allowed: boolean; retryAfterSec: number }

export type LimiterOptions = {
  maxKeys?: number
  pruneBatch?: number
}

export const DEFAULT_MAX_KEYS = 10_000
const DEFAULT_PRUNE_BATCH = 8

export class SlidingWindowLimiter {
  private readonly logs = new Map<string, number[]>()
  private readonly maxKeys: number
  private readonly pruneBatch: number
  // Work counters: keys examined for pruning/eviction on the last hit and on
  // the most expensive hit so far. Tests assert the per-hit bound with these.
  readonly stats = { lastHitWork: 0, maxHitWork: 0, evictions: 0 }

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    opts: LimiterOptions = {},
  ) {
    this.maxKeys = Math.max(1, opts.maxKeys ?? DEFAULT_MAX_KEYS)
    this.pruneBatch = Math.max(1, opts.pruneBatch ?? DEFAULT_PRUNE_BATCH)
  }

  get size(): number {
    return this.logs.size
  }

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

  // Drop fully expired keys from the head (stalest first). Bounded work.
  private pruneHead(t: number): number {
    const cutoff = t - this.windowMs
    let examined = 0
    for (const [key, log] of this.logs) {
      if (examined >= this.pruneBatch) break
      examined++
      if (log[log.length - 1]! > cutoff) break // the stalest key is live, so all are
      this.logs.delete(key)
    }
    return examined
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
    if (log.length >= this.limit) {
      this.stats.lastHitWork = 0
      return { allowed: false, retryAfterSec: this.retryAfter(log, t) }
    }
    const next = log.length ? [...log, t] : [t]
    let work = 0
    // Move the key to the tail (most recent). When the map is full, evict the
    // oldest key first; size never exceeds maxKeys, so this runs at most once.
    this.logs.delete(key)
    while (this.logs.size >= this.maxKeys) {
      const oldest = this.logs.keys().next().value
      if (oldest === undefined) break
      this.logs.delete(oldest)
      this.stats.evictions++
      work++
    }
    this.logs.set(key, next)
    work += this.pruneHead(t)
    this.stats.lastHitWork = work
    if (work > this.stats.maxHitWork) this.stats.maxHitWork = work
    return { allowed: true, retryAfterSec: 0 }
  }

  reset(): void {
    this.logs.clear()
  }
}

// ---- client bucket for the failed-auth brake --------------------------------
//
// Choice (documented in docs/INTEGRATION_API.md): tickets-web cannot see the
// socket peer from an App Router handler, and Next's server only fills
// `x-forwarded-for` from the socket when the caller sent none. /api/v1 is
// served to direct callers on the internal docker networks, with no proxy of
// ours in front, so `cf-connecting-ip` and `x-forwarded-for` are whatever the
// caller chose. They are therefore IGNORED unless
// INTEGRATION_TRUST_PROXY_HEADERS is `1`/`true`. Set that only when a proxy
// you control sits in front of /api/v1 and overwrites both headers.
//
// Untrusted (the default): every failing request shares ONE bucket,
// `untrusted`. That is safe because the brake only ever applies to requests
// that already failed authentication: a valid, enabled key is never blocked
// (auth.ts verifies the key before it consults the brake).
//
// Trusted: `cf-connecting-ip`, else the first `x-forwarded-for` hop, must be a
// literal IP address. IPv4 is keyed per address and IPv6 per /64 (one host
// usually owns a whole /64); IPv4-mapped IPv6 collapses to the IPv4 address.
// Anything unparseable shares the `invalid` bucket, so arbitrary header text
// never becomes a map key.

export const UNTRUSTED_BUCKET = 'untrusted'

export function trustProxyHeaders(env: Record<string, string | undefined> = process.env): boolean {
  const v = (env.INTEGRATION_TRUST_PROXY_HEADERS ?? '').trim().toLowerCase()
  return v === '1' || v === 'true'
}

// IPv6 text → 8 hextets (the input has already passed isIP(...) === 6).
function ipv6Hextets(addr: string): number[] | null {
  let a = addr
  const lastColon = a.lastIndexOf(':')
  const tail = a.slice(lastColon + 1)
  if (tail.includes('.')) {
    if (isIP(tail) !== 4) return null
    const p = tail.split('.').map(Number)
    a = `${a.slice(0, lastColon + 1)}${((p[0]! << 8) | p[1]!).toString(16)}:${((p[2]! << 8) | p[3]!).toString(16)}`
  }
  const halves = a.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  let groups: string[]
  if (halves.length === 1) {
    groups = head
  } else {
    const fill = 8 - head.length - rest.length
    if (fill < 0) return null
    groups = [...head, ...Array<string>(fill).fill('0'), ...rest]
  }
  if (groups.length !== 8) return null
  const out = groups.map((g) => parseInt(g, 16))
  return out.every((n) => Number.isInteger(n) && n >= 0 && n <= 0xffff) ? out : null
}

// A literal IP → its limiter bucket; anything else → 'invalid'.
export function ipBucket(raw: string): string {
  let ip = raw.trim()
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1)
  const zone = ip.indexOf('%')
  if (zone >= 0) ip = ip.slice(0, zone)
  const kind = isIP(ip)
  if (kind === 4) return ip
  if (kind !== 6) return 'invalid'
  const h = ipv6Hextets(ip)
  if (!h) return 'invalid'
  if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
    return `${h[6]! >> 8}.${h[6]! & 0xff}.${h[7]! >> 8}.${h[7]! & 0xff}`
  }
  return `${h.slice(0, 4).map((g) => g.toString(16)).join(':')}::/64`
}

export function clientBucket(headers: Headers, trusted: boolean = trustProxyHeaders()): string {
  if (!trusted) return UNTRUSTED_BUCKET
  const cf = headers.get('cf-connecting-ip')?.trim()
  if (cf) return ipBucket(cf.slice(0, 64))
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return ipBucket(first.slice(0, 64))
  }
  return 'unknown'
}

export const RATE = {
  perKeyPerMin: 60,
  opensPerKeyPerMin: 10,
  authFailuresPerBucket: 20,
  authFailureWindowMs: 10 * 60_000,
  authFailureMaxBuckets: DEFAULT_MAX_KEYS,
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
      authFail: new SlidingWindowLimiter(RATE.authFailuresPerBucket, RATE.authFailureWindowMs, Date.now, {
        maxKeys: RATE.authFailureMaxBuckets,
      }),
    }
  }
  return globalThis.__integrationLimiters
}
