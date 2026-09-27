import { describe, expect, it } from 'vitest'
import { SlidingWindowLimiter, clientIp } from './rateLimit'
import {
  composeIntegrationMessage,
  escapeDiscordMarkdown,
  integrationFooter,
  isAcceptableWebhookUsername,
  safeWebhookUsername,
} from './discordText'
import { parseTicketId, redactHeaders } from './http'

describe('SlidingWindowLimiter', () => {
  it('allows `limit` hits per window, then refuses with Retry-After, then recovers', () => {
    let now = 1_000_000
    const lim = new SlidingWindowLimiter(3, 60_000, () => now)
    expect(lim.hit('k').allowed).toBe(true)
    now += 10_000
    expect(lim.hit('k').allowed).toBe(true)
    expect(lim.hit('k').allowed).toBe(true)
    const refused = lim.hit('k')
    expect(refused.allowed).toBe(false)
    expect(refused.retryAfterSec).toBe(50)
    expect(lim.check('k').allowed).toBe(false)
    // Keys are independent.
    expect(lim.hit('other').allowed).toBe(true)
    // The first hit slides out after 60 s.
    now = 1_000_000 + 60_001
    expect(lim.hit('k').allowed).toBe(true)
    expect(lim.hit('k').allowed).toBe(false)
  })

  it('check() never records', () => {
    const lim = new SlidingWindowLimiter(1, 60_000, () => 0)
    for (let i = 0; i < 5; i++) expect(lim.check('k').allowed).toBe(true)
    expect(lim.hit('k').allowed).toBe(true)
  })
})

describe('clientIp', () => {
  it('prefers cf-connecting-ip, then the first x-forwarded-for hop', () => {
    expect(clientIp(new Headers({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' }))).toBe('1.2.3.4')
    expect(clientIp(new Headers({ 'x-forwarded-for': '5.6.7.8, 10.0.0.1' }))).toBe('5.6.7.8')
    expect(clientIp(new Headers())).toBe('unknown')
  })
})

describe('Discord text shaping', () => {
  it('escapes markdown, mentions and block syntax', () => {
    expect(escapeDiscordMarkdown('**bold** _i_ `code` ~~s~~ ||spoiler|| > quote')).toBe(
      '\\*\\*bold\\*\\* \\_i\\_ \\`code\\` \\~\\~s\\~\\~ \\|\\|spoiler\\|\\| \\> quote',
    )
    expect(escapeDiscordMarkdown('<@123> <@&456> <#789> [x](https://evil)')).toBe(
      '\\<@123\\> \\<@&456\\> \\<#789\\> \\[x\\](https://evil)',
    )
    expect(escapeDiscordMarkdown('# Big\n-# small\n- item\n1. first')).toBe('\\# Big\n\\-# small\n\\- item\n\\1. first')
    expect(escapeDiscordMarkdown('hi @everyone and @here')).toBe('hi @​everyone and @​here')
    expect(escapeDiscordMarkdown('a\\b')).toBe('a\\\\b')
  })

  it('appends the server footer `-# via <integration> · <itemRef>`', () => {
    expect(integrationFooter('EFM Music', 'Song #3')).toBe('-# via EFM Music · Song #3')
    expect(integrationFooter('EFM *Music*')).toBe('-# via EFM \\*Music\\*')
    const msg = composeIntegrationMessage('Approved!', 'EFM Music', 'Song #3')
    expect(msg).toBe('Approved!\n-# via EFM Music · Song #3')
  })

  it('never drops the footer or leaves a dangling escape when trimming to 2000', () => {
    const msg = composeIntegrationMessage('*'.repeat(1800), 'EFM Music', 'Song #1')
    expect(msg.length).toBeLessThanOrEqual(2000)
    expect(msg.endsWith('\n-# via EFM Music · Song #1')).toBe(true)
    const bodyPart = msg.split('\n')[0]!.replace(/…$/, '')
    expect((/\\+$/.exec(bodyPart)?.[0].length ?? 0) % 2).toBe(0)
  })

  it('falls back when a username contains Discord-reserved words', () => {
    expect(isAcceptableWebhookUsername('Alice')).toBe(true)
    expect(isAcceptableWebhookUsername('discord mod')).toBe(false)
    expect(isAcceptableWebhookUsername('CLYDE')).toBe(false)
    expect(isAcceptableWebhookUsername('everyone')).toBe(false)
    expect(isAcceptableWebhookUsername('Sheree')).toBe(true)
    expect(safeWebhookUsername('Discord Fan', 'EFM Music')).toBe('EFM Music')
    expect(safeWebhookUsername('clyde', 'discord bot')).toBe('Euphoric Tickets')
    expect(safeWebhookUsername('  Bob\u0000  ', 'EFM')).toBe('Bob')
    expect(safeWebhookUsername('', null, 'x'.repeat(90))).toBe('x'.repeat(80))
  })
})

describe('http helpers', () => {
  it('redacts credentials from loggable headers', () => {
    const out = redactHeaders(new Headers({ Authorization: 'Bearer etk.x.y', 'x-internal-token': 't', cookie: 'c', accept: 'a' }))
    expect(out).toEqual({ authorization: '[redacted]', 'x-internal-token': '[redacted]', cookie: '[redacted]', accept: 'a' })
  })

  it('parses ticket ids strictly', () => {
    expect(parseTicketId('42')).toBe(42)
    for (const bad of ['0', '-1', '01', '1e3', '42abc', '99999999999', '']) expect(parseTicketId(bad), bad).toBeNull()
  })
})
