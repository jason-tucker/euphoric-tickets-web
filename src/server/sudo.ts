import { cache } from 'react'
import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { db } from '@/db/client'
import { users } from '@/db/schema'
import { auth } from './auth'

// Lightweight "is the current user sudo?" check used by the app chrome to
// decide whether to surface the Admin link. Returns false for anonymous
// visitors so it's safe to call without an auth guard above it.
// Per-request cached so the chrome + downstream pages share the lookup.
export const currentUserIsSudo = cache(async function currentUserIsSudo(): Promise<boolean> {
  const session = await auth()
  if (!session?.user?.id) return false
  const [row] = await db
    .select({ isSudo: users.isSudo })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)
  return !!row?.isSudo
})

// Hard guard for /admin routes. Redirects to /login if not signed in,
// /dashboard if signed in but not sudo.
export async function requireSudo() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login?next=/admin')
  const [row] = await db
    .select({ isSudo: users.isSudo })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1)
  if (!row?.isSudo) redirect('/dashboard')
  return session
}
