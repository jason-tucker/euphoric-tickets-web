// Web → bot bridge client (plan §4.4): request shapes and response parsing,
// against a stubbed fetch. No network, no DB.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BotUnavailableError, botCloseTicket } from './botClient'

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

const TICKET = { ticketId: 7, businessId: '00000000-0000-4000-8000-000000000001' }

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
