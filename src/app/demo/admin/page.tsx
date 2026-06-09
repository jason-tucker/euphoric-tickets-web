import Link from 'next/link'
import { getPersonaKey } from '@/server/demo/cookie'
import { getPersona } from '@/server/demo/personas'
import { getDemoSudoTeams } from '@/server/demo/extras'
import { PersonaGate } from '@/components/demo/views/gate'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export const dynamic = 'force-dynamic'

export default async function DemoAdminPage() {
  const persona = getPersona(await getPersonaKey())
  if (!persona.isSudo) return <PersonaGate title="Sudo — Teams" need="the bot owner (Sudo persona)" />

  const teams = getDemoSudoTeams()
  return (
    <main className="container max-w-4xl space-y-6 py-6">
      <div>
        <h1 className="text-2xl font-semibold">Teams</h1>
        <p className="text-sm text-muted-foreground">Every team (business) across all servers. Sudo-only.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All teams ({teams.length})</CardTitle>
          <CardDescription>Teams are auto-provisioned by the bot when it joins a server.</CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Team</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead className="hidden sm:table-cell">Server</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {teams.map((t) => (
                <TableRow key={t.slug}>
                  <TableCell className="font-medium">
                    <Link href={`/demo/b/${t.slug}`} className="hover:underline">{t.name}</Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">/{t.slug}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">{t.guildName}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  )
}
