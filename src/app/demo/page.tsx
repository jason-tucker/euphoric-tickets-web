import { getPersonaKey } from '@/server/demo/cookie'
import { demoScope, demoVisibleTickets, getPersona } from '@/server/demo/personas'
import { DemoDashboard } from '@/components/demo/views/dashboard'

export const dynamic = 'force-dynamic'

export default async function DemoHome({ searchParams }: { searchParams: Promise<{ mode?: string; closed?: string }> }) {
  const personaKey = await getPersonaKey()
  const persona = getPersona(personaKey)
  const scope = demoScope(persona)
  const sp = await searchParams

  const isAdmin = scope.adminTeamIds.length > 0
  const showTeamTab = scope.staffCategoryIds.length > 0 || isAdmin
  let mode: 'mine' | 'team' | 'admin' = 'mine'
  if (sp.mode === 'admin' && isAdmin) mode = 'admin'
  else if (sp.mode === 'team' && showTeamTab) mode = 'team'

  const base = demoVisibleTickets(persona, new Date(), 1000)

  return <DemoDashboard scope={scope} base={base} mode={mode} showClosed={sp.closed === '1'} />
}
