'use client'

// P10 (lantern) — a small, dependency-free Discord-markdown renderer. Covers
// the syntax people actually use in tickets so the reply preview shows what
// Discord will render: bold, italic, underline, strikethrough, inline + block
// code, click-to-reveal spoilers, blockquotes, headers, subtext, autolinks,
// inline image/gif embeds, custom + animated emoji (rendered from the Discord
// CDN), and mention pills.

import * as React from 'react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

let keySeq = 0
function k(): string {
  keySeq = (keySeq + 1) % 1_000_000
  return `m${keySeq}`
}

// URLs that point straight at an image/gif (optionally with a query string) get
// embedded inline, like Discord does, instead of rendering as a bare link.
const IMAGE_RE = /\.(gif|png|jpe?g|webp|avif)(\?[^\s]*)?$/i

// Click-to-reveal spoiler — a solid block that hides its contents until clicked,
// matching Discord's `||spoiler||`.
function Spoiler({ children }: { children: React.ReactNode }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation()
        setRevealed(true)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          setRevealed(true)
        }
      }}
      title={revealed ? undefined : 'Spoiler — click to reveal'}
      className={cn(
        'rounded px-0.5 transition-colors',
        revealed
          ? 'bg-foreground/10'
          : 'cursor-pointer select-none bg-foreground/80 text-transparent hover:bg-foreground/70 [&_*]:invisible',
      )}
    >
      {children}
    </span>
  )
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
    // Custom / animated emoji: <:name:id> and <a:name:id> → the actual emoji
    // image from Discord's CDN (animated ones are gifs).
    const emoji = /^<(a?):(\w+):(\d+)>/.exec(text.slice(i))
    if (emoji) {
      flush()
      const animated = emoji[1] === 'a'
      const name = emoji[2]
      const id = emoji[3]
      out.push(
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={k()}
          src={`https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}`}
          alt={`:${name}:`}
          title={`:${name}:`}
          className="inline-block h-[1.25em] w-[1.25em] align-[-0.2em]"
          loading="lazy"
        />,
      )
      i += emoji[0].length
      continue
    }
    // Mentions: <@id> / <@!id> (user), <@&id> (role), <#id> (channel). Without a
    // name source we render a clean pill (the raw id stays in the tooltip).
    const mention = /^<(@[!&]?|#)(\d+)>/.exec(text.slice(i))
    if (mention) {
      flush()
      const prefix = mention[1]
      const id = mention[2]
      const isChannel = prefix === '#'
      const label = isChannel ? '#channel' : prefix === '@&' ? '@role' : '@user'
      out.push(
        <span
          key={k()}
          title={id}
          className={`rounded px-1 py-0.5 text-[0.9em] font-medium ${isChannel ? 'bg-muted text-foreground' : 'bg-primary/15 text-primary'}`}
        >
          {label}
        </span>,
      )
      i += mention[0].length
      continue
    }
    // @everyone / @here.
    if (text[i] === '@') {
      const everyone = /^@(everyone|here)\b/.exec(text.slice(i))
      if (everyone) {
        flush()
        out.push(
          <span key={k()} className="rounded bg-primary/15 px-1 py-0.5 text-[0.9em] font-medium text-primary">
            @{everyone[1]}
          </span>,
        )
        i += everyone[0].length
        continue
      }
    }
    // Autolink — embed inline when it's an image/gif, otherwise a text link.
    const link = /^https?:\/\/[^\s<]+/.exec(text.slice(i))
    if (link) {
      flush()
      const url = link[0]
      if (IMAGE_RE.test(url)) {
        out.push(
          <a key={k()} href={url} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="my-1 block max-h-72 max-w-full rounded-md" loading="lazy" />
          </a>,
        )
      } else {
        out.push(
          <a key={k()} href={url} target="_blank" rel="noopener noreferrer" className="text-primary underline">
            {url}
          </a>,
        )
      }
      i += url.length
      continue
    }
    // Formatting markers (longest first).
    if (tryWrap('**', (n) => <strong key={k()}>{n}</strong>)) continue
    if (tryWrap('__', (n) => <u key={k()}>{n}</u>)) continue
    if (tryWrap('~~', (n) => <s key={k()}>{n}</s>)) continue
    if (tryWrap('||', (n) => <Spoiler>{n}</Spoiler>)) continue
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
