// Integration API — the key's guild roles, cached 5 min (plan §4.3).
import { handleGuildRoles } from '@/server/integrations/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request) {
  return handleGuildRoles(req)
}
