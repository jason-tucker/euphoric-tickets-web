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
import { SubmitButton } from '@/components/app/submit-button'
import { requireBusinessAccess } from '@/server/permissions'
import { db } from '@/db/client'
import { businesses, businessMembers, tickets, ticketMessages, users } from '@/db/schema'
import { relativeTime } from '@/lib/format'
import {
  addInternalNote,
  assignTicket,
  claimTicket,
  closeTicket,
  deleteTicketChannel,
  reopenTicket,
  unclaimTicket,
} from './actions'

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
  const [clientBusiness] = t.clientBusinessId
    ? await db.select().from(businesses).where(eq(businesses.id, t.clientBusinessId)).limit(1)
    : [null as null]
  const [assignee] = t.assigneeUserId
    ? await db.select().from(users).where(eq(users.id, t.assigneeUserId)).limit(1)
    : [null as null]

  // Staff list for the Assign dropdown — only the business's known members.
  const staff = isAdmin
    ? await db
        .select({ id: users.id, name: users.name })
        .from(businessMembers)
        .innerJoin(users, eq(users.id, businessMembers.userId))
        .where(eq(businessMembers.businessId, access.business.id))
    : []

  const allMessages = await db
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

  // Internal notes are NEVER shown to the opener — even if they reload
  // the page. Admins see them in a separate panel below the conversation.
  const messages = allMessages.filter((m) => m.source !== 'internal')
  const internalNotes = isAdmin ? allMessages.filter((m) => m.source === 'internal') : []

  // Project tickets: list child sub-tickets. Sub-tickets: link to parent.
  const subTickets = t.kind === 'project'
    ? await db
        .select({ id: tickets.id, subject: tickets.subject, status: tickets.status, lastActivityAt: tickets.lastActivityAt })
        .from(tickets)
        .where(eq(tickets.parentTicketId, t.id))
        .orderBy(asc(tickets.id))
    : []
  const [parentTicket] = t.parentTicketId
    ? await db.select({ id: tickets.id, subject: tickets.subject }).from(tickets).where(eq(tickets.id, t.parentTicketId)).limit(1)
    : [null as null]

  const canClose = t.status !== 'closed' && (isAdmin || t.openerUserId === access.session.user.id)

  async function claim() { 'use server'; await claimTicket(slug, t.id) }
  async function unclaim() { 'use server'; await unclaimTicket(slug, t.id) }
  async function assign(formData: FormData) { 'use server'; await assignTicket(slug, t.id, formData) }
  async function close() { 'use server'; await closeTicket(slug, t.id) }
  async function reopen() { 'use server'; await reopenTicket(slug, t.id) }
  async function deleteChannel() { 'use server'; await deleteTicketChannel(slug, t.id) }
  async function note(formData: FormData) { 'use server'; await addInternalNote(slug, t.id, formData) }

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
            {t.kind === 'project' && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary">
                project
              </span>
            )}
            <span>·</span>
            <span>opened {relativeTime(t.openedAt)} by {opener?.name ?? '?'}</span>
          </div>
          <h1 className="mt-1 break-words text-2xl font-semibold">{t.subject}</h1>
          {parentTicket && (
            <p className="mt-1 text-xs text-muted-foreground">
              Sub-ticket of{' '}
              <Link href={`/b/${slug}/tickets/${parentTicket.id}`} className="font-medium hover:underline">
                #{parentTicket.id} — {parentTicket.subject}
              </Link>
            </p>
          )}
          {clientBusiness && (
            <p className="mt-1 text-xs text-muted-foreground">
              For client{' '}
              <Link href={`/b/${clientBusiness.slug}`} className="font-medium hover:underline">
                {clientBusiness.name}
              </Link>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={t.status} />
          {assignee && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {t.status === 'claimed' ? 'claimed by' : 'assigned to'} {assignee.name ?? '?'}
            </span>
          )}
          {isAdmin && t.status !== 'closed' && (t.assigneeUserId === null) && (
            <form action={claim}><SubmitButton size="sm" variant="secondary">Claim</SubmitButton></form>
          )}
          {isAdmin && t.assigneeUserId && t.status !== 'closed' && (
            <form action={unclaim}><SubmitButton size="sm" variant="outline">Unclaim</SubmitButton></form>
          )}
          {isAdmin && t.status !== 'closed' && (
            <form action={assign} className="flex items-center gap-1">
              <select
                name="assigneeId"
                defaultValue={t.assigneeUserId ?? ''}
                className="h-8 rounded-md border bg-background px-2 text-xs"
                aria-label="Assign to"
              >
                <option value="">— unassigned —</option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>{s.name ?? s.id.slice(0, 8)}</option>
                ))}
              </select>
              <SubmitButton size="sm" variant="secondary">Assign</SubmitButton>
            </form>
          )}
          {canClose && (
            <form action={close}><SubmitButton size="sm" variant="outline">Close</SubmitButton></form>
          )}
          {isAdmin && t.status === 'closed' && (
            <form action={reopen}><SubmitButton size="sm" variant="secondary">Reopen</SubmitButton></form>
          )}
          {isAdmin && t.status === 'closed' && t.discordChannelId && (
            <form action={deleteChannel}>
              <SubmitButton size="sm" variant="destructive" pendingChildren="Deleting…">Delete channel</SubmitButton>
            </form>
          )}
        </div>
      </div>

      {t.status === 'closed' && t.closedAt && (
        <div className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Closed {relativeTime(t.closedAt)}.
          {t.discordChannelId
            ? ' Discord channel was moved to the closed category.'
            : ' Discord channel has been deleted; transcript stays here.'}
        </div>
      )}

      {t.kind === 'project' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Sub-tickets ({subTickets.length})</CardTitle>
            <Button asChild size="sm" variant="secondary">
              <Link href={`/t/new?b=${slug}&parent=${t.id}`}>Add sub-ticket</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {subTickets.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No sub-tickets yet — break work down into focused pieces using the button above.
              </p>
            ) : (
              <ul className="divide-y">
                {subTickets.map((s) => (
                  <li key={s.id} className="py-2">
                    <Link href={`/b/${slug}/tickets/${s.id}`} className="flex items-center gap-2 hover:underline">
                      <Hash className="h-3 w-3 text-muted-foreground" />
                      <span className="font-mono text-xs text-muted-foreground">{s.id}</span>
                      <span className="flex-1 truncate text-sm">{s.subject}</span>
                      <StatusBadge status={s.status} />
                      <span className="text-xs text-muted-foreground">{relativeTime(s.lastActivityAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

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

      {isAdmin && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="text-base">Internal notes — staff only</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {internalNotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No internal notes yet. Notes are never shown to the opener and live in a
                private Discord thread that&apos;s created on first note.
              </p>
            ) : (
              internalNotes.map((m) => (
                <div key={m.id} className="flex gap-3">
                  <Avatar className="h-7 w-7">
                    {m.authorImage && <AvatarImage src={m.authorImage} alt="" />}
                    <AvatarFallback className="text-[10px]">{(m.authorName ?? 'S').slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium">{m.authorName ?? 'Staff'}</span>
                      <span className="text-xs text-muted-foreground">{relativeTime(m.createdAt)}</span>
                    </div>
                    <div className="mt-1 whitespace-pre-wrap break-words rounded-md bg-background/60 p-2 text-sm">
                      {m.body}
                    </div>
                  </div>
                </div>
              ))
            )}
            <form action={note} className="space-y-2 border-t border-amber-500/20 pt-3">
              <textarea
                name="body"
                required
                rows={2}
                maxLength={2000}
                placeholder="Add an internal note (staff-only)…"
                className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              />
              <SubmitButton size="sm" variant="secondary" pendingChildren="Adding…">Add note</SubmitButton>
            </form>
          </CardContent>
        </Card>
      )}
    </main>
  )
}
