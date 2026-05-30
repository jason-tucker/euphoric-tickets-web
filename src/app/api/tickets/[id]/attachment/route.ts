// P-audio (lantern follow-on) — fresh-attachment redirect.
//
// GET /api/tickets/<id>/attachment?m=<discordMessageId>&a=<attachmentId>
//
// Permission-checked (the requester must be able to see the ticket), then
// 302-redirects to the attachment's freshly-signed Discord CDN URL. The
// browser follows the redirect and streams audio/files directly from
// Discord — nothing is downloaded to or stored on the VPS.

import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/db/client'
import { businesses, tickets } from '@/db/schema'
import { auth } from '@/server/auth'
import { resolveBusinessAccess, resolveTicketAccess } from '@/server/permissions'
import { fetchFreshAttachmentUrl } from '@/lib/discord'

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const ticketId = Number(id)
  if (!Number.isInteger(ticketId)) return NextResponse.json({ error: 'bad id' }, { status: 400 })

  const sp = new URL(req.url).searchParams
  const messageId = sp.get('m')
  const attachmentId = sp.get('a')
  if (!messageId || !attachmentId) return NextResponse.json({ error: 'missing m/a' }, { status: 400 })

  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1)
  if (!t) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const [biz] = await db.select().from(businesses).where(eq(businesses.id, t.businessId)).limit(1)
  if (!biz) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const resolved = await resolveBusinessAccess(biz.slug)
  if (!resolved) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const flags = await resolveTicketAccess({
    business: resolved.business,
    level: resolved.level,
    ticket: { openerUserId: t.openerUserId, categoryId: t.categoryId },
    session: { user: { id: session.user.id, discordId: session.user.discordId } },
  })
  if (!flags.canSee) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const botToken = process.env.DISCORD_BOT_TOKEN
  if (!botToken || !t.discordChannelId) return NextResponse.json({ error: 'unavailable' }, { status: 404 })

  const fresh = await fetchFreshAttachmentUrl(botToken, t.discordChannelId, messageId, attachmentId)
  if (!fresh) return NextResponse.json({ error: 'attachment gone' }, { status: 404 })

  // 302 so the <audio>/download follows straight to Discord's CDN. Range
  // requests are handled by the CDN, not us.
  return NextResponse.redirect(fresh, 302)
}
