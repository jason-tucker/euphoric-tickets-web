// P1c: the web↔bot internal secret is INTERNAL_TOKEN only, ≥ 32 characters,
// with no DISCORD_BOT_TOKEN fallback.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INTERNAL_TOKEN_MIN_LENGTH, InternalTokenError, getInternalToken, internalTokenOrNull } from './internalToken'

const saved = { internal: process.env.INTERNAL_TOKEN, bot: process.env.DISCORD_BOT_TOKEN }

beforeEach(() => {
  delete process.env.INTERNAL_TOKEN
  // A realistic bot token is present: it must never be used as the secret.
  process.env.DISCORD_BOT_TOKEN = 'b'.repeat(72)
})

afterEach(() => {
  vi.restoreAllMocks()
  if (saved.internal === undefined) delete process.env.INTERNAL_TOKEN
  else process.env.INTERNAL_TOKEN = saved.internal
  if (saved.bot === undefined) delete process.env.DISCORD_BOT_TOKEN
  else process.env.DISCORD_BOT_TOKEN = saved.bot
})

describe('getInternalToken', () => {
  it('requires a minimum length of 32', () => {
    expect(INTERNAL_TOKEN_MIN_LENGTH).toBe(32)
  })

  it('throws when INTERNAL_TOKEN is missing, even with DISCORD_BOT_TOKEN set (no fallback)', () => {
    expect(() => getInternalToken()).toThrow(InternalTokenError)
    expect(() => getInternalToken()).toThrow(/not set/)
  })

  it('throws when INTERNAL_TOKEN is empty', () => {
    process.env.INTERNAL_TOKEN = ''
    expect(() => getInternalToken()).toThrow(InternalTokenError)
  })

  it('throws when INTERNAL_TOKEN is shorter than 32 characters, without echoing the value', () => {
    const short = 's3cr3t'.padEnd(31, 'q')
    process.env.INTERNAL_TOKEN = short
    let caught: unknown
    try {
      getInternalToken()
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(InternalTokenError)
    expect((caught as Error).message).toMatch(/too short/)
    expect((caught as Error).message).not.toContain(short)
  })

  it('returns the token at exactly 32 characters and above', () => {
    process.env.INTERNAL_TOKEN = 'a'.repeat(32)
    expect(getInternalToken()).toBe('a'.repeat(32))
    process.env.INTERNAL_TOKEN = 'c'.repeat(64)
    expect(getInternalToken()).toBe('c'.repeat(64))
  })
})

describe('internalTokenOrNull', () => {
  it('returns null (never the bot token, never an empty string) when invalid', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(internalTokenOrNull('test')).toBeNull()
    process.env.INTERNAL_TOKEN = 'Qx7-leak-canary'
    expect(internalTokenOrNull('test')).toBeNull()
    expect(log).toHaveBeenCalledTimes(2)
    expect(String(log.mock.calls[1]![0])).not.toContain('Qx7-leak-canary')
  })

  it('returns the token when valid', () => {
    process.env.INTERNAL_TOKEN = 'k'.repeat(40)
    expect(internalTokenOrNull('test')).toBe('k'.repeat(40))
  })
})
