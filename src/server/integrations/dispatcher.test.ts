// DB-backed dispatcher tests (plan §4.5 / §6 P1 "Webhooks"). Requires
// TEST_DATABASE_URL; skipped otherwise.

import { createServer, type IncomingMessage, type Server } from 'node:http'
import { networkInterfaces } from 'node:os'
import { and, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'
import { db } from '@/db/client'
import { integrationDeliveries, integrations, integrationWebhookAllowlist, ticketMessages, tickets } from '@/db/schema'
import { describeDb, makeBusiness, makeCategory, makeIntegration, makeIntegrationTicket, makeUser, stateOf } from '@/test/fixtures'
import {
  DISPATCH_LOCK,
  IntegrationDispatcher,
  backoffMs,
  defaultSender,
  deliverDue,
  enqueueMessageDeliveries,
  enqueueStateDeliveries,
  ensureStateRows,
  type Sender,
} from './dispatcher'
import { verifySignatureHeader } from './signature'

async function setup() {
  const biz = await makeBusiness()
  const cat = await makeCategory(biz.id, 'newsong', { integrationOnly: true })
  const opener = await makeUser()
  const staff = await makeUser()
  const { integration, webhookSecret } = await makeIntegration(biz.id, { webhookUrl: 'http://music-web:6096/api/hooks/tickets' })
  await db.insert(integrationWebhookAllowlist).values({
    integrationId: integration.id,
    scheme: 'http',
    host: 'music-web',
    port: 6096,
    path: '/api/hooks/tickets',
    expectedNetworkCidr: '172.30.40.0/24',
  })
  const ticket = await makeIntegrationTicket({ businessId: biz.id, integrationId: integration.id, openerUserId: opener.id, categoryId: cat.id })
  await ensureStateRows()
  return { biz, cat, opener, staff, integration, webhookSecret, ticket }
}

async function deliveriesFor(integrationId: string, event?: string) {
  return db
    .select()
    .from(integrationDeliveries)
    .where(and(eq(integrationDeliveries.integrationId, integrationId), event ? eq(integrationDeliveries.event, event) : undefined))
}

// Drain everything already queued by other suites so each test starts clean.
async function drainAll() {
  await db.execute(sql`UPDATE integration_deliveries SET next_attempt_at = NULL WHERE delivered_at IS NULL`)
}

describeDb('dispatcher — message cursor', () => {
  beforeEach(drainAll)

  it('author_kind defaults to human for an unchanged insert path (drizzle and raw SQL)', async () => {
    const w = await setup()
    const [viaDrizzle] = await db
      .insert(ticketMessages)
      .values({ ticketId: w.ticket.id, authorUserId: w.staff.id, body: 'web reply', source: 'web' })
      .returning()
    expect(viaDrizzle!.authorKind).toBe('human')
    expect(viaDrizzle!.metadata).toEqual({})
    expect(viaDrizzle!.idempotencyKey).toBeNull()
    // The bot's relay insert (column list without the new columns).
    const [raw] = (await db.execute(sql`
      INSERT INTO ticket_messages (ticket_id, author_user_id, body, source, discord_message_id)
      VALUES (${w.ticket.id}, ${w.opener.id}::uuid, 'discord reply', 'discord', '123456789012345678')
      RETURNING author_kind, metadata
    `)) as unknown as Array<{ author_kind: string; metadata: unknown }>
    expect(raw).toEqual({ author_kind: 'human', metadata: {} })
    // …and such a relay row is delivered.
    await enqueueMessageDeliveries()
    expect(await deliveriesFor(w.integration.id, 'message.created')).toHaveLength(2)
  })

  it('a burst of 5 interleaved Discord and web replies produces exactly 5 deliveries (incl. a late commit)', async () => {
    const w = await setup()
    const insert = (source: 'web' | 'discord', body: string, createdAt?: Date) =>
      db
        .insert(ticketMessages)
        .values({ ticketId: w.ticket.id, authorUserId: source === 'web' ? w.staff.id : w.opener.id, body, source, ...(createdAt ? { createdAt } : {}) })
        .returning({ id: ticketMessages.id })

    await insert('discord', 'd1')
    await insert('web', 'w1')
    await insert('discord', 'd2')
    await enqueueMessageDeliveries()
    expect(await deliveriesFor(w.integration.id, 'message.created')).toHaveLength(3)
    const cursor = await stateOf(w.ticket.id)
    expect(cursor?.msgCursorCreatedAt).not.toBeNull()

    // A transaction that committed AFTER the sweep but carries an earlier
    // created_at (inside the 60 s lookback), interleaved with a new one.
    await insert('web', 'w2-late', new Date(cursor!.msgCursorCreatedAt!.getTime() - 20_000))
    await insert('discord', 'd3')
    await enqueueMessageDeliveries()
    // Re-sweeps (overlap) never duplicate.
    await enqueueMessageDeliveries()
    await enqueueMessageDeliveries()

    const rows = await deliveriesFor(w.integration.id, 'message.created')
    expect(rows).toHaveLength(5)
    expect(new Set(rows.map((r) => (r.payload as { message: { body: string } }).message.body))).toEqual(
      new Set(['d1', 'w1', 'd2', 'w2-late', 'd3']),
    )
    const sample = rows.find((r) => (r.payload as { message: { body: string } }).message.body === 'w1')!
    expect(sample.payload).toMatchObject({
      event: 'message.created',
      ticketId: w.ticket.id,
      externalRef: w.ticket.externalRef,
      message: { source: 'web', author: { discordId: w.staff.discordId } },
    })
  })

  it('an internal note produces 0 deliveries, and integration-authored rows are never echoed', async () => {
    const w = await setup()
    await db.insert(ticketMessages).values({ ticketId: w.ticket.id, authorUserId: w.staff.id, body: 'staff only', source: 'internal' })
    await db.insert(ticketMessages).values({
      ticketId: w.ticket.id,
      body: 'from the portal',
      source: 'system',
      authorKind: 'integration',
      idempotencyKey: 'k',
    })
    await enqueueMessageDeliveries()
    await enqueueMessageDeliveries()
    expect(await deliveriesFor(w.integration.id)).toHaveLength(0)
  })

  it('never delivers another integration’s or a non-integration ticket’s messages', async () => {
    const w = await setup()
    const other = await makeIntegration(w.biz.id)
    const plain = await makeIntegrationTicket({ businessId: w.biz.id, integrationId: null, openerUserId: w.opener.id })
    const otherTicket = await makeIntegrationTicket({ businessId: w.biz.id, integrationId: other.integration.id, openerUserId: w.opener.id })
    await ensureStateRows()
    await db.insert(ticketMessages).values({ ticketId: plain.id, body: 'plain', source: 'web' })
    await db.insert(ticketMessages).values({ ticketId: otherTicket.id, body: 'other', source: 'web' })
    await enqueueMessageDeliveries()
    expect(await deliveriesFor(w.integration.id)).toHaveLength(0)
    const others = await deliveriesFor(other.integration.id)
    expect(others.map((d) => (d.payload as { message: { body: string } }).message.body)).toEqual(['other'])
  })
})

describeDb('dispatcher — status / claim / close diff', () => {
  beforeEach(drainAll)

  it('emits one event per transition and nothing on a re-sweep', async () => {
    const w = await setup()
    await db.update(tickets).set({ status: 'in_progress', assigneeUserId: w.staff.id }).where(eq(tickets.id, w.ticket.id))
    await enqueueStateDeliveries()
    expect(await deliveriesFor(w.integration.id)).toHaveLength(2)
    await enqueueStateDeliveries()
    expect(await deliveriesFor(w.integration.id)).toHaveLength(2)
    const claimed = await deliveriesFor(w.integration.id, 'ticket.claimed')
    expect(claimed[0]!.payload).toMatchObject({ claimedBy: w.staff.discordId, ticket: { status: 'in_progress' } })
    const status = await deliveriesFor(w.integration.id, 'ticket.status_changed')
    expect(status[0]!.payload).toMatchObject({ from: 'open', to: 'in_progress' })

    // open → in_progress again later is a NEW transition (unique source key).
    await db.update(tickets).set({ status: 'open', assigneeUserId: null }).where(eq(tickets.id, w.ticket.id))
    await enqueueStateDeliveries()
    await db.update(tickets).set({ status: 'in_progress' }).where(eq(tickets.id, w.ticket.id))
    await enqueueStateDeliveries()
    expect(await deliveriesFor(w.integration.id, 'ticket.status_changed')).toHaveLength(3)
    expect(await deliveriesFor(w.integration.id, 'ticket.unclaimed')).toHaveLength(1)

    await db.update(tickets).set({ status: 'closed', closedAt: new Date() }).where(eq(tickets.id, w.ticket.id))
    await enqueueStateDeliveries()
    const closed = await deliveriesFor(w.integration.id, 'ticket.closed')
    expect(closed).toHaveLength(1)
    expect((closed[0]!.payload as { ticket: { closedAt: string | null } }).ticket.closedAt).not.toBeNull()
  })
})

describeDb('dispatcher — delivery', () => {
  beforeEach(drainAll)

  it('signs each attempt afresh, backs off on failure, and marks success', async () => {
    const w = await setup()
    await db.insert(ticketMessages).values({ ticketId: w.ticket.id, body: 'hello', source: 'discord', authorUserId: w.opener.id })
    await enqueueMessageDeliveries()
    const [d] = await deliveriesFor(w.integration.id)

    const seen: Array<Parameters<Sender>[0]> = []
    const failing: Sender = async (req) => {
      seen.push(req)
      return { status: 503 }
    }
    expect(await deliverDue(failing)).toEqual({ attempted: 1, delivered: 0 })
    let [row] = await db.select().from(integrationDeliveries).where(eq(integrationDeliveries.id, d!.id))
    expect(row).toMatchObject({ attempts: 1, lastStatus: 503, lastErrorClass: 'http_5xx', deliveredAt: null })
    expect(row!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 10_000)

    // Allowlisted URL → CIDR policy; headers are signed over the exact body.
    const req = seen[0]!
    expect(req.url).toBe('http://music-web:6096/api/hooks/tickets')
    expect(req.policy).toEqual({ mode: 'cidr', cidr: '172.30.40.0/24' })
    expect(req.headers['X-Euphoric-Delivery']).toBe(d!.id)
    expect(
      verifySignatureHeader({
        secret: w.webhookSecret,
        header: req.headers['X-Euphoric-Signature']!,
        deliveryId: d!.id,
        rawBody: req.body,
        nowSec: Math.floor(Date.now() / 1000),
      }),
    ).toBe(true)
    expect(JSON.parse(req.body)).toEqual(d!.payload)

    // Make it due again; the next attempt carries a fresh t.
    await db.update(integrationDeliveries).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(integrationDeliveries.id, d!.id))
    const realNow = Date.now
    Date.now = () => realNow() + 5000
    const ok: Sender = async (r) => {
      seen.push(r)
      return { status: 204 }
    }
    try {
      expect(await deliverDue(ok)).toEqual({ attempted: 1, delivered: 1 })
    } finally {
      Date.now = realNow
    }
    expect(seen[1]!.headers['X-Euphoric-Signature']).not.toBe(seen[0]!.headers['X-Euphoric-Signature'])
    ;[row] = await db.select().from(integrationDeliveries).where(eq(integrationDeliveries.id, d!.id))
    expect(row).toMatchObject({ attempts: 2, lastStatus: 204, lastErrorClass: null, nextAttemptAt: null })
    expect(row!.deliveredAt).not.toBeNull()
    // Delivered rows are never re-sent.
    expect(await deliverDue(ok)).toEqual({ attempted: 0, delivered: 0 })
  })

  it('classifies redirects, uses the public guard for a non-allowlisted URL, and gives up after 24 h', async () => {
    const w = await setup()
    await db.insert(ticketMessages).values({ ticketId: w.ticket.id, body: 'a', source: 'web' })
    await enqueueMessageDeliveries()
    const [d] = await deliveriesFor(w.integration.id)

    await db.update(integrations).set({ webhookUrl: 'https://hooks.example.com/x' }).where(eq(integrations.id, w.integration.id))
    let policy: unknown
    await deliverDue(async (r) => {
      policy = r.policy
      return { status: 302 }
    })
    expect(policy).toEqual({ mode: 'public' })
    let [row] = await db.select().from(integrationDeliveries).where(eq(integrationDeliveries.id, d!.id))
    expect(row!.lastErrorClass).toBe('redirect')

    await db.execute(sql`UPDATE integration_deliveries SET created_at = now() - interval '25 hours', next_attempt_at = now() WHERE id = ${d!.id}::uuid`)
    let called = false
    await deliverDue(async () => {
      called = true
      return { status: 200 }
    })
    expect(called).toBe(false)
    ;[row] = await db.select().from(integrationDeliveries).where(eq(integrationDeliveries.id, d!.id))
    expect(row).toMatchObject({ nextAttemptAt: null, deliveredAt: null, lastErrorClass: 'expired' })
  })

  it('does not send for a disabled integration or an undecryptable secret', async () => {
    const w = await setup()
    await db.insert(ticketMessages).values({ ticketId: w.ticket.id, body: 'a', source: 'web' })
    await enqueueMessageDeliveries()
    await db.update(integrations).set({ enabled: false }).where(eq(integrations.id, w.integration.id))
    let sent = 0
    await deliverDue(async () => {
      sent++
      return { status: 200 }
    })
    let [row] = await deliveriesFor(w.integration.id)
    expect(row!.lastErrorClass).toBe('integration_disabled')

    await db.update(integrations).set({ enabled: true, webhookSecretEnc: 'v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA:AAAA' }).where(eq(integrations.id, w.integration.id))
    await db.update(integrationDeliveries).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(integrationDeliveries.integrationId, w.integration.id))
    await deliverDue(async () => {
      sent++
      return { status: 200 }
    })
    ;[row] = await deliveriesFor(w.integration.id)
    expect(row!.lastErrorClass).toBe('decrypt_failed')
    expect(sent).toBe(0)
  })

  it('backoff grows exponentially and caps at 1 h', () => {
    const noJitter = () => 0
    expect(backoffMs(1, noJitter)).toBe(15_000)
    expect(backoffMs(2, noJitter)).toBe(30_000)
    expect(backoffMs(20, noJitter)).toBe(3_600_000)
  })
})

describeDb('dispatcher — singleton lock', () => {
  it('exactly one instance holds the advisory lock, re-checked per sweep, and it hands over on stop', async () => {
    const a = new IntegrationDispatcher()
    const b = new IntegrationDispatcher()
    try {
      expect(await a.holdsDispatchLock()).toBe(true)
      expect(await b.holdsDispatchLock()).toBe(false)
      expect(await a.holdsDispatchLock()).toBe(true) // re-check path
      await a.stop()
      expect(await b.holdsDispatchLock()).toBe(true)
      const [held] = (await db.execute(sql`
        SELECT count(*)::int AS n FROM pg_locks
        WHERE locktype = 'advisory' AND classid = ${DISPATCH_LOCK[0]} AND objid = ${DISPATCH_LOCK[1]} AND objsubid = 2 AND granted
      `)) as unknown as Array<{ n: number }>
      expect(held!.n).toBe(1)
    } finally {
      await a.stop()
      await b.stop()
    }
  })
})

// End to end over real sockets: a capture endpoint on this host's
// non-loopback address, allowlisted with a /32 CIDR.
const hostIp = Object.values(networkInterfaces())
  .flat()
  .find((a) => a && a.family === 'IPv4' && !a.internal)?.address

describeDb('dispatcher — signed webhook reaches a capture endpoint', () => {
  let server: Server
  let port = 0
  const got: Array<{ headers: IncomingMessage['headers']; body: string }> = []
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        got.push({ headers: req.headers, body })
        res.writeHead(200)
        res.end('ok')
      })
    })
    await new Promise<void>((r) => server.listen(0, '0.0.0.0', r))
    port = (server.address() as { port: number }).port
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))
  beforeEach(drainAll)

  it.skipIf(!hostIp)('delivers, verifies, and refuses the same host once it is outside the CIDR', async () => {
    const w = await setup()
    const url = `http://${hostIp}:${port}/api/hooks/tickets`
    await db.update(integrations).set({ webhookUrl: url }).where(eq(integrations.id, w.integration.id))
    await db.insert(integrationWebhookAllowlist).values({
      integrationId: w.integration.id,
      scheme: 'http',
      host: hostIp!,
      port,
      path: '/api/hooks/tickets',
      expectedNetworkCidr: `${hostIp}/32`,
    })
    await db.insert(ticketMessages).values({ ticketId: w.ticket.id, body: 'reply from Discord', source: 'discord' })
    await enqueueMessageDeliveries()
    expect(await deliverDue(defaultSender)).toEqual({ attempted: 1, delivered: 1 })
    expect(got).toHaveLength(1)
    const h = got[0]!.headers
    expect(
      verifySignatureHeader({
        secret: w.webhookSecret,
        header: String(h['x-euphoric-signature']),
        deliveryId: String(h['x-euphoric-delivery']),
        rawBody: got[0]!.body,
        nowSec: Math.floor(Date.now() / 1000),
      }),
    ).toBe(true)

    // Same host, but the allowlist now expects a different network.
    await db
      .update(integrationWebhookAllowlist)
      .set({ expectedNetworkCidr: '10.123.0.0/24' })
      .where(eq(integrationWebhookAllowlist.integrationId, w.integration.id))
    await db.insert(ticketMessages).values({ ticketId: w.ticket.id, body: 'second', source: 'discord' })
    await enqueueMessageDeliveries()
    await deliverDue(defaultSender)
    expect(got).toHaveLength(1)
    const rows = await deliveriesFor(w.integration.id)
    expect(rows.find((r) => !r.deliveredAt)?.lastErrorClass).toBe('blocked_address')
  })
})
