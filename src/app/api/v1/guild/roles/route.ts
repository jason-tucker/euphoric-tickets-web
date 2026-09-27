// Integration API — the key's guild roles, cached 5 min (plan §4.3).
import { handleGuildRoles } from '@/server/integrations/api'
import { guardApi } from '@/server/integrations/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  return guardApi('roles', () => handleGuildRoles(req))
}
