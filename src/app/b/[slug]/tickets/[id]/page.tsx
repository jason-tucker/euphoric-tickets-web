import Link from 'next/link'
import { notFound } from 'next/navigation'
import { asc, eq, inArray } from 'drizzle-orm'
import { ArrowLeft, Crown, ExternalLink, Hash, Server, UserPlus, X } from 'lucide-react'
import { DiscordPicker } from '@/components/app/discord-picker'
import { LiveRefresh } from '@/components/app/live-refresh'
import { TicketActionMenu } from '@/components/app/ticket-action-menu'
import { TitleEditor } from '@/components/app/title-editor'
import { DiscordMarkdown } from '@/components/app/discord-markdown'
import { fetchChannelOverwrites, fetchGuildRoles } from '@/lib/discord'
import { StatusBadge } from '@/components/app/status-badge'
import { ReplyForm } from '@/components/app/reply-form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { SubmitButton } from '@/components/app/submit-button'
import { requireSession, resolveBusinessAccess, resolveTicketAccess } from '@/server/permissions'
import { db } from '@/db/client'
import { auditLogs, businesses, businessMembers, tickets, ticketCategories, ticketExternalMembers, ticketMessages, users } from '@/db/schema'
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
  renameTicket,
  renameTicketToolTicket,
  requestCloseTicketToolTicket,
  setTicketOwner,
  reopenTicket,
  setTicketStatus,
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

  // P16: soft auth — don't require guild membership here. External members
  // (not in the guild) reach this page via a DM link; the per-ticket
  // resolveTicketAccess.canSee check below is the real gate.
  const session = await requireSession()
  const [biz] = await db.select().from(businesses).where(eq(businesses.slug, slug)).limit(1)
  if (!biz) notFound()
  const resolved = await resolveBusinessAccess(slug)
  const access = { business: biz, level: resolved?.level ?? ('member' as const), session }

  const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId)).limit(1)
  if (!t || t.businessId !== biz.id) notFound()

  // P2: per-ticket access flags. Replaces the old `isAdmin && opener` short-
  // circuit so a staff member on this category sees + acts on the ticket
  // without needing to be a business admin.
  const ticketAccess = await resolveTicketAccess({
    business: access.business,
    level: access.level,
    ticket: { id: t.id, openerUserId: t.openerUserId, categoryId: t.categoryId },
    session: { user: { id: access.session.user.id, discordId: access.session.user.discordId } },
  })
  if (!ticketAccess.canSee) {
    // Friendly 403 — distinguishes "you can't see this" from "doesn't exist"
    // so signed-in users following a link don't see a confusing 404.
    return (
      <main className="container max-w-xl py-10">
        <Card>
          <CardHeader>
            <CardTitle>You don&apos;t have access to this ticket</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Ticket <span className="font-mono">#{t.id}</span> exists in{' '}
              <strong>{biz.name}</strong>, but only the opener, the people on
              the ticket, and staff/admins of this team can view it. If you
              think you should have access, ask an admin to add you to the
              ticket.
            </p>
            <p>
              <Button asChild size="sm" variant="outline">
                <Link href="/dashboard">← Back to dashboard</Link>
              </Button>
            </p>
          </CardContent>
        </Card>
      </main>
    )
  }
  const isAdmin = ticketAccess.isAdmin
  const isStaff = ticketAccess.isStaff

  // All independent queries fire in parallel — was 5-7 sequential round-trips.
  const openerQ = db.select().from(users).where(eq(users.id, t.openerUserId)).limit(1)
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
      authorDiscordId: users.discordId,
    })
    .from(ticketMessages)
    .leftJoin(users, eq(users.id, ticketMessages.authorUserId))
    .where(eq(ticketMessages.ticketId, t.id))
    .orderBy(asc(ticketMessages.createdAt))
  // Audit/lifecycle events for this ticket — merged into the conversation
  // chronologically and listed in full in the Log card below.
  const auditQ = db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
      actorName: users.name,
      actorDiscordId: users.discordId,
    })
    .from(auditLogs)
    .leftJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(eq(auditLogs.ticketId, t.id))
    .orderBy(asc(auditLogs.createdAt))
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
    assigneeRow,
    staff,
    allMessages,
    subTickets,
    parentRow,
    categories,
    auditRows,
  ] = await Promise.all([openerQ, assigneeQ, staffQ, messagesQ, subTicketsQ, parentQ, categoriesQ, auditQ])
  const opener = openerRow[0]
  const assignee = assigneeRow[0] ?? null
  const parentTicket = parentRow[0] ?? null

  // Internal notes are NEVER shown to the opener — even if they reload.
  // Staff and admins see them in a separate panel below the conversation.
  const messages = allMessages.filter((m) => m.source !== 'internal')
  const internalNotes = isStaff ? allMessages.filter((m) => m.source === 'internal') : []

  // P6: people + roles explicitly added to the Discord channel (member + role
  // overwrites). Staff-only, best-effort. Roles matter especially for TicketTool
  // tickets, where access is often granted by role — the People panel shows the
  // full live access list straight off the channel.
  const botToken = process.env.DISCORD_BOT_TOKEN
  const overwrites =
    ticketAccess.canManageMembers && t.discordChannelId && botToken
      ? await fetchChannelOverwrites(botToken, t.discordChannelId).catch(() => ({ memberIds: [] as string[], roleIds: [] as string[] }))
      : { memberIds: [] as string[], roleIds: [] as string[] }
  const peopleIds = overwrites.memberIds
  // Resolve role overwrites → names, dropping @everyone (= guildId, always a
  // deny overwrite on ticket channels and not a "granted role").
  const accessRoleIds = overwrites.roleIds.filter((id) => id !== access.business.discordGuildId)
  const guildRoles =
    accessRoleIds.length && botToken
      ? await fetchGuildRoles(botToken, access.business.discordGuildId).catch(() => [])
      : []
  const accessRoles = accessRoleIds.map((id) => ({
    id,
    name: guildRoles.find((r) => r.id === id)?.name ?? null,
  }))
  const peopleRows = peopleIds.length
    ? await db
        .select({ discordId: users.discordId, name: users.name, image: users.image })
        .from(users)
        .where(inArray(users.discordId, peopleIds))
    : []
  // P16: external members — people granted web-only access via
  // ticket_external_members, not present in any Discord channel overwrite.
  // Merge them into the People list so staff can see + remove them; they
  // were invisible before this commit (only Discord overwrites were listed),
  // which made revoking access impossible from the UI.
  const externalRows = ticketAccess.canManageMembers
    ? await db
        .select({ discordId: users.discordId, name: users.name, image: users.image })
        .from(ticketExternalMembers)
        .innerJoin(users, eq(users.id, ticketExternalMembers.userId))
        .where(eq(ticketExternalMembers.ticketId, t.id))
    : []
  const channelPeople = peopleIds.map(
    (pid) => ({
      ...(peopleRows.find((p) => p.discordId === pid) ?? { discordId: pid, name: null, image: null }),
      isExternal: false,
    }),
  )
  const externalPeople = externalRows
    .filter((r) => !peopleIds.includes(r.discordId))
    .map((r) => ({ ...r, isExternal: true }))
  const people = [...channelPeople, ...externalPeople]

  // Per-guild display identity (server nickname + server avatar) for everyone
  // shown on this ticket — names/avatars reflect THIS team's guild, not the
  // person's global Discord profile. Cached 5 min per (guild, user).
  const identityIds = [
    opener?.discordId,
    assignee?.discordId,
    ...allMessages.map((m) => m.authorDiscordId),
    ...auditRows.map((a) => a.actorDiscordId),
    // The target of member_added/removed/owner_changed events — so the inline
    // status line can show their in-server nickname instead of a raw snowflake.
    ...auditRows.map((a) => (a.metadata as Record<string, unknown> | null)?.discordUserId as string | undefined),
    // The assignee on each `assigned` event — so historical assignees resolve
    // to their nickname too (new rows store the id; old rows parse the mention).
    ...auditRows.map((a) => assigneeDiscordIdFromMeta(a.metadata as Record<string, unknown> | null)),
    ...peopleIds,
  ].filter((x): x is string => !!x)
  const { resolveGuildIdentities } = await import('@/lib/discord')
  const guildIdentities =
    botToken && access.business.discordGuildId
      ? await resolveGuildIdentities(botToken, access.business.discordGuildId, identityIds)
      : new Map<string, { name: string; image: string | null }>()
  const gName = (discordId: string | null | undefined, fallback: string | null | undefined) =>
    (discordId && guildIdentities.get(discordId)?.name) || fallback
  const gImage = (discordId: string | null | undefined, fallback: string | null | undefined) =>
    (discordId && guildIdentities.get(discordId)?.image) || fallback

  // Deep link into the actual Discord client/web at the per-ticket channel.
  const discordChannelUrl =
    t.discordChannelId && access.business.discordGuildId
      ? `https://discord.com/channels/${access.business.discordGuildId}/${t.discordChannelId}`
      : null

  // TicketTool-owned ticket: euphoric controls it only via TicketTool's $
  // commands (rename / add / remove / closeRequest), never by mutating the
  // channel. Hide the native lifecycle controls for these.
  const isExternal = t.externalSource === 'tickettool'
  const canClose = t.status !== 'closed' && ticketAccess.canClose && !isExternal
  const canClaim = t.status !== 'closed' && ticketAccess.canClaim && !isExternal
  const canAssign = canClaim
  // Reopen rules: staff/admin only; closed; AND either a native ticket OR a
  // TicketTool ticket whose channel has been deleted (in which case reopening
  // promotes it to a native ticket — see `reopenTicket` in actions.ts).
  const canReopen =
    t.status === 'closed' &&
    ticketAccess.canClaim &&
    (!isExternal || !t.discordChannelId)
  const canDelete = t.status === 'closed' && ticketAccess.canDeleteChannel && Boolean(t.discordChannelId) && !isExternal
  const canRequestClose = t.status !== 'closed' && ticketAccess.canClose && isExternal
  // Rename now works on native tickets too (renames the Discord channel we own),
  // matching the TicketTool feature.
  const canRename = t.status !== 'closed' && ticketAccess.canManageMembers

  async function claim() { 'use server'; await claimTicket(slug, t.id) }
  async function unclaim() { 'use server'; await unclaimTicket(slug, t.id) }
  async function assign(formData: FormData) { 'use server'; await assignTicket(slug, t.id, formData) }
  async function close() { 'use server'; await closeTicket(slug, t.id) }
  async function reopen() { 'use server'; await reopenTicket(slug, t.id) }
  async function deleteChannel() { 'use server'; await deleteTicketChannel(slug, t.id) }
  async function note(formData: FormData) { 'use server'; await addInternalNote(slug, t.id, formData) }
  async function changeCat(formData: FormData) { 'use server'; await changeTicketCategory(slug, t.id, formData) }
  async function addPerson(formData: FormData) { 'use server'; await addTicketMember(slug, t.id, formData) }
  async function setStatus(formData: FormData) { 'use server'; await setTicketStatus(slug, t.id, formData) }
  async function requestClose() { 'use server'; await requestCloseTicketToolTicket(slug, t.id) }
  async function rename(formData: FormData) {
    'use server'
    if (isExternal) await renameTicketToolTicket(slug, t.id, formData)
    else await renameTicket(slug, t.id, formData)
  }

  return (
    <main className="container max-w-4xl space-y-4 py-6 lg:max-w-6xl">
      <LiveRefresh ticketId={t.id} />
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={isAdmin ? `/tickets?team=${slug}` : '/dashboard'} className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          {isAdmin ? 'All tickets' : 'My tickets'}
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Hash className="h-3 w-3" />
            <span className="font-mono">{t.id}</span>
            {t.kind === 'project' && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary">
                project
              </span>
            )}
            <span>·</span>
            <span>opened {relativeTime(t.openedAt)} by {gName(opener?.discordId, opener?.name) ?? '?'}</span>
          </div>
          {/* Native tickets rename via the pencil here (we own the channel);
              TicketTool tickets keep their rename in the toolbar. */}
          <TitleEditor subject={t.subject} canRename={canRename && !isExternal} action={rename} />

          {parentTicket && (
            <p className="mt-1 text-xs text-muted-foreground">
              Sub-ticket of{' '}
              <Link href={`/b/${slug}/tickets/${parentTicket.id}`} className="font-medium hover:underline">
                #{parentTicket.id} — {parentTicket.subject}
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
          {isExternal && (
            <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-indigo-500">
              TicketTool
            </span>
          )}
          {/* Who it's assigned to. When the Assign dropdown is shown (staff, open,
              native) the assignment rides on the dropdown's label instead, so we
              don't double up and wrap the toolbar — keep this chip only for the
              read-only cases (closed / non-staff / TicketTool). */}
          {assignee && !canAssign && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              assigned to {gName(assignee.discordId, assignee.name) ?? '?'}
            </span>
          )}
          {ticketAccess.canClaim && t.status !== 'closed' && !isExternal && (
            <TicketActionMenu
              triggerLabel="Status"
              variant="outline"
              name="status"
              currentValue={t.status}
              action={setStatus}
              options={[
                { value: 'open', label: 'Open' },
                { value: 'in_progress', label: 'In Progress' },
                { value: 'waiting', label: 'Waiting' },
                { value: 'on_hold', label: 'On Hold' },
                { value: 'completed', label: 'Completed' },
              ]}
            />
          )}
          {canClaim && t.assigneeUserId === null && (
            <form action={claim}><SubmitButton size="sm" variant="secondary">Claim</SubmitButton></form>
          )}
          {canClaim && t.assigneeUserId && (
            <form action={unclaim}><SubmitButton size="sm" variant="outline">Unclaim</SubmitButton></form>
          )}
          {canAssign && (
            <TicketActionMenu
              triggerLabel={assignee ? `Assigned to ${gName(assignee.discordId, assignee.name) ?? '?'}` : 'Assign'}
              variant="secondary"
              name="assigneeId"
              currentValue={t.assigneeUserId ?? ''}
              action={assign}
              options={[
                { value: '', label: '— Unassigned —' },
                ...staff.map((s) => ({ value: s.id, label: s.name ?? s.id.slice(0, 8) })),
              ]}
            />
          )}
          {ticketAccess.canChangeCategory && t.status !== 'closed' && !isExternal && categories.length > 0 && (
            <TicketActionMenu
              triggerLabel="Move"
              variant="outline"
              name="categoryId"
              currentValue={t.categoryId ?? ''}
              action={changeCat}
              options={categories.map((c) => ({
                value: c.id,
                label: `${c.emoji ? `${c.emoji} ` : ''}${c.label}`,
              }))}
            />
          )}
          {/* Native rename lives on the title pencil now; only TicketTool tickets
              (whose channel we don't own) keep the toolbar rename form. */}
          {canRename && isExternal && (
            <form action={rename} className="flex flex-wrap items-center gap-1">
              <input
                name="name"
                required
                maxLength={100}
                placeholder="new-name"
                className="h-8 w-28 rounded-md border bg-background px-2 text-xs"
              />
              <SubmitButton size="sm" variant="outline">Rename</SubmitButton>
            </form>
          )}
          {canRequestClose && (
            <form action={requestClose}>
              <SubmitButton size="sm" variant="outline" pendingChildren="Requesting…">Request close</SubmitButton>
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

      {t.needsAttention && (
        <div className="rounded-md border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          ⚠ This ticket&apos;s Discord channel went missing and was detected on the bot&apos;s last startup
          resync. The transcript here is intact; reopen or close to tidy up.
        </div>
      )}

      {t.status === 'closed' && t.closedAt && (
        <div className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Closed {relativeTime(t.closedAt)}.
          {t.discordChannelId
            ? ' Discord channel was moved to the closed category.'
            : ` Discord channel has been deleted; transcript stays here. Reopen to spin up a fresh channel${isExternal ? ' (which promotes this to a native ticket)' : ''}.`}
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

      <div className="lg:grid lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start lg:gap-4">
        {/* Chat + reply — DOM-first so mobile leads with the conversation; right
            column on wide (16:9) screens. */}
        <div className="space-y-4 lg:col-start-2 lg:row-start-1">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Conversation</CardTitle>
          {auditRows.length > 0 && (
            <Button asChild size="sm" variant="outline">
              <Link href="#ticket-log">Log ({auditRows.length})</Link>
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {messages.length === 0 && auditRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No messages from the web yet. {t.discordChannelId
                ? <>This ticket lives in Discord <code className="font-mono text-xs">#{t.discordChannelId}</code> — the bot is the source of truth there.</>
                : 'Open conversation with a reply below.'}
            </p>
          ) : (
            mergeConversation(messages, auditRows).map((entry) => entry.kind === 'event' ? (
              <div key={`event-${entry.id}`} className="my-1 flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" aria-hidden />
                <span className={`min-w-0 break-words rounded-full px-2 py-0.5 text-center ${eventTone(entry.action, entry.metadata as Record<string, unknown>)}`}>
                  {renderAuditLine(entry, gName)}{' · '}{relativeTime(entry.createdAt)}
                </span>
                <span className="h-px flex-1 bg-border" aria-hidden />
              </div>
            ) : (
              <div key={entry.id} className="flex gap-3">
                <Avatar className="h-8 w-8">
                  {gImage(entry.authorDiscordId, entry.authorImage) && <AvatarImage src={gImage(entry.authorDiscordId, entry.authorImage)!} alt="" />}
                  <AvatarFallback className="text-[10px]">{(gName(entry.authorDiscordId, entry.authorName) ?? 'U').slice(0, 2).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium">{gName(entry.authorDiscordId, entry.authorName) ?? 'Unknown'}</span>
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      via {entry.source}
                    </span>
                    <span className="text-xs text-muted-foreground">{relativeTime(entry.createdAt)}</span>
                  </div>
                  <div className="mt-1 break-words rounded-md bg-muted/40 p-2.5 text-sm">
                    <DiscordMarkdown content={entry.body} />
                  </div>
                  <Attachments ticketId={t.id} messageId={entry.discordMessageId} items={entry.attachments} />
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
        </div>

        {/* People · internal notes · log — left column on wide screens. */}
        <div className="space-y-4 lg:col-start-1 lg:row-start-1">
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
                        {gImage(p.discordId, p.image) && <AvatarImage src={gImage(p.discordId, p.image)!} alt="" />}
                        <AvatarFallback className="text-[9px]">{(gName(p.discordId, p.name) ?? 'U').slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="flex-1 truncate text-sm">
                        {gName(p.discordId, p.name) ?? p.discordId}
                        {p.isExternal && (
                          <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[9px] uppercase tracking-wider text-muted-foreground" title="Web-only access — not in your Discord">
                            external
                          </span>
                        )}
                      </span>
                      {isOpener ? (
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">owner</span>
                      ) : (
                        <div className="flex items-center gap-0.5">
                          <form action={async () => { 'use server'; await setTicketOwner(slug, t.id, p.discordId) }}>
                            <SubmitButton variant="ghost" size="icon" aria-label={`Make ${p.name ?? p.discordId} the owner`} title="Make owner">
                              <Crown className="h-3.5 w-3.5" />
                            </SubmitButton>
                          </form>
                          <form action={async () => { 'use server'; await removeTicketMember(slug, t.id, p.discordId) }}>
                            <SubmitButton variant="ghost" size="icon" aria-label={`Remove ${p.name ?? p.discordId}`} title="Remove from ticket">
                              <X className="h-3.5 w-3.5" />
                            </SubmitButton>
                          </form>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {accessRoles.length > 0 && (
              <div className="border-t pt-3">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Roles with access</p>
                <div className="flex flex-wrap gap-1.5">
                  {accessRoles.map((r) => (
                    <span
                      key={r.id}
                      className="inline-flex items-center rounded-md bg-accent px-1.5 py-0.5 text-xs"
                      title={r.id}
                    >
                      @{r.name ?? r.id}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <form action={addPerson} className="flex items-end gap-2 border-t pt-3">
              <div className="flex-1">
                <DiscordPicker kind="user" guildId={access.business.discordGuildId} name="userId" triggerLabel="Search a member to add…" exclude={peopleIds} />
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
                    {gImage(m.authorDiscordId, m.authorImage) && <AvatarImage src={gImage(m.authorDiscordId, m.authorImage)!} alt="" />}
                    <AvatarFallback className="text-[10px]">{(gName(m.authorDiscordId, m.authorName) ?? 'S').slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium">{gName(m.authorDiscordId, m.authorName) ?? 'Staff'}</span>
                      <span className="text-xs text-muted-foreground">{relativeTime(m.createdAt)}</span>
                    </div>
                    <div className="mt-1 break-words rounded-md bg-background/60 p-2 text-sm">
                      <DiscordMarkdown content={m.body} />
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

      {auditRows.length > 0 && (
        <Card id="ticket-log">
          <CardHeader>
            <CardTitle className="text-base">Log</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-1.5">
              {auditRows.map((a) => (
                <li key={a.id} className="flex items-baseline gap-2 text-xs">
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {new Date(a.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                  <span className="flex-1 text-sm">
                    {renderAuditLine(a, gName)}
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
        </div>
      </div>
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

// ─── conversation / audit merge ─────────────────────────────────────────

type MessageEntry = {
  kind: 'message'
  id: string
  body: string
  source: string
  createdAt: Date
  discordMessageId: string | null
  attachments: Array<{ id: string; name: string; url: string; contentType: string | null; size: number }>
  authorName: string | null
  authorImage: string | null
  authorId: string | null
  authorDiscordId: string | null
}
type EventEntry = {
  kind: 'event'
  id: string
  action: string
  metadata: Record<string, unknown>
  createdAt: Date
  actorName: string | null
  actorDiscordId: string | null
}
type FeedEntry = MessageEntry | EventEntry

type RawMessage = {
  id: string
  body: string
  source: string
  createdAt: Date
  discordMessageId: string | null
  attachments: Array<{ id: string; name: string; url: string; contentType: string | null; size: number }>
  authorName: string | null
  authorImage: string | null
  authorId: string | null
  authorDiscordId: string | null
}
type RawAudit = {
  id: string
  action: string
  metadata: Record<string, unknown>
  createdAt: Date
  actorName: string | null
  actorDiscordId: string | null
}

// Merge ticket_messages + audit_logs into a single chronological feed.
// Stable sort by createdAt; ties broken by kind so messages always render
// before the lifecycle event of the same millisecond (the audit row is
// usually written a hair after the action it records).
function mergeConversation(messages: RawMessage[], audits: RawAudit[]): FeedEntry[] {
  const items: FeedEntry[] = [
    ...messages.map((m): MessageEntry => ({ kind: 'message', ...m })),
    ...audits.map((a): EventEntry => ({ kind: 'event', ...a })),
  ]
  items.sort((a, b) => {
    const t = a.createdAt.getTime() - b.createdAt.getTime()
    if (t !== 0) return t
    if (a.kind === b.kind) return 0
    return a.kind === 'message' ? -1 : 1
  })
  return items
}

// Produce a short human sentence for a lifecycle event. Pulls metadata
// per-action; falls back to a generic "did X" if the payload is missing
// the fields we expect (defensive — the bot and web both write here).
// Color for the inline status pill. Lifecycle close/delete = red, open/reopen =
// green; `status_changed` is tinted by its target workflow status so native
// status changes read at a glance, mirroring the TicketTool close/open colors.
const RED = 'bg-red-500/10 text-red-600 dark:text-red-400'
const GREEN = 'bg-green-500/10 text-green-600 dark:text-green-400'
const AMBER = 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
const BLUE = 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
const NEUTRAL = 'bg-muted/60'

function eventTone(action: string, meta?: Record<string, unknown>): string {
  if (action === 'closed' || action === 'channel_deleted') return RED
  if (action === 'opened' || action === 'reopened') return GREEN
  if (action === 'status_changed') {
    switch (String(meta?.to ?? '')) {
      case 'closed':
        return RED
      case 'completed':
      case 'open':
        return GREEN
      case 'in_progress':
        return BLUE
      case 'waiting':
      case 'on_hold':
        return AMBER
      default:
        return NEUTRAL
    }
  }
  return NEUTRAL
}

// The assignee's Discord id from an `assigned` audit row. New rows store
// `assigneeDiscordId`; older rows only kept the raw `<@id>` mention, so fall
// back to parsing the snowflake out of it — that way the page resolves the
// assignee to the same guild nickname shown in the conversation.
function assigneeDiscordIdFromMeta(meta: Record<string, unknown> | null | undefined): string | undefined {
  if (!meta) return undefined
  if (typeof meta.assigneeDiscordId === 'string') return meta.assigneeDiscordId
  if (typeof meta.assigneeMention === 'string') return meta.assigneeMention.match(/^<@!?(\d+)>$/)?.[1] ?? undefined
  return undefined
}

function renderAuditLine(
  entry: RawAudit | EventEntry,
  gName: (discordId: string | null | undefined, fallback: string | null | undefined) => string | null | undefined,
): React.ReactNode {
  const actor = gName(entry.actorDiscordId, entry.actorName) ?? 'Someone'
  const meta = entry.metadata as Record<string, unknown>
  switch (entry.action) {
    case 'opened':
      return <><strong>{actor}</strong> opened the ticket{meta.categoryLabel ? <> in <em>{String(meta.categoryLabel)}</em></> : null}.</>
    case 'claimed':
      return <><strong>{actor}</strong> claimed the ticket.</>
    case 'unclaimed':
      return <><strong>{actor}</strong> unclaimed the ticket.</>
    case 'status_changed':
      return <><strong>{actor}</strong> set status to <em>{String(meta.to ?? '?')}</em>.</>
    case 'assigned': {
      // Resolve to the same guild identity used in the conversation. New rows
      // carry assigneeDiscordId + assigneeName; older rows only have the raw
      // `<@id>` mention (parsed above) — fall back to it only if nothing resolves.
      const did = assigneeDiscordIdFromMeta(meta)
      const who =
        gName(did, (meta.assigneeName as string | undefined) ?? null) ??
        (meta.assigneeMention ? String(meta.assigneeMention) : null)
      return <><strong>{actor}</strong> assigned the ticket{who ? <> to <em>{who}</em></> : null}.</>
    }
    case 'unassigned':
      return <><strong>{actor}</strong> unassigned the ticket.</>
    case 'category_changed':
      return <><strong>{actor}</strong> moved the ticket{meta.toCategoryLabel ? <> to <em>{String(meta.toCategoryLabel)}</em></> : null}.</>
    case 'member_added': {
      const who = gName(meta.discordUserId as string | undefined, (meta.name as string | undefined) ?? null)
      return <><strong>{actor}</strong> added <em>{who ?? String(meta.discordUserId ?? 'someone')}</em>{meta.isExternal ? ' (external)' : ''} to the ticket.</>
    }
    case 'member_removed': {
      const who = gName(meta.discordUserId as string | undefined, (meta.name as string | undefined) ?? null)
      return <><strong>{actor}</strong> removed <em>{who ?? String(meta.discordUserId ?? 'someone')}</em> from the ticket.</>
    }
    case 'owner_changed': {
      const who = gName(meta.discordUserId as string | undefined, (meta.name as string | undefined) ?? null)
      return <><strong>{actor}</strong> made <em>{who ?? String(meta.discordUserId ?? 'someone')}</em> the ticket owner.</>
    }
    case 'closed':
      return <><strong>{actor}</strong> closed the ticket.</>
    case 'reopened':
      return <><strong>{actor}</strong> reopened the ticket.</>
    case 'channel_deleted':
      return <><strong>{actor}</strong> deleted the Discord channel (transcript kept).</>
    case 'renamed':
      return <><strong>{actor}</strong> renamed the ticket channel.</>
    default:
      return <><strong>{actor}</strong> {entry.action.replace(/_/g, ' ')}.</>
  }
}

