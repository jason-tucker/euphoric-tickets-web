'use client'

// The app chrome, in three interchangeable layouts resolved per page:
//   top     — classic sticky header with horizontal tabs (the default)
//   sidebar — navigation rail on the left, slim header over the content
//   compact — one slim toolbar, minimum chrome, maximum work area
// Which layout renders comes from the appearance prefs: a per-page override
// (pages[pageKey]) when set, else the app-wide default. The shell knows the
// page from the pathname, so the same component serves the real app and the
// /demo mirror. Below `lg` the sidebar collapses into the top-bar form so a
// phone-width CEF iframe (~360px) never meets a rail.
//
// The wrapper publishes --shell-top (sticky chrome height + optional banner)
// for full-height pages: h-[calc(100svh-var(--shell-top,3rem))].

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  CircleHelp,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Table2,
  TicketIcon,
} from 'lucide-react'
import { pageKeyFromPathname, resolveLayout, type LayoutKey, type PageKey } from '@/lib/appearance'
import { useAppearance } from './appearance-provider'
import { cn } from '@/lib/utils'

const NAV_ICONS = {
  overview: LayoutDashboard,
  tickets: Table2,
  settings: Settings,
  sudo: ShieldCheck,
  help: CircleHelp,
} as const

export type NavIconKey = keyof typeof NAV_ICONS

export type NavItem = {
  href: string
  label: string
  icon: NavIconKey
  // Regex source tested against the pathname for the active state.
  activePattern: string
  // Secondary items (Help, Sudo) sit right-aligned in the bar layouts and in
  // the rail's bottom section in the sidebar layout.
  secondary?: boolean
}

// Lets the appearance picker (inside the account dropdown) know which page
// context it would be overriding and which layout is currently showing.
const ShellContext = React.createContext<{ page: PageKey | null; layout: LayoutKey } | null>(null)

export function useShell() {
  return React.useContext(ShellContext)
}

function isActive(item: NavItem, pathname: string): boolean {
  try {
    return new RegExp(item.activePattern).test(pathname)
  } catch {
    return false
  }
}

function Brand({ href, label, iconOnly = false }: { href: string; label: string; iconOnly?: boolean }) {
  return (
    <Link href={href} className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
      <TicketIcon className="h-[18px] w-[18px] text-primary" />
      {!iconOnly && <span className="hidden text-sm md:inline">{label}</span>}
    </Link>
  )
}

function BarItem({ item, active, dense }: { item: NavItem; active: boolean; dense?: boolean }) {
  const Icon = NAV_ICONS[item.icon]
  return (
    <Link
      href={item.href}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors',
        dense ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-sm',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <Icon className={dense ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      {item.label}
    </Link>
  )
}

function RailItem({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = NAV_ICONS[item.icon]
  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors',
        active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" />
      {item.label}
    </Link>
  )
}

export function AppShell({
  nav,
  right,
  banner,
  brandHref,
  brandLabel = 'Euphoric Tickets',
  children,
}: {
  nav: NavItem[]
  // Right side of the bar — account dropdown, persona switcher, …
  right: React.ReactNode
  // Optional strip above the chrome (the demo notice). Must be a fixed 2rem
  // tall so --shell-top stays truthful for full-height pages.
  banner?: React.ReactNode
  brandHref: string
  brandLabel?: string
  children: React.ReactNode
}) {
  const pathname = usePathname() ?? '/'
  const { appearance } = useAppearance()
  const page = pageKeyFromPathname(pathname)
  const layout = resolveLayout(appearance, page)

  const primary = nav.filter((i) => !i.secondary)
  const secondary = nav.filter((i) => i.secondary)
  const barHeightRem = layout === 'compact' ? 2.5 : 3
  const shellTop = `${barHeightRem + (banner ? 2 : 0)}rem`
  const style = { '--shell-top': shellTop } as React.CSSProperties
  const ctx = React.useMemo(() => ({ page, layout }), [page, layout])

  const headerClass =
    'sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75'

  if (layout === 'sidebar') {
    const activeItem = nav.find((i) => isActive(i, pathname))
    return (
      <ShellContext.Provider value={ctx}>
        <div data-shell="sidebar" style={style} className="flex">
          <aside className="sticky top-0 z-40 hidden h-svh w-52 shrink-0 flex-col border-r bg-card/50 lg:flex">
            <div className="flex h-12 shrink-0 items-center border-b px-4">
              <Brand href={brandHref} label={brandLabel} />
            </div>
            <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
              {primary.map((item) => (
                <RailItem key={item.href} item={item} active={isActive(item, pathname)} />
              ))}
            </nav>
            {secondary.length > 0 && (
              <nav className="flex flex-col gap-0.5 border-t p-2">
                {secondary.map((item) => (
                  <RailItem key={item.href} item={item} active={isActive(item, pathname)} />
                ))}
              </nav>
            )}
          </aside>

          <div className="flex min-h-svh min-w-0 flex-1 flex-col">
            {banner}
            <header className={headerClass}>
              <div className="flex h-12 items-center gap-2 px-3 sm:px-4">
                <span className="lg:hidden">
                  <Brand href={brandHref} label={brandLabel} />
                </span>
                {/* Below lg the rail is hidden, so the bar carries the tabs. */}
                <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto lg:hidden">
                  {primary.map((item) => (
                    <BarItem key={item.href} item={item} active={isActive(item, pathname)} />
                  ))}
                </nav>
                {activeItem && (
                  <span className="hidden text-sm font-medium text-muted-foreground lg:inline">
                    {activeItem.label}
                  </span>
                )}
                <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
                  <span className="flex items-center gap-0.5 lg:hidden">
                    {secondary.map((item) => (
                      <BarItem key={item.href} item={item} active={isActive(item, pathname)} />
                    ))}
                  </span>
                  {right}
                </div>
              </div>
            </header>
            <div className="min-w-0 flex-1">{children}</div>
          </div>
        </div>
      </ShellContext.Provider>
    )
  }

  const dense = layout === 'compact'
  return (
    <ShellContext.Provider value={ctx}>
      <div data-shell={layout} style={style}>
        {banner}
        <header className={headerClass}>
          <div
            className={cn(
              'flex items-center',
              dense ? 'h-10 gap-1 px-2 sm:px-3' : 'container h-12 gap-2',
            )}
          >
            <Brand href={brandHref} label={brandLabel} iconOnly={dense} />
            <nav className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
              {primary.map((item) => (
                <BarItem key={item.href} item={item} active={isActive(item, pathname)} dense={dense} />
              ))}
            </nav>
            <div className={cn('ml-auto flex shrink-0 items-center', dense ? 'gap-0.5' : 'gap-1 sm:gap-2')}>
              {secondary.map((item) => (
                <span key={item.href} className="hidden sm:inline-flex">
                  <BarItem item={item} active={isActive(item, pathname)} dense={dense} />
                </span>
              ))}
              {right}
            </div>
          </div>
        </header>
        {children}
      </div>
    </ShellContext.Provider>
  )
}
