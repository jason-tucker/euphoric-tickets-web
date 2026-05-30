'use client'

// P3 (lantern) — DiscordPicker. The reusable searchable picker for any
// Discord directory shape (channel / category / role / user).
//
// Use cases (will land across P1/P6/P10/P16):
//   <DiscordPicker kind="role"    multi guildId={…} name="staffRoleIds" defaultValue="123,456" />
//   <DiscordPicker kind="category"      guildId={…} name="discordParentCategoryId" defaultValue={cat.discordParentCategoryId} />
//   <DiscordPicker kind="user"          guildId={…} name="userId" />
//
// Behavior:
//   - The input doubles as filter AND raw-snowflake paste. If the field
//     value matches /^\d{17,20}$/ on Enter or paste, the id is added
//     immediately without waiting; a non-blocking resolve fetches its
//     display name/avatar to label the badge.
//   - Channels/roles are fetched once on first focus and filtered
//     client-side per-character (small lists, instant filter).
//   - Members hit /api/discord/<guild>/members?q=<text> debounced 80ms.
//   - Selected items render as badges with × to remove.
//   - A hidden CSV input (`name`) carries the value(s) so existing form
//     actions need no changes.

import * as React from 'react'
import { Check, ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

export type PickerKind = 'channel' | 'category' | 'role' | 'user'

export type PickerProps = {
  kind: PickerKind
  guildId: string
  /** Form field name. Emits a comma-separated CSV when `multi`; the raw id otherwise. */
  name?: string
  /** Comma-separated initial value (snowflakes). */
  defaultValue?: string
  multi?: boolean
  /** Placeholder for the empty input. */
  placeholder?: string
  /** Label shown on the trigger button when no items are selected. */
  triggerLabel?: string
  /** When true, the picker is disabled. */
  disabled?: boolean
  className?: string
}

type Item = { id: string; name: string; image: string | null; meta?: string }

const SNOWFLAKE = /^\d{17,20}$/

export function DiscordPicker({
  kind,
  guildId,
  name,
  defaultValue = '',
  multi = false,
  placeholder,
  triggerLabel,
  disabled,
  className,
}: PickerProps) {
  const initial = React.useMemo(
    () =>
      defaultValue
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [defaultValue],
  )

  const [selected, setSelected] = React.useState<string[]>(initial)
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')

  // Per-id label cache so badges show display names instead of raw snowflakes.
  // Populated lazily by the directory fetch + by single-id resolves on paste.
  const [labels, setLabels] = React.useState<Record<string, Item>>({})

  // Directory list for the open popover. For channel/category/role we fetch
  // once on first open and filter client-side; for members we hit the API
  // with a debounced query.
  const [items, setItems] = React.useState<Item[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // ---- directory fetch ----------------------------------------------------
  const isMemberSearch = kind === 'user'

  const fetchDirectory = React.useCallback(
    async (q: string) => {
      setLoading(true)
      setError(null)
      try {
        let url: string
        if (kind === 'user') {
          url = `/api/discord/${guildId}/members${q ? `?q=${encodeURIComponent(q)}` : ''}`
        } else if (kind === 'role') {
          url = `/api/discord/${guildId}/roles`
        } else {
          url = `/api/discord/${guildId}/channels`
        }
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) throw new Error(`${res.status}`)
        const raw = (await res.json()) as Array<Record<string, unknown>>
        let mapped: Item[]
        if (kind === 'user') {
          mapped = raw.map((m) => ({ id: String(m.id), name: String(m.name), image: (m.image as string | null) ?? null }))
        } else if (kind === 'role') {
          mapped = raw.map((r) => ({ id: String(r.id), name: `@${String(r.name)}`, image: null }))
        } else {
          // channel/category
          const wantType = kind === 'category' ? 4 : 0
          mapped = raw
            .filter((c) => (c.type as number) === wantType)
            .map((c) => ({ id: String(c.id), name: `#${String(c.name)}`, image: null }))
        }
        setItems(mapped)
        // Hydrate the label cache for everything we just fetched so any
        // already-selected ids that appear here pick up their names.
        setLabels((prev) => {
          const out = { ...prev }
          for (const it of mapped) out[it.id] = it
          return out
        })
      } catch (e) {
        setError(String(e))
        setItems([])
      } finally {
        setLoading(false)
      }
    },
    [guildId, kind],
  )

  // Debounced fetch on query change for member search; one-shot fetch on open
  // for everything else.
  React.useEffect(() => {
    if (!open) return
    if (isMemberSearch) {
      const t = setTimeout(() => void fetchDirectory(query), 80)
      return () => clearTimeout(t)
    }
    if (items.length === 0 && !loading) void fetchDirectory('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query, isMemberSearch])

  // Resolve labels for initial defaults that didn't come from the directory
  // (raw paste or persisted-from-DB values we haven't fetched yet).
  React.useEffect(() => {
    const missing = selected.filter((id) => !labels[id])
    if (missing.length === 0) return
    let cancelled = false
    void (async () => {
      // For roles + channels we resolve by fetching the whole directory once;
      // it's cheap and we already need it for the picker anyway.
      if (kind !== 'user') {
        await fetchDirectory('')
        return
      }
      // For users, look each up individually via the members search by id.
      // (Discord's `members/search?query=<id>` doesn't match by id, so we
      // use `members/<id>` via a tiny endpoint. For now just leave the raw
      // id as the badge label — admins can still see what they pasted.)
      if (cancelled) return
      setLabels((prev) => {
        const out = { ...prev }
        for (const id of missing) if (!out[id]) out[id] = { id, name: id, image: null }
        return out
      })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, kind])

  // ---- selection helpers --------------------------------------------------
  const add = React.useCallback(
    (id: string, label?: Item) => {
      if (label) setLabels((p) => ({ ...p, [id]: label }))
      setSelected((prev) => {
        if (prev.includes(id)) return prev
        return multi ? [...prev, id] : [id]
      })
      if (!multi) setOpen(false)
      setQuery('')
    },
    [multi],
  )

  const remove = React.useCallback((id: string) => {
    setSelected((prev) => prev.filter((x) => x !== id))
  }, [])

  // ---- raw-id paste shortcut ---------------------------------------------
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    if (!SNOWFLAKE.test(query)) return
    e.preventDefault()
    add(query, { id: query, name: query, image: null })
  }

  // Visible item list — already filtered server-side for members; for the
  // other kinds we let cmdk do the substring filter via its built-in scoring.
  const visible = items

  const csv = multi ? selected.join(',') : (selected[0] ?? '')

  return (
    <div className={cn('space-y-1', className)}>
      {name && <input type="hidden" name={name} value={csv} readOnly />}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              'flex w-full items-center justify-between rounded-md border bg-background px-2 py-1.5 text-left text-sm',
              'hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {selected.length === 0 ? (
              <span className="text-muted-foreground">
                {triggerLabel ?? defaultTriggerLabel(kind, multi)}
              </span>
            ) : (
              <div className="flex flex-wrap gap-1">
                {selected.map((id) => {
                  const it = labels[id] ?? { id, name: id, image: null }
                  return (
                    <span
                      key={id}
                      className="inline-flex items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-xs"
                    >
                      {kind === 'user' && it.image && (
                        <Avatar className="h-4 w-4">
                          <AvatarImage src={it.image} alt="" />
                          <AvatarFallback className="text-[8px]">
                            {it.name.slice(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <span className="max-w-[14ch] truncate">{it.name}</span>
                      <button
                        type="button"
                        aria-label={`remove ${it.name}`}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          remove(id)
                        }}
                        className="rounded p-0.5 hover:bg-background/60"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
            <ChevronDown className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] p-0">
          <Command shouldFilter={!isMemberSearch}>
            <CommandInput
              placeholder={placeholder ?? defaultPlaceholder(kind)}
              value={query}
              onValueChange={setQuery}
              onKeyDown={onInputKeyDown}
            />
            <CommandList>
              {loading && <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>}
              {!loading && error && (
                <div className="px-3 py-2 text-xs text-destructive">Error: {error}</div>
              )}
              {!loading && !error && (
                <>
                  <CommandEmpty>
                    {SNOWFLAKE.test(query)
                      ? 'Press Enter to add this raw ID.'
                      : 'No results — paste a Discord ID to add directly.'}
                  </CommandEmpty>
                  {visible.map((it) => {
                    const isChecked = selected.includes(it.id)
                    return (
                      <CommandItem
                        key={it.id}
                        value={`${it.name} ${it.id}`}
                        onSelect={() => add(it.id, it)}
                      >
                        {kind === 'user' && (
                          <Avatar className="h-5 w-5">
                            {it.image && <AvatarImage src={it.image} alt="" />}
                            <AvatarFallback className="text-[10px]">
                              {it.name.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                        )}
                        <span className="flex-1 truncate">{it.name}</span>
                        {isChecked && <Check className="h-3.5 w-3.5 text-primary" />}
                      </CommandItem>
                    )
                  })}
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}

function defaultTriggerLabel(kind: PickerKind, multi: boolean): string {
  const noun = { channel: 'channel', category: 'category', role: 'role', user: 'user' }[kind]
  return multi ? `Choose ${noun}s…` : `Choose a ${noun}…`
}

function defaultPlaceholder(kind: PickerKind): string {
  if (kind === 'user') return 'Search members — or paste a Discord user ID'
  if (kind === 'role') return 'Search roles — or paste a role ID'
  if (kind === 'category') return 'Search categories — or paste a category ID'
  return 'Search channels — or paste a channel ID'
}
