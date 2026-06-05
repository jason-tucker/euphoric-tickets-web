import { desc, eq } from 'drizzle-orm'
import { TopNav } from '@/components/app/top-nav'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { requireSudo } from '@/server/sudo'
import { db } from '@/db/client'
import { botErrors } from '@/db/schema'
import { relativeTime } from '@/lib/format'

// P12 (lantern) — sudo-only error log viewer. Most recent 200 rows, optional
// level filter. Embedded into /admin/bot (P15) too.
export default async function AdminErrorsPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string }>
}) {
  await requireSudo()
  const sp = await searchParams
  const level = ['error', 'warn', 'info'].includes(sp.level ?? '') ? sp.level : undefined

  const rows = await db
    .select()
    .from(botErrors)
    .where(level ? eq(botErrors.level, level) : undefined)
    .orderBy(desc(botErrors.createdAt))
    .limit(200)

  const levelColor: Record<string, string> = {
    error: 'text-red-500',
    warn: 'text-amber-500',
    info: 'text-muted-foreground',
  }

  return (
    <>
      <TopNav />
      <main className="container max-w-5xl space-y-4 py-6">
        <div>
          <h1 className="text-2xl font-semibold">Bot errors</h1>
          <p className="text-sm text-muted-foreground">
            Most recent {rows.length}. Rows older than 5 days are swept automatically.
          </p>
        </div>

        <div className="flex flex-wrap gap-1">
          {['all', 'error', 'warn', 'info'].map((lv) => {
            const href = lv === 'all' ? '/admin/errors' : `/admin/errors?level=${lv}`
            const active = (lv === 'all' && !level) || lv === level
            return (
              <a
                key={lv}
                href={href}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  active ? 'border-primary/40 bg-primary/10 text-primary' : 'hover:bg-accent'
                }`}
              >
                {lv}
              </a>
            )
          })}
        </div>

        <Card>
          <CardContent className="p-0 sm:p-0">
            {rows.length === 0 ? (
              <div className="px-4 py-6 text-sm text-muted-foreground sm:p-6">No errors logged. 🎉</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Level</TableHead>
                    <TableHead className="w-36">Source</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead className="hidden w-32 sm:table-cell">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className={`text-xs font-medium uppercase ${levelColor[r.level] ?? ''}`}>
                        {r.level}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{r.source ?? '—'}</TableCell>
                      <TableCell className="text-sm">
                        <div className="break-words">{r.message}</div>
                        {r.context && (
                          <pre className="mt-1 overflow-x-auto rounded bg-muted/40 p-1.5 text-[10px] text-muted-foreground">
                            {JSON.stringify(r.context)}
                          </pre>
                        )}
                      </TableCell>
                      <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                        {relativeTime(r.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  )
}
