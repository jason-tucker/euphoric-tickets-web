import Link from 'next/link'
import { notFound } from 'next/navigation'
import { asc, eq, inArray } from 'drizzle-orm'
import { ArrowLeft, ExternalLink, Hash, Server, UserPlus, X } from 'lucide-react'
import { DiscordPicker } from '@/components/app/discord-picker'
import { fetchChannelMemberIds } from '@/lib/discord'
import { StatusBadge } from '@/components/app/status-badge'
import { ReplyForm } from '@/components/app/reply-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { SubmitButton } from '@/components/app/submit-button'
import { requireBusinessAccess, resolveTicketAccess } from '@/server/permissions'
import { db } from '@/db/client'
import { businesses, businessMembers, tickets, ticketCategories, ticketMessages, users } from '@/db/schema'
import { relativeTime } from '@/lib/format'
import {
  addInternalNote,
  addTicketMember,
  assignTicket,
  changeTicketCategory,
  claimTicket,
  closeTicket,
  deleteTicketChannel,
  removeTicketMember,
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

  const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1)
  if (!t || t.businessId !== access.business.id) notFound()

  // P2: per-ticket access flags. Replaces the old `isAdmin && opener` short-
  // circuit so a staff member on this category sees + acts on the ticket
  // without needing to be a business admin.
  const ticketAccess = await resolveTicketAccess({
    business: access.business,
    level: access.level,
    ticket: { openerUserId: t.openerUserId, categoryId: t.categoryId },
    session: { user: { id: access.session.user.id, discordId: access.session.user.discordId } },
  })
  if (!ticketAccess.canSee) notFound()
  const isAdmin = ticketAccess.isAdmin
  const isStaff = ticketAccess.isStaff

  // All independent queries fire in parallel — was 5-7 sequential round-trips.
  const openerQ = db.select().from(users).where(eq(users.id, t.openerUserId)).limit(1)
  const clientBusinessQ = t.clientBusinessId
    ? db.select().from(businesses).where(eq(businesses.id, t.clientBusinessId)).limit(1)
    : Promise.resolve([])
  const assigneeQ = t.assigneeUserId
    ? db.select().from(users).where(eq(users.id, t.assigneeUserId)).limit(1)
    : Promise.resolve([])
  // Staff list drives the Assign dropdown — both admins and category-staff
  // need it under P2.
  const staffQ = isStaff
    ? db
        .select({ id: users.id, name: users.name })
        .from(businessMembers)
        .innerJoin(users, eq(users.id, businessMembers.userId))
        .where(eq(businessMembers.businessId, access.business.id))
    : Promise.resolve([])
  const messagesQ = db
    .select({
      id: ticketMessages.id,
      body: ticketMessages.body,
      source: ticketMessages.source,
      createdAt: ticketMessages.createdAt,
      discordMessageId: ticketMessages.discordMessageId,
      attachments: ticketMessages.attachments,
      authorName: users.name,
      authorImage: users.image,
      authorId: users.id,
    })
    .from(ticketMessages)
    .leftJoin(users, eq(users.id, ticketMessages.authorUserId))
    .where(eq(ticketMessages.ticketId, t.id))
    .orderBy(asc(ticketMessages.createdAt))
  const subTicketsQ = t.kind === 'project'
    ? db
        .select({ id: tickets.id, subject: tickets.subject, status: tickets.status, lastActivityAt: tickets.lastActivityAt })
        .from(tickets)
        .where(eq(tickets.parentTicketId, t.id))
        .orderBy(asc(tickets.id))
    : Promise.resolve([])
  const parentQ = t.parentTicketId
    ? db.select({ id: tickets.id, subject: tickets.subject }).from(tickets).where(eq(tickets.id, t.parentTicketId)).limit(1)
    : Promise.resolve([])
  // Category list powers the admin "Move" select.
  const categoriesQ = ticketAccess.canChangeCategory
    ? db
        .select({ id: ticketCategories.id, key: ticketCategories.key, label: ticketCategories.label, emoji: ticketCategories.emoji })
        .from(ticketCategories)
        .where(eq(ticketCategories.businessId, access.business.id))
        .orderBy(asc(ticketCategories.sortOrder), asc(ticketCategories.label))
    : Promise.resolve([])

  const [
    openerRow,
    clientBusinessRow,
    assigneeRow,
    staff,
    allMessages,
    subTickets,
    parentRow,
    categories,
  ] = await Promise.all([openerQ, clientBusinessQ, assigneeQ, staffQ, messagesQ, subTicketsQ, parentQ, categoriesQ])
  const opener = openerRow[0]
  const clientBusiness = clientBusinessRow[0] ?? null
  const assignee = assigneeRow[0] ?? null
  const parentTicket = parentRow[0] ?? null

  // Internal notes are NEVER shown to the opener — even if they reload.
  // Staff and admins see them in a separate panel below the conversation.
  const messages = allMessages.filter((m) => m.source !== 'internal')
  const internalNotes = isStaff ? allMessages.filter((m) => m.source === 'internal') : []

  // P6: people explicitly added to the Discord channel (member overwrites).
  // Staff-only, best-effort, one Discord call.
  const botToken = process.env.DISCORD_BOT_TOKEN
  const peopleIds =
    ticketAccess.canManageMembers && t.discordChannelId && botToken
      ? await fetchChannelMemberIds(botToken, t.discordChannelId).catch(() => [] as string[])
      : []
  const peopleRows = peopleIds.length
    ? await db
        .select({ discordId: users.discordId, name: users.name, image: users.image })
        .from(users)
        .where(inArray(users.discordId, peopleIds))
    : []
  const people = peopleIds.map(
    (pid) => peopleRows.find((p) => p.discordId === pid) ?? { discordId: pid, name: null, image: null },
  )

  // Deep link into the actual Discord client/web at the per-ticket channel.
  const discordChannelUrl =
    t.discordChannelId && access.business.discordGuildId
      ? `https://discord.com/channels/${access.business.discordGuildId}/${t.discordChannelId}`
      : null

  const canClose = t.status !== 'closed' && ticketAccess.canClose
  const canClaim = t.status !== 'closed' && ticketAccess.canClaim
  const canAssign = canClaim
  const canReopen = t.status === 'closed' && ticketAccess.canClaim
  const canDelete = t.status === 'closed' && ticketAccess.canDeleteChannel && Boolean(t.discordChannelId)

  async function claim() { 'use server'; await claimTicket(slug, t.id) }
  async function unclaim() { 'use server'; await unclaimTicket(slug, t.id) }
  async function assign(formData: FormData) { 'use server'; await assignTicket(slug, t.id, formData) }
  async function close() { 'use server'; await closeTicket(slug, t.id) }
  async function reopen() { 'use server'; await reopenTicket(slug, t.id) }
  async function deleteChannel() { 'use server'; await deleteTicketChannel(slug, t.id) }
  async function note(formData: FormData) { 'use server'; await addInternalNote(slug, t.id, formData) }
  async function changeCat(formData: FormData) { 'use server'; await changeTicketCategory(slug, t.id, formData) }
  async function addPerson(formData: FormData) { 'use server'; await addTicketMember(slug, t.id, formData) }

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
          <p className="mt-1 inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Server className="h-3 w-3" />
              In Discord server <span className="font-medium text-foreground">{access.business.name}</span>
            </span>
            {discordChannelUrl && (
              <>
                <span>·</span>
                <a
                  href={discordChannelUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  Open in Discord <ExternalLink className="h-3 w-3" />
                </a>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={t.status} />
          {assignee && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              {t.status === 'claimed' ? 'claimed by' : 'assigned to'} {assignee.name ?? '?'}
            </span>
          )}
          {canClaim && t.assigneeUserId === null && (
            <form action={claim}><SubmitButton size="sm" variant="secondary">Claim</SubmitButton></form>
          )}
          {canClaim && t.assigneeUserId && (
            <form action={unclaim}><SubmitButton size="sm" variant="outline">Unclaim</SubmitButton></form>
          )}
          {canAssign && (
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
          {ticketAccess.canChangeCategory && t.status !== 'closed' && categories.length > 0 && (
            <form action={changeCat} className="flex items-center gap-1">
              <select
                name="categoryId"
                defaultValue={t.categoryId ?? ''}
                className="h-8 rounded-md border bg-background px-2 text-xs"
                aria-label="Move to category"
              >
                {!t.categoryId && <option value="">— category —</option>}
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ''}{c.label}</option>
                ))}
              </select>
              <SubmitButton size="sm" variant="outline">Move</SubmitButton>
            </form>
          )}
          {canClose && (
            <form action={close}><SubmitButton size="sm" variant="outline">Close</SubmitButton></form>
          )}
          {canReopen && (
            <form action={reopen}><SubmitButton size="sm" variant="secondary">Reopen</SubmitButton></form>
          )}
          {canDelete && (
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
                  <Attachments ticketId={t.id} messageId={m.discordMessageId} items={m.attachments} />
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

      {ticketAccess.canManageMembers && t.status !== 'closed' && t.discordChannelId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">People</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {people.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Just the opener and staff roles so far. Add a specific Discord member below.
              </p>
            ) : (
              <ul className="divide-y">
                {people.map((p) => {
                  const isOpener = opener?.discordId === p.discordId
                  return (
                    <li key={p.discordId} className="flex items-center gap-2 py-1.5">
                      <Avatar className="h-6 w-6">
                        {p.image && <AvatarImage src={p.image} alt="" />}
                        <AvatarFallback className="text-[9px]">{(p.name ?? 'U').slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="flex-1 truncate text-sm">{p.name ?? p.discordId}</span>
                      {isOpener ? (
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">opener</span>
                      ) : (
                        <form action={async () => { 'use server'; await removeTicketMember(slug, t.id, p.discordId) }}>
                          <SubmitButton variant="ghost" size="icon" aria-label={`Remove ${p.name ?? p.discordId}`}>
                            <X className="h-3.5 w-3.5" />
                          </SubmitButton>
                        </form>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            <form action={addPerson} className="flex items-end gap-2 border-t pt-3">
              <div className="flex-1">
                <DiscordPicker kind="user" guildId={access.business.discordGuildId} name="userId" triggerLabel="Search a member to add…" />
              </div>
              <SubmitButton size="sm" variant="secondary" pendingChildren="Adding…">
                <UserPlus className="mr-1 h-3.5 w-3.5" /> Add
              </SubmitButton>
            </form>
          </CardContent>
        </Card>
      )}

      {isStaff && (
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
                    <Attachments ticketId={t.id} messageId={m.discordMessageId} items={m.attachments} />
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

const AUDIO_EXT = /\.(mp3|ogg|oga|wav|m4a|flac|webm|opus|aac)$/i

function isAudio(a: { name: string; contentType: string | null }): boolean {
  return (a.contentType?.startsWith('audio/') ?? false) || AUDIO_EXT.test(a.name)
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// Renders a message's captured Discord attachments. Audio → an inline player;
// everything else → a download link. Both point at the refresh endpoint
// (/api/tickets/<id>/attachment) which 302s to a fresh Discord CDN URL, so
// playback/downloads stream straight from Discord — never stored on the VPS.
// Falls back to the (possibly-stale) stored URL when there's no Discord
// message id to refresh against (e.g. web-origin rows).
function Attachments({
  ticketId,
  messageId,
  items,
}: {
  ticketId: number
  messageId: string | null
  items: { id: string; name: string; url: string; contentType: string | null; size: number }[] | null
}) {
  if (!items || items.length === 0) return null
  return (
    <div className="mt-2 space-y-2">
      {items.map((a) => {
        const fresh = messageId
          ? `/api/tickets/${ticketId}/attachment?m=${encodeURIComponent(messageId)}&a=${encodeURIComponent(a.id)}`
          : a.url
        if (isAudio(a)) {
          return (
            <div key={a.id} className="space-y-1">
              <div className="text-xs text-muted-foreground">🎵 {a.name} · {fmtBytes(a.size)}</div>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio controls preload="none" src={fresh} className="w-full max-w-md" />
            </div>
          )
        }
        return (
          <a
            key={a.id}
            href={fresh}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs hover:bg-accent"
          >
            📎 <span className="max-w-[28ch] truncate">{a.name}</span>
            <span className="text-muted-foreground">· {fmtBytes(a.size)}</span>
          </a>
        )
      })}
    </div>
  )
}
