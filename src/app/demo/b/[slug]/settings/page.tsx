import { notFound } from 'next/navigation'
import { getPersonaKey } from '@/server/demo/cookie'
import { getPersona } from '@/server/demo/personas'
import { getDemoSettings } from '@/server/demo/extras'
import { DemoSettings } from '@/components/demo/views/settings'
import { PersonaGate } from '@/components/demo/views/gate'

export const dynamic = 'force-dynamic'

export default async function DemoSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const personaKey = await getPersonaKey()
  const persona = getPersona(personaKey)
  const data = getDemoSettings(personaKey, slug)
  if (!data) notFound()
  const isAdmin = persona.isSudo || persona.adminTeamIds.has(data.business.id)
  if (!isAdmin) return <PersonaGate title={`Settings — ${data.business.name}`} need="admins of this team" />
  return <DemoSettings data={data} slug={slug} />
}
