import Link from 'next/link'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

// P9 (lantern) — a clickable column header that toggles ?sort/&dir in the URL
// while preserving the rest of the query string (status/category filters).
export function SortHeader({
  label,
  sortKey,
  activeSort,
  activeDir,
  basePath,
  params,
  className,
}: {
  label: string
  sortKey: string
  activeSort: string
  activeDir: 'asc' | 'desc'
  basePath: string
  params: Record<string, string | undefined>
  className?: string
}) {
  const isActive = activeSort === sortKey
  const nextDir = isActive && activeDir === 'desc' ? 'asc' : 'desc'
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v)
  sp.set('sort', sortKey)
  sp.set('dir', nextDir)
  return (
    <Link
      href={`${basePath}?${sp.toString()}`}
      className={cn('inline-flex items-center gap-1 hover:text-foreground', className)}
    >
      {label}
      {isActive ? (
        activeDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </Link>
  )
}

// Shared sort-key parsing. Returns a normalized { sort, dir }.
export function parseSort(
  raw: { sort?: string; dir?: string },
  allowed: readonly string[],
  fallback: string,
): { sort: string; dir: 'asc' | 'desc' } {
  const sort = raw.sort && allowed.includes(raw.sort) ? raw.sort : fallback
  const dir = raw.dir === 'asc' ? 'asc' : 'desc'
  return { sort, dir }
}
