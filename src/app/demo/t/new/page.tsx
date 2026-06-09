import { getPersonaKey } from '@/server/demo/cookie'
import { getPersona } from '@/server/demo/personas'
import { getDemoNewTicketForm } from '@/server/demo/extras'
import { getDemoDataset } from '@/server/demo/data'
import { avatarUrl } from '@/lib/format'
import { DemoNewTicket } from '@/components/demo/views/new-ticket'

export const dynamic = 'force-dynamic'

export default async function DemoNewTicketPage({ searchParams }: { searchParams: Promise<{ b?: string }> }) {
  const personaKey = await getPersonaKey()
  const persona = getPersona(personaKey)
  const form = getDemoNewTicketForm(personaKey)
  const ds = getDemoDataset()
  const u = ds.userById.get(persona.userId)
  const me = { id: persona.userId, name: u?.name ?? 'You', image: u ? avatarUrl(u.discordId, u.image) : null, discordId: u?.discordId ?? null }
  const sp = await searchParams
  return <DemoNewTicket form={form} me={me} preselect={sp.b} />
}
