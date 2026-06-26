import { getPersonaKey } from '@/server/demo/cookie'
import { demoConsoleTeams, demoScope, demoVisibleTickets, getPersona } from '@/server/demo/personas'
import { DemoConsole } from '@/components/demo/views/console'
import { PersonaGate } from '@/components/demo/views/gate'

export const dynamic = 'force-dynamic'

export default async function DemoTicketsPage({ searchParams }: { searchParams: Promise<{ team?: string }> }) {
  const personaKey = await getPersonaKey()
  const persona = getPersona(personaKey)
  const scope = demoScope(persona)
  if (!scope.canUseConsole) {
    return <PersonaGate title="The Tickets console" need="staff (category-level or team-wide) and admins" />
  }

  const tickets = demoVisibleTickets(persona, new Date(), 1000)
  const teams = demoConsoleTeams(persona)
  const sp = await searchParams

  return (
    <main className="flex h-[calc(100svh-6rem)] flex-col">
      <DemoConsole tickets={tickets} teams={teams} meId={persona.userId} initialTeamSlug={sp.team} />
    </main>
  )
}
