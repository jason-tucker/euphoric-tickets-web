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

export default async function TicketsPage() {
  const session = await requireSession()
  const scope = await ticketsConsoleScope()
  // Console is for people who manage or staff tickets; everyone else has the
  // personal "Overview" (My tickets) view.
  if (!scope.canUse) redirect('/dashboard')

  const data = await getTicketsConsoleData()

  return (
    <>
      <TopNav />
      <main className="mx-auto w-full max-w-[96rem] space-y-4 px-4 py-6 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold">Tickets</h1>
          <p className="text-sm text-muted-foreground">
            Every ticket across your teams — sort any column, filter by team, and it stays live as
            things change.
          </p>
        </div>
        <TicketsConsole initial={data} meId={session.user.id} />
      </main>
    </>
  )
}
