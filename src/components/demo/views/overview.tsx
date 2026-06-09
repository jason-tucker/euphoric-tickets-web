'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import type { DemoTeamOverview } from '@/server/demo/personas'
import { useDemoStore, mergeTicketList } from '@/components/demo/store'
import { StatusBadge } from '@/components/app/status-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { relativeTime } from '@/lib/format'

export function DemoTeamOverviewView({ data }: { data: DemoTeamOverview }) {
  const { overlay } = useDemoStore()
  const myTickets = useMemo(
    () => mergeTicketList(data.myTickets, overlay).filter((t) => t.teamSlug === data.team.slug).slice(0, 10),
    [data.myTickets, data.team.slug, overlay],
  )

  return (
    <main className="container max-w-6xl space-y-6 py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{data.team.name}</h1>
          {data.team.description && <p className="text-sm text-muted-foreground">{data.team.description}</p>}
        </div>
        <Button asChild>
          <Link href={`/demo/t/new?b=${data.team.slug}`}>
            <Plus />
            Open a ticket
          </Link>
        </Button>
      </div>

      {data.isAdmin && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Open" value={data.stats.open} tone="text-status-open" />
          <Stat label="Claimed" value={data.stats.claimed} tone="text-status-claimed" />
          <Stat label="Waiting" value={data.stats.waiting} tone="text-status-waiting" />
          <Stat label="Closed (24h)" value={data.stats.closedToday} tone="text-status-closed" />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">My recent tickets</CardTitle>
          <CardDescription>Tickets you’ve opened in {data.team.name}.</CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {myTickets.length === 0 ? (
            <div className="px-4 py-6 text-sm text-muted-foreground sm:p-6">No tickets yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead className="w-20">Status</TableHead>
                  <TableHead className="hidden w-32 sm:table-cell">Last activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myTickets.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{t.id}</TableCell>
                    <TableCell className="max-w-[40ch] truncate">
                      <Link href={`/demo/b/${data.team.slug}/tickets/${t.id}`} className="font-medium hover:underline">
                        {t.subject}
                      </Link>
                    </TableCell>
                    <TableCell><StatusBadge status={t.status} /></TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{relativeTime(t.lastActivityAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card>
      <CardContent className="py-4 sm:py-4">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
      </CardContent>
    </Card>
  )
}
