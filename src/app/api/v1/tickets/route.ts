// Integration API — open a ticket (plan §4.3). Docker-network only; the edge
// 404s /api/v1/* (plan §4.6). Logic: src/server/integrations/api.ts.
import { handleOpenTicket } from '@/server/integrations/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  return handleOpenTicket(req)
}
