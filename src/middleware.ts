import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PROTECTED_PREFIXES = ['/dashboard', '/b/', '/t/']

// We rely on auth() inside server components for fine-grained access
// control. This middleware is just a cheap "send unauth'd users to /login"
// guard so they don't get a flash of empty content first.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (!PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next()

  // Auth.js v5 cookies: __Secure-authjs.session-token in prod, authjs.session-token in dev.
  const hasSession =
    req.cookies.has('authjs.session-token') ||
    req.cookies.has('__Secure-authjs.session-token')
  if (!hasSession) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/b/:path*', '/t/:path*'],
}
