// In-app confinement of /api/v1/* to the internal docker networks (defense in
// depth ahead of the plan §4.6 P1d edge rule).
//
// Every /api/v1 request must carry a `Host` header naming one of the internal
// aliases in INTERNAL_API_HOSTS (comma-separated, case-insensitive, exact
// host[:port] match). Default: `tickets-web:3000,tickets-web`, the alias the
// music worker (efm-public-net) and the staging stack use. Anything else —
// including a missing Host — gets a bare 404 before any key work.
//
// Why Host: traffic that reaches tickets-web through the public Cloudflare
// tunnel or the Caddy block arrives with the public Host
// (`tickets.euphoric.fm` / `tickets.euphoric.gg`); those proxies route by that
// Host and forward it unchanged, so an external caller cannot turn it into
// the internal alias. Assumption: neither proxy is configured to rewrite Host
// to `tickets-web[:3000]` (cloudflared `httpHostHeader`, Caddy `header_up
// Host`). Only the `host` header is read — never X-Forwarded-Host, which a
// caller controls.
//
// Local testing against a published port (e.g. staging's 127.0.0.1:16095)
// needs that host added: INTERNAL_API_HOSTS=tickets-web:3000,tickets-web,127.0.0.1:16095
//
// /api/internal/* is deliberately NOT gated here yet: the bot still calls
// /api/internal/notify through the public URL until it deploys
// WEB_INTERNAL_URL (that gate is P1d).

export const DEFAULT_INTERNAL_API_HOSTS = 'tickets-web:3000,tickets-web'

export function internalApiHosts(env: Record<string, string | undefined> = process.env): Set<string> {
  // Unset or blank → the default (a blank value must not silently open or close the API).
  const configured = (env.INTERNAL_API_HOSTS ?? '').trim()
  const raw = configured || DEFAULT_INTERNAL_API_HOSTS
  return new Set(
    raw
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function isInternalApiRequest(headers: Headers, env: Record<string, string | undefined> = process.env): boolean {
  const host = headers.get('host')?.trim().toLowerCase()
  if (!host) return false
  return internalApiHosts(env).has(host)
}

export function notFoundResponse(): Response {
  return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } })
}
