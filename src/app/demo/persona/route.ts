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
  // Only ever redirect within the demo subtree.
  const dest = nextParam.startsWith('/demo') ? nextParam : '/demo'

  const res = NextResponse.redirect(new URL(dest, url))
  res.cookies.set(PERSONA_COOKIE, isPersonaKey(to) ? to : 'enduser', {
    path: '/demo',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  })
  return res
}
