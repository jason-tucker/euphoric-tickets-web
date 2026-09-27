import { createHmac, randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { IntegrationCryptoError, decryptSecret, encryptSecret, parseEncKey } from './crypto'
import { computeSignature, signatureHeader, verifySignatureHeader } from './signature'

describe('webhook secret encryption (AES-256-GCM)', () => {
  const key = randomBytes(32)

  it('round-trips and uses a fresh IV each time', () => {
    const a = encryptSecret('s3cret', 'integration-a', key)
    const b = encryptSecret('s3cret', 'integration-a', key)
    expect(a).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/)
    expect(a).not.toBe(b)
    expect(a).not.toContain('s3cret')
    expect(decryptSecret(a, 'integration-a', key)).toBe('s3cret')
  })

  it('binds the ciphertext to the integration id (AAD)', () => {
    const enc = encryptSecret('s3cret', 'integration-a', key)
    expect(() => decryptSecret(enc, 'integration-b', key)).toThrow(IntegrationCryptoError)
  })

  it('rejects tampering and a wrong key', () => {
    const enc = encryptSecret('s3cret', 'id', key)
    const parts = enc.split(':')
    const ct = Buffer.from(parts[3]!, 'base64url')
    ct[0] ^= 1
    const tampered = [parts[0], parts[1], parts[2], ct.toString('base64url')].join(':')
    expect(() => decryptSecret(tampered, 'id', key)).toThrow(IntegrationCryptoError)
    expect(() => decryptSecret(enc, 'id', randomBytes(32))).toThrow(IntegrationCryptoError)
    expect(() => decryptSecret('v2:a:b:c', 'id', key)).toThrow(IntegrationCryptoError)
  })

  it('accepts only 32-byte keys (base64 or hex)', () => {
    const raw = randomBytes(32)
    expect(parseEncKey(raw.toString('base64')).equals(raw)).toBe(true)
    expect(parseEncKey(raw.toString('base64url')).equals(raw)).toBe(true)
    expect(parseEncKey(raw.toString('hex')).equals(raw)).toBe(true)
    expect(() => parseEncKey(undefined)).toThrow(IntegrationCryptoError)
    expect(() => parseEncKey(randomBytes(16).toString('base64'))).toThrow(IntegrationCryptoError)
    expect(() => parseEncKey('not a key')).toThrow(IntegrationCryptoError)
  })
})

describe('X-Euphoric-Signature', () => {
  const secret = 'test-secret-value'
  const deliveryId = '0f8fad5b-d9cb-469f-a165-70867728950e'
  const body = '{"event":"message.created","ticketId":1}'

  it('is t=<unix>,v1=<hex HMAC-SHA256(secret, `${t}.${deliveryId}.${rawBody}`)>', () => {
    const t = 1_790_000_000
    const expected = createHmac('sha256', secret).update(`${t}.${deliveryId}.${body}`).digest('hex')
    expect(computeSignature(secret, t, deliveryId, body)).toBe(expected)
    expect(signatureHeader(secret, t, deliveryId, body)).toBe(`t=${t},v1=${expected}`)
  })

  it('verifies within ±300 s and rejects skew, tampering, and a different delivery id', () => {
    const t = 1_790_000_000
    const header = signatureHeader(secret, t, deliveryId, body)
    expect(verifySignatureHeader({ secret, header, deliveryId, rawBody: body, nowSec: t + 299 })).toBe(true)
    expect(verifySignatureHeader({ secret, header, deliveryId, rawBody: body, nowSec: t + 301 })).toBe(false)
    expect(verifySignatureHeader({ secret, header, deliveryId, rawBody: body + ' ', nowSec: t })).toBe(false)
    expect(verifySignatureHeader({ secret, header, deliveryId: 'other', rawBody: body, nowSec: t })).toBe(false)
    expect(verifySignatureHeader({ secret: 'x', header, deliveryId, rawBody: body, nowSec: t })).toBe(false)
    expect(verifySignatureHeader({ secret, header: null, deliveryId, rawBody: body, nowSec: t })).toBe(false)
  })

  it('changes with t, so each attempt carries a fresh signature', () => {
    expect(signatureHeader(secret, 100, deliveryId, body)).not.toBe(signatureHeader(secret, 101, deliveryId, body))
  })
})
