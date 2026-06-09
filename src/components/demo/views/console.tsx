'use client'

import { useMemo } from 'react'
import { TicketsConsole } from '@/components/app/tickets-console'
import type { DemoConsoleTeam, DemoTicket } from '@/server/demo/personas'
import { useDemoStore, mergeTicketList } from '@/components/demo/store'

export function DemoConsole({
  tickets,
  teams,
  meId,
  initialTeamSlug,
}: {
  tickets: DemoTicket[]
  teams: DemoConsoleTeam[]
  meId: string
  initialTeamSlug?: string
}) {
  const { overlay, hydrated } = useDemoStore()
  const merged = useMemo(
    () => ({ tickets: mergeTicketList(tickets, overlay), teams, generatedAt: new Date().toISOString() }),
    [tickets, teams, overlay],
  )
  // Re-seed the console (which holds `initial` in state) once the persisted
  // overlay loads, and whenever the visitor's edit count changes.
  const sig = `${hydrated ? 1 : 0}:${overlay.newTickets.length}:${Object.keys(overlay.ticketPatches).length}`
  return <TicketsConsole key={sig} initial={merged} meId={meId} initialTeamSlug={initialTeamSlug} live={false} basePath="/demo" />
}
