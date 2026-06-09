// P13 (lantern) — bot → web notify bridge. The bot POSTs here after a
// Discord-origin ticket open or reply so the web dispatcher fans out
// ntfy / DM notifications. Authed by the shared INTERNAL_TOKEN.

import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { notify, type NotifyContext } from '@/server/notify'
import { notifyEvents } from '@/db/schema'

// Constant-time comparison so the shared-secret check doesn't leak the token
// byte-by-byte via response timing. Returns false on any length mismatch.
function tokenMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

const bodySchema = z.object({
  event: z.enum(notifyEvents),
  businessId: z.string().min(1).max(64),
  categoryId: z
    .string()
    .max(64)
    .nullish()
    .transform((v) => v ?? null),
  ticketId: z.coerce.number().int().positive(),
  subject: z
    .string()
    .max(2000)
    .nullish()
    .transform((s) => s ?? ''),
  slug: z.string().min(1).max(64),
  actorUserId: z
    .string()
    .max(64)
    .nullish()
    .transform((v) => v ?? null),
})

export async function POST(req: Request) {
  // INTERNAL_TOKEN if set, else the shared bot token (no extra config needed).
  const token = process.env.INTERNAL_TOKEN ?? process.env.DISCORD_BOT_TOKEN
  if (!token || !tokenMatches(req.headers.get('x-internal-token'), token)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 })
  }

  // Fire-and-forget so the bot isn't blocked on fan-out.
  void notify(parsed.data as NotifyContext).catch((err) => console.error('[internal/notify] failed', err))
  return NextResponse.json({ ok: true })
}
