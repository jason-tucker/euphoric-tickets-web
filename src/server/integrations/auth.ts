// Integration API authentication + scoping (plan §4.2).
//
// Order (every /api/v1/* request):
//   1. per-IP failed-auth brake — an IP with ≥ RATE.authFailuresPerIp recent
//      401s gets 429 before any key work;
//   2. parse `Authorization: Bearer etk.<prefix>.<secret>`;
//   3. look the prefix up; ALWAYS one sha256 + one timingSafeEqual (a dummy
//      compare when the prefix is unknown or the header is malformed);
//   4. unknown / wrong / disabled → 401 `unauthorized` (+ record an IP failure);
//   5. per-key limits (60/min; opens additionally 10/min) → 429;
//   6. required scope missing → 403 `scope_missing`.
//
// Never logs the Authorization header or any part of the key.

import { eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { businesses, integrations, type Business, type Integration, type IntegrationScope } from '@/db/schema'
import { parseAuthorizationHeader, verifySecret } from './keys'
import { clientIp, limiters } from './rateLimit'
import { apiError } from './http'

export type IntegrationContext = { integration: Integration; business: Business }

export type AuthResult = { ok: true; ctx: IntegrationContext } | { ok: false; response: Response }

const LAST_USED_THROTTLE_MS = 60_000

export async function authenticateIntegration(
  req: Request,
  opts: { scope: IntegrationScope; open?: boolean },
): Promise<AuthResult> {
  const lim = limiters()
  const ip = clientIp(req.headers)

  const blocked = lim.authFail.check(ip)
  if (!blocked.allowed) {
    return { ok: false, response: apiError(429, 'rate_limited', { 'Retry-After': String(blocked.retryAfterSec) }) }
  }

  const parsed = parseAuthorizationHeader(req.headers.get('authorization'))
  let row: Integration | undefined
  if (parsed) {
    ;[row] = await db.select().from(integrations).where(eq(integrations.keyPrefix, parsed.prefix)).limit(1)
  }
  // Exactly one hash + constant-time compare on every path (dummy when no row).
  const secretOk = verifySecret(parsed?.secret ?? '', row?.keyHash ?? null)

  if (!parsed || !row || !secretOk || !row.enabled) {
    lim.authFail.hit(ip)
    return { ok: false, response: apiError(401, 'unauthorized', { 'WWW-Authenticate': 'Bearer' }) }
  }

  const perKey = lim.perKey.hit(row.id)
  if (!perKey.allowed) {
    return { ok: false, response: apiError(429, 'rate_limited', { 'Retry-After': String(perKey.retryAfterSec) }) }
  }
  if (opts.open) {
    const opens = lim.opens.hit(row.id)
    if (!opens.allowed) {
      return { ok: false, response: apiError(429, 'rate_limited', { 'Retry-After': String(opens.retryAfterSec) }) }
    }
  }

  if (!row.scopes.includes(opts.scope)) {
    return { ok: false, response: apiError(403, 'scope_missing', undefined, { required: opts.scope }) }
  }

  const [business] = await db.select().from(businesses).where(eq(businesses.id, row.businessId)).limit(1)
  if (!business) {
    // The integration's team is gone (cascade should have removed the row).
    lim.authFail.hit(ip)
    return { ok: false, response: apiError(401, 'unauthorized', { 'WWW-Authenticate': 'Bearer' }) }
  }

  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    void db
      .update(integrations)
      .set({ lastUsedAt: sql`now()` })
      .where(eq(integrations.id, row.id))
      .catch(() => {})
  }

  return { ok: true, ctx: { integration: row, business } }
}

export function hasScope(integration: Pick<Integration, 'scopes'>, scope: IntegrationScope): boolean {
  return integration.scopes.includes(scope)
}
