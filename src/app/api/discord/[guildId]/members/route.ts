// P3 (lantern) — members API for the DiscordPicker.
// `?q=<text>` triggers Discord's prefix-match search (≤25 results). Empty
// query returns the first 100 members (Discord's default sort isn't great
// but fine for tiny guilds — most callers will be typing).
//
// No in-process cache here: queries vary per keystroke and Discord's
// search/members endpoints are themselves Discord-side rate-limited at a
// rate well above what a typing user can generate. The picker debounces
// 80ms on the client to coalesce bursts.

import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { businesses } from '@/db/schema'
import { requireBusinessAccess } from '@/server/permissions'
import { fetchGuildMembers } from '@/lib/discord'

export async function GET(req: Request, ctx: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await ctx.params
  if (!/^\d{17,20}$/.test(guildId)) return NextResponse.json({ error: 'bad guild id' }, { status: 400 })

  const [biz] = await db.select().from(businesses).where(eq(businesses.discordGuildId, guildId)).limit(1)
  if (!biz) return NextResponse.json({ error: 'unknown guild' }, { status: 404 })
  await requireBusinessAccess(biz.slug, 'admin')

  const botToken = process.env.DISCORD_BOT_TOKEN
  if (!botToken) return NextResponse.json({ error: 'bot not configured' }, { status: 500 })

  const q = new URL(req.url).searchParams.get('q')?.trim() || undefined
  const data = await fetchGuildMembers(botToken, guildId, q)
  return NextResponse.json(data)
}
