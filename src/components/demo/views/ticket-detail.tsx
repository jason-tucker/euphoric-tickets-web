'use client'

// The interactive demo ticket. Reply, claim/unclaim, assign, change status, move
// category, rename, close/reopen, add internal notes — every action writes to the
// per-browser overlay store (localStorage), so the conversation and toolbar update
// instantly and the changes survive reloads. None of it reaches the server.

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ArrowLeft, Hash, Pencil } from 'lucide-react'
import type { DemoTicketBase, DemoAudit } from '@/server/demo/detail'
import { mergeMessages, mergeTicket, useDemoStore, type TicketPatch } from '@/components/demo/store'
import { DemoConversation } from '@/components/demo/conversation'
import { SavedHint } from '@/components/demo/bits'
import { DiscordMarkdown } from '@/components/app/discord-markdown'
import { StatusBadge } from '@/components/app/status-badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { relativeTime } from '@/lib/format'

type Me = { id: string; name: string; image: string | null; discordId: string | null }

const STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
]

// Render the visitor's most-recent overlay actions as log lines so the activity
// feed reflects what they just did.
function derivedAudit(patch: TicketPatch | undefined, me: Me): DemoAudit[] {
  if (!patch) return []
  const at = patch.updatedAt ?? new Date().toISOString()
  const base = { actorName: me.name, actorDiscordId: me.discordId, createdAt: at }
  const out: DemoAudit[] = []
  if (patch.subject) out.push({ id: 'ov-rename', action: 'renamed', metadata: {}, ...base })
  if (patch.categoryId) out.push({ id: 'ov-cat', action: 'category_changed', metadata: { toCategoryLabel: patch.categoryLabel }, ...base })
  if ('assigneeId' in patch && patch.assigneeId) out.push({ id: 'ov-assign', action: 'assigned', metadata: { assigneeName: patch.assigneeName }, ...base })
  if (patch.status === 'closed') out.push({ id: 'ov-status', action: 'closed', metadata: {}, ...base })
  else if (patch.status === 'open') out.push({ id: 'ov-status', action: 'reopened', metadata: {}, ...base })
  else if (patch.status) out.push({ id: 'ov-status', action: 'status_changed', metadata: { to: patch.status }, ...base })
  return out
}

export function DemoTicketDetail({ base, slug, me }: { base: DemoTicketBase; slug: string; me: Me }) {
  const store = useDemoStore()
  const id = base.ticket.id
  const t = mergeTicket(base.ticket, store.overlay)
  const access = base.access
  const isClosed = t.status === 'closed'

  const messages = useMemo(() => mergeMessages(base.messages, store.overlay.messages[id]), [base.messages, store.overlay.messages, id])
  const internalNotes = useMemo(
    () => [...base.internalNotes, ...(store.overlay.internalNotes[id] ?? [])],
    [base.internalNotes, store.overlay.internalNotes, id],
  )
  const audit = useMemo(() => [...base.audit, ...derivedAudit(store.overlay.ticketPatches[id], me)], [base.audit, store.overlay.ticketPatches, id, me])

  const authorStamp = () => ({
    createdAt: new Date().toISOString(),
    authorId: me.id,
    authorName: me.name,
    authorImage: me.image,
    authorDiscordId: me.discordId,
  })

  const setStatus = (status: string) => store.patchTicket(id, { status })
  const assign = (assigneeId: string) => {
    const who = base.assignable.find((s) => s.id === assigneeId)
    store.patchTicket(id, { assigneeId: assigneeId || null, assigneeName: who?.name ?? null, assigneeImage: who?.image ?? null })
  }
  const move = (categoryId: string) => {
    const c = base.categories.find((x) => x.id === categoryId)
    store.patchTicket(id, { categoryId: categoryId || null, categoryLabel: c?.label ?? null, categoryEmoji: c?.emoji ?? null })
  }

  return (
    <main className="container max-w-4xl space-y-4 py-6">
      <div className="text-sm text-muted-foreground">
        <Link href={access.isAdmin || access.isStaff ? '/demo/tickets' : '/demo'} className="inline-flex items-center gap-1 hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          {access.isAdmin || access.isStaff ? 'All tickets' : 'My tickets'}
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Hash className="h-3 w-3" />
            <span className="font-mono">{id}</span>
            {t.externalSource === 'tickettool' && (
              <span className="rounded bg-indigo-500/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-indigo-500">TicketTool</span>
            )}
            <span>·</span>
            <span>opened {relativeTime(t.openedAt)} by {t.openerName ?? '?'}</span>
          </div>
          <TitleRow subject={t.subject} canRename={access.canManageMembers && !isClosed} onRename={(s) => store.patchTicket(id, { subject: s })} />
          <p className="mt-1 text-xs text-muted-foreground">In Discord server <span className="font-medium text-foreground">{t.teamName}</span></p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={t.status} />
          {access.canClaim && !isClosed && (
            <Select label="Status" value={t.status} onChange={setStatus} options={STATUS_OPTIONS} />
          )}
          {access.canClaim && !isClosed && !t.assigneeId && (
            <Button size="sm" variant="secondary" onClick={() => assign(me.id)}>Claim</Button>
          )}
          {access.canClaim && !isClosed && t.assigneeId && (
            <Button size="sm" variant="outline" onClick={() => assign('')}>Unclaim</Button>
          )}
          {access.canClaim && !isClosed && (
            <Select
              label={t.assigneeName ? `Assigned: ${t.assigneeName}` : 'Assign'}
              value={t.assigneeId ?? ''}
              onChange={assign}
              options={[{ value: '', label: '— Unassigned —' }, ...base.assignable.map((s) => ({ value: s.id, label: s.name }))]}
            />
          )}
          {access.canChangeCategory && !isClosed && base.categories.length > 1 && (
            <Select
              label="Move"
              value={t.categoryId ?? ''}
              onChange={move}
              options={base.categories.map((c) => ({ value: c.id, label: `${c.emoji ? `${c.emoji} ` : ''}${c.label}` }))}
            />
          )}
          {access.canClose && !isClosed && (
            <Button size="sm" variant="outline" onClick={() => setStatus('closed')}>Close</Button>
          )}
          {access.canClaim && isClosed && (
            <Button size="sm" variant="secondary" onClick={() => setStatus('open')}>Reopen</Button>
          )}
        </div>
      </div>

      {isClosed && (
        <div className="rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Closed {t.closedAt ? relativeTime(t.closedAt) : 'recently'}. Reopen to continue the conversation.
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Conversation</CardTitle></CardHeader>
        <CardContent>
          <DemoConversation messages={messages} audit={audit} />
        </CardContent>
      </Card>

      {!isClosed && access.canReply && (
        <Card>
          <CardHeader><CardTitle className="text-base">Reply</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <ReplyBox onSend={(body) => store.addMessage(id, { body, source: 'web', ...authorStamp() })} />
            <SavedHint />
          </CardContent>
        </Card>
      )}

      {access.canManageMembers && (
        <Card>
          <CardHeader><CardTitle className="text-base">People</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <ul className="divide-y">
              {base.people.map((p) => (
                <li key={p.discordId} className="flex items-center gap-2 py-1.5">
                  <Avatar className="h-6 w-6">
                    {p.image && <AvatarImage src={p.image} alt="" />}
                    <AvatarFallback className="text-[9px]">{(p.name ?? 'U').slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="flex-1 truncate text-sm">{p.name ?? p.discordId}</span>
                  {p.isOpener && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">owner</span>}
                </li>
              ))}
            </ul>
            {base.accessRoles.length > 0 && (
              <div className="border-t pt-2">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">Roles with access</p>
                <div className="flex flex-wrap gap-1.5">
                  {base.accessRoles.map((r) => (
                    <span key={r.id} className="inline-flex items-center rounded-md bg-accent px-1.5 py-0.5 text-xs">@{r.name}</span>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {access.isStaff && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader><CardTitle className="text-base">Internal notes — staff only</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {internalNotes.length === 0 ? (
              <p className="text-sm text-muted-foreground">No internal notes yet. These are never shown to the opener.</p>
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
                    <div className="mt-1 break-words rounded-md bg-background/60 p-2 text-sm"><DiscordMarkdown content={m.body} /></div>
                  </div>
                </div>
              ))
            )}
            <NoteBox onAdd={(body) => store.addInternalNote(id, { body, source: 'internal', ...authorStamp() })} />
          </CardContent>
        </Card>
      )}

      {audit.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Log</CardTitle></CardHeader>
          <CardContent>
            <ol className="space-y-1.5">
              {audit.map((a) => (
                <li key={a.id} className="flex items-baseline gap-2 text-xs">
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                    {new Date(a.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                  <span className="flex-1 text-sm">
                    <strong>{a.actorName ?? 'Someone'}</strong> {a.action.replace(/_/g, ' ')}
                    {a.metadata.to ? <> → <em>{String(a.metadata.to)}</em></> : null}
                    {a.metadata.assigneeName ? <> to <em>{String(a.metadata.assigneeName)}</em></> : null}.
                  </span>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </main>
  )
}

function TitleRow({ subject, canRename, onRename }: { subject: string; canRename: boolean; onRename: (s: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(subject)
  if (editing) {
    return (
      <form
        className="mt-1 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const v = value.trim()
          if (v) onRename(v)
          setEditing(false)
        }}
      >
        <input value={value} onChange={(e) => setValue(e.target.value)} maxLength={100} autoFocus className="h-9 flex-1 rounded-md border bg-background px-2 text-lg font-semibold" />
        <Button type="submit" size="sm" variant="secondary">Save</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => { setValue(subject); setEditing(false) }}>Cancel</Button>
      </form>
    )
  }
  return (
    <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold">
      <span className="min-w-0 break-words">{subject}</span>
      {canRename && (
        <button type="button" onClick={() => { setValue(subject); setEditing(true) }} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Rename ticket" title="Rename">
          <Pencil className="h-4 w-4" />
        </button>
      )}
    </h1>
  )
}

function ReplyBox({ onSend }: { onSend: (body: string) => void }) {
  const [value, setValue] = useState('')
  const send = () => {
    const v = value.trim()
    if (!v) return
    onSend(v)
    setValue('')
  }
  return (
    <div className="space-y-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') send()
        }}
        rows={3}
        maxLength={2000}
        placeholder="Write a reply… (Cmd/Ctrl+Enter to send)"
        className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
      />
      <Button size="sm" onClick={send} disabled={!value.trim()}>Send reply</Button>
    </div>
  )
}

function NoteBox({ onAdd }: { onAdd: (body: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <form
      className="space-y-2 border-t border-amber-500/20 pt-3"
      onSubmit={(e) => {
        e.preventDefault()
        const v = value.trim()
        if (!v) return
        onAdd(v)
        setValue('')
      }}
    >
      <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={2} maxLength={2000} placeholder="Add an internal note (staff-only)…" className="w-full rounded-md border bg-background px-2 py-1.5 text-sm" />
      <Button type="submit" size="sm" variant="secondary" disabled={!value.trim()}>Add note</Button>
    </form>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="inline-flex items-center gap-1 rounded-md border bg-background px-1.5 py-1 text-xs">
      <span className="text-muted-foreground">{label}:</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent text-xs outline-none">
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}
