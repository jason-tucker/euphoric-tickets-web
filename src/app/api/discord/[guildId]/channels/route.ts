// P3 (lantern) — channels API for the DiscordPicker.
// Returns the bot's view of every channel in the guild, minimal shape. Admin-
// only: gating by guild ID requires resolving the business first, then asking
// requireBusinessAccess to enforce admin tier. Cached in-memory for 60s per
// guild because picker open/close re-mounts the component.

import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { businesses } from '@/db/schema'
import { requireBusinessAccess } from '@/server/permissions'
import { fetchGuildChannels } from '@/lib/discord'

const cache = new Map<string, { at: number; data: Awaited<ReturnType<typeof fetchGuildChannels>> }>()
const TTL_MS = 60_000

export async function GET(_req: Request, ctx: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await ctx.params
  if (!/^\d{17,20}$/.test(guildId)) return NextResponse.json({ error: 'bad guild id' }, { status: 400 })

  const [biz] = await db.select().from(businesses).where(eq(businesses.discordGuildId, guildId)).limit(1)
  if (!biz) return NextResponse.json({ error: 'unknown guild' }, { status: 404 })
  await requireBusinessAccess(biz.slug, 'admin')

  const cached = cache.get(guildId)
  if (cached && Date.now() - cached.at < TTL_MS) return NextResponse.json(cached.data)

  const botToken = process.env.DISCORD_BOT_TOKEN
  if (!botToken) return NextResponse.json({ error: 'bot not configured' }, { status: 500 })

  const data = await fetchGuildChannels(botToken, guildId)
  cache.set(guildId, { at: Date.now(), data })
  return NextResponse.json(data)
}
