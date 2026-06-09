// SSRF guards for outbound requests whose destination is user-supplied.
//
// The app's only user-controlled outbound destination is the optional custom
// `ntfyServer` in a user's notification preferences (used by
// `src/server/notify.ts`). Everything else — the Discord REST API and the
// per-business Discord webhook URLs — targets fixed/allowlisted hosts. Without
// a guard, a user could point that field at an internal/metadata address
// (169.254.169.254, 127.0.0.1, 10.0.0.0/8, a docker-network service name, …)
// and use the server as a blind-SSRF pivot.
//
// `parseSafeHttpUrl` is a cheap structural check (scheme + IP-literal/host
// shape) suitable for save-time validation. `assertPublicHttpUrl` additionally
// resolves the hostname and rejects it if any resolved address is private —
// use it at request time, right before fetching.

import { isIP } from 'node:net'
import { lookup } from 'node:dns/promises'

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BlockedUrlError'
  }
}

// True if `ip` (v4 or v6 literal) is loopback, private, link-local, ULA,
// CGNAT, multicast, or otherwise not a public/global-unicast address. Anything
// that doesn't parse as an IP is treated as unsafe (fail closed).
export function isPrivateOrReservedIp(ip: string): boolean {
  const fam = isIP(ip)
  if (fam === 4) return isPrivateV4(ip)
  if (fam === 6) return isPrivateV6(ip)
  return true
}

function isPrivateV4(ip: string): boolean {
  const p = ip.split('.').map((n) => Number(n))
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b, c] = p
  if (a === 0) return true // 0.0.0.0/8 "this host"
  if (a === 10) return true // 10.0.0.0/8 private
  if (a === 127) return true // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && c === 0) return true // 192.0.0.0/24 IETF
  if (a === 192 && b === 0 && c === 2) return true // 192.0.2.0/24 TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true // 198.18.0.0/15 benchmark
  if (a === 198 && b === 51 && c === 100) return true // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255
  return false
}

function isPrivateV6(ip: string): boolean {
  let v = ip.toLowerCase()
  const pct = v.indexOf('%') // strip zone id (fe80::1%eth0)
  if (pct !== -1) v = v.slice(0, pct)
  if (v === '::1' || v === '::') return true // loopback / unspecified
  // IPv4-mapped / -embedded forms (::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::a.b.c.d).
  const embedded = v.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  if (embedded) return isPrivateV4(embedded[1])
  if (/^fe[89a-f]/.test(v)) return true // fe80::/10 link-local (+ deprecated fec0::/10 site-local)
  if (v.startsWith('fc') || v.startsWith('fd')) return true // fc00::/7 unique-local
  if (v.startsWith('ff')) return true // ff00::/8 multicast
  if (v.startsWith('2001:db8')) return true // documentation
  return false
}

// Structural check: accept only http(s) and reject hosts that are private/
// reserved IP literals or obvious internal names. DNS names that pass here are
// still fully validated by `assertPublicHttpUrl` (which resolves them).
export function parseSafeHttpUrl(raw: string): URL | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  let host = u.hostname.toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1) // IPv6 literal
  if (!host) return null
  if (host === 'localhost' || host.endsWith('.localhost')) return null
  if (host.endsWith('.internal') || host.endsWith('.local')) return null
  const fam = isIP(host)
  if (fam !== 0) {
    if (isPrivateOrReservedIp(host)) return null
  } else if (!host.includes('.')) {
    // Bare single-label name (e.g. a docker service alias like `db`) — not a
    // public FQDN. Reject to be safe.
    return null
  }
  return u
}

// Full request-time check: structural validation + DNS resolution. Throws
// `BlockedUrlError` if the URL is malformed, non-http(s), or resolves to any
// private/reserved address.
//
// Residual risk: a TOCTOU/DNS-rebinding window remains between this lookup and
// the socket connect inside `fetch`. Closing it fully requires pinning the
// connection to the validated IP; for this best-effort, fire-and-forget
// notification path the resolve-and-reject check is a proportionate mitigation.
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const u = parseSafeHttpUrl(raw)
  if (!u) throw new BlockedUrlError('URL is not an allowed public http(s) address')
  let host = u.hostname.toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (isIP(host) !== 0) return u // already-validated IP literal
  let addrs: Array<{ address: string }>
  try {
    addrs = await lookup(host, { all: true })
  } catch {
    throw new BlockedUrlError(`could not resolve host ${host}`)
  }
  if (addrs.length === 0) throw new BlockedUrlError(`host ${host} did not resolve`)
  for (const a of addrs) {
    if (isPrivateOrReservedIp(a.address)) {
      throw new BlockedUrlError(`host ${host} resolves to a private/reserved address`)
    }
  }
  return u
}
