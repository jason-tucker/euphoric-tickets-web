'use client'

import Link from 'next/link'
import { Check, ChevronsUpDown, Building2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

type Item = { slug: string; name: string; level: 'member' | 'admin' | 'owner' }

export function BusinessSwitcher({
  current,
  businesses,
}: {
  current: { slug: string; name: string } | null
  businesses: Item[]
}) {
  if (businesses.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'inline-flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-sm hover:bg-accent',
            'max-w-[50vw] truncate',
          )}
        >
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="truncate">{current?.name ?? 'My tickets'}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-60">
        <DropdownMenuLabel>Switch view</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/dashboard" className="flex items-center justify-between">
            <span>My tickets</span>
            {!current && <Check className="h-4 w-4" />}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs text-muted-foreground">Businesses</DropdownMenuLabel>
        {businesses.map((b) => {
          // Admins land on the queue view; members land on the business overview.
          const href = b.level === 'admin' || b.level === 'owner' ? `/b/${b.slug}/tickets` : `/b/${b.slug}`
          return (
            <DropdownMenuItem asChild key={b.slug}>
              <Link href={href} className="flex items-center justify-between gap-2">
                <span className="truncate">{b.name}</span>
                <span className="ml-2 flex items-center gap-1">
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                    {b.level}
                  </span>
                  {current?.slug === b.slug && <Check className="h-4 w-4" />}
                </span>
              </Link>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
