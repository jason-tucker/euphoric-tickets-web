// Text shaping for integration-authored Discord posts (plan §4.3): escaped
// markdown, a server-appended footer, and a webhook username that Discord will
// accept.

// Backslash-escape Discord markdown so integration text renders literally:
//   inline  \ * _ ~ ` | > [ ] <   (the '<' kills <@id>, <#id>, <t:…> tokens)
//   block   line-leading "# ", "## ", "### ", "-# ", "- ", "* ", "+ ", "1. "
// and defuse @everyone / @here with a zero-width joiner. allowed_mentions
// parse:[] already prevents pings; this also stops them rendering as mentions.
export function escapeDiscordMarkdown(input: string): string {
  return input
    .replace(/[\\*_~`|>[\]<]/g, '\\$&')
    .replace(/^([ \t]*)(#{1,3}[ \t]|-#[ \t]|[-+][ \t]|\d+\.[ \t])/gm, '$1\\$2')
    .replace(/@(everyone|here)/gi, '@​$1')
}

// Discord refuses webhook usernames containing "clyde" or "discord"
// (case-insensitive) and the exact names "everyone" / "here". Length is 1–80.
export function isAcceptableWebhookUsername(name: string): boolean {
  const n = name.trim()
  if (n.length < 1 || n.length > 80) return false
  if (/clyde|discord/i.test(n)) return false
  if (/^(everyone|here)$/i.test(n)) return false
  return true
}

function cleanName(raw: string | null | undefined): string {
  // Strip control characters; collapse whitespace; cap at Discord's 80.
  return (raw ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
}

// First acceptable candidate wins; the constant is always acceptable.
export function safeWebhookUsername(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    const n = cleanName(c)
    if (isAcceptableWebhookUsername(n)) return n
  }
  return 'Euphoric Tickets'
}

// `-# via <integration> · <itemRef>` (grey subtext). Both parts escaped.
export function integrationFooter(integrationName: string, itemRef?: string | null): string {
  const name = escapeDiscordMarkdown(cleanName(integrationName) || 'integration')
  const ref = itemRef ? ` · ${escapeDiscordMarkdown(cleanName(itemRef))}` : ''
  return `-# via ${name}${ref}`
}

// Trim already-escaped text to `max` characters (ending in '…') without
// leaving a dangling '\' escape or a lone high surrogate.
export function clampEscaped(escaped: string, max: number): string {
  if (escaped.length <= max) return escaped
  let out = escaped.slice(0, Math.max(0, max - 1))
  const last = out.charCodeAt(out.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1)
  // Drop a trailing odd run of backslashes (a cut escape sequence).
  const run = /\\+$/.exec(out)?.[0].length ?? 0
  if (run % 2 === 1) out = out.slice(0, -1)
  return `${out}…`
}

// Integration text that the BOT renders (card title/lines, subject, close
// reason): escape markdown + defuse mentions here, at the API boundary — the
// bot does not escape again — and fit the bot's per-field length limit.
export function escapeForBot(text: string, max: number): string {
  return clampEscaped(escapeDiscordMarkdown(text), max)
}

// Escaping can up to double the body, so trim the ESCAPED body (never the
// footer) to fit Discord's 2000-char cap, without leaving a dangling '\'.
export function composeIntegrationMessage(body: string, integrationName: string, itemRef?: string | null): string {
  const footer = integrationFooter(integrationName, itemRef)
  const escaped = clampEscaped(escapeDiscordMarkdown(body), 2000 - footer.length - 1)
  return `${escaped}\n${footer}`
}
