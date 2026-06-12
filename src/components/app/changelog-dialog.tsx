'use client'

import * as React from 'react'
// The *user-facing* changelog — a curated list of changes people would
// actually notice, kept separately from the full engineering CHANGELOG.md.
// Inlined at build time via the `asset/source` webpack rule (next.config.ts).
import changelog from '../../../CHANGELOG.user.md'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

// The version label in the footer; clicking it opens the changelog.
export function ChangelogDialog({ version }: { version: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="font-mono underline-offset-2 transition-colors hover:text-foreground hover:underline"
          aria-label="View changelog"
        >
          v{version}
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>What&apos;s new</DialogTitle>
          <DialogDescription>The changes you&apos;d notice in Euphoric Tickets.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[70svh] space-y-1.5 overflow-y-auto pr-1 text-sm leading-relaxed">
          {renderMarkdown(changelog)}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Minimal Markdown renderer for our own changelog — handles the subset we
// actually write: `##`/`###` headings, `-` bullet lists (one nesting level),
// and inline `**bold**`, `` `code` ``, and `[label](url)` links. Content is
// our own file, rendered as React text nodes (no dangerouslySetInnerHTML), so
// there's no injection surface.
function renderMarkdown(md: string): React.ReactNode {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks: React.ReactNode[] = []
  let list: { text: string; nested: boolean }[] = []

  const flushList = (key: string) => {
    if (list.length === 0) return
    const items = list
    list = []
    blocks.push(
      <ul key={key} className="ml-4 list-disc space-y-1 text-muted-foreground">
        {items.map((it, i) => (
          <li key={i} className={it.nested ? 'ml-4' : undefined}>
            {renderInline(it.text, `${key}-${i}`)}
          </li>
        ))}
      </ul>,
    )
  }

  lines.forEach((raw, idx) => {
    const line = raw.replace(/\s+$/, '')
    const key = `b${idx}`

    const bullet = /^(\s*)[-*] (.*)$/.exec(line)
    if (bullet) {
      list.push({ text: bullet[2], nested: bullet[1].length >= 2 })
      return
    }
    flushList(`ul${idx}`)

    if (!line.trim()) return
    if (line.startsWith('# ')) return // top-level title — dialog is already titled
    if (line.startsWith('## ')) {
      blocks.push(
        <h3
          key={key}
          className="mt-4 border-t pt-3 font-semibold text-foreground first:mt-0 first:border-0 first:pt-0"
        >
          {renderInline(line.slice(3), key)}
        </h3>,
      )
      return
    }
    if (line.startsWith('### ')) {
      blocks.push(
        <h4 key={key} className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {renderInline(line.slice(4), key)}
        </h4>,
      )
      return
    }
    blocks.push(
      <p key={key} className="text-muted-foreground">
        {renderInline(line, key)}
      </p>,
    )
  })
  flushList('ul-end')

  return blocks
}

const INLINE_RE = /(\*\*(.+?)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  INLINE_RE.lastIndex = 0
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    if (m[1] !== undefined) {
      nodes.push(
        <strong key={`${keyPrefix}-s${i}`} className="font-semibold text-foreground">
          {m[2]}
        </strong>,
      )
    } else if (m[3] !== undefined) {
      nodes.push(
        <code key={`${keyPrefix}-c${i}`} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {m[4]}
        </code>,
      )
    } else if (m[5] !== undefined) {
      nodes.push(
        <a
          key={`${keyPrefix}-a${i}`}
          href={m[7]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline"
        >
          {m[6]}
        </a>,
      )
    }
    last = m.index + m[0].length
    i++
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}
