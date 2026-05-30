// P13 (lantern) — bot → web notify bridge. The bot POSTs here after a
// Discord-origin ticket open or reply so the web dispatcher fans out
// ntfy / DM notifications. Authed by the shared INTERNAL_TOKEN.

import { NextResponse } from 'next/server'
import { notify, type NotifyContext } from '@/server/notify'

export async function POST(req: Request) {
  const token = process.env.INTERNAL_TOKEN
  if (!token || req.headers.get('x-internal-token') !== token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  let body: NotifyContext
  try {
    body = (await req.json()) as NotifyContext
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }
  if (!body?.event || !body.businessId || !body.ticketId || !body.slug) {
    return NextResponse.json({ error: 'missing fields' }, { status: 400 })
  }
  // Fire-and-forget so the bot isn't blocked on fan-out.
  void notify(body).catch((err) => console.error('[internal/notify] failed', err))
  return NextResponse.json({ ok: true })
}
