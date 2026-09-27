// AES-256-GCM envelope for `integrations.webhook_secret_enc` (plan §4.1).
//
// Key: env INTEGRATION_ENC_KEY — 32 bytes as base64/base64url (44/43 chars)
// or hex (64 chars). It lives only in the container env, never in the DB, so a
// DB dump alone does not reveal webhook secrets.
//
// Format: `v1:<iv b64url>:<tag b64url>:<ciphertext b64url>` with a fresh
// 96-bit IV per encryption. The integration id is bound in as AAD, so a
// ciphertext copied onto another integration row fails to decrypt.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export class IntegrationCryptoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntegrationCryptoError'
  }
}

export function parseEncKey(raw: string | undefined): Buffer {
  if (!raw) throw new IntegrationCryptoError('INTEGRATION_ENC_KEY is not set')
  const v = raw.trim()
  let key: Buffer | null = null
  if (/^[0-9a-fA-F]{64}$/.test(v)) key = Buffer.from(v, 'hex')
  else if (/^[A-Za-z0-9+/_-]{43}=?$/.test(v)) key = Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  if (!key || key.length !== 32) {
    throw new IntegrationCryptoError('INTEGRATION_ENC_KEY must be 32 bytes (base64 or 64 hex chars)')
  }
  return key
}

function encKey(): Buffer {
  return parseEncKey(process.env.INTEGRATION_ENC_KEY)
}

export function encryptSecret(plaintext: string, aad: string, key: Buffer = encKey()): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ct.toString('base64url')}`
}

export function decryptSecret(envelope: string, aad: string, key: Buffer = encKey()): string {
  const parts = envelope.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1') throw new IntegrationCryptoError('bad envelope')
  const iv = Buffer.from(parts[1]!, 'base64url')
  const tag = Buffer.from(parts[2]!, 'base64url')
  const ct = Buffer.from(parts[3]!, 'base64url')
  if (iv.length !== 12 || tag.length !== 16) throw new IntegrationCryptoError('bad envelope')
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
  } catch {
    throw new IntegrationCryptoError('decrypt failed')
  }
}
