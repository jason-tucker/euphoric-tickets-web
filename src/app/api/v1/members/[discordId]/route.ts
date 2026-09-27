// Integration API — guild membership lookup (plan §4.3).
import { handleMember } from '@/server/integrations/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request, { params }: { params: Promise<{ discordId: string }> }) {
  const { discordId } = await params
  return handleMember(req, discordId)
}
