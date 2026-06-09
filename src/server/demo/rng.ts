// Deterministic, dependency-free PRNG + helpers for the demo dataset.
//
// Everything structural in the demo (team names, subjects, openers, statuses,
// categories, message bodies) is seeded by a FIXED constant — never the date —
// so the synthetic install is byte-stable forever. Only ticket *timestamps*
// derive from "today" (see ./dates), so the whole corpus slides forward one day
// each day while keeping its shape.

// FNV-1a 32-bit string hash → uint32 seed.
export function hashStr(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// mulberry32 — small, fast, well-distributed PRNG returning [0, 1).
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class Rng {
  private next: () => number
  constructor(seed: number | string) {
    this.next = mulberry32(typeof seed === 'string' ? hashStr(seed) : seed)
  }
  float(): number {
    return this.next()
  }
  // Inclusive integer in [min, max].
  int(min: number, max: number): number {
    if (max < min) return min
    return min + Math.floor(this.next() * (max - min + 1))
  }
  bool(p = 0.5): boolean {
    return this.next() < p
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]
  }
  // Weighted pick: entries are [value, weight] pairs (weights need not sum to 1).
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    let total = 0
    for (const [, w] of entries) total += w
    let r = this.next() * total
    for (const [v, w] of entries) {
      r -= w
      if (r <= 0) return v
    }
    return entries[entries.length - 1][0]
  }
  // Fisher–Yates shuffle of a copy.
  shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice()
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1))
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
  // Pick `n` distinct items (or all of them if n >= length).
  sample<T>(arr: readonly T[], n: number): T[] {
    return this.shuffle(arr).slice(0, Math.max(0, Math.min(n, arr.length)))
  }
  // A deterministic 18-digit, snowflake-shaped string. Parses as a BigInt so
  // `avatarUrl()`'s default-avatar index math works on it.
  snowflake(): string {
    let s = String(this.int(1, 9))
    for (let i = 0; i < 17; i++) s += String(this.int(0, 9))
    return s
  }
}

// The one structural seed. Bump the suffix to regenerate the whole demo.
export const DEMO_SEED = 'euphoric-demo-v1'

// A stable sub-stream for a named entity, e.g. rngFor('ticket', teamId, n).
// Order-independent: each entity reproduces the same values regardless of when
// it's generated, which is what lets per-ticket detail be generated lazily.
export function rngFor(...parts: (string | number)[]): Rng {
  return new Rng(hashStr([DEMO_SEED, ...parts].join(':')))
}
