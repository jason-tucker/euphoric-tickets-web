// P18 (lantern) — load-balancer health check. Returns 200 when Postgres is
// reachable, 503 otherwise. Caddy's `health_uri /api/health` polls this to
// decide whether a backing VPS should receive traffic.

import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/db/client'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await db.execute(sql`select 1`)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}
