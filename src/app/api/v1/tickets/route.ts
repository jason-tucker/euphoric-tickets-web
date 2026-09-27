// Integration API — open a ticket (plan §4.3). Docker-network only; the edge
// 404s /api/v1/* (plan §4.6). Logic: src/server/integrations/api.ts.
import { handleOpenTicket } from '@/server/integrations/api'
import { guardApi } from '@/server/integrations/http'
import { v1MethodNotAllowed, v1Options } from '@/server/integrations/internalHost'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request) {
  return guardApi('open', () => handleOpenTicket(req))
}

// Host-gated answers for every method this route does not implement (see internalHost.ts).
const IMPLEMENTED = ['POST'] as const
export const OPTIONS = v1Options([...IMPLEMENTED])
export const GET = v1MethodNotAllowed([...IMPLEMENTED])
export const HEAD = v1MethodNotAllowed([...IMPLEMENTED])
export const PUT = v1MethodNotAllowed([...IMPLEMENTED])
export const PATCH = v1MethodNotAllowed([...IMPLEMENTED])
export const DELETE = v1MethodNotAllowed([...IMPLEMENTED])
