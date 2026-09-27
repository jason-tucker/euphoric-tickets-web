// Integration API — public /api/v1/* handlers (plan §4.2–§4.3).
//
// Route files under src/app/api/v1/** are thin wrappers around these
// functions; the bot / Discord / notify seams are injected (`ApiDeps`) so the
// tests can drive the real DB with fake network edges.
//
// Scoping invariants (every handler):
//   • the caller is the integration row the key resolved to, and its team;
//   • every /tickets/:id* lookup is `id AND integration_id AND business_id`,
//     so a foreign ticket is indistinguishable from a missing one (404);
//   • categories resolve by (key.business_id, categoryKey) AND must be listed
//     in allowed_category_keys;
//   • card.link.url must have origin === integrations.link_origin.

import { and, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '@/db/client'
import {
  integrationTicketState,
  ticketCategories,
  ticketMessages,
  tickets,
  users,
  type Business,
  type Integration,
  type Ticket,
  type TicketMessage,
} from '@/db/schema'
import {
  DiscordHttpError,
  fetchGuildMemberAsBot,
  fetchGuildRoles,
  postChannelStatus,
  postWebhook,
  type DiscordGuildMember,
  type DiscordGuildRole,
} from '@/lib/discord'
import { writeAudit } from '@/server/audit'
import { authenticateIntegration, hasScope, type IntegrationContext } from './auth'
import { writeIntegrationAudit } from './audit'
import { BotUnavailableError, DISCORD_WEBHOOK_URL_RE, defaultBotOps, type BotOps } from './botClient'
import { composeIntegrationMessage, escapeDiscordMarkdown, escapeForBot, safeWebhookUsername } from './discordText'
import { BodyError, apiError, apiJson, parseTicketId, readJsonBody, validationError } from './http'

// ---- dependency seams -------------------------------------------------------

type NotifyFn = (ctx: {
  event: 'reply'
  businessId: string
  categoryId: string | null
  ticketId: number
  subject: string
  slug: string
  actorUserId?: string | null
}) => Promise<void>

export type DiscordOps = {
  postWebhook: typeof postWebhook
  fetchGuildMember: typeof fetchGuildMemberAsBot
  fetchGuildRoles: typeof fetchGuildRoles
  postChannelStatus: typeof postChannelStatus
}

export type ApiDeps = {
  bot: BotOps
  discord: DiscordOps
  botToken: () => string | undefined
  notify: NotifyFn
}

export function defaultApiDeps(): ApiDeps {
  return {
    bot: defaultBotOps,
    discord: {
      postWebhook,
      fetchGuildMember: fetchGuildMemberAsBot,
      fetchGuildRoles,
      postChannelStatus,
    },
    botToken: () => process.env.DISCORD_BOT_TOKEN,
    notify: async (ctx) => {
      const { notify } = await import('@/server/notify')
      await notify(ctx)
    },
  }
}

// ---- shared helpers ---------------------------------------------------------

const SNOWFLAKE = z.string().regex(/^\d{17,20}$/, 'must be a Discord snowflake')
// Visible ASCII, no whitespace/control chars — used for client-chosen refs.
const REF = (max: number) => z.string().regex(new RegExp(`^[\\x21-\\x7e]{1,${max}}$`), `1-${max} visible ASCII chars`)
// Single-line text: no control characters (tabs/newlines included).
const LINE = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), 'control characters are not allowed')

function publicBase(): string {
  return (process.env.PUBLIC_BASE_URL ?? 'https://tickets.euphoric.fm').replace(/\/+$/, '')
}

function csv(input: string | null | undefined): string[] {
  return (input ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}

async function loadScopedTicket(ctx: IntegrationContext, id: number): Promise<Ticket | null> {
  const [t] = await db
    .select()
    .from(tickets)
    .where(
      and(eq(tickets.id, id), eq(tickets.integrationId, ctx.integration.id), eq(tickets.businessId, ctx.business.id)),
    )
    .limit(1)
  return t ?? null
}

export type TicketView = {
  ticketId: number
  status: string
  claimedBy: string | null
  closedAt: string | null
  webUrl: string
  discordChannelUrl: string | null
}

async function ticketView(t: Ticket, business: Business): Promise<TicketView> {
  let claimedBy: string | null = null
  if (t.assigneeUserId) {
    const [u] = await db.select({ discordId: users.discordId }).from(users).where(eq(users.id, t.assigneeUserId)).limit(1)
    claimedBy = u?.discordId ?? null
  }
  return {
    ticketId: t.id,
    status: t.status,
    claimedBy,
    closedAt: t.closedAt ? t.closedAt.toISOString() : null,
    webUrl: `${publicBase()}/b/${business.slug}/tickets/${t.id}`,
    discordChannelUrl: t.discordChannelId ? `https://discord.com/channels/${business.discordGuildId}/${t.discordChannelId}` : null,
  }
}

async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown
  try {
    raw = await readJsonBody(req)
  } catch (err) {
    if (err instanceof BodyError) return { ok: false, response: apiError(err.status, err.code) }
    throw err
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) return { ok: false, response: validationError(parsed.error) }
  return { ok: true, data: parsed.data }
}

function botUnavailable(err: unknown, where: string): Response {
  const cls = err instanceof BotUnavailableError ? err.errorClass : 'unexpected'
  console.warn(`[integration-api] ${where}: bot unavailable`, { errorClass: cls })
  return apiError(502, 'bot_unavailable')
}

// The staff role set for a ticket's category: the category's own staff
// roles ∪ the team-wide "Team Member" roles (businesses.staff_role_ids) ∪ the
// team's admin ("Team Manager") roles (businesses.admin_role_ids).
//
// This is THE staff set for integration actor checks, and the bot's
// close-actor rule uses the identical union. It is purely role-based:
// Discord ManageGuild / ADMINISTRATOR permissions and the sudo flag do NOT
// make an actor staff here. (The ticket opener additionally counts for POST
// /messages only; see checkActor.)
export function staffRoleIdsForCategory(
  business: Pick<Business, 'staffRoleIds' | 'adminRoleIds'>,
  category: { staffRoleIds: string } | null,
): string[] {
  return [...new Set([...csv(category?.staffRoleIds), ...csv(business.staffRoleIds), ...csv(business.adminRoleIds)])]
}

type ActorOk = { ok: true; member: DiscordGuildMember & { avatar?: string | null; pending?: boolean }; userId: string | null }

// actorDiscordId rule for POST /messages (plan §4.3): the integration must
// have actor_impersonation, AND a LIVE bot-token lookup must show the actor is
// a (non-pending) guild member who holds a role in staffRoleIdsForCategory, or
// is the ticket's opener. Otherwise 403 `actor_forbidden`. Only the member's
// role list is consulted — never permissions or sudo.
async function checkActor(
  ctx: IntegrationContext,
  ticket: Ticket,
  actorDiscordId: string,
  deps: ApiDeps,
): Promise<ActorOk | { ok: false; response: Response }> {
  if (!ctx.integration.actorImpersonation) return { ok: false, response: apiError(403, 'actor_forbidden') }
  const botToken = deps.botToken()
  if (!botToken) return { ok: false, response: apiError(502, 'discord_unavailable') }

  let member: (DiscordGuildMember & { avatar?: string | null; pending?: boolean }) | null
  try {
    member = await deps.discord.fetchGuildMember(botToken, ctx.business.discordGuildId, actorDiscordId)
  } catch {
    return { ok: false, response: apiError(502, 'discord_unavailable') }
  }
  if (!member || member.pending) return { ok: false, response: apiError(403, 'actor_forbidden') }

  const [opener] = await db.select({ discordId: users.discordId }).from(users).where(eq(users.id, ticket.openerUserId)).limit(1)
  let category: { staffRoleIds: string } | null = null
  if (ticket.categoryId) {
    ;[category] = await db
      .select({ staffRoleIds: ticketCategories.staffRoleIds })
      .from(ticketCategories)
      .where(eq(ticketCategories.id, ticket.categoryId))
      .limit(1)
  }
  const staffRoles = staffRoleIdsForCategory(ctx.business, category ?? null)
  const isStaff = member.roles.some((r) => staffRoles.includes(r))
  const isOpener = opener?.discordId === actorDiscordId
  if (!isStaff && !isOpener) return { ok: false, response: apiError(403, 'actor_forbidden') }

  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.discordId, actorDiscordId)).limit(1)
  return { ok: true, member, userId: u?.id ?? null }
}

// ---- POST /api/v1/tickets -----------------------------------------------------

// Leaves ~2.5 KB of the bot's 16 KB cap for the integration id/slug/name/business id.
export const BOT_BODY_BUDGET = 13_500
// Discord rejects a link button whose URL is longer than 512 characters.
export const LINK_URL_MAX = 512

const openSchema = z
  .object({
    categoryKey: z.string().min(1).max(64),
    openerDiscordId: SNOWFLAKE,
    subject: LINE(100),
    card: z
      .object({
        title: LINE(100),
        lines: z.array(LINE(200)).max(25),
        link: z.object({ label: LINE(40), url: z.string().max(LINK_URL_MAX).url() }).strict(),
      })
      .strict(),
    externalRef: REF(100),
  })
  .strict()
  // The bot's internal routes cap bodies at 16 KB (plan §4.4); 25 lines of
  // 200 multi-byte chars can exceed that, so bound the forwarded payload here
  // (422) instead of surfacing the bot's refusal as a 502.
  .refine((v) => Buffer.byteLength(JSON.stringify(v), 'utf8') <= BOT_BODY_BUDGET, {
    message: `request too large for the bot bridge (max ${BOT_BODY_BUDGET} bytes of UTF-8 JSON)`,
    path: ['card'],
  })

export async function handleOpenTicket(req: Request, deps: ApiDeps = defaultApiDeps()): Promise<Response> {
  const auth = await authenticateIntegration(req, { scope: 'tickets:write', open: true })
  if (!auth.ok) return auth.response
  const ctx = auth.ctx
  const body = await parseBody(req, openSchema)
  if (!body.ok) return body.response
  const input = body.data

  // Link origin must equal the integration's configured origin exactly.
  let linkOrigin: string | null = null
  let linkHref = ''
  try {
    const u = new URL(input.card.link.url)
    linkOrigin = u.origin
    linkHref = u.href
  } catch {
    linkOrigin = null
  }
  if (!ctx.integration.linkOrigin || linkOrigin !== ctx.integration.linkOrigin) {
    return apiError(422, 'validation', undefined, {
      issues: [{ path: 'card.link.url', message: 'origin is not the integration link_origin' }],
    })
  }
  // URL normalisation (percent-encoding) can lengthen it; Discord checks the
  // serialised form, so bound that too.
  if (linkHref.length > LINK_URL_MAX) {
    return apiError(422, 'validation', undefined, {
      issues: [{ path: 'card.link.url', message: `at most ${LINK_URL_MAX} characters once normalised` }],
    })
  }

  // Category: (key's business, categoryKey) AND allowlisted on the key.
  if (!ctx.integration.allowedCategoryKeys.includes(input.categoryKey)) return apiError(403, 'category_forbidden')
  const [category] = await db
    .select({ id: ticketCategories.id })
    .from(ticketCategories)
    .where(and(eq(ticketCategories.businessId, ctx.business.id), eq(ticketCategories.key, input.categoryKey)))
    .limit(1)
  if (!category) return apiError(403, 'category_forbidden')

  // The bot renders subject and card as Discord markdown in its own messages
  // (welcome card, templates) and does not escape them, so escape + defuse
  // mentions here and fit the bot's field limits (subject/title 100, line 200).
  const forwarded = {
    subject: escapeForBot(input.subject, 100),
    card: {
      title: escapeForBot(input.card.title, 100),
      lines: input.card.lines.map((l) => escapeForBot(l, 200)),
      link: input.card.link,
    },
  }
  if (Buffer.byteLength(JSON.stringify({ ...input, ...forwarded }), 'utf8') > BOT_BODY_BUDGET) {
    return apiError(422, 'validation', undefined, {
      issues: [{ path: 'card', message: `request too large for the bot bridge once escaped (max ${BOT_BODY_BUDGET} bytes of UTF-8 JSON)` }],
    })
  }

  let result
  try {
    result = await deps.bot.openTicket({
      integrationId: ctx.integration.id,
      integrationSlug: ctx.integration.slug,
      integrationName: ctx.integration.name,
      businessId: ctx.business.id,
      categoryKey: input.categoryKey,
      openerDiscordId: input.openerDiscordId,
      subject: forwarded.subject,
      card: forwarded.card,
      externalRef: input.externalRef,
    })
  } catch (err) {
    return botUnavailable(err, 'open')
  }

  if (!result.ok) {
    if (result.code === 'opening_in_progress') return apiError(409, result.code, { 'Retry-After': '5' })
    // ticket_channel_missing is not transient: no Retry-After.
    return apiError(result.status, result.code)
  }

  // The bot reports the ticket id; re-read it under OUR scope before handing
  // anything back (a mismatch means a bot bug, never data for this caller).
  const ticket = await loadScopedTicket(ctx, result.ticketId)
  if (!ticket || ticket.externalRef !== input.externalRef) {
    console.warn('[integration-api] open: bot returned a ticket outside this integration scope')
    return apiError(502, 'bot_unavailable')
  }

  await db
    .insert(integrationTicketState)
    .values({
      ticketId: ticket.id,
      lastStatus: ticket.status,
      lastAssignee: ticket.assigneeUserId,
      msgCursorCreatedAt: ticket.openedAt,
      msgCursorId: null,
    })
    .onConflictDoNothing()

  await writeIntegrationAudit({
    integrationId: ctx.integration.id,
    businessId: ctx.business.id,
    action: 'ticket.opened',
    metadata: { ticketId: ticket.id, created: result.created, externalRef: input.externalRef, categoryKey: input.categoryKey },
  })

  const view = await ticketView(ticket, ctx.business)
  return apiJson(result.created ? 201 : 200, {
    ticketId: ticket.id,
    number: ticket.id,
    webUrl: view.webUrl,
    discordChannelUrl: view.discordChannelUrl,
    created: result.created,
  })
}

// ---- GET /api/v1/tickets/:id ------------------------------------------------

export async function handleGetTicket(req: Request, rawId: string): Promise<Response> {
  const auth = await authenticateIntegration(req, { scope: 'tickets:read' })
  if (!auth.ok) return auth.response
  const id = parseTicketId(rawId)
  const ticket = id ? await loadScopedTicket(auth.ctx, id) : null
  if (!ticket) return apiError(404, 'not_found')
  const v = await ticketView(ticket, auth.ctx.business)
  return apiJson(200, {
    status: v.status,
    claimedBy: v.claimedBy,
    closedAt: v.closedAt,
    webUrl: v.webUrl,
    discordChannelUrl: v.discordChannelUrl,
  })
}

// ---- PATCH /api/v1/tickets/:id ----------------------------------------------

const patchSchema = z
  .object({
    status: z.enum(['in_progress', 'waiting', 'on_hold', 'completed', 'closed']),
    actorDiscordId: SNOWFLAKE.optional(),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict()

const STATUS_LABEL: Record<string, string> = {
  in_progress: 'In Progress',
  waiting: 'Waiting',
  on_hold: 'On Hold',
  completed: 'Completed',
}

export async function handlePatchTicket(req: Request, rawId: string, deps: ApiDeps = defaultApiDeps()): Promise<Response> {
  const auth = await authenticateIntegration(req, { scope: 'tickets:write' })
  if (!auth.ok) return auth.response
  const ctx = auth.ctx
  const id = parseTicketId(rawId)
  const ticket = id ? await loadScopedTicket(ctx, id) : null
  if (!ticket) return apiError(404, 'not_found')

  const body = await parseBody(req, patchSchema)
  if (!body.ok) return body.response
  const input = body.data

  if (input.status === 'closed' && !hasScope(ctx.integration, 'tickets:close')) {
    return apiError(403, 'scope_missing', undefined, { required: 'tickets:close' })
  }
  if (ticket.status === 'closed') return apiError(409, 'already_closed')

  if (input.status === 'closed') {
    // The bot decides the closer: the actor if given AND in the shared staff
    // set (staffRoleIdsForCategory — the opener does NOT count for close),
    // else the bot itself; it reports which as closedBy. Web only gates
    // impersonation here.
    if (input.actorDiscordId && !ctx.integration.actorImpersonation) return apiError(403, 'actor_forbidden')
    let res
    try {
      res = await deps.bot.closeTicket({
        ticketId: ticket.id,
        businessId: ctx.business.id,
        integrationId: ctx.integration.id,
        ...(input.actorDiscordId ? { actorDiscordId: input.actorDiscordId } : {}),
        // The bot puts the reason in the opener's DM unescaped: escape here.
        ...(input.reason ? { reason: escapeForBot(input.reason, 500) } : {}),
      })
    } catch (err) {
      return botUnavailable(err, 'close')
    }
    if (!res.ok) return res.status === 404 ? apiError(404, 'not_found') : apiError(409, 'already_closed')
    await writeIntegrationAudit({
      integrationId: ctx.integration.id,
      businessId: ctx.business.id,
      action: 'ticket.closed',
      metadata: { ticketId: ticket.id, actorDiscordId: input.actorDiscordId ?? null, closedBy: res.closedBy },
    })
    const fresh = (await loadScopedTicket(ctx, ticket.id)) ?? ticket
    const v = await ticketView(fresh, ctx.business)
    return apiJson(200, {
      status: 'closed',
      claimedBy: v.claimedBy,
      closedAt: v.closedAt,
      webUrl: v.webUrl,
      discordChannelUrl: v.discordChannelUrl,
      closedBy: res.closedBy,
    })
  }

  // Non-closing workflow status. Conditional on "not closed" so a racing
  // close always wins.
  const [updated] = await db
    .update(tickets)
    .set({ status: input.status, lastActivityAt: sql`now()` })
    .where(and(eq(tickets.id, ticket.id), sql`${tickets.status} <> 'closed'`))
    .returning()
  if (!updated) return apiError(409, 'already_closed')

  if (ticket.status !== input.status) {
    const botToken = deps.botToken()
    if (botToken && ticket.discordChannelId) {
      await deps.discord.postChannelStatus({
        botToken,
        channelId: ticket.discordChannelId,
        text: `Ticket status set to ${STATUS_LABEL[input.status]} by ${escapeDiscordMarkdown(ctx.integration.name)}`,
      })
    }
    await writeAudit({
      businessId: ctx.business.id,
      ticketId: ticket.id,
      actorUserId: null,
      action: 'status_changed',
      metadata: { from: ticket.status, to: input.status, via: `integration:${ctx.integration.slug}` },
    })
    await writeIntegrationAudit({
      integrationId: ctx.integration.id,
      businessId: ctx.business.id,
      action: 'ticket.status_changed',
      metadata: { ticketId: ticket.id, from: ticket.status, to: input.status },
    })
  }
  const v = await ticketView(updated, ctx.business)
  return apiJson(200, { status: v.status, claimedBy: v.claimedBy, closedAt: v.closedAt, webUrl: v.webUrl, discordChannelUrl: v.discordChannelUrl })
}

// ---- POST /api/v1/tickets/:id/messages --------------------------------------

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{1,128}$/
// A stored message that never reached Discord is re-posted by a replay only
// once it is older than this (the first attempt may still be in flight).
export const REPOST_AFTER_SEC = 30

const messageSchema = z
  .object({
    kind: z.enum(['system', 'comment']),
    body: z.string().min(1).max(1800),
    itemRef: LINE(100).optional(),
    actorDiscordId: SNOWFLAKE.optional(),
  })
  .strict()

type PostIdentity = { username: string; avatarUrl: string | null }

function memberIdentity(
  guildId: string,
  actorDiscordId: string,
  m: DiscordGuildMember & { avatar?: string | null },
): { name: string | null; avatarUrl: string | null } {
  const name = m.nick ?? m.user?.global_name ?? m.user?.username ?? null
  let avatarUrl: string | null = null
  if (m.avatar) {
    const ext = m.avatar.startsWith('a_') ? 'gif' : 'png'
    avatarUrl = `https://cdn.discordapp.com/guilds/${guildId}/users/${actorDiscordId}/avatars/${m.avatar}.${ext}?size=128`
  } else if (m.user?.avatar) {
    avatarUrl = `https://cdn.discordapp.com/avatars/${actorDiscordId}/${m.user.avatar}.png?size=128`
  }
  return { name, avatarUrl }
}

// Post one stored integration message to the ticket's channel webhook and
// record the Discord message id. Returns the Discord id, or an error Response.
async function deliverMessageRow(
  ctx: IntegrationContext,
  ticket: Ticket,
  row: TicketMessage,
  identity: PostIdentity,
  deps: ApiDeps,
): Promise<{ ok: true; discordMessageId: string } | { ok: false; response: Response }> {
  let webhookUrl = ticket.discordWebhookUrl && DISCORD_WEBHOOK_URL_RE.test(ticket.discordWebhookUrl) ? ticket.discordWebhookUrl : null
  if (!webhookUrl) {
    try {
      const ensured = await deps.bot.ensureWebhook({ ticketId: ticket.id, businessId: ctx.business.id, integrationId: ctx.integration.id })
      webhookUrl = ensured.webhookUrl
      await db
        .update(tickets)
        .set({ discordWebhookUrl: ensured.webhookUrl, discordWebhookId: ensured.webhookId })
        .where(eq(tickets.id, ticket.id))
    } catch (err) {
      return { ok: false, response: botUnavailable(err, 'webhook/ensure') }
    }
  }

  const meta = (row.metadata ?? {}) as { itemRef?: string | null }
  const content = composeIntegrationMessage(row.body, ctx.integration.name, meta.itemRef ?? null)
  let posted: { id: string } | null
  try {
    posted = await deps.discord.postWebhook({
      webhookUrl,
      username: identity.username,
      avatarUrl: identity.avatarUrl,
      content,
      allowedMentions: { parse: [] },
    })
  } catch (err) {
    // A deleted webhook: forget it so the next attempt re-ensures one.
    if (err instanceof DiscordHttpError && (err.status === 404 || err.status === 401)) {
      await db
        .update(tickets)
        .set({ discordWebhookUrl: null, discordWebhookId: null })
        .where(and(eq(tickets.id, ticket.id), eq(tickets.discordWebhookUrl, webhookUrl)))
    }
    console.warn('[integration-api] message post failed', {
      ticketId: ticket.id,
      status: err instanceof DiscordHttpError ? err.status : null,
    })
    return { ok: false, response: apiError(502, 'discord_unavailable', { 'Retry-After': '30' }, { messageId: row.id }) }
  }
  if (!posted?.id) return { ok: false, response: apiError(502, 'discord_unavailable', { 'Retry-After': '30' }, { messageId: row.id }) }

  await db.update(ticketMessages).set({ discordMessageId: posted.id }).where(eq(ticketMessages.id, row.id))
  return { ok: true, discordMessageId: posted.id }
}

// For an undelivered message: its Discord id if it was delivered meanwhile,
// else how long until a replay may take the re-post lease (DB clock).
async function inFlightStatus(messageId: string): Promise<{ discordMessageId: string | null; retryAfterSec: number } | null> {
  const [row] = await db
    .select({
      discordMessageId: ticketMessages.discordMessageId,
      retryAfterSec: sql<number>`GREATEST(1, CEIL(GREATEST(
        EXTRACT(EPOCH FROM (${ticketMessages.createdAt} + make_interval(secs => ${REPOST_AFTER_SEC}) - now())),
        COALESCE(EXTRACT(EPOCH FROM ((${ticketMessages.metadata}->>'repostAt')::timestamptz + make_interval(secs => ${REPOST_AFTER_SEC}) - now())), 0)
      )))::int`,
    })
    .from(ticketMessages)
    .where(eq(ticketMessages.id, messageId))
    .limit(1)
  return row ? { discordMessageId: row.discordMessageId, retryAfterSec: Number(row.retryAfterSec) } : null
}

export async function handlePostMessage(req: Request, rawId: string, deps: ApiDeps = defaultApiDeps()): Promise<Response> {
  const auth = await authenticateIntegration(req, { scope: 'tickets:write' })
  if (!auth.ok) return auth.response
  const ctx = auth.ctx
  const id = parseTicketId(rawId)
  const ticket = id ? await loadScopedTicket(ctx, id) : null
  if (!ticket) return apiError(404, 'not_found')

  const idemKey = req.headers.get('idempotency-key')
  if (!idemKey || !IDEMPOTENCY_KEY_RE.test(idemKey)) {
    return apiError(422, 'validation', undefined, {
      issues: [{ path: 'Idempotency-Key', message: 'required header: 1-128 chars of [A-Za-z0-9._:-]' }],
    })
  }
  const body = await parseBody(req, messageSchema)
  if (!body.ok) return body.response
  const input = body.data

  const findExisting = async () => {
    const [existing] = await db
      .select()
      .from(ticketMessages)
      .where(and(eq(ticketMessages.ticketId, ticket.id), eq(ticketMessages.idempotencyKey, idemKey)))
      .limit(1)
    return existing ?? null
  }

  if (ticket.status === 'closed') {
    // A replay of a message accepted before the close still gets its answer.
    const existing = await findExisting()
    if (existing) return apiJson(200, { messageId: existing.id, discordMessageId: existing.discordMessageId, created: false })
    return apiError(409, 'ticket_closed')
  }

  // Actor gate BEFORE anything is stored.
  let identity: PostIdentity = { username: safeWebhookUsername(ctx.integration.name), avatarUrl: null }
  let authorUserId: string | null = null
  if (input.actorDiscordId) {
    const actor = await checkActor(ctx, ticket, input.actorDiscordId, deps)
    if (!actor.ok) return actor.response
    authorUserId = actor.userId
    const who = memberIdentity(ctx.business.discordGuildId, input.actorDiscordId, actor.member)
    identity = { username: safeWebhookUsername(who.name, ctx.integration.name), avatarUrl: who.avatarUrl }
  }

  // (1) Claim the idempotency key.
  const [inserted] = await db
    .insert(ticketMessages)
    .values({
      ticketId: ticket.id,
      authorUserId,
      body: input.body,
      source: 'system',
      authorKind: 'integration',
      idempotencyKey: idemKey,
      metadata: {
        integrationId: ctx.integration.id,
        itemRef: input.itemRef ?? null,
        actorDiscordId: input.actorDiscordId ?? null,
        kind: input.kind,
      },
    })
    .onConflictDoNothing({ target: [ticketMessages.ticketId, ticketMessages.idempotencyKey] })
    .returning()

  if (!inserted) {
    // (2) Conflict: answer with the existing row. Re-post only when it never
    // reached Discord AND is older than 30 s; the conditional UPDATE below is
    // the single-winner lease for that re-post (metadata.repostAt).
    // Both age checks use the DATABASE clock (no app/DB skew).
    const existing = await findExisting()
    if (!existing) return apiError(409, 'conflict')
    if (existing.discordMessageId) {
      return apiJson(200, { messageId: existing.id, discordMessageId: existing.discordMessageId, created: false })
    }
    const [leased] = await db
      .update(ticketMessages)
      .set({ metadata: sql`${ticketMessages.metadata} || jsonb_build_object('repostAt', now())` })
      .where(
        and(
          eq(ticketMessages.id, existing.id),
          sql`${ticketMessages.discordMessageId} IS NULL`,
          sql`${ticketMessages.createdAt} < now() - make_interval(secs => ${REPOST_AFTER_SEC})`,
          sql`(${ticketMessages.metadata}->>'repostAt' IS NULL OR (${ticketMessages.metadata}->>'repostAt')::timestamptz < now() - make_interval(secs => ${REPOST_AFTER_SEC}))`,
        ),
      )
      .returning()
    if (!leased) {
      // No lease: either the first attempt is still in flight (row < 30 s
      // old), another replay holds the re-post lease, or the row was just
      // delivered. Only a non-null discordMessageId means "delivered"; an
      // undelivered row is NOT reported as success (the in-flight attempt may
      // still fail, and then nobody would retry).
      const st = await inFlightStatus(existing.id)
      if (st?.discordMessageId) return apiJson(200, { messageId: existing.id, discordMessageId: st.discordMessageId, created: false })
      return apiError(409, 'in_progress', { 'Retry-After': String(st?.retryAfterSec ?? REPOST_AFTER_SEC) }, { messageId: existing.id })
    }
    const repost = await deliverMessageRow(ctx, ticket, leased, identity, deps)
    if (!repost.ok) return repost.response
    return apiJson(200, { messageId: existing.id, discordMessageId: repost.discordMessageId, created: false })
  }

  // (3) Post, (4) record the Discord id.
  const delivered = await deliverMessageRow(ctx, ticket, inserted, identity, deps)
  if (!delivered.ok) return delivered.response

  await db.update(tickets).set({ lastActivityAt: sql`now()` }).where(eq(tickets.id, ticket.id))
  void deps
    .notify({
      event: 'reply',
      businessId: ctx.business.id,
      categoryId: ticket.categoryId,
      ticketId: ticket.id,
      subject: ticket.subject,
      slug: ctx.business.slug,
      actorUserId: authorUserId,
    })
    .catch(() => {})

  return apiJson(201, { messageId: inserted.id, discordMessageId: delivered.discordMessageId, created: true })
}

// ---- GET /api/v1/guild/roles -------------------------------------------------

const ROLES_TTL_MS = 5 * 60_000
const rolesCache = new Map<string, { at: number; roles: DiscordGuildRole[] }>()

export async function handleGuildRoles(req: Request, deps: ApiDeps = defaultApiDeps()): Promise<Response> {
  const auth = await authenticateIntegration(req, { scope: 'guild:read' })
  if (!auth.ok) return auth.response
  const guildId = auth.ctx.business.discordGuildId
  const cached = rolesCache.get(guildId)
  let roles = cached && Date.now() - cached.at < ROLES_TTL_MS ? cached.roles : null
  if (!roles) {
    const botToken = deps.botToken()
    if (!botToken) return apiError(502, 'discord_unavailable')
    try {
      roles = await deps.discord.fetchGuildRoles(botToken, guildId)
    } catch {
      return apiError(502, 'discord_unavailable')
    }
    rolesCache.set(guildId, { at: Date.now(), roles })
  }
  return apiJson(200, roles.map((r) => ({ id: r.id, name: r.name, color: r.color, position: r.position })))
}

// ---- GET /api/v1/members/:discordId -----------------------------------------

export async function handleMember(req: Request, rawDiscordId: string, deps: ApiDeps = defaultApiDeps()): Promise<Response> {
  const auth = await authenticateIntegration(req, { scope: 'guild:read' })
  if (!auth.ok) return auth.response
  if (!/^\d{17,20}$/.test(rawDiscordId)) {
    return apiError(422, 'validation', undefined, { issues: [{ path: 'discordId', message: 'must be a Discord snowflake' }] })
  }
  const botToken = deps.botToken()
  if (!botToken) return apiError(502, 'discord_unavailable')
  let m: (DiscordGuildMember & { pending?: boolean }) | null
  try {
    m = await deps.discord.fetchGuildMember(botToken, auth.ctx.business.discordGuildId, rawDiscordId)
  } catch {
    return apiError(502, 'discord_unavailable')
  }
  if (!m) return apiJson(200, { member: false, pending: false, roleIds: [] })
  return apiJson(200, { member: true, pending: !!m.pending, roleIds: m.roles ?? [] })
}

// Exposed for tests.
export const __test = { rolesCache, loadScopedTicket, ticketView }
export type { Integration }
