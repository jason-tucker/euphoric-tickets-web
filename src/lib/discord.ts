// Minimal Discord REST client. We only need two things at runtime:
//   1. The Bot's view of a guild member's roles (for permission resolution).
//   2. Outbound webhook POST with per-user username/avatar overrides.
//
// Auth.js fetches the user's guild list itself via OAuth scopes — we use
// that for "which businesses can this user see" decisions and only fall back
// to bot-token reads when a permission boundary is in question.

const DISCORD_API = 'https://discord.com/api/v10'

// Every Discord REST call here runs in the request path of a server action or
// route handler. Without a timeout a slow/hung Discord response (or a stored
// per-business webhook URL that stops responding) would pin the Node request
// indefinitely and tie up the action. Bound every call with an AbortSignal;
// callers may still pass their own `signal` to override.
const DISCORD_TIMEOUT_MS = 10_000
function discordFetch(input: string, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(DISCORD_TIMEOUT_MS) })
}

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
  const res = await discordFetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
    headers: { Authorization: `Bot ${botToken}` },
    cache: 'no-store',
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`fetchGuildMember failed: ${res.status} ${await res.text()}`)
  return (await res.json()) as DiscordGuildMember & { avatar?: string | null }
}

// List the guilds the BOT itself is in (bot token). Used by the sudo Bot
// dashboard's force-leave list. `/users/@me/guilds` returns up to 200 guilds
// per page; this bot is well under that, so we don't paginate.
export async function fetchBotGuilds(
  botToken: string,
): Promise<Array<{ id: string; name: string; icon: string | null }>> {
  const res = await discordFetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { Authorization: `Bot ${botToken}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`fetchBotGuilds failed: ${res.status} ${await res.text()}`)
  const raw = (await res.json()) as Array<{ id: string; name: string; icon: string | null }>
  return raw.map((g) => ({ id: g.id, name: g.name, icon: g.icon ?? null }))
}

// ===== P3 (lantern) — guild directory bulk lookups ==========================
// Used by the searchable Discord picker on the settings + members surfaces.
// All three use the bot token; the bot must be in the guild and have the
// GUILD_MEMBERS intent (already enabled in bot/client.ts).

export type DiscordGuildChannel = {
  id: string
  name: string
  // 0 = GUILD_TEXT, 4 = GUILD_CATEGORY, 5 = GUILD_ANNOUNCEMENT, 11 = PUBLIC_THREAD, 12 = PRIVATE_THREAD.
  type: number
  parent_id: string | null
  position: number
}

export type DiscordGuildRole = {
  id: string
  name: string
  color: number
  position: number
  managed: boolean
}

export type DiscordGuildMemberLite = {
  id: string
  name: string
  image: string | null
}

export async function fetchGuildChannels(
  botToken: string,
  guildId: string,
): Promise<DiscordGuildChannel[]> {
  const res = await discordFetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${botToken}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`fetchGuildChannels failed: ${res.status} ${await res.text()}`)
  const raw = (await res.json()) as Array<{ id: string; name: string; type: number; parent_id: string | null; position: number }>
  return raw.map((c) => ({ id: c.id, name: c.name, type: c.type, parent_id: c.parent_id ?? null, position: c.position ?? 0 }))
}

export async function fetchGuildRoles(
  botToken: string,
  guildId: string,
): Promise<DiscordGuildRole[]> {
  const res = await discordFetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
    headers: { Authorization: `Bot ${botToken}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`fetchGuildRoles failed: ${res.status} ${await res.text()}`)
  const raw = (await res.json()) as Array<{ id: string; name: string; color: number; position: number; managed: boolean }>
  return raw.map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.position, managed: r.managed }))
}

// `query` empty → first 100 members (Discord's default ordering, not very
// useful but fine for tiny guilds). `query` non-empty → up to 25 members
// matching a username prefix. The picker debounces per-keystroke calls.
export async function fetchGuildMembers(
  botToken: string,
  guildId: string,
  query?: string,
): Promise<DiscordGuildMemberLite[]> {
  const path = query
    ? `/guilds/${guildId}/members/search?query=${encodeURIComponent(query)}&limit=25`
    : `/guilds/${guildId}/members?limit=100`
  const res = await discordFetch(`${DISCORD_API}${path}`, {
    headers: { Authorization: `Bot ${botToken}` },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`fetchGuildMembers failed: ${res.status} ${await res.text()}`)
  type Raw = {
    user?: { id: string; username: string; global_name: string | null; avatar: string | null }
    nick: string | null
    avatar?: string | null
  }
  const raw = (await res.json()) as Raw[]
  return raw
    .filter((m) => !!m.user?.id)
    .map((m) => {
      const u = m.user!
      const name = m.nick ?? u.global_name ?? u.username
      // Prefer the per-guild member avatar when present (Discord stores it
      // under /guilds/{gid}/users/{uid}/avatars/{hash} — different CDN
      // path from the user-level avatar).
      const guildAvatar = m.avatar
      const image = guildAvatar
        ? `https://cdn.discordapp.com/guilds/${guildId}/users/${u.id}/avatars/${guildAvatar}.png`
        : u.avatar
          ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png`
          : null
      return { id: u.id, name, image }
    })
}

// Resolve the best display identity for a user inside a specific guild.
// Falls back gracefully when the bot can't see the guild or the user isn't
// a member: returns the caller's globalName + globalAvatarUrl untouched.
//
// Guild member avatars live at a different CDN path than user avatars —
// see https://discord.com/developers/docs/reference#image-formatting.
export async function resolveWebhookIdentity(input: {
  botToken: string | undefined
  guildId: string | null
  discordUserId: string
  globalName: string
  globalAvatarUrl: string | null
}): Promise<{ username: string; avatarUrl: string | null }> {
  const { botToken, guildId, discordUserId, globalName, globalAvatarUrl } = input

  if (!botToken || !guildId) return { username: globalName, avatarUrl: globalAvatarUrl }

  try {
    const member = await fetchGuildMemberAsBot(botToken, guildId, discordUserId)
    if (!member) return { username: globalName, avatarUrl: globalAvatarUrl }

    const username = member.nick ?? globalName
    let avatarUrl = globalAvatarUrl
    const memberAvatar = (member as { avatar?: string | null }).avatar
    if (memberAvatar) {
      const ext = memberAvatar.startsWith('a_') ? 'gif' : 'png'
      avatarUrl = `https://cdn.discordapp.com/guilds/${guildId}/users/${discordUserId}/avatars/${memberAvatar}.${ext}?size=128`
    }
    return { username, avatarUrl }
  } catch {
    return { username: globalName, avatarUrl: globalAvatarUrl }
  }
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
  // SUPPRESS_NOTIFICATIONS — Discord delivers the message without pinging
  // anyone or pushing a notification. Used by the conversation replay on
  // reopen so the new channel doesn't notification-spam staff.
  silent?: boolean
}

export async function postWebhook(input: WebhookPostInput): Promise<{ id: string } | null> {
  const { webhookUrl, username, avatarUrl, content, embeds, allowedMentions, silent } = input
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
  if (silent) body.flags = 1 << 12 // SUPPRESS_NOTIFICATIONS

  const res = await discordFetch(url, {
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

  const res = await discordFetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
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

  const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/webhooks`, {
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

// Archive the per-ticket channel on close: rename with `closed-` prefix, and
// optionally move it under a different Discord category (the per-business or
// per-ticket-category "closed" destination). We don't outright delete the
// channel so transcripts remain visible to staff. Best-effort — if anything
// here fails we still mark the ticket closed in the DB.
export async function archiveTicketChannel(input: {
  botToken: string
  channelId: string
  closedCategoryId?: string | null
  prefix?: string
}): Promise<void> {
  const { botToken, channelId, closedCategoryId, prefix = 'closed-' } = input

  const currentRes = await discordFetch(`${DISCORD_API}/channels/${channelId}`, {
    headers: { Authorization: `Bot ${botToken}` },
  })
  if (!currentRes.ok) return
  const current = (await currentRes.json()) as { name?: string; parent_id?: string | null }

  const newName = `${prefix}${(current.name ?? 'ticket').replace(new RegExp(`^${prefix}`), '')}`.slice(0, 90)

  const patch: Record<string, unknown> = { name: newName }
  if (closedCategoryId) patch.parent_id = closedCategoryId

  await discordFetch(`${DISCORD_API}/channels/${channelId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

// Inverse of `archiveTicketChannel`: strip the `closed-` prefix and move the
// channel back to a chosen parent category. Used by reopen for native tickets
// whose channel was archived (not deleted). Best-effort — no throw on 404 so
// a reopen still completes its DB writes if Discord disagrees.
export async function unarchiveTicketChannel(input: {
  botToken: string
  channelId: string
  parentId: string | null
  prefix?: string
}): Promise<void> {
  const { botToken, channelId, parentId, prefix = 'closed-' } = input

  const currentRes = await discordFetch(`${DISCORD_API}/channels/${channelId}`, {
    headers: { Authorization: `Bot ${botToken}` },
  })
  if (!currentRes.ok) return
  const current = (await currentRes.json()) as { name?: string; parent_id?: string | null }

  const stripped = (current.name ?? 'ticket').replace(new RegExp(`^${prefix}`), '')
  const patch: Record<string, unknown> = { name: stripped.slice(0, 90) }
  if (parentId) patch.parent_id = parentId

  await discordFetch(`${DISCORD_API}/channels/${channelId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

// Rename a ticket channel (native euphoric tickets — we own the channel). The
// caller passes the already-formatted Discord channel name.
export async function renameDiscordChannel(
  botToken: string,
  channelId: string,
  name: string,
): Promise<void> {
  await discordFetch(`${DISCORD_API}/channels/${channelId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.slice(0, 90) }),
  })
}

// Create a private thread off a ticket channel for staff-only internal
// notes. Created lazily on the first internal note. Type 12 = PRIVATE_THREAD.
export async function createPrivateThread(input: {
  botToken: string
  channelId: string
  name: string
}): Promise<{ id: string }> {
  const { botToken, channelId, name } = input
  const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/threads`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: name.slice(0, 90),
      type: 12, // PRIVATE_THREAD
      auto_archive_duration: 10080, // 7 days
      invitable: false,
    }),
  })
  if (!res.ok) {
    throw new Error(`createPrivateThread failed: ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as { id: string }
}

// Post a message into a thread using the bot's identity. (Threads can't
// take webhook posts the same way channels do, so internal notes use the
// bot identity instead of the per-user spoof. Acceptable because internal
// notes are never user-visible.)
export async function postBotMessageToThread(input: {
  botToken: string
  threadId: string
  content: string
}): Promise<{ id: string }> {
  const { botToken, threadId, content } = input
  const res = await discordFetch(`${DISCORD_API}/channels/${threadId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: content.slice(0, 2000),
      allowed_mentions: { parse: [] },
    }),
  })
  if (!res.ok) {
    throw new Error(`postBotMessageToThread failed: ${res.status} ${await res.text()}`)
  }
  return (await res.json()) as { id: string }
}

// Per-guild display identity (server nickname + server avatar) for a member.
// Falls back to global name/avatar when the member has no per-guild override,
// and to null entirely if they're not in the guild. Cached 5 min per
// (guild, user) so the ticket page's SSE re-renders don't re-hit Discord.
const identityCache = new Map<string, { at: number; v: { name: string; image: string | null } | null }>()
const IDENTITY_TTL_MS = 5 * 60 * 1000

export async function fetchGuildMemberIdentity(
  botToken: string,
  guildId: string,
  userId: string,
): Promise<{ name: string; image: string | null } | null> {
  const key = `${guildId}:${userId}`
  const cached = identityCache.get(key)
  if (cached && Date.now() - cached.at < IDENTITY_TTL_MS) return cached.v

  const m = (await fetchGuildMemberAsBot(botToken, guildId, userId).catch(() => null)) as
    | (DiscordGuildMember & { avatar?: string | null })
    | null

  let v: { name: string; image: string | null } | null = null
  if (m?.user) {
    const name = m.nick ?? m.user.global_name ?? m.user.username
    const image = m.avatar
      ? `https://cdn.discordapp.com/guilds/${guildId}/users/${userId}/avatars/${m.avatar}.png`
      : m.user.avatar
        ? `https://cdn.discordapp.com/avatars/${userId}/${m.user.avatar}.png`
        : null
    v = { name, image }
  }
  identityCache.set(key, { at: Date.now(), v })
  return v
}

// Resolve several members' per-guild identities at once → Map keyed by user id.
export async function resolveGuildIdentities(
  botToken: string,
  guildId: string,
  userIds: string[],
): Promise<Map<string, { name: string; image: string | null }>> {
  const out = new Map<string, { name: string; image: string | null }>()
  const unique = [...new Set(userIds.filter(Boolean))]
  await Promise.all(
    unique.map(async (uid) => {
      const v = await fetchGuildMemberIdentity(botToken, guildId, uid)
      if (v) out.set(uid, v)
    }),
  )
  return out
}

// A member's role IDs within a guild (bot-token read), cached ~5 min per
// (guild,user). The tickets console uses this to decide whether the viewer
// holds a real staff role in a team — independent of the cached
// business_members role snapshot, which is empty for admins/sudo (their roles
// are never fetched during permission resolution).
const memberRolesCache = new Map<string, { at: number; roles: string[] | null }>()
const MEMBER_ROLES_TTL_MS = 5 * 60 * 1000

export async function fetchGuildMemberRoles(
  botToken: string,
  guildId: string,
  userId: string,
): Promise<string[] | null> {
  const key = `${guildId}:${userId}`
  const cached = memberRolesCache.get(key)
  if (cached && Date.now() - cached.at < MEMBER_ROLES_TTL_MS) return cached.roles

  const m = await fetchGuildMemberAsBot(botToken, guildId, userId).catch(() => null)
  const roles = m?.roles ?? null
  memberRolesCache.set(key, { at: Date.now(), roles })
  return roles
}

// P16: fetch any Discord user by id (works for users NOT in a shared guild).
export async function fetchDiscordUser(
  botToken: string,
  userId: string,
): Promise<{ id: string; name: string; image: string | null } | null> {
  const res = await discordFetch(`${DISCORD_API}/users/${userId}`, {
    headers: { Authorization: `Bot ${botToken}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const u = (await res.json()) as { id: string; username: string; global_name: string | null; avatar: string | null }
  return {
    id: u.id,
    name: u.global_name ?? u.username,
    image: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png` : null,
  }
}

// P6: list the per-user (type 1) permission overwrites on a ticket channel —
// i.e. the people explicitly added to the ticket. Returns their user ids.
//
// Perf: the ticket page re-renders on every new message (SSE → router.refresh),
// so this would otherwise GET /channels/{id} per message. A short in-process
// TTL cache collapses bursts; channel membership changes rarely.
const channelMembersCache = new Map<string, { at: number; ids: string[] }>()
const CHANNEL_MEMBERS_TTL_MS = 20_000

export async function fetchChannelMemberIds(botToken: string, channelId: string): Promise<string[]> {
  const cached = channelMembersCache.get(channelId)
  if (cached && Date.now() - cached.at < CHANNEL_MEMBERS_TTL_MS) return cached.ids

  const res = await discordFetch(`${DISCORD_API}/channels/${channelId}`, {
    headers: { Authorization: `Bot ${botToken}` },
    cache: 'no-store',
  })
  if (!res.ok) return cached?.ids ?? []
  const ch = (await res.json()) as { permission_overwrites?: Array<{ id: string; type: number }> }
  const ids = (ch.permission_overwrites ?? []).filter((o) => o.type === 1).map((o) => o.id)
  channelMembersCache.set(channelId, { at: Date.now(), ids })
  return ids
}

const channelOverwritesCache = new Map<string, { at: number; memberIds: string[]; roleIds: string[] }>()

// Like fetchChannelMemberIds but returns BOTH member (type 1) and role (type 0)
// overwrites, so the People panel can show who AND which roles have access — the
// full access list a TicketTool channel carries. Returns the raw `@everyone`
// role (= guildId) too; callers filter it out when rendering.
export async function fetchChannelOverwrites(
  botToken: string,
  channelId: string,
): Promise<{ memberIds: string[]; roleIds: string[] }> {
  const cached = channelOverwritesCache.get(channelId)
  if (cached && Date.now() - cached.at < CHANNEL_MEMBERS_TTL_MS) {
    return { memberIds: cached.memberIds, roleIds: cached.roleIds }
  }
  const res = await discordFetch(`${DISCORD_API}/channels/${channelId}`, {
    headers: { Authorization: `Bot ${botToken}` },
    cache: 'no-store',
  })
  if (!res.ok) return cached ? { memberIds: cached.memberIds, roleIds: cached.roleIds } : { memberIds: [], roleIds: [] }
  const ch = (await res.json()) as { permission_overwrites?: Array<{ id: string; type: number }> }
  const ow = ch.permission_overwrites ?? []
  const memberIds = ow.filter((o) => o.type === 1).map((o) => o.id)
  const roleIds = ow.filter((o) => o.type === 0).map((o) => o.id)
  channelOverwritesCache.set(channelId, { at: Date.now(), memberIds, roleIds })
  return { memberIds, roleIds }
}

// P6: grant a user access to a ticket channel (member overwrite, type 1).
export async function addChannelMember(botToken: string, channelId: string, userId: string): Promise<void> {
  // ViewChannel|SendMessages|ReadMessageHistory|AttachFiles|EmbedLinks
  const ALLOW = String((1 << 10) | (1 << 11) | (1 << 16) | (1 << 15) | (1 << 14))
  const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/permissions/${userId}`, {
    method: 'PUT',
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 1, allow: ALLOW, deny: '0' }),
  })
  if (!res.ok) throw new Error(`addChannelMember failed: ${res.status} ${await res.text()}`)
}

// P6: revoke a user's channel overwrite.
export async function removeChannelMember(botToken: string, channelId: string, userId: string): Promise<void> {
  const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/permissions/${userId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bot ${botToken}` },
  })
  if (!res.ok && res.status !== 404) {
    throw new Error(`removeChannelMember failed: ${res.status} ${await res.text()}`)
  }
}

// P5: move a ticket channel under a new Discord parent category and grant the
// new category's staff roles channel access (additive — existing overwrites
// stay). Best-effort; mirrors the bot's changeTicketCategory.
export async function changeTicketChannelCategory(input: {
  botToken: string
  channelId: string
  parentId: string | null
  grantRoleIds: string[]
}): Promise<void> {
  const { botToken, channelId, parentId, grantRoleIds } = input
  const headers = { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' }

  if (parentId) {
    await discordFetch(`${DISCORD_API}/channels/${channelId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ parent_id: parentId }),
    }).catch((err) => console.error('[changeTicketChannelCategory] move failed', err))
  }

  // ViewChannel|SendMessages|ReadMessageHistory|AttachFiles|EmbedLinks
  const ALLOW = String((1 << 10) | (1 << 11) | (1 << 16) | (1 << 15) | (1 << 14))
  for (const roleId of grantRoleIds) {
    await discordFetch(`${DISCORD_API}/channels/${channelId}/permissions/${roleId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ type: 0, allow: ALLOW, deny: '0' }),
    }).catch((err) => console.error('[changeTicketChannelCategory] grant failed', err))
  }
}

// Fetch a FRESH signed CDN URL for one attachment. Discord's attachment URLs
// expire (~24h), so the web never serves the stored URL directly for audio —
// it re-fetches the message via the bot token and returns the attachment's
// current `.url`. The browser then streams from Discord's CDN; nothing is
// stored on the VPS. Returns null if the channel/message/attachment is gone.
export async function fetchFreshAttachmentUrl(
  botToken: string,
  channelId: string,
  messageId: string,
  attachmentId: string,
): Promise<string | null> {
  const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
    headers: { Authorization: `Bot ${botToken}` },
    cache: 'no-store',
  })
  if (!res.ok) return null
  const msg = (await res.json()) as { attachments?: Array<{ id: string; url: string }> }
  const att = msg.attachments?.find((a) => a.id === attachmentId)
  return att?.url ?? null
}

// Post a small, silent subtext status line into a ticket channel for
// lifecycle events (claim/assign/close/reopen/add/remove). Mirrors the
// bot's postTicketStatus.
//
//   `-# `  → grey subtext (footer-sized).
//   flags 1<<12 (SUPPRESS_NOTIFICATIONS) → "@silent", no ping/badge.
//   allowed_mentions parse:[] → <@id> renders as a name, never pings.
//
// Posted as the bot (system content, not user content) — this is the one
// place the web posts a bot-authored line, and it's deliberately NOT a
// reply (replies still go via the per-user webhook spoof). NEVER call this
// for internal-note activity.
//
// Best-effort: returns silently on failure so it can't break the action.
export async function postChannelStatus(input: {
  botToken: string
  channelId: string
  text: string
}): Promise<void> {
  const { botToken, channelId, text } = input
  try {
    const res = await discordFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `-# ${text}`,
        flags: 1 << 12, // SUPPRESS_NOTIFICATIONS
        allowed_mentions: { parse: [] },
      }),
    })
    if (!res.ok && res.status !== 404) {
      console.error('[postChannelStatus] failed', res.status, await res.text())
    }
  } catch (err) {
    console.error('[postChannelStatus] threw', err)
  }
}

// Hard-delete a Discord channel (used by the manual delete button on a
// closed ticket). The DB row + ticket_messages stay so transcripts survive.
export async function deleteDiscordChannel(input: {
  botToken: string
  channelId: string
}): Promise<void> {
  const { botToken, channelId } = input
  const res = await discordFetch(`${DISCORD_API}/channels/${channelId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bot ${botToken}` },
  })
  // 404 = already gone — that's fine.
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteDiscordChannel failed: ${res.status} ${await res.text()}`)
  }
}
