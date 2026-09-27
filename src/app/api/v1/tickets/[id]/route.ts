// Integration API — read / update one integration ticket (plan §4.3).
import { handleGetTicket, handlePatchTicket } from '@/server/integrations/api'
import { guardApi } from '@/server/integrations/http'
import { v1MethodNotAllowed, v1Options } from '@/server/integrations/internalHost'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params
  return guardApi('get', () => handleGetTicket(req, id))
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params
  return guardApi('patch', () => handlePatchTicket(req, id))
}

// Host-gated answers for every method this route does not implement (see internalHost.ts).
const IMPLEMENTED = ['GET', 'PATCH'] as const
export const OPTIONS = v1Options([...IMPLEMENTED])
export const POST = v1MethodNotAllowed([...IMPLEMENTED])
export const PUT = v1MethodNotAllowed([...IMPLEMENTED])
export const DELETE = v1MethodNotAllowed([...IMPLEMENTED])
