import { notFound } from 'next/navigation'
import { getPersonaKey } from '@/server/demo/cookie'
import { getPersona } from '@/server/demo/personas'
import { getDemoTicketBase } from '@/server/demo/detail'
import { getDemoDataset } from '@/server/demo/data'
import { avatarUrl } from '@/lib/format'
import { DemoTicketLoader } from '@/components/demo/views/ticket-loader'
import { PersonaGate } from '@/components/demo/views/gate'

export const dynamic = 'force-dynamic'

export default async function DemoTicketPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  const ticketId = Number(id)
  if (!Number.isInteger(ticketId)) notFound()

  const personaKey = await getPersonaKey()
  const persona = getPersona(personaKey)
  const ds = getDemoDataset()
  const meUser = ds.userById.get(persona.userId)
  const me = {
    id: persona.userId,
    name: meUser?.name ?? 'You',
    image: meUser ? avatarUrl(meUser.discordId, meUser.image) : null,
    discordId: meUser?.discordId ?? null,
  }

  const base = getDemoTicketBase(personaKey, slug, ticketId, new Date())
  if (base) {
    const canSee = base.access.isAdmin || base.access.isStaff || base.access.isOpener
    if (!canSee) return <PersonaGate title={`Ticket #${ticketId}`} need="the opener, staff, or admins of this team" />
  }

  return <DemoTicketLoader base={base} slug={slug} me={me} id={ticketId} />
}
