'use client'

// The team switcher at the top of the Settings page. Replaces the old per-team
// sub-nav: pick which business/team you're editing without leaving Settings.
// Renders as a plain heading when you only manage one team.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'

export function SettingsTeamPicker({
  teams,
  current,
}: {
  teams: { slug: string; name: string }[]
  current: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const cur = teams.find((t) => t.slug === current)
  const name = cur?.name ?? current

  // Nothing to switch between — just show the name.
  if (teams.length <= 1) return <span>{name}</span>

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md hover:opacity-80"
          aria-label="Switch team"
        >
          <span className="truncate">{name}</span>
          <ChevronsUpDown className="h-5 w-5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-0">
        <Command>
          <CommandInput placeholder="Switch team…" />
          <CommandList>
            <CommandEmpty>No teams found.</CommandEmpty>
            {teams.map((t) => (
              <CommandItem
                key={t.slug}
                value={t.name}
                onSelect={() => {
                  setOpen(false)
                  if (t.slug !== current) router.push(`/b/${t.slug}/settings`)
                }}
                className="justify-between gap-2"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{t.name}</span>
                </span>
                <Check className={cn('h-4 w-4 shrink-0', t.slug === current ? 'opacity-100' : 'opacity-0')} />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
