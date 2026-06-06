import Link from 'next/link'
import { TicketIcon } from 'lucide-react'
import { auth, signOut } from '@/server/auth'
import { ticketsConsoleScope, type ConsoleScope } from '@/server/tickets'
import { currentUserIsSudo } from '@/server/sudo'
import { MainNav } from './main-nav'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

// One consolidated header for the whole app: brand, the primary Overview ·
// Tickets · Settings tabs, then Sudo / Help / account on the right. The old
// per-team "switch view" dropdown is gone — picking a team is now a filter
// inside the Tickets console, not a navigation mode.
export async function TopNav() {
  const session = await auth()
  // Scope (admin/staff reach) + sudo are independent lookups; both ride on the
  // request-cached listMyBusinesses / sudo lookups, so this stays one round-trip
  // even though TopNav renders on every page.
  let scope: ConsoleScope = { canUse: false, isAdminAnywhere: false, adminTeams: [] }
  let isSudo = false
  if (session?.user) {
    const [s, su] = await Promise.all([ticketsConsoleScope(), currentUserIsSudo()])
    scope = s
    isSudo = su
  }

  // Smart Settings target: one team → straight to its settings; several → the hub.
  const settingsHref =
    scope.adminTeams.length === 1 ? `/b/${scope.adminTeams[0].slug}/settings` : '/settings/teams'

  async function logout() {
    'use server'
    await signOut({ redirectTo: '/login' })
  }

  const initials =
    session?.user?.name
      ?.split(/\s+/)
      .map((s) => s[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() ?? 'U'

  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 items-center gap-2">
        <Link href="/dashboard" className="flex shrink-0 items-center gap-2 font-semibold">
          <TicketIcon className="h-5 w-5 text-primary" />
          <span className="hidden md:inline">Euphoric Tickets</span>
        </Link>

        {session?.user && (
          <MainNav
            showTickets={scope.canUse}
            showSettings={scope.isAdminAnywhere}
            settingsHref={settingsHref}
          />
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
          {isSudo && (
            <Link
              href="/admin"
              className="hidden rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground sm:inline-block"
            >
              Sudo
            </Link>
          )}
          <Link
            href="/help"
            className="rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Help
          </Link>
          {session?.user ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent">
                  <Avatar className="h-7 w-7">
                    {session.user.image && <AvatarImage src={session.user.image} alt="" />}
                    <AvatarFallback className="text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <span className="hidden text-sm font-medium md:inline">{session.user.name}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span>{session.user.name}</span>
                    {session.user.email && (
                      <span className="text-xs text-muted-foreground">{session.user.email}</span>
                    )}
                  </div>
                </DropdownMenuLabel>
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
          ) : (
            <Link
              href="/login"
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
