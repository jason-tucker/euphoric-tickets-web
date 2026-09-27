// Web → bot calls for the Integration API (plan §4.4). The request and
// response shapes follow the §4.4 table exactly; the bot is built against the
// same table.
//
//   POST <BOT_INTERNAL_URL>/api/internal/tickets/open
//   POST <BOT_INTERNAL_URL>/api/internal/tickets/close
//   POST <BOT_INTERNAL_URL>/api/internal/tickets/webhook/ensure
//
// Auth: header `x-internal-token: INTERNAL_TOKEN`. Unlike the older bridges
// (notify / DM / bot-control), this module deliberately has NO fallback to
// DISCORD_BOT_TOKEN: without INTERNAL_TOKEN it fails closed as
// `bot_unavailable`. (Removing the legacy fallbacks elsewhere is P1c.)
//
// Error bodies are read as `{ error: '<code>' }` (or `{ code }`); the HTTP
// status is authoritative, and the code refines it only within the §4.4
// table. Anything unexpected surfaces as BotUnavailableError, which callers
// map to 502 `bot_unavailable`.

import { z } from 'zod'
import type { IntegrationCard } from '@/db/schema'

export class BotUnavailableError extends Error {
  constructor(readonly errorClass: string) {
    super(`bot unavailable: ${errorClass}`)
    this.name = 'BotUnavailableError'
  }
}

type RawBotResponse = { status: number; body: Record<string, unknown> | null }

const OPEN_TIMEOUT_MS = 20_000
const DEFAULT_TIMEOUT_MS = 10_000

async function postInternal(path: string, payload: unknown, timeoutMs: number): Promise<RawBotResponse> {
  const base = process.env.BOT_INTERNAL_URL
  const token = process.env.INTERNAL_TOKEN
  if (!base || !token) throw new BotUnavailableError('not_configured')
  let res: Response
  try {
    res = await fetch(`${base.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-token': token },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
      cache: 'no-store',
    })
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    throw new BotUnavailableError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network')
  }
  let body: Record<string, unknown> | null = null
  try {
    const parsed: unknown = await res.json()
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>
  } catch {
    body = null
  }
  return { status: res.status, body }
}

function codeOf(body: Record<string, unknown> | null): string | null {
  const c = body?.error ?? body?.code
  return typeof c === 'string' ? c : null
}

// ---- open ----------------------------------------------------------------

export type BotOpenRequest = {
  integrationId: string
  integrationSlug: string
  integrationName: string
  businessId: string
  categoryKey: string
  openerDiscordId: string
  subject: string
  card: IntegrationCard
  externalRef: string
}

export type BotOpenResult =
  | { ok: true; ticketId: number; channelId: string; created: boolean }
  | { ok: false; status: 404; code: 'opener_not_member' }
  | { ok: false; status: 403; code: 'opener_pending' | 'category_forbidden' }
  | { ok: false; status: 409; code: 'opening_in_progress' | 'ticket_channel_missing' }

const openOk = z.object({
  ticketId: z.number().int().positive(),
  channelId: z.string().regex(/^\d{17,20}$/),
  created: z.boolean(),
})

export async function botOpenTicket(req: BotOpenRequest): Promise<BotOpenResult> {
  const r = await postInternal('/api/internal/tickets/open', req, OPEN_TIMEOUT_MS)
  if (r.status === 201 || r.status === 200) {
    const p = openOk.safeParse(r.body)
    if (!p.success) throw new BotUnavailableError('bad_response')
    return { ok: true, ...p.data }
  }
  const code = codeOf(r.body)
  if (r.status === 404) return { ok: false, status: 404, code: 'opener_not_member' }
  if (r.status === 403) {
    return { ok: false, status: 403, code: code === 'opener_pending' ? 'opener_pending' : 'category_forbidden' }
  }
  if (r.status === 409) {
    // The ref already has a ticket whose Discord channel is gone, so the bot
    // refuses to adopt it; any other 409 is a concurrent open still running.
    return { ok: false, status: 409, code: code === 'ticket_channel_missing' ? 'ticket_channel_missing' : 'opening_in_progress' }
  }
  // 503 guild_unavailable and anything else.
  throw new BotUnavailableError(r.status === 503 ? 'guild_unavailable' : `http_${r.status}`)
}

// ---- close ---------------------------------------------------------------

// integrationId: the bot requires it on close and webhook/ensure and checks
// that the ticket is bound to that integration (and business).
export type BotCloseRequest = { ticketId: number; businessId: string; integrationId: string; actorDiscordId?: string; reason?: string }
// closedBy: 'actor' when the bot closed as actorDiscordId (the actor passed
// the shared staff-set check), 'bot' when it fell back to closing as itself.
// null only if the bot did not say (tolerated: the ticket IS closed, so a
// missing attribution must not turn a completed close into a 502).
export type CloseAttribution = 'actor' | 'bot' | null
export type BotCloseResult =
  | { ok: true; closedBy: CloseAttribution }
  | { ok: false; status: 409; code: 'already_closed' }
  | { ok: false; status: 404; code: 'not_found' }

export async function botCloseTicket(req: BotCloseRequest): Promise<BotCloseResult> {
  const r = await postInternal('/api/internal/tickets/close', req, DEFAULT_TIMEOUT_MS)
  if (r.status === 200 && r.body?.closed === true) {
    const by = r.body.closedBy
    return { ok: true, closedBy: by === 'actor' || by === 'bot' ? by : null }
  }
  if (r.status === 409) return { ok: false, status: 409, code: 'already_closed' }
  if (r.status === 404) return { ok: false, status: 404, code: 'not_found' }
  throw new BotUnavailableError(`http_${r.status}`)
}

// ---- webhook/ensure --------------------------------------------------------

// A Discord webhook execute URL (the only shape we will store and POST to).
export const DISCORD_WEBHOOK_URL_RE =
  /^https:\/\/(?:discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)\/api(?:\/v\d{1,2})?\/webhooks\/(\d{17,20})\/([A-Za-z0-9_-]{20,128})$/

const ensureOk = z.object({ webhookUrl: z.string().regex(DISCORD_WEBHOOK_URL_RE) })

export type BotEnsureWebhookRequest = { ticketId: number; businessId: string; integrationId: string }

export async function botEnsureWebhook(req: BotEnsureWebhookRequest): Promise<{ webhookUrl: string; webhookId: string }> {
  const r = await postInternal('/api/internal/tickets/webhook/ensure', req, DEFAULT_TIMEOUT_MS)
  if (r.status !== 200) throw new BotUnavailableError(`http_${r.status}`)
  const p = ensureOk.safeParse(r.body)
  if (!p.success) throw new BotUnavailableError('bad_response')
  const webhookId = DISCORD_WEBHOOK_URL_RE.exec(p.data.webhookUrl)![1]!
  return { webhookUrl: p.data.webhookUrl, webhookId }
}

// The seam the route handlers depend on (swapped for fakes in tests).
export type BotOps = {
  openTicket: typeof botOpenTicket
  closeTicket: typeof botCloseTicket
  ensureWebhook: typeof botEnsureWebhook
}

export const defaultBotOps: BotOps = {
  openTicket: botOpenTicket,
  closeTicket: botCloseTicket,
  ensureWebhook: botEnsureWebhook,
}
