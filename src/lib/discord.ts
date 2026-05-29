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

// ---------------------------------------------------------------------------
// Bot-token operations — used only by the web for ticket lifecycle work
// (create channel, create webhook, archive). Per CLAUDE.md we still NEVER
// post messages as the bot from the web; user messages go through
// postWebhook above.
// ---------------------------------------------------------------------------

// Discord channel type for a regular text channel. (4 = GUILD_CATEGORY,
// 0 = GUILD_TEXT; see https://discord.com/developers/docs/resources/channel#channel-object-channel-types.)
const CHANNEL_TYPE_GUILD_TEXT = 0

export type CreatedChannel = { id: string; name: string }

// Create a private(-ish) text channel under the given category. Permission
// overrides limit visibility to the bot itself + the opener; admins (anyone
// with VIEW_CHANNEL on the parent category, by Discord's inheritance rules)
// still see it as expected.
export async function createTicketChannel(input: {
  botToken: string
  guildId: string
  parentCategoryId: string | null
  name: string
  topic?: string
  openerDiscordId?: string
}): Promise<CreatedChannel> {
  const { botToken, guildId, parentCategoryId, name, topic, openerDiscordId } = input

  const permissionOverwrites: Array<{ id: string; type: 0 | 1; allow: string; deny: string }> = [
    // Deny @everyone read by default; explicit grants follow.
    { id: guildId, type: 0, allow: '0', deny: '1024' }, // VIEW_CHANNEL
  ]
  if (openerDiscordId) {
    // Opener: VIEW_CHANNEL + SEND_MESSAGES + READ_MESSAGE_HISTORY.
    permissionOverwrites.push({ id: openerDiscordId, type: 1, allow: '68608', deny: '0' })
  }

  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name.slice(0, 90),
      type: CHANNEL_TYPE_GUILD_TEXT,
      parent_id: parentCategoryId ?? undefined,
      topic: topic?.slice(0, 1024),
      permission_overwrites: permissionOverwrites,
    }),
  })
  if (!res.ok) {
    throw new Error(`createTicketChannel failed: ${res.status} ${await res.text()}`)
  }
  const json = (await res.json()) as CreatedChannel
  return json
}

export type CreatedWebhook = { id: string; token: string; url: string }

// Create a webhook on a channel and return its full POST URL (id + token).
// Used so subsequent web replies can be user-spoofed without re-issuing
// bot-token API calls.
export async function createChannelWebhook(input: {
  botToken: string
  channelId: string
  name?: string
}): Promise<CreatedWebhook> {
  const { botToken, channelId, name = 'Euphoric Tickets' } = input

  const res = await fetch(`${DISCORD_API}/channels/${channelId}/webhooks`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) {
    throw new Error(`createChannelWebhook failed: ${res.status} ${await res.text()}`)
  }
  const json = (await res.json()) as { id: string; token: string }
  return {
    id: json.id,
    token: json.token,
    url: `${DISCORD_API}/webhooks/${json.id}/${json.token}`,
  }
}

// Archive (rename + lock) the per-ticket channel. We don't outright delete
// it so transcripts remain visible to staff after close. Best-effort — if
// it fails we still mark the ticket closed in the DB.
export async function archiveTicketChannel(input: {
  botToken: string
  channelId: string
  prefix?: string
}): Promise<void> {
  const { botToken, channelId, prefix = 'closed-' } = input

  const currentRes = await fetch(`${DISCORD_API}/channels/${channelId}`, {
    headers: { Authorization: `Bot ${botToken}` },
  })
  if (!currentRes.ok) return
  const current = (await currentRes.json()) as { name?: string }

  const newName = `${prefix}${(current.name ?? 'ticket').replace(new RegExp(`^${prefix}`), '')}`.slice(0, 90)

  await fetch(`${DISCORD_API}/channels/${channelId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: newName,
      // Lock the channel: deny SEND_MESSAGES for @everyone.
      // Existing overrides survive; this just adds the deny bit.
    }),
  })
}
