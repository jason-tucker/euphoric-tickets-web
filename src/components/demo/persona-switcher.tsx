'use client'

// The "view as" control. Switching navigates to the /demo/persona GET handler,
// which sets the demo_persona cookie and redirects back to the current page — no
// server action, no DB. The dropdown doubles as the explainer (each persona's
// blurb), and the trigger carries a tooltip.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Check, ChevronDown, UserCog } from 'lucide-react'
import { PERSONA_KEYS, PERSONA_META, type PersonaKey } from '@/server/demo/meta'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function PersonaSwitcher({ current }: { current: PersonaKey }) {
  const pathname = usePathname() || '/demo'
  const next = encodeURIComponent(pathname)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-1.5 rounded-md border bg-background px-2.5 py-1.5 text-sm hover:bg-accent"
          title="Explore the demo at each permission level — your choice is remembered in this browser."
        >
          <UserCog className="h-4 w-4 text-primary" />
          <span className="hidden sm:inline">Viewing as</span>
          <span className="font-medium">{PERSONA_META[current].label}</span>
          <ChevronDown className="h-3 w-3 opacity-60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          View the demo as a sample user at each permission level.
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PERSONA_KEYS.map((key) => {
          const meta = PERSONA_META[key]
          const active = key === current
          return (
            <DropdownMenuItem key={key} asChild>
              <Link href={`/demo/persona?to=${key}&next=${next}`} className="flex items-start gap-2">
                <Check className={`mt-0.5 h-4 w-4 shrink-0 ${active ? 'opacity-100 text-primary' : 'opacity-0'}`} />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{meta.label}</span>
                  <span className="text-xs text-muted-foreground">{meta.blurb}</span>
                </span>
              </Link>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
