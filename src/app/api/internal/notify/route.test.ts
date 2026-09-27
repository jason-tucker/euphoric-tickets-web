// P1c: the bot → web notify bridge authenticates with INTERNAL_TOKEN only.
// No DB: notify() is mocked, so a 200 here only proves the auth + body gates.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { notifyMock } = vi.hoisted(() => ({ notifyMock: vi.fn(async (_ctx: unknown) => {}) }))
vi.mock('@/server/notify', () => ({ notify: notifyMock }))

import { POST } from './route'

const TOKEN = 't'.repeat(64)
const BOT_TOKEN = 'b'.repeat(72)
const saved = { internal: process.env.INTERNAL_TOKEN, bot: process.env.DISCORD_BOT_TOKEN }

const validBody = {
  event: 'new_ticket',
  businessId: '00000000-0000-4000-8000-000000000001',
  categoryId: null,
  ticketId: 7,
  subject: 'hello',
  slug: 'efm',
  actorUserId: null,
}

function req(token: string | null, body: unknown = validBody): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token !== null) headers['x-internal-token'] = token
  return new Request('http://tickets-web:3000/api/internal/notify', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  process.env.INTERNAL_TOKEN = TOKEN
  process.env.DISCORD_BOT_TOKEN = BOT_TOKEN
  notifyMock.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
  if (saved.internal === undefined) delete process.env.INTERNAL_TOKEN
  else process.env.INTERNAL_TOKEN = saved.internal
  if (saved.bot === undefined) delete process.env.DISCORD_BOT_TOKEN
  else process.env.DISCORD_BOT_TOKEN = saved.bot
})

describe('POST /api/internal/notify', () => {
  it('returns 401 with a wrong token or no token', async () => {
    expect((await POST(req('w'.repeat(64)))).status).toBe(401)
    expect((await POST(req(TOKEN.slice(0, 63)))).status).toBe(401)
    expect((await POST(req(null))).status).toBe(401)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('rejects the Discord bot token (no fallback)', async () => {
    expect((await POST(req(BOT_TOKEN))).status).toBe(401)
    delete process.env.INTERNAL_TOKEN
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await POST(req(BOT_TOKEN))).status).toBe(401)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('rejects every request when the configured token is missing, empty or short', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const configured of [undefined, '', 'short-token']) {
      if (configured === undefined) delete process.env.INTERNAL_TOKEN
      else process.env.INTERNAL_TOKEN = configured
      // Presenting the (invalid) configured value, or nothing, must not pass.
      expect((await POST(req(configured ?? ''))).status).toBe(401)
      expect((await POST(req(null))).status).toBe(401)
    }
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('returns 400 with the right token and a bad body', async () => {
    expect((await POST(req(TOKEN, { ...validBody, event: 'nope' }))).status).toBe(400)
    expect((await POST(req(TOKEN, '{not json'))).status).toBe(400)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('accepts the right token and a valid body', async () => {
    const res = await POST(req(TOKEN))
    expect(res.status).toBe(200)
    expect(notifyMock).toHaveBeenCalledTimes(1)
  })
})
