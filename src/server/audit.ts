import { db } from '@/db/client'
import { auditLogs, type AuditAction } from '@/db/schema'

// Best-effort audit log writer. Never throws — a missed audit row should
// never block the action it was tracking (this matches the pattern used
// across the codebase: notifications, post-status, etc., all swallow
// failures rather than 500 the action). The ticket detail page and the
// future audit-tail surface read from `audit_logs`; the Discord channel
// also gets a status footer in parallel for users still living in Discord.
export async function writeAudit(opts: {
  businessId: string
  ticketId: number | null
  actorUserId: string | null
  action: AuditAction
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      businessId: opts.businessId,
      ticketId: opts.ticketId,
      actorUserId: opts.actorUserId,
      action: opts.action,
      metadata: opts.metadata ?? {},
    })
  } catch (err) {
    console.warn('[audit] write failed', { action: opts.action, ticketId: opts.ticketId, err: String(err) })
  }
}
