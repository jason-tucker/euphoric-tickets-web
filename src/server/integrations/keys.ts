// Integration API keys: `etk.<prefix10>.<secret43>` (plan §4.2).
//
//   prefix — 10 base62 chars (CSPRNG, rejection-sampled). Stored in clear as
//            `integrations.key_prefix`; it is only a lookup handle.
//   secret — 32 CSPRNG bytes rendered as exactly 43 base62 chars
//            (62^43 > 2^256, so every 32-byte value fits). Only sha256(secret)
//            is stored (`integrations.key_hash`, hex).
//
// Verification always performs exactly one sha256 + one timingSafeEqual,
// including for an unknown prefix (compared against a fixed dummy hash), so
// "no such prefix" and "wrong secret" are indistinguishable by timing.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
export const KEY_PREFIX_LEN = 10
export const KEY_SECRET_LEN = 43
export const KEY_RE = /^etk\.([0-9A-Za-z]{10})\.([0-9A-Za-z]{43})$/

// Encode bytes as a fixed-width base62 string (left-padded with '0').
export function base62Encode(bytes: Uint8Array, width: number): string {
  let n = BigInt('0x' + (Buffer.from(bytes).toString('hex') || '0'))
  let out = ''
  while (n > 0n) {
    out = BASE62[Number(n % 62n)] + out
    n /= 62n
  }
  if (out.length > width) throw new Error('base62 value exceeds width')
  return out.padStart(width, '0')
}

// Uniform random base62 string: bytes >= 248 (= 4*62) are rejected so the
// modulo does not bias the low characters.
export function randomBase62(len: number): string {
  let out = ''
  while (out.length < len) {
    for (const b of randomBytes(len * 2)) {
      if (b < 248) out += BASE62[b % 62]
      if (out.length === len) break
    }
  }
  return out
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

export type GeneratedKey = { key: string; prefix: string; secret: string; hash: string }

export function generateIntegrationKey(): GeneratedKey {
  const prefix = randomBase62(KEY_PREFIX_LEN)
  const secret = base62Encode(randomBytes(32), KEY_SECRET_LEN)
  return { key: `etk.${prefix}.${secret}`, prefix, secret, hash: hashSecret(secret) }
}

export type ParsedKey = { prefix: string; secret: string }

export function parseIntegrationKey(raw: string | null | undefined): ParsedKey | null {
  if (!raw) return null
  const m = KEY_RE.exec(raw)
  return m ? { prefix: m[1]!, secret: m[2]! } : null
}

// `Authorization: Bearer etk.…` → parsed key, or null.
export function parseAuthorizationHeader(header: string | null | undefined): ParsedKey | null {
  if (!header) return null
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header)
  return m ? parseIntegrationKey(m[1]) : null
}

// sha256 of a value no real secret can produce a match for in practice; used
// so an unknown prefix still costs one hash + one constant-time compare.
const DUMMY_HASH = Buffer.from(hashSecret('etk-dummy-comparison-value'), 'hex')

// Constant-time check of `providedSecret` against a stored hex sha256.
// `storedHashHex` null (unknown prefix) or malformed → dummy compare → false.
export function verifySecret(providedSecret: string, storedHashHex: string | null | undefined): boolean {
  const provided = createHash('sha256').update(providedSecret, 'utf8').digest()
  let stored = DUMMY_HASH
  let real = false
  if (storedHashHex && /^[0-9a-f]{64}$/i.test(storedHashHex)) {
    stored = Buffer.from(storedHashHex, 'hex')
    real = true
  }
  const equal = timingSafeEqual(provided, stored)
  return real && equal
}

// Webhook signing secret handed to the receiver (shown once in the admin UI).
export function generateWebhookSecret(): string {
  return randomBytes(32).toString('base64url')
}
