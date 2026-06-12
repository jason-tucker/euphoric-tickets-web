'use client'

// Open a ticket in the demo. It creates a ticket in the per-browser overlay and
// drops you on its detail page — the new ticket then shows up in your dashboard
// and the console, and survives reloads. Nothing is sent to a server.

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { DemoNewTicketForm } from '@/server/demo/extras'
import { useDemoStore } from '@/components/demo/store'
import { SavedHint } from '@/components/demo/bits'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

type Me = { id: string; name: string; image: string | null; discordId: string | null }

export function DemoNewTicket({ form, me, preselect }: { form: DemoNewTicketForm; me: Me; preselect?: string }) {
  const router = useRouter()
  const store = useDemoStore()
  const initialTeam = form.teams.find((t) => t.slug === preselect)?.slug ?? form.teams[0]?.slug ?? ''
  const [teamSlug, setTeamSlug] = useState(initialTeam)
  const [categoryKey, setCategoryKey] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')

  const cats = form.categoriesByTeam[teamSlug] ?? []

  if (form.teams.length === 0) {
    return (
      <main className="container max-w-xl py-10">
        <Card>
          <CardHeader><CardTitle>No teams</CardTitle></CardHeader>
          <CardContent className="text-sm text-muted-foreground">This persona isn’t in any team. Switch persona to open a ticket.</CardContent>
        </Card>
      </main>
    )
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const team = form.teams.find((t) => t.slug === teamSlug)
    if (!team || !subject.trim()) return
    const cat = cats.find((c) => c.key === categoryKey)
    const now = new Date().toISOString()
    const id = store.createTicket({
      ticket: {
        subject: subject.trim(),
        status: 'open',
        kind: 'normal',
        needsAttention: false,
        externalSource: 'euphoric',
        openedAt: now,
        lastActivityAt: now,
        closedAt: null,
        teamId: team.id,
        teamName: team.name,
        teamSlug: team.slug,
        discordGuildId: null,
        discordChannelId: null,
        categoryId: null,
        categoryLabel: cat?.label ?? null,
        categoryEmoji: cat?.emoji ?? null,
        openerId: me.id,
        openerName: me.name,
        openerImage: me.image,
        openerDiscordId: me.discordId,
        assigneeId: null,
        assigneeName: null,
        assigneeImage: null,
        assigneeDiscordId: null,
        priority: 2,
        personalScope: true,
      },
      firstMessage: {
        body: body.trim() || subject.trim(),
        source: 'web',
        createdAt: now,
        authorId: me.id,
        authorName: me.name,
        authorImage: me.image,
        authorDiscordId: me.discordId,
      },
    })
    router.push(`/demo/b/${team.slug}/tickets/${id}`)
  }

  return (
    <main className="container max-w-xl space-y-6 py-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Open a ticket</h1>
        <p className="text-sm text-muted-foreground">Pick a team and category, describe the issue, and submit.</p>
      </div>
      <Card>
        <CardContent className="space-y-4 pt-6">
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1">
              <Label>Team</Label>
              <select value={teamSlug} onChange={(e) => { setTeamSlug(e.target.value); setCategoryKey('') }} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                {form.teams.map((t) => <option key={t.slug} value={t.slug}>{t.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <select value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                <option value="">— Choose a category —</option>
                {cats.map((c) => <option key={c.key} value={c.key}>{c.emoji ? `${c.emoji} ` : ''}{c.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} placeholder="Short summary of your issue" required />
            </div>
            <div className="space-y-1">
              <Label>Details</Label>
              <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={2000} placeholder="What’s going on?" />
            </div>
            <Button type="submit" disabled={!subject.trim()}>Open ticket</Button>
            <SavedHint />
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
