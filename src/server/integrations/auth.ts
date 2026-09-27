// Integration API authentication + scoping (plan §4.2).
//
// Order (every /api/v1/* request):
//   0. internal-host gate (internalHost.ts): a Host that is not an internal
//      alias gets a bare 404 before anything else;
//   1. parse `Authorization: Bearer etk.<prefix>.<secret>`. A missing or
//      malformed header costs no DB round-trip;
//   2. look the prefix up (only for a well-formed header); ALWAYS one sha256
//      + one timingSafeEqual (a dummy compare when the prefix is unknown or
//      the header is malformed);
//   3. unknown / wrong / disabled → the failed-auth brake: record a failure
//      for the client bucket (rateLimit.ts clientBucket) and answer 401
//      `unauthorized`, or 429 once that bucket has ≥ RATE.authFailuresPerBucket
//      recent failures. The brake is consulted ONLY for failing requests, so a
//      valid, enabled key is never blocked by it (no lockout of a legitimate
//      integration by someone else's failures);
//   4. per-key limits (60/min; opens additionally 10/min) → 429;
//   5. required scope missing → 403 `scope_missing`.
//
// Never logs the Authorization header or any part of the key.

import { eq, sql } from 'drizzle-orm'
import { db } from '@/db/client'
import { businesses, integrations, type Business, type Integration, type IntegrationScope } from '@/db/schema'
import { parseAuthorizationHeader, verifySecret } from './keys'
import { clientBucket, limiters } from './rateLimit'
import { writeIntegrationAudit } from './audit'
import { apiError } from './http'
import { isInternalApiRequest, notFoundResponse } from './internalHost'

export type IntegrationContext = { integration: Integration; business: Business }

export type AuthResult = { ok: true; ctx: IntegrationContext } | { ok: false; response: Response }

const LAST_USED_THROTTLE_MS = 60_000

export async function authenticateIntegration(
  req: Request,
  opts: { scope: IntegrationScope; open?: boolean },
): Promise<AuthResult> {
  if (!isInternalApiRequest(req.headers)) return { ok: false, response: notFoundResponse() }
  const lim = limiters()

  const parsed = parseAuthorizationHeader(req.headers.get('authorization'))
  let row: Integration | undefined
  if (parsed) {
    ;[row] = await db.select().from(integrations).where(eq(integrations.keyPrefix, parsed.prefix)).limit(1)
  }
  // Exactly one hash + constant-time compare on every path (dummy when no row).
  const secretOk = verifySecret(parsed?.secret ?? '', row?.keyHash ?? null)

  if (!parsed || !row || !secretOk || !row.enabled) {
    const reason: AuthFailureReason = !parsed ? 'missing_or_malformed' : !row ? 'unknown_prefix' : !secretOk ? 'bad_secret' : 'disabled'
    return { ok: false, response: await authFailure(req, reason, row) }
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
    return { ok: false, response: await authFailure(req, 'business_missing', row) }
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

type AuthFailureReason = 'missing_or_malformed' | 'unknown_prefix' | 'bad_secret' | 'disabled' | 'business_missing'

// A failed authentication: record it against the client bucket and answer
// 401, or 429 once the bucket is over the brake. Refused (429) hits are not
// recorded, so the bucket drains on schedule.
//
// Sampled integration_audit row ('auth.failed'): at most one per bucket per
// minute and RATE.authAuditPerMinGlobal per minute overall. It carries the
// bucket, a reason code and (when the prefix matched a row) the integration
// id — never the Authorization header, prefix or secret.
async function authFailure(req: Request, reason: AuthFailureReason, row?: Integration): Promise<Response> {
  const lim = limiters()
  const bucket = clientBucket(req.headers)
  const brake = lim.authFail.hit(bucket)
  if (lim.authAudit.hit(bucket).allowed && lim.authAuditGlobal.hit('*').allowed) {
    await writeIntegrationAudit({
      integrationId: row?.id ?? null,
      businessId: row?.businessId ?? null,
      action: 'auth.failed',
      metadata: { bucket, reason, braked: !brake.allowed },
    })
  }
  if (!brake.allowed) return apiError(429, 'rate_limited', { 'Retry-After': String(brake.retryAfterSec) })
  return apiError(401, 'unauthorized', { 'WWW-Authenticate': 'Bearer' })
}

export function hasScope(integration: Pick<Integration, 'scopes'>, scope: IntegrationScope): boolean {
  return integration.scopes.includes(scope)
}
