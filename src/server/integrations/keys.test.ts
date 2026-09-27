import { describe, expect, it } from 'vitest'
import {
  BASE62,
  KEY_RE,
  base62Encode,
  generateIntegrationKey,
  generateWebhookSecret,
  hashSecret,
  parseAuthorizationHeader,
  parseIntegrationKey,
  randomBase62,
  verifySecret,
} from './keys'

describe('integration keys', () => {
  it('generates etk.<prefix10>.<secret43> in base62 and stores only sha256(secret)', () => {
    const k = generateIntegrationKey()
    expect(k.key).toMatch(KEY_RE)
    expect(k.prefix).toHaveLength(10)
    expect(k.secret).toHaveLength(43)
    expect(k.key).toBe(`etk.${k.prefix}.${k.secret}`)
    expect(k.hash).toBe(hashSecret(k.secret))
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(k.hash).not.toContain(k.secret)
  })

  it('is unique across generations', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateIntegrationKey().key))
    expect(seen.size).toBe(200)
  })

  it('fits every 32-byte value into exactly 43 base62 chars', () => {
    expect(base62Encode(new Uint8Array(32).fill(0xff), 43)).toHaveLength(43)
    expect(base62Encode(new Uint8Array(32), 43)).toBe('0'.repeat(43))
    expect(() => base62Encode(new Uint8Array(33).fill(0xff), 43)).toThrow()
  })

  it('draws random prefixes from the base62 alphabet only', () => {
    const s = randomBase62(2000)
    expect(s).toHaveLength(2000)
    for (const ch of s) expect(BASE62).toContain(ch)
  })

  it('parses only well-formed keys and Bearer headers', () => {
    const k = generateIntegrationKey()
    expect(parseIntegrationKey(k.key)).toEqual({ prefix: k.prefix, secret: k.secret })
    expect(parseAuthorizationHeader(`Bearer ${k.key}`)).toEqual({ prefix: k.prefix, secret: k.secret })
    expect(parseAuthorizationHeader(`bearer ${k.key}`)).not.toBeNull()
    for (const bad of [
      '',
      k.key,
      `Basic ${k.key}`,
      `Bearer ${k.key}x`,
      `Bearer etk.${k.prefix}.${k.secret.slice(1)}`,
      `Bearer etk.${k.prefix.slice(1)}.${k.secret}`,
      `Bearer etk.${k.prefix}.${k.secret.slice(1)}!`,
      `Bearer ${k.key} extra`,
    ]) {
      expect(parseAuthorizationHeader(bad), bad).toBeNull()
    }
  })

  it('verifies with a constant-time compare and fails closed', () => {
    const k = generateIntegrationKey()
    expect(verifySecret(k.secret, k.hash)).toBe(true)
    expect(verifySecret(k.secret, k.hash.toUpperCase())).toBe(true)
    expect(verifySecret(k.secret.slice(0, -1) + (k.secret.endsWith('0') ? '1' : '0'), k.hash)).toBe(false)
    // Unknown prefix → dummy compare, never true.
    expect(verifySecret(k.secret, null)).toBe(false)
    expect(verifySecret('', null)).toBe(false)
    // Malformed stored hash → dummy compare, never true.
    expect(verifySecret(k.secret, 'not-a-hash')).toBe(false)
    expect(verifySecret(k.secret, k.hash.slice(2))).toBe(false)
  })

  it('makes 43-char base64url webhook secrets', () => {
    const s = generateWebhookSecret()
    expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(generateWebhookSecret()).not.toBe(s)
  })
})
