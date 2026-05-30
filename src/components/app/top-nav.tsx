import Link from 'next/link'
import { TicketIcon } from 'lucide-react'
import { auth, signOut } from '@/server/auth'
import { listMyBusinesses } from '@/server/permissions'
import { currentUserIsSudo } from '@/server/sudo'
import { BusinessSwitcher } from './business-switcher'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export async function TopNav({ activeBusinessSlug }: { activeBusinessSlug?: string }) {
  const session = await auth()
  // listMyBusinesses + currentUserIsSudo are independent DB lookups — run
  // them concurrently. TopNav renders on every page so the saved round-trip
  // is felt site-wide.
  const [myBusinesses, isSudo] = session?.user
    ? await Promise.all([listMyBusinesses(), currentUserIsSudo()])
    : [[] as Awaited<ReturnType<typeof listMyBusinesses>>, false]
  const active = myBusinesses.find((b) => b.business.slug === activeBusinessSlug)
  const activeBusiness = active?.business
  const isActiveAdmin = active && (active.level === 'admin' || active.level === 'owner')

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
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold">
          <TicketIcon className="h-5 w-5 text-primary" />
          <span className="hidden sm:inline">Euphoric Tickets</span>
        </Link>
        <div className="ml-1">
          <BusinessSwitcher
            current={activeBusiness ? { slug: activeBusiness.slug, name: activeBusiness.name } : null}
            businesses={myBusinesses.map(({ business, level }) => ({
              slug: business.slug,
              name: business.name,
              level,
            }))}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
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
                  <Link href="/dashboard">My tickets</Link>
                </DropdownMenuItem>
                {(isSudo || myBusinesses.some((b) => b.level === 'admin' || b.level === 'owner')) && (
                  <DropdownMenuItem asChild>
                    <Link href="/tickets">All tickets</Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <Link href="/t/new">Open a ticket</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/settings/notifications">Notifications</Link>
                </DropdownMenuItem>
                {activeBusiness && isActiveAdmin && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                      {activeBusiness.name}
                    </DropdownMenuLabel>
                    <DropdownMenuItem asChild>
                      <Link href={`/b/${activeBusiness.slug}/tickets`}>Ticket queue</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href={`/b/${activeBusiness.slug}/settings`}>Team settings</Link>
                    </DropdownMenuItem>
                  </>
                )}
                {(isSudo || myBusinesses.some((b) => b.level === 'admin' || b.level === 'owner')) && (
                  <DropdownMenuItem asChild>
                    <Link href="/clients">All teams / clients</Link>
                  </DropdownMenuItem>
                )}
                {isSudo && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link href="/admin">Admin</Link>
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
