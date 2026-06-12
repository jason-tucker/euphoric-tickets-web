import Link from 'next/link'
import type { Session } from 'next-auth'
import { auth, signOut } from '@/server/auth'
import { ticketsConsoleScope, type ConsoleScope } from '@/server/tickets'
import { currentUserIsSudo } from '@/server/sudo'
import { AppShell, type NavItem } from './app-shell'
import { AppearancePanel } from './appearance-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// The whole app chrome: resolves who you are and what you can reach, then
// hands plain nav data to the client AppShell, which renders it in whichever
// layout (top / sidebar / compact) the appearance prefs pick for this page.
// Pages wrap their content: <AppChrome><main>…</main></AppChrome>.
export async function AppChrome({ children }: { children: React.ReactNode }) {
  const session = await auth()
  // Scope (admin/staff reach) + sudo are independent lookups; both ride on the
  // request-cached listMyBusinesses / sudo lookups, so this stays one round-trip
  // even though AppChrome renders on every page.
  let scope: ConsoleScope = { canUse: false, isAdminAnywhere: false, adminTeams: [] }
  let isSudo = false
  if (session?.user) {
    const [s, su] = await Promise.all([ticketsConsoleScope(), currentUserIsSudo()])
    scope = s
    isSudo = su
  }

  // Settings opens a team's settings page directly; its own dropdown switches
  // between teams, so there's no separate hub step.
  const settingsHref = scope.adminTeams[0]
    ? `/b/${scope.adminTeams[0].slug}/settings`
    : '/settings/teams'

  const nav: NavItem[] = []
  if (session?.user) {
    nav.push({ href: '/dashboard', label: 'Overview', icon: 'overview', activePattern: '^/(dashboard/?)?$' })
    if (scope.canUse) {
      nav.push({ href: '/tickets', label: 'Tickets', icon: 'tickets', activePattern: '^/tickets' })
    }
    if (scope.isAdminAnywhere) {
      // Team settings (/b/<slug>/settings) and the settings hub — but NOT the
      // personal /settings/notifications page.
      nav.push({
        href: settingsHref,
        label: 'Settings',
        icon: 'settings',
        activePattern: '^/settings/teams|^/b/[^/]+/settings',
      })
    }
  }
  if (isSudo) {
    nav.push({ href: '/admin', label: 'Sudo', icon: 'sudo', activePattern: '^/admin', secondary: true })
  }
  nav.push({ href: '/help', label: 'Help', icon: 'help', activePattern: '^/help', secondary: true })

  return (
    <AppShell
      nav={nav}
      brandHref={session?.user ? '/dashboard' : '/login'}
      right={session?.user ? <AccountMenu session={session} scope={scope} isSudo={isSudo} /> : <SignInLink />}
    >
      {children}
    </AppShell>
  )
}

function SignInLink() {
  return (
    <Link
      href="/login"
      className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
    >
      Sign in
    </Link>
  )
}

async function AccountMenu({
  session,
  scope,
  isSudo,
}: {
  session: Session
  scope: ConsoleScope
  isSudo: boolean
}) {
  async function logout() {
    'use server'
    await signOut({ redirectTo: '/login' })
  }

  const initials =
    session.user?.name
      ?.split(/\s+/)
      .map((s) => s[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() ?? 'U'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent">
          <Avatar className="h-7 w-7">
            {session.user?.image && <AvatarImage src={session.user.image} alt="" />}
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium md:inline">{session.user?.name}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span>{session.user?.name}</span>
            {session.user?.email && (
              <span className="text-xs font-normal text-muted-foreground">{session.user.email}</span>
            )}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* Theme + layout picker — lives here so it's one click away on every
            page. Buttons inside don't close the menu, so you can try themes. */}
        <AppearancePanel />
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/t/new">Open a ticket</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/notifications">Notifications</Link>
        </DropdownMenuItem>
        {scope.isAdminAnywhere && (
          <DropdownMenuItem asChild>
            <Link href="/teams">All teams</Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href="/help">Help</Link>
        </DropdownMenuItem>
        {isSudo && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              Sudo
            </DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link href="/admin">Teams</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/admin/bot">Bot dashboard</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/admin/errors">Bot errors</Link>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <form action={logout}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full text-left">Sign out</button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
