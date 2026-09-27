// Outbound webhook signature (plan §4.5):
//
//   X-Euphoric-Delivery:  <delivery uuid>
//   X-Euphoric-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${deliveryId}.${rawBody}`)>
//
// The HMAC key is the webhook secret string's UTF-8 bytes (the exact value
// shown once in the admin UI). `t` is taken fresh on every attempt, so a
// retried delivery carries a new signature. The receiver rejects |now − t| >
// 300 s and compares with timingSafeEqual BEFORE parsing the body.

import { createHmac, timingSafeEqual } from 'node:crypto'

export function computeSignature(secret: string, t: number, deliveryId: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${t}.${deliveryId}.${rawBody}`, 'utf8').digest('hex')
}

export function signatureHeader(secret: string, t: number, deliveryId: string, rawBody: string): string {
  return `t=${t},v1=${computeSignature(secret, t, deliveryId, rawBody)}`
}

// Reference verifier (the receiver's side). Used by the tests; also the spec
// a receiver implementation should match.
export function verifySignatureHeader(opts: {
  secret: string
  header: string | null
  deliveryId: string
  rawBody: string
  nowSec: number
  toleranceSec?: number
}): boolean {
  const m = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(opts.header ?? '')
  if (!m) return false
  const t = Number(m[1])
  if (Math.abs(opts.nowSec - t) > (opts.toleranceSec ?? 300)) return false
  const expected = Buffer.from(computeSignature(opts.secret, t, opts.deliveryId, opts.rawBody), 'hex')
  return timingSafeEqual(expected, Buffer.from(m[2]!, 'hex'))
}
