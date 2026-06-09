'use client'

// The demo conversation feed — message bubbles + lifecycle events merged
// chronologically. Ported from the real ticket-detail renderers (kept pure here
// so the production page is untouched), but it reads names straight off the
// serialized demo rows (no Discord guild-identity lookup) and works on ISO-string
// timestamps that crossed from the server.

import * as React from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { DiscordMarkdown } from '@/components/app/discord-markdown'
import { relativeTime } from '@/lib/format'
import type { DemoMessage, DemoAudit } from '@/server/demo/detail'

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

function renderAuditLine(entry: DemoAudit): React.ReactNode {
  const actor = entry.actorName ?? 'Someone'
  const meta = entry.metadata
  switch (entry.action) {
    case 'opened':
      return <><strong>{actor}</strong> opened the ticket{meta.categoryLabel ? <> in <em>{String(meta.categoryLabel)}</em></> : null}.</>
    case 'claimed':
      return <><strong>{actor}</strong> claimed the ticket.</>
    case 'unclaimed':
      return <><strong>{actor}</strong> unclaimed the ticket.</>
    case 'status_changed':
      return <><strong>{actor}</strong> set status to <em>{String(meta.to ?? '?')}</em>.</>
    case 'assigned':
      return <><strong>{actor}</strong> assigned the ticket{meta.assigneeName ? <> to <em>{String(meta.assigneeName)}</em></> : null}.</>
    case 'unassigned':
      return <><strong>{actor}</strong> unassigned the ticket.</>
    case 'category_changed':
      return <><strong>{actor}</strong> moved the ticket{meta.toCategoryLabel ? <> to <em>{String(meta.toCategoryLabel)}</em></> : null}.</>
    case 'renamed':
      return <><strong>{actor}</strong> renamed the ticket.</>
    case 'closed':
      return <><strong>{actor}</strong> closed the ticket.</>
    case 'reopened':
      return <><strong>{actor}</strong> reopened the ticket.</>
    default:
      return <><strong>{actor}</strong> {entry.action.replace(/_/g, ' ')}.</>
  }
}

type Feed =
  | ({ kind: 'message' } & DemoMessage)
  | ({ kind: 'event' } & DemoAudit)

function merge(messages: DemoMessage[], audit: DemoAudit[]): Feed[] {
  const items: Feed[] = [
    ...messages.map((m): Feed => ({ kind: 'message', ...m })),
    ...audit.map((a): Feed => ({ kind: 'event', ...a })),
  ]
  items.sort((a, b) => {
    const t = Date.parse(a.createdAt) - Date.parse(b.createdAt)
    if (t !== 0) return t
    if (a.kind === b.kind) return 0
    return a.kind === 'message' ? -1 : 1
  })
  return items
}

export function DemoConversation({ messages, audit }: { messages: DemoMessage[]; audit: DemoAudit[] }) {
  if (messages.length === 0 && audit.length === 0) {
    return <p className="text-sm text-muted-foreground">No messages yet. Start the conversation with a reply below.</p>
  }
  return (
    <div className="space-y-3">
      {merge(messages, audit).map((entry) =>
        entry.kind === 'event' ? (
          <div key={`event-${entry.id}`} className="my-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" aria-hidden />
            <span className={`min-w-0 break-words rounded-full px-2 py-0.5 text-center ${eventTone(entry.action, entry.metadata)}`}>
              {renderAuditLine(entry)} · {relativeTime(entry.createdAt)}
            </span>
            <span className="h-px flex-1 bg-border" aria-hidden />
          </div>
        ) : (
          <div key={entry.id} className="flex gap-3">
            <Avatar className="h-8 w-8">
              {entry.authorImage && <AvatarImage src={entry.authorImage} alt="" />}
              <AvatarFallback className="text-[10px]">{(entry.authorName ?? 'U').slice(0, 2).toUpperCase()}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-medium">{entry.authorName ?? 'Unknown'}</span>
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">via {entry.source}</span>
                <span className="text-xs text-muted-foreground">{relativeTime(entry.createdAt)}</span>
              </div>
              <div className="mt-1 break-words rounded-md bg-muted/40 p-2.5 text-sm">
                <DiscordMarkdown content={entry.body} />
              </div>
            </div>
          </div>
        ),
      )}
    </div>
  )
}
