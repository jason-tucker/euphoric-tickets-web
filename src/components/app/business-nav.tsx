'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

type Item = { href: string; label: string; icon: React.ReactNode; adminOnly?: boolean }

// Tickets are no longer per-team — they live in the unified /tickets console
// (reachable from the global header), so this team sub-nav only carries the
// team's own Overview + Settings.
export function BusinessNav({ slug, isAdmin }: { slug: string; isAdmin: boolean }) {
  const pathname = usePathname()
  const items: Item[] = [
    { href: `/b/${slug}`, label: 'Overview', icon: <LayoutDashboard className="h-4 w-4" /> },
    { href: `/b/${slug}/settings`, label: 'Settings', icon: <Settings className="h-4 w-4" />, adminOnly: true },
  ]
  const visible = items.filter((i) => !i.adminOnly || isAdmin)

  return (
    <nav className="border-b bg-card/40">
      <div className="container flex items-center gap-1 overflow-x-auto py-2">
        {visible.map((it) => {
          const active = pathname === it.href || (it.href !== `/b/${slug}` && pathname.startsWith(it.href))
          return (
            <Link
              key={it.href}
              href={it.href}
              className={cn(
                'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {it.icon}
              {it.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
