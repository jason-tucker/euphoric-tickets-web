'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { Plus, Building2 } from 'lucide-react'
import type { DemoScope, DemoTicket } from '@/server/demo/personas'
import { useDemoStore, mergeTicketList } from '@/components/demo/store'
import { StatusBadge } from '@/components/app/status-badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { relativeTime } from '@/lib/format'

type Mode = 'mine' | 'team' | 'admin'

export function DemoDashboard({
  scope,
  base,
  mode,
  showClosed,
}: {
  scope: DemoScope
  base: DemoTicket[]
  mode: Mode
  showClosed: boolean
}) {
  const { overlay } = useDemoStore()
  const isAdmin = scope.adminTeamIds.length > 0
  const hasTeam = scope.staffCategoryIds.length > 0
  const showTeamTab = hasTeam || isAdmin

  const merged = useMemo(() => mergeTicketList(base, overlay), [base, overlay])
  const staffCats = useMemo(() => new Set(scope.staffCategoryIds), [scope.staffCategoryIds])
  const adminTeams = useMemo(() => new Set(scope.adminTeamIds), [scope.adminTeamIds])
  const me = scope.personaUserId

  const rows = useMemo(() => {
    const closedOk = (t: DemoTicket) => (showClosed ? true : t.status !== 'closed')
    let list: DemoTicket[]
    if (mode === 'mine') {
      list = merged.filter((t) => t.openerId === me && closedOk(t))
    } else if (mode === 'team') {
      list = merged.filter((t) => t.categoryId != null && staffCats.has(t.categoryId) && t.openerId !== me && closedOk(t))
    } else {
      list = merged.filter(
        (t) => adminTeams.has(t.teamId) && t.openerId !== me && !(t.categoryId != null && staffCats.has(t.categoryId)) && closedOk(t),
      )
    }
    return list.slice(0, 50)
  }, [merged, mode, showClosed, me, staffCats, adminTeams])

  const dashHref = (m: Mode, closed: boolean) => {
    const params = new URLSearchParams()
    if (m !== 'mine') params.set('mode', m)
    if (closed) params.set('closed', '1')
    const qs = params.toString()
    return qs ? `/demo?${qs}` : '/demo'
  }

  const adminOf = scope.businesses.filter((b) => b.level === 'admin' || b.level === 'owner')

  return (
    <main className="container max-w-6xl space-y-6 py-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">My tickets</h1>
          <p className="text-sm text-muted-foreground">
            {mode === 'mine'
              ? `Tickets you’ve opened across ${scope.businesses.length} ${scope.businesses.length === 1 ? 'team' : 'teams'}.`
              : mode === 'team'
                ? 'Tickets you can reach through a staff role you aren’t personally on.'
                : `Tickets in ${scope.adminTeamIds.length} ${scope.adminTeamIds.length === 1 ? 'team' : 'teams'} you administer.`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {showTeamTab && (
              <div className="inline-flex gap-1 rounded-md border border-input bg-background p-0.5 text-xs">
                <Button asChild size="sm" variant={mode === 'mine' ? 'secondary' : 'ghost'} className="h-7 px-3">
                  <Link href={dashHref('mine', showClosed)}>Mine</Link>
                </Button>
                <Button asChild size="sm" variant={mode === 'team' ? 'secondary' : 'ghost'} className="h-7 px-3">
                  <Link href={dashHref('team', showClosed)}>Team</Link>
                </Button>
                {isAdmin && (
                  <Button asChild size="sm" variant={mode === 'admin' ? 'secondary' : 'ghost'} className="h-7 px-3">
                    <Link href={dashHref('admin', showClosed)}>Admin</Link>
                  </Button>
                )}
              </div>
            )}
            <Button asChild size="sm" variant={showClosed ? 'secondary' : 'outline'} className="h-7 px-3 text-xs">
              <Link href={dashHref(mode, !showClosed)}>{showClosed ? 'Hide closed' : 'Show closed'}</Link>
            </Button>
          </div>
        </div>
        <Button asChild>
          <Link href="/demo/t/new">
            <Plus />
            Open a ticket
          </Link>
        </Button>
      </div>

      {rows.length > 0 ? (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">#</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead className="hidden md:table-cell">Team</TableHead>
                  <TableHead className="w-20">Status</TableHead>
                  <TableHead className="hidden w-32 sm:table-cell">Last activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((t) => (
                  <TableRow key={`${t.teamSlug}-${t.id}`}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{t.id}</TableCell>
                    <TableCell className="max-w-[40ch] truncate">
                      <Link href={`/demo/b/${t.teamSlug}/tickets/${t.id}`} className="font-medium hover:underline">
                        {t.subject}
                      </Link>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">{t.teamName}</TableCell>
                    <TableCell><StatusBadge status={t.status} /></TableCell>
                    <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">{relativeTime(t.lastActivityAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{mode === 'mine' ? 'No tickets yet' : mode === 'team' ? 'Nothing in your team queue' : 'Nothing in your admin queue'}</CardTitle>
            <CardDescription>
              {mode === 'mine'
                ? 'Open a ticket and it shows up here — your reply is saved in your browser.'
                : 'Switch persona to explore other queues, or change filters above.'}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {adminOf.length > 0 && (
        <section>
          <h2 className="mb-2 mt-8 text-lg font-semibold">You administer</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {adminOf.map((b) => (
              <Link key={b.id} href={`/demo/tickets`} className="block">
                <Card className="transition-colors hover:bg-accent/50">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      {b.name}
                    </CardTitle>
                    <CardDescription className="flex items-center justify-between">
                      <span>/{b.slug}</span>
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-primary">{b.level}</span>
                    </CardDescription>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
