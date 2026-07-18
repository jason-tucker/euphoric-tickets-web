'use client'

// Team select + the admin-only "Open as" field for /t/new. The open-as picker
// needs the currently selected team's guildId (DiscordPicker searches that
// guild's members), so both live in one client component; category sourcing
// stays server-side via the ?b= param.

import * as React from 'react'
import { Label } from '@/components/ui/label'
import { DiscordPicker } from '@/components/app/discord-picker'

export type OpenAsTeam = { slug: string; name: string; guildId: string; admin: boolean }

export function TeamAndOpenAsFields({ teams, defaultSlug }: { teams: OpenAsTeam[]; defaultSlug: string }) {
  const [slug, setSlug] = React.useState(defaultSlug)
  const team = teams.find((t) => t.slug === slug)

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
