'use client'

// P10 (lantern) — a small, dependency-free Discord-markdown renderer. Covers
// the syntax people actually use in tickets so the reply preview shows what
// Discord will render: bold, italic, underline, strikethrough, inline + block
// code, spoilers, blockquotes, headers, subtext, autolinks, and mention/emoji
// pills. Mentions render as styled `@id` / `#id` pills (name resolution is a
// later nicety — the raw id still shows what you're tagging).

import * as React from 'react'

let keySeq = 0
function k(): string {
  keySeq = (keySeq + 1) % 1_000_000
  return `m${keySeq}`
}

// Inline tokenizer — recursive descent over a single line of text.
function parseInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let i = 0
  let buf = ''
  const flush = () => {
    if (buf) {
      out.push(buf)
      buf = ''
    }
  }

  const tryWrap = (marker: string, render: (inner: React.ReactNode[]) => React.ReactNode): boolean => {
    if (!text.startsWith(marker, i)) return false
    const end = text.indexOf(marker, i + marker.length)
    if (end === -1) return false
    const inner = text.slice(i + marker.length, end)
    if (inner.length === 0) return false
    flush()
    out.push(<React.Fragment key={k()}>{render(parseInline(inner))}</React.Fragment>)
    i = end + marker.length
    return true
  }

  while (i < text.length) {
    // Inline code — literal contents, highest precedence.
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1)
      if (end !== -1) {
        flush()
        out.push(
          <code key={k()} className="rounded bg-background/70 px-1 py-0.5 font-mono text-[0.85em]">
            {text.slice(i + 1, end)}
          </code>,
        )
        i = end + 1
        continue
      }
    }
    // Mentions / channels / roles / custom emoji.
    const mention = /^<(@!?|@&|#|a?:[\w]+:)(\d+)>/.exec(text.slice(i))
    if (mention) {
      flush()
      const kind = mention[1]
      const id = mention[2]
      let label = `@${id}`
      let cls = 'bg-primary/15 text-primary'
      if (kind === '#') {
        label = `#${id}`
      } else if (kind === '@&') {
        label = `@&${id}`
      } else if (kind.endsWith(':')) {
        const name = /^a?:([\w]+):$/.exec(kind)?.[1] ?? 'emoji'
        label = `:${name}:`
        cls = 'bg-muted text-foreground'
      }
      out.push(
        <span key={k()} className={`rounded px-1 py-0.5 text-[0.9em] font-medium ${cls}`}>
          {label}
        </span>,
      )
      i += mention[0].length
      continue
    }
    // Autolink.
    const link = /^https?:\/\/[^\s<]+/.exec(text.slice(i))
    if (link) {
      flush()
      out.push(
        <a key={k()} href={link[0]} target="_blank" rel="noopener noreferrer" className="text-primary underline">
          {link[0]}
        </a>,
      )
      i += link[0].length
      continue
    }
    // Formatting markers (longest first).
    if (tryWrap('**', (n) => <strong key={k()}>{n}</strong>)) continue
    if (tryWrap('__', (n) => <u key={k()}>{n}</u>)) continue
    if (tryWrap('~~', (n) => <s key={k()}>{n}</s>)) continue
    if (tryWrap('||', (n) => <span key={k()} className="rounded bg-foreground/30 text-foreground/30 hover:text-foreground">{n}</span>)) continue
    if (tryWrap('*', (n) => <em key={k()}>{n}</em>)) continue
    if (tryWrap('_', (n) => <em key={k()}>{n}</em>)) continue

    buf += text[i]
    i++
  }
  flush()
  return out
}

export function DiscordMarkdown({ content }: { content: string }) {
  if (!content.trim()) {
    return <span className="text-muted-foreground">Nothing to preview yet.</span>
  }

  const blocks: React.ReactNode[] = []
  // Split out triple-backtick code blocks first.
  const segments = content.split(/(```[\s\S]*?```)/g)
  for (const seg of segments) {
    if (seg.startsWith('```') && seg.endsWith('```') && seg.length >= 6) {
      const inner = seg.slice(3, -3).replace(/^[\w-]*\n/, '') // drop optional lang line
      blocks.push(
        <pre key={k()} className="overflow-x-auto rounded bg-background/70 p-2 font-mono text-xs">
          {inner}
        </pre>,
      )
      continue
    }
    // Line-based handling for the non-code segment.
    const lines = seg.split('\n')
    lines.forEach((line, idx) => {
      if (line.startsWith('### ')) {
        blocks.push(<div key={k()} className="text-sm font-semibold">{parseInline(line.slice(4))}</div>)
      } else if (line.startsWith('## ')) {
        blocks.push(<div key={k()} className="text-base font-semibold">{parseInline(line.slice(3))}</div>)
      } else if (line.startsWith('# ')) {
        blocks.push(<div key={k()} className="text-lg font-bold">{parseInline(line.slice(2))}</div>)
      } else if (line.startsWith('-# ')) {
        blocks.push(<div key={k()} className="text-[11px] text-muted-foreground">{parseInline(line.slice(3))}</div>)
      } else if (line.startsWith('> ')) {
        blocks.push(
          <blockquote key={k()} className="border-l-2 border-muted-foreground/40 pl-2 text-muted-foreground">
            {parseInline(line.slice(2))}
          </blockquote>,
        )
      } else if (line.length === 0) {
        // Preserve blank lines between text (but not a trailing one).
        if (idx < lines.length - 1) blocks.push(<div key={k()} className="h-2" />)
      } else {
        blocks.push(<div key={k()} className="whitespace-pre-wrap break-words">{parseInline(line)}</div>)
      }
    })
  }

  return <div className="space-y-0.5 text-sm leading-relaxed">{blocks}</div>
}
