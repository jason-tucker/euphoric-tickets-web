// Outbound integration webhook dispatcher (plan §4.5).
//
// Runs inside tickets-web (started from src/instrumentation.ts, Node runtime
// only) as a per-process singleton, and does work only while it holds a
// Postgres advisory lock on a DEDICATED reserved connection
// (`pgClient.reserve()`). The lock is re-verified on every sweep, so exactly
// one tickets-web process dispatches even across overlapping deploys.
//
// NOTIFY `ticket_activity` only wakes it up; the 15 s sweep is the source of
// truth. Each sweep:
//   1. ensures an integration_ticket_state row per integration ticket;
//   2. scans ticket_messages per integration ticket from its cursor
//      (`created_at`, `id`) MINUS a 60 s lookback overlap (a transaction that
//      commits late can carry an earlier created_at), keeping rows with
//      author_kind IS DISTINCT FROM 'integration' AND source <> 'internal', and
//      inserts `message.created` deliveries ON CONFLICT DO NOTHING — the
//      UNIQUE (integration_id, event, source_key=message id) absorbs the
//      overlap — then advances the cursor (same transaction);
//   3. diffs tickets.status / assignee against integration_ticket_state and
//      emits `ticket.status_changed` / `ticket.closed` / `ticket.claimed` /
//      `ticket.unclaimed`;
//   4. delivers due rows: fresh `t` per attempt, HMAC-signed, redirect
//      'manual', SSRF-pinned (webhookSsrf.ts), exponential backoff for 24 h.
// Only the HTTP status and a coarse error class are ever logged or stored.

import { eq, sql } from 'drizzle-orm'
import { fetch as undiciFetch } from 'undici'
import { db, ensureNotifyTriggers, pgClient } from '@/db/client'
import { integrationDeliveries, integrations, integrationWebhookAllowlist } from '@/db/schema'
import { decryptSecret } from './crypto'
import { signatureHeader } from './signature'
import { createPinnedAgent, matchAllowlist, type AddressPolicy } from './webhookSsrf'

export const SWEEP_INTERVAL_MS = 15_000
export const CURSOR_LOOKBACK_SEC = 60
export const DELIVERY_TTL_MS = 24 * 60 * 60_000
export const DELIVERY_TIMEOUT_MS = 10_000
const MESSAGE_PAGE = 500
const DELIVERY_BATCH = 25
// Two int4 keys → pg_locks shows classid/objid with objsubid = 2.
export const DISPATCH_LOCK: readonly [number, number] = [0x45544b31, 1] // 'ETK1', 1

type Db = typeof db

// ---- 1. state rows ----------------------------------------------------------

export async function ensureStateRows(database: Db = db): Promise<void> {
  await database.execute(sql`
    INSERT INTO integration_ticket_state (ticket_id, last_status, last_assignee, msg_cursor_created_at, msg_cursor_id)
    SELECT t.id, t.status, t.assignee_user_id, t.opened_at, NULL
    FROM tickets t
    WHERE t.integration_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM integration_ticket_state s WHERE s.ticket_id = t.id)
    ON CONFLICT (ticket_id) DO NOTHING
  `)
}

// ---- 2. message cursor ------------------------------------------------------

type MessageRow = {
  id: string
  ticket_id: number
  created_at_text: string
  created_at_iso: string
  source: string
  body: string
  attachments: Array<{ name?: string; contentType?: string | null; size?: number }> | null
  author_discord_id: string | null
  author_name: string | null
  integration_id: string
  external_ref: string | null
}

export function messagePayload(r: MessageRow): Record<string, unknown> {
  return {
    event: 'message.created',
    ticketId: r.ticket_id,
    externalRef: r.external_ref,
    occurredAt: r.created_at_iso,
    message: {
      id: r.id,
      source: r.source,
      body: r.body,
      createdAt: r.created_at_iso,
      author: r.author_discord_id ? { discordId: r.author_discord_id, name: r.author_name } : null,
      // Discord CDN URLs are signed + expiring; only describe attachments.
      attachments: (r.attachments ?? []).map((a) => ({
        name: a.name ?? null,
        contentType: a.contentType ?? null,
        size: a.size ?? null,
      })),
    },
  }
}

// Returns the number of delivery rows newly inserted.
export async function enqueueMessageDeliveries(database: Db = db): Promise<number> {
  let inserted = 0
  let after: { createdAt: string; id: string } | null = null
  for (;;) {
    const keyset = after
      ? sql`AND (m.created_at, m.id) > (${after.createdAt}::timestamptz, ${after.id}::uuid)`
      : sql``
    const rows = (await database.execute(sql`
      SELECT m.id, m.ticket_id,
             m.created_at::text AS created_at_text,
             to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso,
             m.source, m.body, m.attachments,
             u.discord_id AS author_discord_id, u.name AS author_name,
             t.integration_id, t.external_ref
      FROM ticket_messages m
      JOIN tickets t ON t.id = m.ticket_id
      JOIN integrations i ON i.id = t.integration_id AND i.enabled
      JOIN integration_ticket_state s ON s.ticket_id = t.id
      LEFT JOIN users u ON u.id = m.author_user_id
      WHERE t.integration_id IS NOT NULL
        AND m.author_kind IS DISTINCT FROM 'integration'
        AND m.source <> 'internal'
        AND (s.msg_cursor_created_at IS NULL
             OR m.created_at > s.msg_cursor_created_at - make_interval(secs => ${CURSOR_LOOKBACK_SEC}))
        ${keyset}
      ORDER BY m.created_at, m.id
      LIMIT ${MESSAGE_PAGE}
    `)) as unknown as MessageRow[]
    if (rows.length === 0) break

    // Highest (created_at, id) seen per ticket in this page (rows are ordered).
    const maxByTicket = new Map<number, { createdAt: string; id: string }>()
    for (const r of rows) maxByTicket.set(r.ticket_id, { createdAt: r.created_at_text, id: r.id })

    await database.transaction(async (tx) => {
      const res = await tx
        .insert(integrationDeliveries)
        .values(
          rows.map((r) => ({
            integrationId: r.integration_id,
            event: 'message.created',
            sourceKey: r.id,
            payload: messagePayload(r),
          })),
        )
        .onConflictDoNothing({
          target: [integrationDeliveries.integrationId, integrationDeliveries.event, integrationDeliveries.sourceKey],
        })
        .returning({ id: integrationDeliveries.id })
      inserted += res.length
      for (const [ticketId, c] of maxByTicket) {
        // Forward-only cursor move.
        await tx.execute(sql`
          UPDATE integration_ticket_state
          SET msg_cursor_created_at = ${c.createdAt}::timestamptz, msg_cursor_id = ${c.id}::uuid
          WHERE ticket_id = ${ticketId}
            AND (msg_cursor_created_at IS NULL
                 OR (msg_cursor_created_at, COALESCE(msg_cursor_id, '00000000-0000-0000-0000-000000000000'::uuid))
                    < (${c.createdAt}::timestamptz, ${c.id}::uuid))
        `)
      }
    })

    if (rows.length < MESSAGE_PAGE) break
    const last = rows[rows.length - 1]!
    after = { createdAt: last.created_at_text, id: last.id }
  }
  return inserted
}

// ---- 3. status / claim / close diff ------------------------------------------

type StateRow = {
  ticket_id: number
  status: string
  assignee_user_id: string | null
  assignee_discord_id: string | null
  closed_at_iso: string | null
  integration_id: string
  external_ref: string | null
  last_status: string | null
  last_assignee: string | null
}

export async function enqueueStateDeliveries(database: Db = db): Promise<number> {
  const rows = (await database.execute(sql`
    SELECT t.id AS ticket_id, t.status, t.assignee_user_id, au.discord_id AS assignee_discord_id,
           to_char(t.closed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS closed_at_iso,
           t.integration_id, t.external_ref, s.last_status, s.last_assignee
    FROM tickets t
    JOIN integration_ticket_state s ON s.ticket_id = t.id
    JOIN integrations i ON i.id = t.integration_id AND i.enabled
    LEFT JOIN users au ON au.id = t.assignee_user_id
    WHERE t.integration_id IS NOT NULL
      AND (t.status IS DISTINCT FROM s.last_status OR t.assignee_user_id IS DISTINCT FROM s.last_assignee)
    ORDER BY t.id
    LIMIT 200
  `)) as unknown as StateRow[]

  let inserted = 0
  for (const r of rows) {
    await database.transaction(async (tx) => {
      // Single-winner transition: only if the state still holds what we read.
      const moved = (await tx.execute(sql`
        UPDATE integration_ticket_state
        SET last_status = ${r.status}, last_assignee = ${r.assignee_user_id}::uuid
        WHERE ticket_id = ${r.ticket_id}
          AND last_status IS NOT DISTINCT FROM ${r.last_status}
          AND last_assignee IS NOT DISTINCT FROM ${r.last_assignee}::uuid
        RETURNING ticket_id
      `)) as unknown as unknown[]
      if (moved.length === 0) return

      const stamp = Date.now()
      const base = {
        ticketId: r.ticket_id,
        externalRef: r.external_ref,
        occurredAt: new Date(stamp).toISOString(),
        ticket: { status: r.status, claimedBy: r.assignee_discord_id, closedAt: r.closed_at_iso },
      }
      const events: Array<{ event: string; sourceKey: string; payload: Record<string, unknown> }> = []
      if (r.status !== r.last_status && r.last_status !== null) {
        const event = r.status === 'closed' ? 'ticket.closed' : 'ticket.status_changed'
        events.push({
          event,
          sourceKey: `${r.ticket_id}:${r.last_status}>${r.status}:${stamp}`,
          payload: { event, ...base, from: r.last_status, to: r.status },
        })
      }
      if (r.assignee_user_id !== r.last_assignee) {
        const event = r.assignee_user_id ? 'ticket.claimed' : 'ticket.unclaimed'
        events.push({
          event,
          sourceKey: `${r.ticket_id}:${r.last_assignee ?? '-'}>${r.assignee_user_id ?? '-'}:${stamp}`,
          payload: { event, ...base, claimedBy: r.assignee_discord_id },
        })
      }
      if (events.length === 0) return
      const res = await tx
        .insert(integrationDeliveries)
        .values(events.map((e) => ({ integrationId: r.integration_id, ...e })))
        .onConflictDoNothing({
          target: [integrationDeliveries.integrationId, integrationDeliveries.event, integrationDeliveries.sourceKey],
        })
        .returning({ id: integrationDeliveries.id })
      inserted += res.length
    })
  }
  return inserted
}

// ---- 4. delivery ------------------------------------------------------------

export type SendRequest = { url: string; headers: Record<string, string>; body: string; policy: AddressPolicy }
export type Sender = (req: SendRequest) => Promise<{ status: number }>

// Coarse, log-safe classification of a send failure (walks `cause`).
export function classifySendError(err: unknown): string {
  let e: unknown = err
  for (let depth = 0; e && depth < 5; depth++) {
    const x = e as { name?: string; code?: string; cause?: unknown }
    if (x.name === 'BlockedAddressError') return 'blocked_address'
    if (x.name === 'WebhookDnsError') return 'dns'
    if (x.name === 'TimeoutError' || x.name === 'AbortError') return 'timeout'
    if (x.code === 'UND_ERR_CONNECT_TIMEOUT') return 'connect_timeout'
    if (x.code === 'ECONNREFUSED') return 'connect_refused'
    if (x.code === 'ECONNRESET' || x.code === 'UND_ERR_SOCKET') return 'connection_reset'
    if (x.code === 'ENOTFOUND' || x.code === 'EAI_AGAIN') return 'dns'
    if (typeof x.code === 'string' && (/^ERR_TLS/.test(x.code) || /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(x.code))) return 'tls'
    e = x.cause
  }
  return 'network'
}

export const defaultSender: Sender = async ({ url, headers, body, policy }) => {
  const agent = createPinnedAgent(policy)
  try {
    const res = await undiciFetch(url, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      dispatcher: agent,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    })
    // Never read the receiver's body (it is not logged or stored).
    await res.body?.cancel().catch(() => {})
    return { status: res.status }
  } finally {
    agent.close().catch(() => {})
  }
}

export function backoffMs(attempts: number, rand: () => number = Math.random): number {
  const base = Math.min(15_000 * 2 ** Math.max(0, attempts - 1), 60 * 60_000)
  return Math.round(base * (1 + 0.2 * rand()))
}

type DueRow = {
  id: string
  integration_id: string
  event: string
  payload: Record<string, unknown>
  attempts: number
  expired: boolean
}

export async function deliverDue(sender: Sender = defaultSender, database: Db = db): Promise<{ attempted: number; delivered: number }> {
  const due = (await database.execute(sql`
    SELECT d.id, d.integration_id, d.event, d.payload, d.attempts,
           (d.created_at < now() - make_interval(secs => ${DELIVERY_TTL_MS / 1000})) AS expired
    FROM integration_deliveries d
    WHERE d.delivered_at IS NULL AND d.next_attempt_at IS NOT NULL AND d.next_attempt_at <= now()
    ORDER BY d.next_attempt_at, d.created_at
    LIMIT ${DELIVERY_BATCH}
  `)) as unknown as DueRow[]

  let attempted = 0
  let delivered = 0
  for (const d of due) {
    // Lease the row (2 min) so a crashed attempt is retried, never doubled.
    const leased = (await database.execute(sql`
      UPDATE integration_deliveries SET next_attempt_at = now() + interval '2 minutes'
      WHERE id = ${d.id}::uuid AND delivered_at IS NULL AND next_attempt_at IS NOT NULL AND next_attempt_at <= now()
      RETURNING id
    `)) as unknown as unknown[]
    if (leased.length === 0) continue

    if (d.expired) {
      await database
        .update(integrationDeliveries)
        .set({ nextAttemptAt: null, lastErrorClass: 'expired' })
        .where(eq(integrationDeliveries.id, d.id))
      continue
    }

    const outcome = await attemptOne(d, sender, database)
    attempted++
    const attempts = d.attempts + 1
    if (outcome.ok) {
      delivered++
      await database
        .update(integrationDeliveries)
        .set({ deliveredAt: sql`now()`, nextAttemptAt: null, attempts, lastStatus: outcome.status, lastErrorClass: null })
        .where(eq(integrationDeliveries.id, d.id))
    } else {
      const delay = backoffMs(attempts)
      await database.execute(sql`
        UPDATE integration_deliveries
        SET attempts = ${attempts},
            last_status = ${outcome.status ?? null},
            last_error_class = ${outcome.errorClass},
            next_attempt_at = CASE
              WHEN now() + make_interval(secs => ${delay / 1000}) > created_at + make_interval(secs => ${DELIVERY_TTL_MS / 1000})
              THEN NULL
              ELSE now() + make_interval(secs => ${delay / 1000})
            END
        WHERE id = ${d.id}::uuid
      `)
      console.warn('[integration-dispatcher] delivery failed', {
        deliveryId: d.id,
        integrationId: d.integration_id,
        status: outcome.status ?? null,
        errorClass: outcome.errorClass,
      })
    }
  }
  return { attempted, delivered }
}

async function attemptOne(
  d: DueRow,
  sender: Sender,
  database: Db,
): Promise<{ ok: true; status: number } | { ok: false; status?: number; errorClass: string }> {
  const [integ] = await database
    .select({
      id: integrations.id,
      enabled: integrations.enabled,
      webhookUrl: integrations.webhookUrl,
      webhookSecretEnc: integrations.webhookSecretEnc,
    })
    .from(integrations)
    .where(eq(integrations.id, d.integration_id))
    .limit(1)
  if (!integ || !integ.enabled) return { ok: false, errorClass: 'integration_disabled' }
  if (!integ.webhookUrl || !integ.webhookSecretEnc) return { ok: false, errorClass: 'not_configured' }

  let secret: string
  try {
    secret = decryptSecret(integ.webhookSecretEnc, integ.id)
  } catch {
    return { ok: false, errorClass: 'decrypt_failed' }
  }

  const allow = await database
    .select()
    .from(integrationWebhookAllowlist)
    .where(eq(integrationWebhookAllowlist.integrationId, integ.id))
  const row = matchAllowlist(integ.webhookUrl, allow)
  // Fail closed: the stored URL must still match a current allowlist row of
  // this integration (the save-time invariant). If it does not — a row was
  // removed, or the DB was edited — do NOT fall back to the weaker
  // public-address policy; refuse to send.
  if (!row) return { ok: false, errorClass: 'not_allowlisted' }
  const policy: AddressPolicy = { mode: 'cidr', cidr: row.expectedNetworkCidr }

  const body = JSON.stringify(d.payload)
  const t = Math.floor(Date.now() / 1000)
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'EuphoricTickets-Webhook/1',
    'X-Euphoric-Delivery': d.id,
    'X-Euphoric-Event': d.event,
    'X-Euphoric-Signature': signatureHeader(secret, t, d.id, body),
  }
  try {
    const { status } = await sender({ url: integ.webhookUrl, headers, body, policy })
    if (status >= 200 && status < 300) return { ok: true, status }
    const errorClass = status >= 300 && status < 400 ? 'redirect' : status >= 500 ? 'http_5xx' : 'http_4xx'
    return { ok: false, status, errorClass }
  } catch (err) {
    return { ok: false, errorClass: classifySendError(err) }
  }
}

// ---- runner -------------------------------------------------------------------

export async function sweepOnce(sender: Sender = defaultSender, database: Db = db): Promise<void> {
  await ensureStateRows(database)
  await enqueueMessageDeliveries(database)
  await enqueueStateDeliveries(database)
  await deliverDue(sender, database)
}

type Reserved = Awaited<ReturnType<typeof pgClient.reserve>>

export class IntegrationDispatcher {
  private reserved: Reserved | null = null
  private holdsLock = false
  private running = false
  private again = false
  private wakeTimer: ReturnType<typeof setTimeout> | null = null
  private interval: ReturnType<typeof setInterval> | null = null

  // True iff THIS process holds the dispatcher lock right now.
  async holdsDispatchLock(): Promise<boolean> {
    try {
      if (!this.reserved) {
        this.reserved = await pgClient.reserve()
        this.holdsLock = false
      }
      const r = this.reserved
      if (this.holdsLock) {
        const still = await r`
          SELECT 1 FROM pg_locks
          WHERE locktype = 'advisory' AND classid = ${DISPATCH_LOCK[0]} AND objid = ${DISPATCH_LOCK[1]}
            AND objsubid = 2 AND pid = pg_backend_pid() AND granted`
        if (still.length === 0) this.holdsLock = false
      }
      if (!this.holdsLock) {
        const [row] = await r`SELECT pg_try_advisory_lock(${DISPATCH_LOCK[0]}::int4, ${DISPATCH_LOCK[1]}::int4) AS ok`
        this.holdsLock = !!row?.ok
      }
      return this.holdsLock
    } catch (err) {
      console.warn('[integration-dispatcher] lock connection lost', { err: err instanceof Error ? err.name : 'unknown' })
      try {
        this.reserved?.release()
      } catch {
        /* ignore */
      }
      this.reserved = null
      this.holdsLock = false
      return false
    }
  }

  async sweep(): Promise<void> {
    if (this.running) {
      this.again = true
      return
    }
    this.running = true
    try {
      if (await this.holdsDispatchLock()) await sweepOnce()
    } catch (err) {
      console.warn('[integration-dispatcher] sweep failed', { err: err instanceof Error ? err.name : 'unknown' })
    } finally {
      this.running = false
      if (this.again) {
        this.again = false
        setTimeout(() => void this.sweep(), 250)
      }
    }
  }

  // Release the lock connection (tests / shutdown).
  async stop(): Promise<void> {
    if (this.interval) clearInterval(this.interval)
    if (this.reserved) {
      try {
        await this.reserved`SELECT pg_advisory_unlock(${DISPATCH_LOCK[0]}::int4, ${DISPATCH_LOCK[1]}::int4)`
      } catch {
        /* connection already gone: the lock went with it */
      }
      this.reserved.release()
      this.reserved = null
    }
    this.holdsLock = false
  }

  wake(): void {
    if (this.wakeTimer) return
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = null
      void this.sweep()
    }, 500)
  }

  async start(): Promise<void> {
    await ensureNotifyTriggers().catch(() => {})
    try {
      await pgClient.listen('ticket_activity', () => this.wake())
    } catch {
      // The sweep interval is the source of truth; NOTIFY is only a wake-up.
    }
    this.interval = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS)
    this.interval.unref?.()
    void this.sweep()
  }
}

declare global {
  var __integrationDispatcher: IntegrationDispatcher | undefined
}

export function startIntegrationDispatcher(): void {
  if (globalThis.__integrationDispatcher) return
  const d = new IntegrationDispatcher()
  globalThis.__integrationDispatcher = d
  void d.start().catch((err) => {
    console.warn('[integration-dispatcher] start failed', { err: err instanceof Error ? err.name : 'unknown' })
  })
}
