import 'server-only'

// Web → bot bridge for controlling third-party TicketTool tickets.
//
// TicketTool has no API; it's driven by $-prefix message commands posted by a
// bot whose user ID is whitelisted in TicketTool's Server Configs. The web
// layer must never post to Discord as the bot itself (see CLAUDE.md), so for
// TicketTool control we ask OUR bot to emit the command via its internal HTTP
// endpoint. The bot resolves the channel + the business's configured prefix and
// sends `<prefix><action> …` into the TicketTool channel.
//
// Mirrors the env + auth used by the P16 external-member DM in the ticket
// actions: BOT_INTERNAL_URL + INTERNAL_TOKEN (falls back to the bot token).

export type TicketToolAction = 'closeRequest' | 'rename' | 'add' | 'remove'

// Ask the bot to back-grab already-open TicketTool tickets under a team's
// watched categories — used right after an admin links/changes those categories
// so existing tickets appear without waiting for a bot restart. Fire-and-forget
// from the settings save; returns the count (or null if the bot is unreachable).
export async function reconcileTicketTool(businessId: string): Promise<number | null> {
  const botBase = process.env.BOT_INTERNAL_URL
  const internalToken = process.env.INTERNAL_TOKEN ?? process.env.DISCORD_BOT_TOKEN
  if (!botBase || !internalToken) return null
  try {
    const res = await fetch(`${botBase}/api/internal/tickettool/reconcile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': internalToken },
      body: JSON.stringify({ businessId }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { ok?: boolean; count?: number }
    return data.ok ? data.count ?? 0 : null
  } catch {
    return null
  }
}

export async function emitTicketToolCommand(input: {
  ticketId: number
  action: TicketToolAction
  name?: string
  discordUserId?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const botBase = process.env.BOT_INTERNAL_URL
  const internalToken = process.env.INTERNAL_TOKEN ?? process.env.DISCORD_BOT_TOKEN
  if (!botBase || !internalToken) {
    return { ok: false, error: 'Bot internal endpoint not configured' }
  }

  try {
    const res = await fetch(`${botBase}/api/internal/tickettool/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': internalToken },
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `Bot rejected the command (${res.status}) ${text}`.trim() }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: 'Could not reach the bot: ' + String(err) }
  }
}
