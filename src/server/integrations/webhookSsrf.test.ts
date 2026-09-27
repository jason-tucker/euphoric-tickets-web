import { createServer, type Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fetch as undiciFetch } from 'undici'
import {
  BlockedAddressError,
  assertAddressAllowed,
  createPinnedAgent,
  ipInCidr,
  isAlwaysForbidden,
  matchAllowlist,
  normalizeWebhookUrl,
  parseCidr,
  resolvePinnedAddress,
  validateExpectedCidr,
} from './webhookSsrf'
import { classifySendError } from './dispatcher'

const row = (over: Partial<{ scheme: string; host: string; port: number; path: string; expectedNetworkCidr: string }> = {}) => ({
  scheme: 'http',
  host: 'music-web',
  port: 6096,
  path: '/api/hooks/tickets',
  expectedNetworkCidr: '172.30.40.0/24',
  ...over,
})

describe('webhook allowlist (save time)', () => {
  it('normalises scheme/host/port/path and rejects credentials, query and fragment', () => {
    expect(normalizeWebhookUrl('http://Music-Web:6096/api/hooks/tickets')).toEqual({
      scheme: 'http',
      host: 'music-web',
      port: 6096,
      path: '/api/hooks/tickets',
    })
    expect(normalizeWebhookUrl('https://hooks.example.com/x')?.port).toBe(443)
    expect(normalizeWebhookUrl('http://hooks.example.com/x')?.port).toBe(80)
    for (const bad of ['ftp://a/b', 'http://u:p@a/b', 'http://a/b?x=1', 'http://a/b#f', 'not a url']) {
      expect(normalizeWebhookUrl(bad), bad).toBeNull()
    }
  })

  it('matches only an exact (scheme, host, port, path) row', () => {
    const rows = [row()]
    expect(matchAllowlist('http://music-web:6096/api/hooks/tickets', rows)).toBe(rows[0])
    expect(matchAllowlist('http://MUSIC-WEB:6096/api/hooks/tickets', rows)).toBe(rows[0])
    for (const miss of [
      'https://music-web:6096/api/hooks/tickets', // scheme
      'http://music-web2:6096/api/hooks/tickets', // host
      'http://music-web:6097/api/hooks/tickets', // port
      'http://music-web/api/hooks/tickets', // default port 80
      'http://music-web:6096/api/hooks/tickets/', // path
      'http://music-web:6096/api/hooks', // path prefix
      'http://music-web:6096/api/hooks/tickets?x=1', // query
      'http://169.254.169.254/latest/meta-data', // anything else
    ]) {
      expect(matchAllowlist(miss, rows), miss).toBeNull()
    }
  })

  it('accepts only narrow private CIDRs for expected_network_cidr', () => {
    expect(validateExpectedCidr('172.30.40.0/24')).toBeNull()
    expect(validateExpectedCidr('10.1.0.0/16')).toBeNull()
    expect(validateExpectedCidr('fd00:1:2::/64')).toBeNull()
    expect(validateExpectedCidr('172.30.40.1/24')).not.toBeNull() // host bits set
    expect(validateExpectedCidr('10.0.0.0/8')).not.toBeNull() // too broad
    expect(validateExpectedCidr('0.0.0.0/0')).not.toBeNull()
    expect(validateExpectedCidr('127.0.0.0/24')).not.toBeNull() // not private
    expect(validateExpectedCidr('169.254.169.0/24')).not.toBeNull()
    expect(validateExpectedCidr('8.8.8.0/24')).not.toBeNull()
    expect(validateExpectedCidr('garbage')).not.toBeNull()
  })
})

describe('CIDR arithmetic', () => {
  it('handles IPv4, IPv6 and IPv4-mapped IPv6', () => {
    expect(ipInCidr('172.30.40.7', '172.30.40.0/24')).toBe(true)
    expect(ipInCidr('172.30.41.7', '172.30.40.0/24')).toBe(false)
    expect(ipInCidr('::ffff:172.30.40.7', '172.30.40.0/24')).toBe(true)
    expect(ipInCidr('fd00:1:2::5', 'fd00:1:2::/64')).toBe(true)
    expect(ipInCidr('fd00:1:3::5', 'fd00:1:2::/64')).toBe(false)
    expect(ipInCidr('172.30.40.7', 'fd00::/8')).toBe(false)
    expect(parseCidr('1.2.3.4/33')).toBeNull()
  })

  it('always forbids loopback, link-local and unspecified addresses', () => {
    for (const ip of ['127.0.0.1', '127.9.9.9', '169.254.169.254', '::1', '::ffff:127.0.0.1', '0.0.0.0', '::', 'fe80::1']) {
      expect(isAlwaysForbidden(ip), ip).toBe(true)
    }
    expect(isAlwaysForbidden('172.30.40.7')).toBe(false)
  })
})

describe('send-time address policy', () => {
  const cidr = { mode: 'cidr' as const, cidr: '172.30.40.0/24' }

  it('allowlisted rows: resolved IP must be inside expected_network_cidr', () => {
    expect(() => assertAddressAllowed('172.30.40.9', cidr)).not.toThrow()
    expect(() => assertAddressAllowed('172.30.41.9', cidr)).toThrow(BlockedAddressError)
    expect(() => assertAddressAllowed('8.8.8.8', cidr)).toThrow(BlockedAddressError)
    // Even a CIDR that (mis)contains loopback / metadata can never reach them.
    expect(() => assertAddressAllowed('127.0.0.1', { mode: 'cidr', cidr: '127.0.0.0/8' })).toThrow(BlockedAddressError)
    expect(() => assertAddressAllowed('169.254.169.254', { mode: 'cidr', cidr: '169.254.0.0/16' })).toThrow(BlockedAddressError)
    expect(() => assertAddressAllowed('::1', { mode: 'cidr', cidr: '::/0' })).toThrow(BlockedAddressError)
  })

  it('non-allowlisted URLs fall back to the public-only guard', () => {
    expect(() => assertAddressAllowed('93.184.216.34', { mode: 'public' })).not.toThrow()
    for (const ip of ['10.0.0.1', '172.30.40.9', '192.168.1.1', '127.0.0.1', '169.254.169.254', '100.64.0.1']) {
      expect(() => assertAddressAllowed(ip, { mode: 'public' }), ip).toThrow(BlockedAddressError)
    }
  })

  it('refuses a host that resolves outside its CIDR, or to a mixed answer', async () => {
    const lookup = (map: Record<string, string[]>) => async (h: string) => (map[h] ?? []).map((address) => ({ address }))
    await expect(resolvePinnedAddress('music-web', cidr, lookup({ 'music-web': ['172.30.40.5'] }))).resolves.toBe('172.30.40.5')
    await expect(resolvePinnedAddress('music-web', cidr, lookup({ 'music-web': ['172.31.0.5'] }))).rejects.toThrow(BlockedAddressError)
    await expect(
      resolvePinnedAddress('music-web', cidr, lookup({ 'music-web': ['172.30.40.5', '127.0.0.1'] })),
    ).rejects.toThrow(BlockedAddressError)
    await expect(resolvePinnedAddress('nx', cidr, lookup({}))).rejects.toThrow(BlockedAddressError)
    await expect(resolvePinnedAddress('[::1]', cidr)).rejects.toThrow(BlockedAddressError)
    await expect(resolvePinnedAddress('127.0.0.1', cidr)).rejects.toThrow(BlockedAddressError)
  })
})

// Real sockets: a capture server on this host's non-loopback address.
const hostIp = Object.values(networkInterfaces())
  .flat()
  .find((a) => a && a.family === 'IPv4' && !a.internal)?.address

describe.skipIf(!hostIp)('pinned undici agent (real sockets)', () => {
  let server: Server
  let port = 0
  const hits: Array<{ url: string; sig: string | undefined }> = []

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push({ url: req.url ?? '', sig: req.headers['x-euphoric-signature'] as string | undefined })
      if (req.url === '/redirect') {
        res.writeHead(302, { Location: 'http://169.254.169.254/' })
        res.end()
        return
      }
      res.writeHead(204)
      res.end()
    })
    await new Promise<void>((r) => server.listen(0, '0.0.0.0', r))
    port = (server.address() as { port: number }).port
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  it('connects when the pinned IP is inside the CIDR', async () => {
    const agent = createPinnedAgent({ mode: 'cidr', cidr: `${hostIp}/32` })
    const res = await undiciFetch(`http://${hostIp}:${port}/hook`, { method: 'POST', body: '{}', dispatcher: agent, redirect: 'manual' })
    expect(res.status).toBe(204)
    await agent.close()
  })

  it('refuses a name that resolves outside the CIDR before any byte is sent', async () => {
    const before = hits.length
    const agent = createPinnedAgent({ mode: 'cidr', cidr: '10.99.0.0/24' }, { lookup: async () => [{ address: hostIp! }] })
    const err = await undiciFetch(`http://music-web:${port}/hook`, { method: 'POST', body: '{}', dispatcher: agent }).catch((e) => e)
    expect(classifySendError(err)).toBe('blocked_address')
    expect(hits.length).toBe(before)
    await agent.close()
  })

  it('refuses loopback even under the public policy (DNS-rebinding style)', async () => {
    const agent = createPinnedAgent({ mode: 'public' }, { lookup: async () => [{ address: '127.0.0.1' }] })
    const err = await undiciFetch(`http://rebind.example:${port}/hook`, { dispatcher: agent }).catch((e) => e)
    expect(classifySendError(err)).toBe('blocked_address')
    await agent.close()
  })

  it('does not follow redirects (redirect: manual)', async () => {
    const agent = createPinnedAgent({ mode: 'cidr', cidr: `${hostIp}/32` })
    const res = await undiciFetch(`http://${hostIp}:${port}/redirect`, { dispatcher: agent, redirect: 'manual' })
    expect(res.status).toBe(302)
    await agent.close()
  })
})
