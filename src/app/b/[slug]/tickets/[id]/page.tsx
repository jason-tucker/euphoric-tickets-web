import Link from 'next/link'
import { notFound } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { ArrowLeft, Hash } from 'lucide-react'
import { TopNav } from '@/components/app/top-nav'
import { StatusBadge } from '@/components/app/status-badge'
import { ReplyForm } from '@/components/app/reply-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { requireBusinessAccess } from '@/server/permissions'
import { db } from '@/db/client'
import { tickets, ticketMessages, users } from '@/db/schema'
import { relativeTime } from '@/lib/format'
import { claimTicket, closeTicket, reopenTicket } from './actions'

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>
}) {
  const { slug, id } = await params
  const ticketId = Number(id)
  if (!Number.isInteger(ticketId)) notFound()

  const access = await requireBusinessAccess(slug, 'member')
  const isAdmin = access.level === 'admin' || access.level === 'owner'

  const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1)
  if (!t || t.businessId !== access.business.id) notFound()
  if (!isAdmin && t.openerUserId !== access.session.user.id) notFound()

  const [opener] = await db.select().from(users).where(eq(users.id, t.openerUserId)).limit(1)

  const messages = await db
    .select({
      id: ticketMessages.id,
      body: ticketMessages.body,
      source: ticketMessages.source,
      createdAt: ticketMessages.createdAt,
      authorName: users.name,
      authorImage: users.image,
      authorId: users.id,
    })
    .from(ticketMessages)
    .leftJoin(users, eq(users.id, ticketMessages.authorUserId))
    .where(eq(ticketMessages.ticketId, t.id))
    .orderBy(asc(ticketMessages.createdAt))

  const canClose = t.status !== 'closed' && (isAdmin || t.openerUserId === access.session.user.id)

  async function claim() { 'use server'; await claimTicket(slug, t.id) }
  async function close() { 'use server'; await closeTicket(slug, t.id) }
  async function reopen() { 'use server'; await reopenTicket(slug, t.id) }

  return (
    <main className="container max-w-4xl space-y-4 py-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={isAdmin ? `/b/${slug}/tickets` : '/dashboard'} className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          {isAdmin ? 'All tickets' : 'My tickets'}
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Hash className="h-3 w-3" />
            <span className="font-mono">{t.id}</span>
            <span>·</span>
            <span>opened {relativeTime(t.openedAt)} by {opener?.name ?? '?'}</span>
          </div>
          <h1 className="mt-1 break-words text-2xl font-semibold">{t.subject}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={t.status} />
          {isAdmin && t.status === 'open' && (
            <form action={claim}><Button size="sm" variant="secondary">Claim</Button></form>
          )}
          {canClose && (
            <form action={close}><Button size="sm" variant="outline">Close</Button></form>
          )}
          {isAdmin && t.status === 'closed' && (
            <form action={reopen}><Button size="sm" variant="secondary">Reopen</Button></form>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conversation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No messages from the web yet. {t.discordChannelId
                ? <>This ticket lives in Discord <code className="font-mono text-xs">#{t.discordChannelId}</code> — the bot is the source of truth there.</>
                : 'Open conversation with a reply below.'}
            </p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className="flex gap-3">
                <Avatar className="h-8 w-8">
                  {m.authorImage && <AvatarImage src={m.authorImage} alt="" />}
                  <AvatarFallback className="text-[10px]">{(m.authorName ?? 'U').slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium">{m.authorName ?? 'Unknown'}</span>
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      via {m.source}
                    </span>
                    <span className="text-xs text-muted-foreground">{relativeTime(m.createdAt)}</span>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2.5 text-sm">
                    {m.body}
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {t.status !== 'closed' && (
        <Card>
          <CardHeader><CardTitle className="text-base">Reply</CardTitle></CardHeader>
          <CardContent>
            <ReplyForm slug={slug} ticketId={t.id} />
            <p className="mt-2 text-xs text-muted-foreground">
              Cmd/Ctrl+Enter to send. Your reply posts to the linked Discord channel as you (your Discord name + avatar).
            </p>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
