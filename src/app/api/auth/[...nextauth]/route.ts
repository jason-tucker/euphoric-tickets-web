import { NextRequest } from 'next/server'
import { handlers } from '@/server/auth'

// --- Multi-domain OAuth (tickets.euphoric.fm AND tickets.euphoric.gg) --------
//
// next-auth (v5 beta) derives the OAuth `redirect_uri` from `request.url`
// (`@auth/core` providers util: `callbackUrl = ${new URL(req.url)}/callback/<id>`),
// NOT from the X-Forwarded-* headers. In a Next.js standalone server behind a
// reverse proxy, `request.url` is pinned to the container's bind address
// (`http://0.0.0.0:3000`) — it deliberately does not trust the Host header.
//
// The library's only built-in fix is `AUTH_URL`, which `reqWithEnvURL` uses to
// rewrite that origin — but it's a single fixed value, so it can only ever
// serve one domain. With two public domains, a login begun on .gg but pinned to
// .fm sets its PKCE cookie on .gg and is bounced to the .fm callback, which
// can't read it → `InvalidCheck: pkceCodeVerifier` → the server-config error.
//
// So we do per-request what AUTH_URL does globally: rebuild `request.url` from
// the proxy's X-Forwarded-Host (falling back to Host). Then redirect_uri, the
// PKCE/state cookies, and the callback all land on whichever domain the user
// actually started from. Caddy (.gg) sets X-Forwarded-Host explicitly;
// cloudflared (.fm) preserves the original Host header.
//
// When AUTH_URL IS set (local dev points it at http://localhost:3000) we defer
// to next-auth's own handling and skip the rewrite entirely.
function withForwardedHost(req: NextRequest): NextRequest {
  if (process.env.AUTH_URL || process.env.NEXTAUTH_URL) return req

  const forwardedHost = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  if (!forwardedHost) return req

  const forwardedProto = req.headers.get('x-forwarded-proto') ?? 'https'
  const current = new URL(req.url)
  if (current.host === forwardedHost && current.protocol === `${forwardedProto}:`) return req

  // Build the authority from the string rather than assigning `url.host` —
  // the WHATWG URL `host` setter keeps the existing port when the new value
  // has none, so `url.host = 'tickets.euphoric.gg'` against a bind URL of
  // :3000 would leak `tickets.euphoric.gg:3000` into redirect_uri. Composing
  // the string directly (as @auth/core's createActionURL does) avoids that.
  const rewritten = new URL(`${forwardedProto}://${forwardedHost}${current.pathname}${current.search}`)
  // Mirrors next-auth's own reqWithEnvURL: `new NextRequest(url, req)` carries
  // over method, headers, and body (needed for the signin/callback POSTs).
  return new NextRequest(rewritten, req)
}

export const GET = (req: NextRequest) => handlers.GET(withForwardedHost(req))
export const POST = (req: NextRequest) => handlers.POST(withForwardedHost(req))
