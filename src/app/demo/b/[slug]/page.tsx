import { notFound } from 'next/navigation'
import { getPersonaKey } from '@/server/demo/cookie'
import { demoTeamOverview, getPersona } from '@/server/demo/personas'
import { DemoTeamOverviewView } from '@/components/demo/views/overview'
import { PersonaGate } from '@/components/demo/views/gate'

export const dynamic = 'force-dynamic'

export default async function DemoTeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const persona = getPersona(await getPersonaKey())
  const data = demoTeamOverview(persona, slug, new Date())
  if (!data) notFound()
  if (!data.visible) return <PersonaGate title={data.team.name} need="members of this team" />
  return <DemoTeamOverviewView data={data} />
}
