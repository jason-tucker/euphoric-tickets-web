// Web → bot bridge client (plan §4.4): request shapes and response parsing,
// against a stubbed fetch. No network, no DB.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BotUnavailableError, botCloseTicket, botEnsureWebhook, botOpenTicket } from './botClient'

type Seen = { url: string; body: unknown; headers: Record<string, string> }

function stubBot(status: number, body: unknown): Seen[] {
  const seen: Seen[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, body: JSON.parse(String(init.body)), headers: init.headers as Record<string, string> })
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
    }),
  )
  return seen
}

beforeEach(() => {
  process.env.BOT_INTERNAL_URL = 'http://bot.test:8787'
  process.env.INTERNAL_TOKEN = 'x'.repeat(40)
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.BOT_INTERNAL_URL
  delete process.env.INTERNAL_TOKEN
})

const INTEGRATION_ID = '00000000-0000-4000-8000-0000000000aa'
const TICKET = { ticketId: 7, businessId: '00000000-0000-4000-8000-000000000001', integrationId: INTEGRATION_ID }

describe('INTERNAL_TOKEN (P1c: no bot-token fallback, ≥ 32 chars)', () => {
  it('fails closed as not_configured without calling the bot when the token is missing or short', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.DISCORD_BOT_TOKEN = 'b'.repeat(72)
    try {
      for (const token of [undefined, 'y'.repeat(31)]) {
        if (token === undefined) delete process.env.INTERNAL_TOKEN
        else process.env.INTERNAL_TOKEN = token
        const seen = stubBot(200, { closed: true })
        await expect(botCloseTicket(TICKET)).rejects.toMatchObject({ errorClass: 'not_configured' })
        expect(seen).toHaveLength(0)
      }
    } finally {
      delete process.env.DISCORD_BOT_TOKEN
      vi.restoreAllMocks()
    }
  })

  it('sends the dedicated token in x-internal-token', async () => {
    const seen = stubBot(200, { closed: true, closedBy: 'bot' })
    await botCloseTicket(TICKET)
    expect(seen[0]!.headers['x-internal-token']).toBe('x'.repeat(40))
  })
})

describe('botCloseTicket', () => {
  it('parses closedBy (actor | bot), tolerating a missing or unknown value as null', async () => {
    for (const [closedBy, expected] of [
      ['actor', 'actor'],
      ['bot', 'bot'],
      [undefined, null],
      ['someone-else', null],
    ] as const) {
      stubBot(200, { closed: true, ...(closedBy !== undefined ? { closedBy } : {}) })
      expect(await botCloseTicket(TICKET)).toEqual({ ok: true, closedBy: expected })
    }
  })

  it('maps 409 / 404 and treats anything else as bot_unavailable', async () => {
    stubBot(409, { error: 'already_closed' })
    expect(await botCloseTicket(TICKET)).toEqual({ ok: false, status: 409, code: 'already_closed' })
    stubBot(404, { error: 'not_found' })
    expect(await botCloseTicket(TICKET)).toEqual({ ok: false, status: 404, code: 'not_found' })
    stubBot(200, { closed: false })
    await expect(botCloseTicket(TICKET)).rejects.toBeInstanceOf(BotUnavailableError)
  })
})

describe('integrationId on close and webhook/ensure', () => {
  it('is sent in the request body (the bot requires it and verifies the binding)', async () => {
    let seen = stubBot(200, { closed: true, closedBy: 'bot' })
    await botCloseTicket({ ...TICKET, actorDiscordId: '123456789012345678', reason: 'done' })
    expect(seen[0]!.url).toBe('http://bot.test:8787/api/internal/tickets/close')
    expect(seen[0]!.body).toEqual({ ...TICKET, actorDiscordId: '123456789012345678', reason: 'done' })

    seen = stubBot(200, { webhookUrl: `https://discord.com/api/webhooks/123456789012345678/${'t'.repeat(40)}` })
    const ensured = await botEnsureWebhook(TICKET)
    expect(seen[0]!.url).toBe('http://bot.test:8787/api/internal/tickets/webhook/ensure')
    expect(seen[0]!.body).toEqual(TICKET)
    expect(ensured.webhookId).toBe('123456789012345678')
  })
})

describe('botOpenTicket', () => {
  const req = {
    integrationId: INTEGRATION_ID,
    integrationSlug: 'efm',
    integrationName: 'EFM Music',
    businessId: TICKET.businessId,
    categoryKey: 'newsong',
    openerDiscordId: '123456789012345678',
    subject: 's',
    card: { title: 't', lines: [], link: { label: 'l', url: 'https://music.test/' } },
    externalRef: 'batch:1',
  }

  it('distinguishes 409 ticket_channel_missing from 409 opening_in_progress', async () => {
    stubBot(409, { error: 'ticket_channel_missing' })
    expect(await botOpenTicket(req)).toEqual({ ok: false, status: 409, code: 'ticket_channel_missing' })
    stubBot(409, { error: 'opening_in_progress' })
    expect(await botOpenTicket(req)).toEqual({ ok: false, status: 409, code: 'opening_in_progress' })
    stubBot(409, {})
    expect(await botOpenTicket(req)).toEqual({ ok: false, status: 409, code: 'opening_in_progress' })
  })
})
