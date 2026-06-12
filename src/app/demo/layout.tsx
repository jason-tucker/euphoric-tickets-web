import Link from 'next/link'
import { LogOut } from 'lucide-react'
import { getPersonaKey } from '@/server/demo/cookie'
import { demoScope, getPersona } from '@/server/demo/personas'
import { DemoStoreProvider } from '@/components/demo/store'
import { PersonaSwitcher } from '@/components/demo/persona-switcher'
import { ResetDemoButton } from '@/components/demo/bits'
import { AppShell, type NavItem } from '@/components/app/app-shell'
import { AppearanceDropdown } from '@/components/app/appearance-menu'

// The /demo subtree is public (the middleware matcher excludes it) and reads the
// persona cookie fresh on every request, so it stays dynamic.
export const dynamic = 'force-dynamic'

export default async function DemoLayout({ children }: { children: React.ReactNode }) {
  const personaKey = await getPersonaKey()
  const scope = demoScope(getPersona(personaKey))

  // Same chrome as the real app (same three layouts, same theme tokens) —
  // nav visibility tracks the active persona's scope exactly like the real
  // nav tracks real permissions.
  const nav: NavItem[] = [
    { href: '/demo', label: 'Overview', icon: 'overview', activePattern: '^/demo/?$' },
  ]
  if (scope.canUseConsole) {
    nav.push({
      href: '/demo/tickets',
      label: 'Tickets',
      icon: 'tickets',
      activePattern: '^/demo/(?!.*settings)(tickets|b/|t/)',
    })
  }
  if (scope.isAdminAnywhere && scope.settingsHref) {
    nav.push({
      href: scope.settingsHref,
      label: 'Settings',
      icon: 'settings',
      activePattern: '^/demo/.*settings',
    })
  }
  if (scope.isSudo) {
    nav.push({ href: '/demo/admin', label: 'Sudo', icon: 'sudo', activePattern: '^/demo/admin', secondary: true })
  }

  return (
    <DemoStoreProvider>
      <AppShell
        nav={nav}
        brandHref="/demo"
        // Fixed h-8 (2rem) — the AppShell counts it into --shell-top so the
        // full-height console still sizes correctly inside the demo.
        banner={
          <div className="flex h-8 items-center gap-2 overflow-hidden border-b border-amber-500/30 bg-amber-500/10 px-3 text-xs">
            <p className="min-w-0 truncate text-amber-700 dark:text-amber-300">
              <strong>Demo</strong> — sample data, fully interactive; changes save only in your browser.
            </p>
            <span className="ml-auto shrink-0">
              <ResetDemoButton className="h-6 px-2 text-xs" />
            </span>
          </div>
        }
        right={
          <>
            <AppearanceDropdown />
            <PersonaSwitcher current={scope.personaKey} />
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Leave the demo"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Exit</span>
            </Link>
          </>
        }
      >
        {children}
      </AppShell>
    </DemoStoreProvider>
  )
}
