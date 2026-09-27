// Integration API — post a message into an integration ticket (plan §4.3).
// Requires an Idempotency-Key header.
import { handlePostMessage } from '@/server/integrations/api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handlePostMessage(req, id)
}
