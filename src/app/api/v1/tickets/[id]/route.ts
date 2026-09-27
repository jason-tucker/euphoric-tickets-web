// Integration API — read / update one integration ticket (plan §4.3).
import { handleGetTicket, handlePatchTicket } from '@/server/integrations/api'
import { guardApi } from '@/server/integrations/http'

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
