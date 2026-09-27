// Integration API — the key's guild roles, cached 5 min (plan §4.3).
import { handleGuildRoles } from '@/server/integrations/api'
import { guardApi } from '@/server/integrations/http'
import { v1MethodNotAllowed, v1Options } from '@/server/integrations/internalHost'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  return guardApi('roles', () => handleGuildRoles(req))
}

// Host-gated answers for every method this route does not implement (see internalHost.ts).
const IMPLEMENTED = ['GET'] as const
export const OPTIONS = v1Options([...IMPLEMENTED])
export const POST = v1MethodNotAllowed([...IMPLEMENTED])
export const PUT = v1MethodNotAllowed([...IMPLEMENTED])
export const PATCH = v1MethodNotAllowed([...IMPLEMENTED])
export const DELETE = v1MethodNotAllowed([...IMPLEMENTED])
