import { redirect } from 'next/navigation'
import { TopNav } from '@/components/app/top-nav'
import { TicketsConsole } from '@/components/app/tickets-console'
import { requireSession } from '@/server/permissions'
import { getTicketsConsoleData, ticketsConsoleScope } from '@/server/tickets'

// The cross-team Tickets console. The server shell only resolves access and the
// first dataset; all sorting / filtering / multi-team selection happen client-
// side and live (see TicketsConsole), so there are no further navigations,
// URL changes, or spinners once you're here.
export const dynamic = 'force-dynamic'

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string }>
}) {
  const session = await requireSession()
  const scope = await ticketsConsoleScope()
  // Console is for people who manage or staff tickets; everyone else has the
  // personal "Overview" (My tickets) view.
  if (!scope.canUse) redirect('/dashboard')

  const [data, sp] = await Promise.all([getTicketsConsoleData(), searchParams])

  return (
    <>
      <TopNav />
      {/* Full-bleed, full-height app shell — the console spans the whole browser
          (edge to edge, no centered max-width, no card box) and fills the
          viewport below the 3.5rem header, ConnectWise-Manage style. The grid
          scrolls internally; only the toolbar header stays pinned. */}
      <main className="flex h-[calc(100svh-3.5rem)] flex-col">
        <TicketsConsole initial={data} meId={session.user.id} initialTeamSlug={sp.team} />
      </main>
    </>
  )
}
