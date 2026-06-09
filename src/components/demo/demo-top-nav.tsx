'use client'

// The demo's own header — replaces the auth-driven TopNav for the whole /demo
// subtree. Nav visibility tracks the active persona's scope exactly like the real
// nav tracks real permissions. No auth, no sign-in/out.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { TicketIcon, LogOut } from 'lucide-react'
import type { DemoScope } from '@/server/demo/personas'
import { PersonaSwitcher } from './persona-switcher'
import { cn } from '@/lib/utils'

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </Link>
  )
}

export function DemoTopNav({ scope }: { scope: DemoScope }) {
  const pathname = usePathname() || '/demo'
  const isOverview = pathname === '/demo'
  const isTickets = pathname.startsWith('/demo/tickets') || pathname.startsWith('/demo/b/')
  const isSettings = pathname.includes('/settings')
  const isSudo = pathname.startsWith('/demo/admin')

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center gap-2">
        <Link href="/demo" className="flex shrink-0 items-center gap-2 font-semibold">
          <TicketIcon className="h-5 w-5 text-primary" />
          <span className="hidden md:inline">Euphoric Tickets</span>
        </Link>

        <nav className="flex items-center gap-0.5">
          <NavLink href="/demo" active={isOverview}>Overview</NavLink>
          {scope.canUseConsole && (
            <NavLink href="/demo/tickets" active={isTickets && !isSettings}>Tickets</NavLink>
          )}
          {scope.isAdminAnywhere && scope.settingsHref && (
            <NavLink href={scope.settingsHref} active={isSettings}>Settings</NavLink>
          )}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          {scope.isSudo && (
            <NavLink href="/demo/admin" active={isSudo}>Sudo</NavLink>
          )}
          <PersonaSwitcher current={scope.personaKey} />
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Leave the demo"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Exit</span>
          </Link>
        </div>
      </div>
    </header>
  )
}
