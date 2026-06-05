import 'server-only'

// Web → bot control bridge for bot-owner (sudo) actions: leave a guild, set the
// bot's username. Same transport as the TicketTool/DM bridges — POST to the
// bot's internal HTTP (BOT_INTERNAL_URL) with the shared INTERNAL_TOKEN (falling
// back to the bot token, which both services already share).

type BotResult = { ok: true } | { ok: false; error: string }

function botEndpoint(): { base: string; token: string } | null {
  const base = process.env.BOT_INTERNAL_URL
  const token = process.env.INTERNAL_TOKEN ?? process.env.DISCORD_BOT_TOKEN
  return base && token ? { base, token } : null
}

async function postBot(path: string, body: unknown): Promise<BotResult> {
  const ep = botEndpoint()
  if (!ep) return { ok: false, error: 'Bot internal endpoint not configured (BOT_INTERNAL_URL).' }
  try {
    const res = await fetch(`${ep.base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': ep.token },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error ?? `Bot rejected the request (${res.status}).` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: 'Could not reach the bot: ' + String(err) }
  }
}

// Ask the bot to leave a guild. The team's DB rows are untouched — this only
// severs the bot's Discord membership.
export async function leaveGuild(guildId: string): Promise<BotResult> {
  return postBot('/api/internal/guild/leave', { guildId })
}

// Ask the bot to change its global Discord username. Discord rate-limits this
// hard (≈2/hour); the bot relays its rejection here.
export async function setBotUsername(name: string): Promise<BotResult> {
  return postBot('/api/internal/bot/username', { name })
}
