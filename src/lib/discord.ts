// Minimal Discord REST client. We only need two things at runtime:
//   1. The Bot's view of a guild member's roles (for permission resolution).
//   2. Outbound webhook POST with per-user username/avatar overrides.
//
// Auth.js fetches the user's guild list itself via OAuth scopes — we use
// that for "which businesses can this user see" decisions and only fall back
// to bot-token reads when a permission boundary is in question.

const DISCORD_API = 'https://discord.com/api/v10'

export type DiscordGuildLite = {
  id: string
  name: string
  icon: string | null
  // Permissions bitfield as a base-10 string (Discord returns this on the user's
  // /users/@me/guilds list — what they can do in that guild).
  permissions: string
}

export type DiscordGuildMember = {
  user?: { id: string; username: string; global_name: string | null; avatar: string | null }
  nick: string | null
  roles: string[]
}

export async function fetchGuildMemberAsBot(
  botToken: string,
  guildId: string,
  userId: string,
): Promise<DiscordGuildMember | null> {
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
    headers: { Authorization: `Bot ${botToken}` },
    cache: 'no-store',
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`fetchGuildMember failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as DiscordGuildMember
}

export type WebhookPostInput = {
  webhookUrl: string
  username: string
  avatarUrl?: string | null
  content: string
  embeds?: unknown[]
  // Allow the webhook to ping nobody by default — we don't want web replies
  // accidentally pinging the role channel.
  allowedMentions?: { parse?: ('roles' | 'users' | 'everyone')[]; roles?: string[]; users?: string[] }
}

export async function postWebhook(input: WebhookPostInput): Promise<{ id: string } | null> {
  const { webhookUrl, username, avatarUrl, content, embeds, allowedMentions } = input
  // ?wait=true makes Discord return the created message object, so we can
  // persist the discordMessageId on our ticket_messages row.
  const url = webhookUrl.includes('?') ? `${webhookUrl}&wait=true` : `${webhookUrl}?wait=true`
  const body: Record<string, unknown> = {
    username,
    avatar_url: avatarUrl ?? undefined,
    content,
    allowed_mentions: allowedMentions ?? { parse: [] },
  }
  if (embeds) body.embeds = embeds

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Discord webhook POST failed: ${res.status} ${text}`)
  }
  const json = (await res.json()) as { id: string }
  return { id: json.id }
}
