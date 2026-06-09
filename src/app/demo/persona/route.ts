import { NextResponse } from 'next/server'
import { isPersonaKey } from '@/server/demo/meta'
import { PERSONA_COOKIE } from '@/server/demo/cookie'

// Switches the active demo persona by setting the `demo_persona` cookie and
// redirecting back. A plain GET handler — no server action, no DB. The cookie is
// scoped to /demo and carries no secret; it only selects which synthetic viewer
// the demo renders as.
export function GET(req: Request) {
  const url = new URL(req.url)
  const to = url.searchParams.get('to')
  const nextParam = url.searchParams.get('next') || '/demo'
  // Only ever redirect within the demo subtree (guards against open redirects),
  // and strip any CR/LF so the value can't inject extra response headers.
  const cleaned = nextParam.replace(/[\r\n]/g, '')
  // Only ever redirect to the demo subtree itself — require a `/demo` or
  // `/demo/...` path so neighbours like `/demoX`, protocol-relative `//host`,
  // or `/demo\host` can't slip through the prefix check.
  const dest = cleaned === '/demo' || cleaned.startsWith('/demo/') ? cleaned : '/demo'

  // Use a RELATIVE Location header. `NextResponse.redirect` would build an
  // ABSOLUTE URL from `req.url`, whose host behind the reverse proxy is the
  // internal bind address (0.0.0.0:3000) — which then leaked into the browser's
  // address bar. A relative Location is resolved by the browser against the
  // public URL it actually requested, so the host stays correct.
  const res = new NextResponse(null, { status: 303, headers: { Location: dest } })
  res.cookies.set(PERSONA_COOKIE, isPersonaKey(to) ? to : 'enduser', {
    path: '/demo',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  })
  return res
}
