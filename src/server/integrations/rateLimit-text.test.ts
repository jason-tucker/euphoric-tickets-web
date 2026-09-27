import { describe, expect, it } from 'vitest'
import { PrefixLru, RATE, SlidingWindowLimiter, UNTRUSTED_BUCKET, clientBucket, ipBucket, trustProxyHeaders } from './rateLimit'
import {
  clampEscaped,
  composeIntegrationMessage,
  escapeDiscordMarkdown,
  escapeForBot,
  integrationFooter,
  isAcceptableWebhookUsername,
  safeWebhookUsername,
} from './discordText'
import { parseTicketId, redactHeaders } from './http'

describe('PrefixLru (recently-valid key prefixes)', () => {
  it('is bounded and evicts the least recently used prefix', () => {
    const lru = new PrefixLru(3)
    for (const p of ['a', 'b', 'c']) lru.add(p)
    expect(lru.has('a')).toBe(true) // refresh a → order b, c, a
    lru.add('d') // evicts b
    expect(lru.size).toBe(3)
    expect(lru.has('b')).toBe(false)
    for (const p of ['a', 'c', 'd']) expect(lru.has(p), p).toBe(true)
    for (let i = 0; i < 10_000; i++) lru.add(`x${i}`)
    expect(lru.size).toBe(3)
    expect(RATE.validPrefixCapacity).toBeLessThanOrEqual(RATE.authFailureMaxBuckets)
  })
})

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

describe('SlidingWindowLimiter — bounded memory and per-hit work', () => {
  it('caps the map at maxKeys, evicting the oldest key (insertion order) on insert', () => {
    const lim = new SlidingWindowLimiter(5, 60_000, () => 1_000, { maxKeys: 3 })
    for (const k of ['a', 'b', 'c']) lim.hit(k)
    expect(lim.size).toBe(3)
    lim.hit('d') // evicts 'a'
    expect(lim.size).toBe(3)
    expect(lim.stats.evictions).toBe(1)
    // A recorded hit moves a key to the tail, so 'b' survives the next insert.
    lim.hit('b')
    lim.hit('e') // evicts 'c' (now the oldest)
    lim.hit('f') // evicts 'd'
    expect(lim.size).toBe(3)
    // 'b' still has its 2 hits; 'c' was evicted and starts over.
    for (let i = 0; i < 3; i++) expect(lim.hit('b').allowed).toBe(true)
    expect(lim.hit('b').allowed).toBe(false)
  })

  it('prunes expired keys from the head without scanning the map', () => {
    let now = 0
    const lim = new SlidingWindowLimiter(1, 1_000, () => now, { maxKeys: 100_000, pruneBatch: 4 })
    for (let i = 0; i < 1_000; i++) lim.hit(`k${i}`)
    expect(lim.size).toBe(1_000)
    now = 5_000 // everything expired
    // Each hit drops at most pruneBatch stale head keys (never all 1000 at once).
    lim.hit('fresh')
    expect(lim.stats.lastHitWork).toBeLessThanOrEqual(4)
    expect(lim.size).toBe(1_000 + 1 - 4)
    for (let i = 0; i < 400; i++) lim.hit(`later${i}`)
    // The stale keys drain as traffic continues; only live keys remain.
    expect(lim.size).toBe(401)
    expect(lim.stats.maxHitWork).toBeLessThanOrEqual(4)
  })

  it('30k failing hits from distinct IPs: map stays ≤ cap and per-hit work/time stay flat', () => {
    const lim = new SlidingWindowLimiter(RATE.authFailuresPerBucket, RATE.authFailureWindowMs, Date.now, {
      maxKeys: RATE.authFailureMaxBuckets,
    })
    const headers = (i: number) => new Headers({ 'cf-connecting-ip': `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}` })
    const chunkMs: number[] = []
    let maxSize = 0
    for (let chunk = 0; chunk < 3; chunk++) {
      const started = performance.now()
      for (let i = chunk * 10_000; i < (chunk + 1) * 10_000; i++) {
        lim.hit(clientBucket(headers(i), true))
        if (lim.size > maxSize) maxSize = lim.size
      }
      chunkMs.push(performance.now() - started)
    }
    expect(maxSize).toBeLessThanOrEqual(RATE.authFailureMaxBuckets)
    expect(lim.size).toBe(RATE.authFailureMaxBuckets)
    // Deterministic bound: no hit examined more than pruneBatch + 1 keys.
    expect(lim.stats.maxHitWork).toBeLessThanOrEqual(9)
    // Wall-clock sanity (the old per-hit O(N) prune made the last 20k hits
    // each scan ~10k entries, i.e. hundreds of times slower than the first 10k).
    expect(Math.max(chunkMs[1]!, chunkMs[2]!)).toBeLessThan(Math.max(chunkMs[0]!, 5) * 10)
    expect(chunkMs.reduce((a, b) => a + b, 0)).toBeLessThan(3_000)
  })
})

describe('clientBucket', () => {
  it('ignores caller-supplied proxy headers unless INTEGRATION_TRUST_PROXY_HEADERS is set', () => {
    const h = new Headers({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' })
    expect(clientBucket(h, false)).toBe(UNTRUSTED_BUCKET)
    expect(clientBucket(new Headers(), false)).toBe(UNTRUSTED_BUCKET)
    expect(trustProxyHeaders({})).toBe(false)
    expect(trustProxyHeaders({ INTEGRATION_TRUST_PROXY_HEADERS: 'true' })).toBe(true)
    expect(trustProxyHeaders({ INTEGRATION_TRUST_PROXY_HEADERS: '1' })).toBe(true)
    expect(trustProxyHeaders({ INTEGRATION_TRUST_PROXY_HEADERS: 'yes please' })).toBe(false)
  })

  it('when trusted: prefers cf-connecting-ip, then the first x-forwarded-for hop', () => {
    expect(clientBucket(new Headers({ 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' }), true)).toBe('1.2.3.4')
    expect(clientBucket(new Headers({ 'x-forwarded-for': '5.6.7.8, 10.0.0.1' }), true)).toBe('5.6.7.8')
    expect(clientBucket(new Headers(), true)).toBe('unknown')
  })

  it('keys IPv6 by /64, collapses IPv4-mapped addresses, and never keys on arbitrary text', () => {
    expect(ipBucket('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64')
    expect(ipBucket('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64')
    expect(ipBucket('2001:DB8:1:2:ffff::9')).toBe('2001:db8:1:2::/64')
    expect(ipBucket('[2001:db8::1]')).toBe('2001:db8:0:0::/64')
    expect(ipBucket('fe80::1%eth0')).toBe('fe80:0:0:0::/64')
    expect(ipBucket('::')).toBe('0:0:0:0::/64')
    expect(ipBucket('::ffff:192.0.2.7')).toBe('192.0.2.7')
    expect(ipBucket('::ffff:c000:207')).toBe('192.0.2.7')
    expect(ipBucket('203.0.113.9')).toBe('203.0.113.9')
    for (const bad of ['not-an-ip', '1.2.3', '999.1.1.1', 'a'.repeat(64), '1.2.3.4:80', '']) {
      expect(ipBucket(bad), bad).toBe('invalid')
    }
    // Rotating through one /64 lands in one bucket.
    const buckets = new Set(Array.from({ length: 50 }, (_, i) => ipBucket(`2001:db8:5:6::${(i + 1).toString(16)}`)))
    expect(buckets.size).toBe(1)
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

  it('escapes block markers behind NBSP / other Unicode space separators', () => {
    expect(escapeDiscordMarkdown('\u00a0# heading')).toBe('\u00a0\\# heading')
    expect(escapeDiscordMarkdown('\u00a0\u00a0-# subtext')).toBe('\u00a0\u00a0\\-# subtext')
    expect(escapeDiscordMarkdown('x\n\u2003\t## two\n\u3000- item\n\u202f1. first')).toBe(
      'x\n\u2003\t\\## two\n\u3000\\- item\n\u202f\\1. first',
    )
    // A marker followed by NBSP is escaped too; mid-line markers are untouched.
    expect(escapeDiscordMarkdown('#\u00a0heading')).toBe('\\#\u00a0heading')
    expect(escapeDiscordMarkdown('a # b -# c')).toBe('a # b -# c')
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

  it('escapeForBot escapes, then clamps to the bot field limit safely', () => {
    expect(escapeForBot('[x](https://a) <@1>', 100)).toBe('\\[x\\](https://a) \\<@1\\>')
    const clamped = escapeForBot('_'.repeat(100), 100)
    expect(clamped.length).toBeLessThanOrEqual(100)
    expect(clamped.endsWith('…')).toBe(true)
    expect((/\\+$/.exec(clamped.slice(0, -1))?.[0].length ?? 0) % 2).toBe(0)
    // Never ends in a lone high surrogate.
    const emoji = clampEscaped('a' + '🎵'.repeat(10), 5)
    expect(emoji.length).toBeLessThanOrEqual(5)
    expect(emoji).toBe('a🎵…')
    expect(escapeForBot('short', 100)).toBe('short')
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
