// JSON feed for the live tickets console. The client refetches this on a
// stream nudge / poll / tab-focus and swaps the grid data in place — no page
// navigation, no spinner. Scope is re-resolved server-side every call, so the
// generic "something changed" stream nudge can never leak a ticket the caller
// shouldn't see.

import { NextResponse } from 'next/server'
import { auth } from '@/server/auth'
import { getTicketsConsoleData } from '@/server/tickets'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return new NextResponse('unauthorized', { status: 401 })

  const data = await getTicketsConsoleData()
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } })
}
