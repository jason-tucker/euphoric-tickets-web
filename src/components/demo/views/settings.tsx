'use client'

// Editable team settings. Every field and the category list are live; Save writes
// to the per-browser overlay, so reloading keeps your edits. Nothing is sent to a
// server. The live Discord pickers from the real page are replaced with plain
// fields (the demo has no Discord to query).

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { DemoSettings } from '@/server/demo/extras'
import type { DemoBusiness, DemoCategory } from '@/server/demo/data'
import { useDemoStore, mergedCategories } from '@/components/demo/store'
import { SavedHint } from '@/components/demo/bits'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

type BizForm = {
  name: string
  description: string
  discordGuildId: string
  adminRoleIds: string
  webhookUrl: string
  discordFallbackCategoryId: string
  discordClosedCategoryId: string
  deleteClosedAfterDays: string
  ticketMode: 'euphoric' | 'tickettool'
  ticketToolCategoryIds: string
  ticketToolPrefix: string
}

function toForm(b: DemoBusiness): BizForm {
  return {
    name: b.name,
    description: b.description ?? '',
    discordGuildId: b.discordGuildId,
    adminRoleIds: b.adminRoleIds,
    webhookUrl: b.webhookUrl ?? '',
    discordFallbackCategoryId: b.discordFallbackCategoryId ?? '',
    discordClosedCategoryId: b.discordClosedCategoryId ?? '',
    deleteClosedAfterDays: b.deleteClosedAfterDays != null ? String(b.deleteClosedAfterDays) : '',
    ticketMode: b.ticketMode,
    ticketToolCategoryIds: b.ticketToolCategoryIds,
    ticketToolPrefix: b.ticketToolPrefix,
  }
}

export function DemoSettings({ data, slug }: { data: DemoSettings; slug: string }) {
  const store = useDemoStore()
  const merged = useMemo<DemoBusiness>(() => ({ ...data.business, ...store.overlay.settings[slug] }), [data.business, store.overlay.settings, slug])
  const [form, setForm] = useState<BizForm>(() => toForm(merged))
  const [saved, setSaved] = useState(false)

  // Re-seed from persisted overlay once it loads on the client.
  useEffect(() => {
    setForm(toForm(merged))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.hydrated])

  const set = (patch: Partial<BizForm>) => {
    setForm((f) => ({ ...f, ...patch }))
    setSaved(false)
  }

  const save = () => {
    store.saveSettings(slug, {
      name: form.name,
      description: form.description || null,
      discordGuildId: form.discordGuildId,
      adminRoleIds: form.adminRoleIds,
      webhookUrl: form.webhookUrl || null,
      discordFallbackCategoryId: form.discordFallbackCategoryId || null,
      discordClosedCategoryId: form.discordClosedCategoryId || null,
      deleteClosedAfterDays: form.deleteClosedAfterDays ? Number(form.deleteClosedAfterDays) : null,
      ticketMode: form.ticketMode,
      ticketToolCategoryIds: form.ticketToolCategoryIds,
      ticketToolPrefix: form.ticketToolPrefix,
    })
    setSaved(true)
  }

  const categories = useMemo(
    () => mergedCategories({ categories: data.categories }, store.overlay.categoryOps[slug]).sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder) || a.label.localeCompare(b.label)),
    [data.categories, store.overlay.categoryOps, slug],
  )

  return (
    <main className="container max-w-2xl space-y-6 py-6">
      <div className="space-y-1">
        <h1 className="flex flex-wrap items-center gap-x-2 text-2xl font-semibold">
          <span>Settings</span>
          <span className="text-muted-foreground">—</span>
          <span>{merged.name}</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Connect this team to Discord. Roles, webhook, and categories live here.{' '}
          {data.adminTeams.length > 1 && (
            <>Other teams:{' '}
              {data.adminTeams.filter((t) => t.slug !== slug).map((t, i) => (
                <span key={t.slug}>
                  {i > 0 && ', '}
                  <Link href={`/demo/b/${t.slug}/settings`} className="underline">{t.name}</Link>
                </span>
              ))}
            </>
          )}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Team</CardTitle>
          <CardDescription>What end users and your team see.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Name"><Input value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Description"><Textarea value={form.description} onChange={(e) => set({ description: e.target.value })} rows={2} /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Discord</CardTitle>
          <CardDescription>The guild and which roles count as admins of this team.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Discord guild ID"><Input value={form.discordGuildId} onChange={(e) => set({ discordGuildId: e.target.value })} /></Field>
          <Field label="Admin / manager role IDs (CSV)"><Input value={form.adminRoleIds} onChange={(e) => set({ adminRoleIds: e.target.value })} /></Field>
          <Field label="Fallback channel category ID"><Input value={form.discordFallbackCategoryId} onChange={(e) => set({ discordFallbackCategoryId: e.target.value })} /></Field>
          <Field label="Closed-tickets category ID"><Input value={form.discordClosedCategoryId} onChange={(e) => set({ discordClosedCategoryId: e.target.value })} /></Field>
          <Field label="Auto-delete closed after (days)"><Input value={form.deleteClosedAfterDays} onChange={(e) => set({ deleteClosedAfterDays: e.target.value.replace(/\D/g, '') })} placeholder="blank = never" /></Field>
          <Field label="Fallback webhook URL"><Input value={form.webhookUrl} onChange={(e) => set({ webhookUrl: e.target.value })} /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">TicketTool coexistence</CardTitle>
          <CardDescription>Ingest and control a third-party TicketTool bot’s tickets.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Ticket system for this team">
            <select value={form.ticketMode} onChange={(e) => set({ ticketMode: e.target.value as 'euphoric' | 'tickettool' })} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="euphoric">Euphoric Tickets (native panels + web)</option>
              <option value="tickettool">TicketTool (ingest + control its tickets)</option>
            </select>
          </Field>
          <Field label="Watched TicketTool category IDs (CSV)"><Input value={form.ticketToolCategoryIds} onChange={(e) => set({ ticketToolCategoryIds: e.target.value })} /></Field>
          <Field label="TicketTool command prefix"><Input value={form.ticketToolPrefix} onChange={(e) => set({ ticketToolPrefix: e.target.value })} className="w-24" /></Field>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={save}>Save settings</Button>
        {saved && <span className="text-sm text-emerald-500">Saved in your browser ✓</span>}
      </div>
      <SavedHint />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ticket categories</CardTitle>
          <CardDescription>Drives the “Open a ticket” form’s category picker.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">No categories yet — add one below.</p>
          ) : (
            <ul className="divide-y">
              {categories.map((c) => (
                <li key={c.id} className="py-2">
                  <CategoryEditor
                    category={c}
                    onSave={(patch) => store.editCategory(slug, c.id, patch)}
                    onDelete={() => store.deleteCategory(slug, c.id)}
                  />
                </li>
              ))}
            </ul>
          )}
          <AddCategory businessId={data.business.id} onAdd={(cat) => store.addCategory(slug, cat)} />
        </CardContent>
      </Card>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function CategoryEditor({ category, onSave, onDelete }: { category: DemoCategory; onSave: (p: Partial<DemoCategory>) => void; onDelete: () => void }) {
  const [label, setLabel] = useState(category.label)
  const [emoji, setEmoji] = useState(category.emoji ?? '')
  const [description, setDescription] = useState(category.description ?? '')
  const [sortOrder, setSortOrder] = useState(category.sortOrder)
  const [staffOnly, setStaffOnly] = useState(category.staffOnly)
  const [kind, setKind] = useState(category.kind)
  const [done, setDone] = useState(false)

  return (
    <details>
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-md px-1 py-1 hover:bg-accent/50">
        <span className="text-xl" aria-hidden>{category.emoji ?? '·'}</span>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{category.label}</div>
          <div className="text-xs text-muted-foreground"><span className="font-mono">{category.key}</span>{category.description ? ` — ${category.description}` : ''}</div>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">edit</span>
      </summary>
      <div className="mt-3 space-y-3 rounded-md border bg-background/40 p-3">
        <div className="grid gap-3 sm:grid-cols-[6rem_1fr_5rem]">
          <Field label="Emoji"><Input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={8} /></Field>
          <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
          <Field label="Sort"><Input value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></Field>
        </div>
        <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Type">
            <select value={kind} onChange={(e) => setKind(e.target.value as 'normal' | 'project')} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              <option value="normal">Normal</option>
              <option value="project">Project (sub-tickets)</option>
            </select>
          </Field>
          <label className="mt-6 inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={staffOnly} onChange={(e) => setStaffOnly(e.target.checked)} className="h-4 w-4" />
            Staff-only destination
          </label>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" variant="secondary" onClick={() => { onSave({ label, emoji: emoji || null, description: description || null, sortOrder, staffOnly, kind }); setDone(true) }}>Save</Button>
          {done && <span className="text-xs text-emerald-500">Saved ✓</span>}
          <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 className="mr-1 h-3.5 w-3.5" /> Delete</Button>
        </div>
      </div>
    </details>
  )
}

function AddCategory({ businessId, onAdd }: { businessId: string; onAdd: (c: DemoCategory) => void }) {
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [emoji, setEmoji] = useState('')

  return (
    <form
      className="space-y-3 border-t pt-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!key.trim() || !label.trim()) return
        onAdd({
          id: `cat-new-${Math.random().toString(36).slice(2, 8)}`,
          businessId,
          key: key.trim(),
          label: label.trim(),
          emoji: emoji || null,
          description: null,
          sortOrder: '50',
          discordParentCategoryId: null,
          discordClosedCategoryId: null,
          allowRoleIds: '',
          staffRoleIds: '',
          firstMessageTemplate: null,
          staffOnly: false,
          kind: 'normal',
        })
        setKey('')
        setLabel('')
        setEmoji('')
      }}
    >
      <p className="text-sm font-medium">Add a new category</p>
      <div className="grid gap-3 sm:grid-cols-[6rem_8rem_1fr]">
        <Field label="Emoji"><Input value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={8} placeholder="💳" /></Field>
        <Field label="Key"><Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="billing" /></Field>
        <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Billing" /></Field>
      </div>
      <Button type="submit" variant="secondary" size="sm">Add category</Button>
    </form>
  )
}
