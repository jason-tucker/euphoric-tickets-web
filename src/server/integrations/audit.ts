import { db } from '@/db/client'
import { integrationAudit } from '@/db/schema'

// Best-effort integration audit writer (never throws, like server/audit.ts).
// `metadata` must never carry secrets, keys, webhook secrets or headers —
// callers pass ids, names, scopes and outcomes only.
export async function writeIntegrationAudit(opts: {
  integrationId: string | null
  businessId: string | null
  actorUserId?: string | null
  action: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    await db.insert(integrationAudit).values({
      integrationId: opts.integrationId,
      businessId: opts.businessId,
      actorUserId: opts.actorUserId ?? null,
      action: opts.action,
      metadata: opts.metadata ?? {},
    })
  } catch (err) {
    console.warn('[integration-audit] write failed', { action: opts.action, err: err instanceof Error ? err.name : 'unknown' })
  }
}
