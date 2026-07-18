'use client'

// Team select + category select + the admin-only "Open as" field for /t/new.
// All three live in one client component: the open-as picker needs the
// selected team's guildId, and the category list must follow the selected
// team — a server-rendered list would go stale the moment the user switches
// teams without a navigation.

import * as React from 'react'
import { Label } from '@/components/ui/label'
import { DiscordPicker } from '@/components/app/discord-picker'

export type OpenAsTeam = { slug: string; name: string; guildId: string; admin: boolean }
export type OpenAsCategory = { id: string; label: string; emoji: string | null }

export function TeamAndOpenAsFields({
  teams,
  defaultSlug,
  catsByTeam,
}: {
  teams: OpenAsTeam[]
  defaultSlug: string
  catsByTeam: Record<string, OpenAsCategory[]>
}) {
  const [slug, setSlug] = React.useState(defaultSlug)
  const team = teams.find((t) => t.slug === slug)
  const cats = catsByTeam[slug] ?? []

  return (
    <>
      <div className="space-y-1">
        <Label htmlFor="businessSlug">Team</Label>
        <select
          id="businessSlug"
          name="businessSlug"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          {teams.map((t) => (
            <option key={t.slug} value={t.slug}>{t.name}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="categoryId">Category</Label>
        {/* Remount on team change so the old team's selection can't linger. */}
        <select
          key={slug}
          id="categoryId"
          name="categoryId"
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">— pick one —</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ''}{c.label}</option>
          ))}
        </select>
        {cats.length === 0 && (
          <p className="text-xs text-muted-foreground">
            This team has no categories yet. An admin can add them in team settings.
          </p>
        )}
      </div>

      {team?.admin && (
        <div className="space-y-1">
          <Label>Open as (admin) — optional</Label>
          {/* Remount on team change so a member picked in one guild can't leak into another. */}
          <DiscordPicker key={team.slug} kind="user" guildId={team.guildId} name="openAsDiscordId" />
          <p className="text-xs text-muted-foreground">
            Open this ticket on behalf of another member; they become the ticket owner.
          </p>
        </div>
      )}
    </>
  )
}
