import { redirect } from 'next/navigation'
import { requireSession } from '@/server/permissions'
import { ticketsConsoleScope } from '@/server/tickets'

// The team-settings hub is gone — the Settings page carries its own team
// switcher now. Send anyone who lands here straight to a team's settings (or
// the dashboard if they administer none).
export default async function TeamSettingsHubRedirect() {
  await requireSession()
  const { adminTeams } = await ticketsConsoleScope()
  if (adminTeams[0]) redirect(`/b/${adminTeams[0].slug}/settings`)
  redirect('/dashboard')
}
