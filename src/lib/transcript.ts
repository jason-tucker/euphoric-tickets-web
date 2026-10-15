// `tickets.external_transcript_url` is written by the bot: a copium.pics paste
// link when a ticket is closed from Discord, or a TicketTool transcript URL for
// imported tickets. It is rendered as an `href`, so only http(s) URLs are
// allowed through — `javascript:`, `data:` and anything unparseable return null.
export function safeTranscriptUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  return u.href
}
