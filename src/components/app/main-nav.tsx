'use client'

// Primary header tabs — Overview · Tickets · Settings. Lives in the single
// consolidated top bar (the old per-team dropdown switcher is gone; team
// selection now happens inside the Tickets console's multi-team filter).
// Client-side only so it can highlight the active tab off the pathname.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Table2, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

export function MainNav({
  showTickets,
  showSettings,
  settingsHref,
}: {
  showTickets: boolean
  showSettings: boolean
  settingsHref: string | null
}) {
  const pathname = usePathname()

  const items = [
    {
      href: '/dashboard',
      label: 'Overview',
      icon: <LayoutDashboard className="h-4 w-4" />,
      active: pathname === '/dashboard' || pathname === '/',
      show: true,
    },
    {
      href: '/tickets',
      label: 'Tickets',
      icon: <Table2 className="h-4 w-4" />,
      // The console and the per-team ticket views it links out to
      // (/b/<slug>/tickets and /b/<slug>/tickets/<id>).
      active: pathname.startsWith('/tickets') || /^\/b\/[^/]+\/tickets/.test(pathname),
      show: showTickets,
    },
    {
      href: settingsHref ?? '/dashboard',
      label: 'Settings',
      icon: <Settings className="h-4 w-4" />,
      // Team settings (/b/<slug>/settings) — but NOT the personal
      // /settings/notifications page.
      active: /^\/b\/[^/]+\/settings/.test(pathname),
      show: showSettings && settingsHref !== null,
    },
  ].filter((i) => i.show)

  return (
    <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
      {items.map((it) => (
        <Link
          key={it.label}
          href={it.href}
          className={cn(
            'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
            it.active
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {it.icon}
          {it.label}
        </Link>
      ))}
    </nav>
  )
}
