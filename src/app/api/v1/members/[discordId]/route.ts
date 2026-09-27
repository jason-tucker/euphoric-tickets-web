// Integration API — guild membership lookup (plan §4.3).
import { handleMember } from '@/server/integrations/api'
import { guardApi } from '@/server/integrations/http'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ discordId: string }> }) {
  const { discordId } = await params
  return guardApi('member', () => handleMember(req, discordId))
}
