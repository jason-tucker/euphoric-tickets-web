import Link from 'next/link'
import { notFound } from 'next/navigation'
import { asc, desc, eq } from 'drizzle-orm'
import { Trash2 } from 'lucide-react'
import { TopNav } from '@/components/app/top-nav'
import { db } from '@/db/client'
import {
  businesses,
  integrationAudit,
  integrationDeliveries,
  integrations,
  integrationScopes,
  integrationWebhookAllowlist,
  ticketCategories,
} from '@/db/schema'
import { requireSudo } from '@/server/sudo'
import { allowlistRowUrl } from '@/server/integrations/adminValidation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SubmitButton } from '@/components/app/submit-button'
import { OneTimeSecretForm } from '@/components/app/one-time-secret-form'
import { relativeTime } from '@/lib/format'
import {
  addAllowlistAction,
  removeAllowlistAction,
  rotateKeyAction,
  rotateSecretAction,
  setCategoryIntegrationOnlyAction,
  setCategoryPingStaffOnOpenAction,
  setEnabledAction,
  setWebhookUrlAction,
  updateIntegrationAction,
} from '../actions'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function deliveryState(d: { deliveredAt: Date | null; nextAttemptAt: Date | null }): { label: string; tone: 'secondary' | 'outline' | 'destructive' } {
  if (d.deliveredAt) return { label: 'delivered', tone: 'secondary' }
  if (d.nextAttemptAt) return { label: 'pending', tone: 'outline' }
  return { label: 'failed', tone: 'destructive' }
}

export default async function AdminIntegrationPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSudo()
  const { id } = await params
  if (!UUID_RE.test(id)) notFound()
  const [integ] = await db.select().from(integrations).where(eq(integrations.id, id)).limit(1)
  if (!integ) notFound()

  const [[biz], cats, allow, deliveries, audit] = await Promise.all([
    db.select().from(businesses).where(eq(businesses.id, integ.businessId)).limit(1),
    db
      .select()
      .from(ticketCategories)
      .where(eq(ticketCategories.businessId, integ.businessId))
      .orderBy(asc(ticketCategories.sortOrder), asc(ticketCategories.label)),
    db.select().from(integrationWebhookAllowlist).where(eq(integrationWebhookAllowlist.integrationId, integ.id)),
    db
      .select()
      .from(integrationDeliveries)
      .where(eq(integrationDeliveries.integrationId, integ.id))
      .orderBy(desc(integrationDeliveries.createdAt))
      .limit(100),
    db.select().from(integrationAudit).where(eq(integrationAudit.integrationId, integ.id)).orderBy(desc(integrationAudit.createdAt)).limit(50),
  ])

  const selectCls = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'

  return (
    <>
      <TopNav />
      <main className="container max-w-4xl space-y-6 py-6">
        <div className="space-y-1">
          <Link href="/admin/integrations" className="text-sm underline underline-offset-2">
            ← Integrations
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            {integ.name}
            {integ.enabled ? <Badge variant="secondary">enabled</Badge> : <Badge variant="destructive">disabled</Badge>}
          </h1>
          <p className="flex flex-wrap gap-x-3 text-sm text-muted-foreground">
            <span>
              Team: {biz?.name} (/{biz?.slug})
            </span>
            <span className="font-mono">{integ.slug}</span>
            <span className="font-mono">etk.{integ.keyPrefix}.…</span>
            <span>{integ.lastUsedAt ? `last used ${relativeTime(integ.lastUsedAt)}` : 'never used'}</span>
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateIntegrationAction.bind(null, integ.id)} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" name="name" defaultValue={integ.name} required maxLength={60} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="linkOrigin">Link origin</Label>
                  <Input id="linkOrigin" name="linkOrigin" defaultValue={integ.linkOrigin ?? ''} placeholder="https://music.euphoric.fm" />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="allowedCategoryKeys">Allowed category keys</Label>
                <Input id="allowedCategoryKeys" name="allowedCategoryKeys" defaultValue={integ.allowedCategoryKeys.join(', ')} />
                <p className="text-xs text-muted-foreground">Team keys: {cats.map((c) => c.key).join(', ') || 'none'}</p>
              </div>
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium">Scopes</legend>
                <div className="flex flex-wrap gap-3">
                  {integrationScopes.map((s) => (
                    <label key={s} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" name="scopes" value={s} defaultChecked={integ.scopes.includes(s)} className="h-4 w-4" />{' '}
                      <code>{s}</code>
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="actorImpersonation" defaultChecked={integ.actorImpersonation} className="h-4 w-4" />
                Allow <code>actorDiscordId</code>
              </label>
              <SubmitButton pendingChildren="Saving…">Save settings</SubmitButton>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Webhook</CardTitle>
            <CardDescription>
              The URL must exactly match an allowlist row (scheme, host, port, path). At send time the host must resolve
              inside the row&apos;s network CIDR; loopback and link-local addresses are always refused.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {allow.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Allowed URL</TableHead>
                    <TableHead>Expected network</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allow.map((r) => (
                    <TableRow key={allowlistRowUrl(r)}>
                      <TableCell className="break-all font-mono text-xs">{allowlistRowUrl(r)}</TableCell>
                      <TableCell className="font-mono text-xs">{r.expectedNetworkCidr}</TableCell>
                      <TableCell>
                        <form action={removeAllowlistAction.bind(null, integ.id)}>
                          <input type="hidden" name="scheme" value={r.scheme} />
                          <input type="hidden" name="host" value={r.host} />
                          <input type="hidden" name="port" value={r.port} />
                          <input type="hidden" name="path" value={r.path} />
                          <Button type="submit" size="sm" variant="ghost" aria-label="Remove allowlist row">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </form>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <form action={addAllowlistAction.bind(null, integ.id)} className="grid gap-2 sm:grid-cols-6">
              <select name="scheme" className={`${selectCls} sm:col-span-1`} aria-label="Scheme" defaultValue="http">
                <option value="http">http</option>
                <option value="https">https</option>
              </select>
              <Input name="host" placeholder="music-web" required aria-label="Host" className="sm:col-span-2" />
              <Input name="port" placeholder="6096" required inputMode="numeric" aria-label="Port" className="sm:col-span-1" />
              <Input name="path" placeholder="/api/hooks/tickets" required aria-label="Path" className="sm:col-span-2" />
              <Input name="expectedNetworkCidr" placeholder="172.30.40.0/24" required aria-label="Expected network CIDR" className="sm:col-span-3" />
              <div className="sm:col-span-3">
                <SubmitButton variant="outline" pendingChildren="Adding…">
                  Add allowlist row
                </SubmitButton>
              </div>
            </form>
            <form action={setWebhookUrlAction.bind(null, integ.id)} className="space-y-1">
              <Label htmlFor="webhookUrl">Webhook URL</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input id="webhookUrl" name="webhookUrl" defaultValue={integ.webhookUrl ?? ''} list="allowed-urls" placeholder="empty = no webhook" />
                <datalist id="allowed-urls">
                  {allow.map((r) => (
                    <option key={allowlistRowUrl(r)} value={allowlistRowUrl(r)} />
                  ))}
                </datalist>
                <SubmitButton pendingChildren="Saving…">Save URL</SubmitButton>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Credentials &amp; state</CardTitle>
            <CardDescription>Rotation takes effect immediately; the old value stops working.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            <OneTimeSecretForm
              action={rotateKeyAction.bind(null, integ.id)}
              submitLabel="Rotate API key"
              pendingLabel="Rotating…"
              variant="outline"
              confirm="Rotate the API key? The current key stops working immediately."
            />
            <OneTimeSecretForm
              action={rotateSecretAction.bind(null, integ.id)}
              submitLabel="Rotate webhook secret"
              pendingLabel="Rotating…"
              variant="outline"
              confirm="Rotate the webhook signing secret? The receiver must be updated."
            />
            <form action={setEnabledAction.bind(null, integ.id)}>
              <input type="hidden" name="enabled" value={integ.enabled ? 'false' : 'true'} />
              <SubmitButton variant={integ.enabled ? 'destructive' : 'default'} pendingChildren="Saving…">
                {integ.enabled ? 'Disable integration' : 'Enable integration'}
              </SubmitButton>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Integration-only categories</CardTitle>
            <CardDescription>
              An integration-only category is hidden from the web &quot;Open a ticket&quot; form and refused on Discord
              panels; only an integration can open tickets in it. &quot;Staff ping&quot; controls whether the bot&apos;s
              ticket-open message pings the category&apos;s staff roles; off pings only the opener (staff keep access).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {cats.length === 0 && <p className="text-sm text-muted-foreground">This team has no categories.</p>}
            {cats.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-sm">
                  {c.emoji ? `${c.emoji} ` : ''}
                  {c.label} <code className="text-xs text-muted-foreground">{c.key}</code>
                  {c.integrationOnly && (
                    <Badge variant="outline" className="ml-2">
                      integration-only
                    </Badge>
                  )}
                  <Badge variant={c.pingStaffOnOpen ? 'secondary' : 'outline'} className="ml-2">
                    {c.pingStaffOnOpen ? 'staff ping: on' : 'staff ping: off'}
                  </Badge>
                </span>
                <div className="flex flex-wrap gap-2">
                  <form action={setCategoryPingStaffOnOpenAction.bind(null, integ.id)}>
                    <input type="hidden" name="categoryId" value={c.id} />
                    <input type="hidden" name="pingStaffOnOpen" value={c.pingStaffOnOpen ? 'false' : 'true'} />
                    <SubmitButton size="sm" variant="outline" pendingChildren="…">
                      {c.pingStaffOnOpen ? 'Stop pinging staff' : 'Ping staff on open'}
                    </SubmitButton>
                  </form>
                  <form action={setCategoryIntegrationOnlyAction.bind(null, integ.id)}>
                    <input type="hidden" name="categoryId" value={c.id} />
                    <input type="hidden" name="integrationOnly" value={c.integrationOnly ? 'false' : 'true'} />
                    <SubmitButton size="sm" variant="outline" pendingChildren="…">
                      {c.integrationOnly ? 'Allow normal opens' : 'Make integration-only'}
                    </SubmitButton>
                  </form>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Delivery log (latest {deliveries.length})</h2>
          <Card>
            <CardContent className="p-0 sm:p-0">
              {deliveries.length === 0 ? (
                <p className="px-4 py-6 text-sm text-muted-foreground">No deliveries yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Event</TableHead>
                      <TableHead>State</TableHead>
                      <TableHead className="hidden sm:table-cell">Attempts</TableHead>
                      <TableHead>Last</TableHead>
                      <TableHead className="hidden sm:table-cell">When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {deliveries.map((d) => {
                      const st = deliveryState(d)
                      return (
                        <TableRow key={d.id}>
                          <TableCell className="text-xs">
                            <div className="font-mono">{d.event}</div>
                            <div className="font-mono text-[10px] text-muted-foreground">{d.id}</div>
                          </TableCell>
                          <TableCell>
                            <Badge variant={st.tone}>{st.label}</Badge>
                          </TableCell>
                          <TableCell className="hidden text-xs sm:table-cell">{d.attempts}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {d.lastStatus ?? '—'}
                            {d.lastErrorClass ? ` · ${d.lastErrorClass}` : ''}
                          </TableCell>
                          <TableCell className="hidden text-xs text-muted-foreground sm:table-cell">
                            {relativeTime(d.createdAt)}
                            {d.nextAttemptAt && !d.deliveredAt ? ` · next ${relativeTime(d.nextAttemptAt)}` : ''}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Audit</h2>
          <ul className="space-y-1 text-sm">
            {audit.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-2">
                <span className="text-muted-foreground">{relativeTime(a.createdAt)}</span>
                <code>{a.action}</code>
              </li>
            ))}
            {audit.length === 0 && <li className="text-muted-foreground">Nothing yet.</li>}
          </ul>
        </section>
      </main>
    </>
  )
}
