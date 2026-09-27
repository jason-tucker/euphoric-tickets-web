// SSRF policy for outbound integration webhooks (plan §4.5).
//
// Save time: a webhook URL is accepted ONLY if its (scheme, host, port, path)
//   exactly equals an `integration_webhook_allowlist` row of THAT integration.
// Send time: the address the socket actually connects to is decided inside an
//   undici `connect` hook (DNS is resolved there and the socket is pinned to
//   the validated IP, so there is no resolve-then-connect TOCTOU window):
//     • allowlisted URL → the IP must lie inside the row's
//       `expected_network_cidr` and must never be loopback (127/8, ::1),
//       link-local (169.254/16) or unspecified (0/8, ::);
//     • anything else (defence in depth: e.g. the allowlist row was deleted
//       after save) → the public-only rule of src/lib/ssrf.ts
//       (`isPrivateOrReservedIp`), applied to the connected address.
// Redirects are never followed (redirect:'manual' at the call site).

import { isIP } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'
import { Agent, buildConnector } from 'undici'
import { isPrivateOrReservedIp } from '@/lib/ssrf'

export class BlockedAddressError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockedAddressError'
  }
}

// ---- URL normalisation + allowlist match ---------------------------------

export type WebhookTarget = { scheme: 'http' | 'https'; host: string; port: number; path: string }

// Parse a webhook URL into the tuple the allowlist is keyed on. Rejects
// credentials, fragments and query strings so "exact match" stays exact.
export function normalizeWebhookUrl(raw: string): WebhookTarget | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.username || u.password || u.search || u.hash) return null
  let host = u.hostname.toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (!host) return null
  const scheme = u.protocol === 'https:' ? 'https' : 'http'
  const port = u.port ? Number(u.port) : scheme === 'https' ? 443 : 80
  return { scheme, host, port, path: u.pathname || '/' }
}

export type AllowRow = { scheme: string; host: string; port: number; path: string; expectedNetworkCidr: string }

export function matchAllowlist<R extends AllowRow>(rawUrl: string, rows: R[]): R | null {
  const t = normalizeWebhookUrl(rawUrl)
  if (!t) return null
  return (
    rows.find(
      (r) => r.scheme.toLowerCase() === t.scheme && r.host.toLowerCase() === t.host && r.port === t.port && r.path === t.path,
    ) ?? null
  )
}

// ---- IP / CIDR arithmetic ---------------------------------------------------

type ParsedIp = { family: 4 | 6; bytes: Uint8Array }

function parseV4(ip: string): Uint8Array | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const out = new Uint8Array(4)
  for (let i = 0; i < 4; i++) {
    if (!/^\d{1,3}$/.test(parts[i]!)) return null
    const n = Number(parts[i])
    if (n > 255) return null
    out[i] = n
  }
  return out
}

function parseV6(ip: string): Uint8Array | null {
  let v = ip.toLowerCase()
  const pct = v.indexOf('%')
  if (pct !== -1) v = v.slice(0, pct)
  // Trailing embedded IPv4 (::ffff:1.2.3.4).
  let tail: number[] = []
  const m = /^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(v)
  if (m) {
    const v4 = parseV4(m[2]!)
    if (!v4) return null
    tail = [(v4[0]! << 8) | v4[1]!, (v4[2]! << 8) | v4[3]!]
    v = m[1]!.endsWith('::') ? m[1]! : m[1]!.slice(0, -1)
  }
  const halves = v.split('::')
  if (halves.length > 2) return null
  const toGroups = (s: string) => (s === '' ? [] : s.split(':'))
  const head = toGroups(halves[0]!)
  const rest = halves.length === 2 ? toGroups(halves[1]!) : []
  const want = 8 - tail.length
  let groups: string[]
  if (halves.length === 2) {
    const fill = want - head.length - rest.length
    if (fill < 0) return null
    groups = [...head, ...Array(fill).fill('0'), ...rest]
  } else {
    groups = head
  }
  if (groups.length !== want) return null
  const words: number[] = []
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    words.push(parseInt(g, 16))
  }
  words.push(...tail)
  const out = new Uint8Array(16)
  words.forEach((w, i) => {
    out[i * 2] = w >> 8
    out[i * 2 + 1] = w & 0xff
  })
  return out
}

// Parse an IP literal; IPv4-mapped IPv6 (::ffff:a.b.c.d) collapses to IPv4.
export function parseIp(ip: string): ParsedIp | null {
  const fam = isIP(ip.split('%')[0]!)
  if (fam === 4) {
    const b = parseV4(ip)
    return b ? { family: 4, bytes: b } : null
  }
  if (fam === 6) {
    const b = parseV6(ip)
    if (!b) return null
    const mapped = b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff
    if (mapped) return { family: 4, bytes: b.slice(12) }
    return { family: 6, bytes: b }
  }
  return null
}

export type ParsedCidr = { family: 4 | 6; bytes: Uint8Array; prefix: number }

export function parseCidr(cidr: string): ParsedCidr | null {
  const m = /^([^/\s]+)\/(\d{1,3})$/.exec(cidr.trim())
  if (!m) return null
  const ip = parseIp(m[1]!)
  if (!ip) return null
  const prefix = Number(m[2])
  const max = ip.family === 4 ? 32 : 128
  if (prefix > max) return null
  // Canonical form only: no host bits set below the prefix.
  const masked = maskBytes(ip.bytes, prefix)
  if (!masked.every((b, i) => b === ip.bytes[i])) return null
  return { family: ip.family, bytes: ip.bytes, prefix }
}

function maskBytes(bytes: Uint8Array, prefix: number): Uint8Array {
  const out = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) {
    const bits = Math.max(0, Math.min(8, prefix - i * 8))
    out[i] = bits === 0 ? 0 : bytes[i]! & ((0xff << (8 - bits)) & 0xff)
  }
  return out
}

export function ipInCidr(ip: string, cidr: string | ParsedCidr): boolean {
  const c = typeof cidr === 'string' ? parseCidr(cidr) : cidr
  const p = parseIp(ip)
  if (!c || !p || c.family !== p.family) return false
  const a = maskBytes(p.bytes, c.prefix)
  return a.every((b, i) => b === c.bytes[i])
}

// Never acceptable for an allowlisted (internal-network) webhook.
const ALWAYS_FORBIDDEN = ['127.0.0.0/8', '169.254.0.0/16', '0.0.0.0/8', '::1/128', '::/128', 'fe80::/10'].map(
  (c) => parseCidr(c)!,
)

export function isAlwaysForbidden(ip: string): boolean {
  return ALWAYS_FORBIDDEN.some((c) => ipInCidr(ip, c))
}

// Save-time sanity for `expected_network_cidr`: a canonical private-range
// CIDR no broader than /16 (IPv4) or /48 (IPv6) — the fixed subnet of one
// docker network, never "everything".
const PRIVATE_PARENTS = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', 'fc00::/7'].map((c) => parseCidr(c)!)

export function validateExpectedCidr(cidr: string): string | null {
  const c = parseCidr(cidr)
  if (!c) return 'not a canonical CIDR (e.g. 172.30.40.0/24)'
  if (c.family === 4 && c.prefix < 16) return 'IPv4 CIDR must be /16 or narrower'
  if (c.family === 6 && c.prefix < 48) return 'IPv6 CIDR must be /48 or narrower'
  const inside = PRIVATE_PARENTS.some(
    (p) => p.family === c.family && c.prefix >= p.prefix && ipInCidr(formatIp(c), p),
  )
  if (!inside) return 'CIDR must be inside a private range (10/8, 172.16/12, 192.168/16, fc00::/7)'
  return null
}

function formatIp(c: { family: 4 | 6; bytes: Uint8Array }): string {
  if (c.family === 4) return Array.from(c.bytes).join('.')
  const words: string[] = []
  for (let i = 0; i < 16; i += 2) words.push(((c.bytes[i]! << 8) | c.bytes[i + 1]!).toString(16))
  return words.join(':')
}

// ---- address policy ------------------------------------------------------

export type AddressPolicy = { mode: 'cidr'; cidr: string } | { mode: 'public' }

// Throws BlockedAddressError unless `ip` is acceptable under `policy`.
export function assertAddressAllowed(ip: string, policy: AddressPolicy): void {
  const parsed = parseIp(ip)
  if (!parsed) throw new BlockedAddressError('unparseable address')
  if (policy.mode === 'cidr') {
    if (isAlwaysForbidden(ip)) throw new BlockedAddressError('loopback/link-local address')
    if (!ipInCidr(ip, policy.cidr)) throw new BlockedAddressError('address outside expected network')
    return
  }
  if (isPrivateOrReservedIp(ip)) throw new BlockedAddressError('private/reserved address')
}

export type LookupFn = (host: string) => Promise<Array<{ address: string }>>

const defaultLookup: LookupFn = (host) => dnsLookup(host, { all: true, verbatim: true })

// Resolve `hostname` and return an address to connect to, after checking
// EVERY resolved address against the policy (a mixed answer is refused).
export async function resolvePinnedAddress(
  hostname: string,
  policy: AddressPolicy,
  lookup: LookupFn = defaultLookup,
): Promise<string> {
  let host = hostname
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (isIP(host)) {
    assertAddressAllowed(host, policy)
    return host
  }
  let addrs: Array<{ address: string }>
  try {
    addrs = await lookup(host)
  } catch {
    throw new BlockedAddressError('dns resolution failed')
  }
  if (addrs.length === 0) throw new BlockedAddressError('host did not resolve')
  for (const a of addrs) assertAddressAllowed(a.address, policy)
  return addrs[0]!.address
}

// An undici Agent whose connect hook resolves + validates the destination and
// pins the socket to that IP (TLS still verifies the original hostname).
export function createPinnedAgent(policy: AddressPolicy, opts: { lookup?: LookupFn; connectTimeoutMs?: number } = {}): Agent {
  const base = buildConnector({ timeout: opts.connectTimeoutMs ?? 10_000 })
  const connect: buildConnector.connector = (options, callback) => {
    const original = options.hostname
    resolvePinnedAddress(original, policy, opts.lookup).then(
      (ip) => {
        const bare = original.startsWith('[') ? original.slice(1, -1) : original
        base(
          {
            ...options,
            hostname: ip,
            servername: options.servername || (isIP(bare) ? undefined : bare),
          },
          callback,
        )
      },
      (err: Error) => callback(err, null),
    )
  }
  return new Agent({ connect })
}
