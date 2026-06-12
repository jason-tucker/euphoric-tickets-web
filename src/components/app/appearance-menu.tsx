'use client'

// The theme + layout picker. AppearancePanel is embedded inside the account
// dropdown (and the demo's palette dropdown); plain buttons, not menu items,
// so trying themes/layouts doesn't close the menu. Theme applies instantly;
// layout swaps the shell in place; "This page" overrides the layout for the
// current page context only.

import * as React from 'react'
import { Check, PanelLeft, PanelTop, Rows2, SwatchBook } from 'lucide-react'
import {
  LAYOUT_KEYS,
  LAYOUTS,
  PAGE_LABELS,
  THEME_KEYS,
  THEMES,
  type LayoutKey,
} from '@/lib/appearance'
import { useAppearance } from './appearance-provider'
import { useShell } from './app-shell'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

const LAYOUT_ICONS: Record<LayoutKey, React.ComponentType<{ className?: string }>> = {
  top: PanelTop,
  sidebar: PanelLeft,
  compact: Rows2,
}

function LayoutSegment({
  value,
  onChange,
  allowDefault,
}: {
  value: LayoutKey | null
  onChange: (l: LayoutKey | null) => void
  // "This page" gets a Default option that clears the override.
  allowDefault?: boolean
}) {
  return (
    <div className="flex w-fit items-center gap-0.5 rounded-md border border-input p-0.5">
      {allowDefault && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn(
            'rounded px-1.5 py-1 text-[11px] font-medium transition-colors',
            value === null ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          Auto
        </button>
      )}
      {LAYOUT_KEYS.map((key) => {
        const Icon = LAYOUT_ICONS[key]
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            title={`${LAYOUTS[key].label} — ${LAYOUTS[key].hint}`}
            aria-pressed={value === key}
            className={cn(
              'flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium transition-colors',
              value === key ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{LAYOUTS[key].label}</span>
          </button>
        )
      })}
    </div>
  )
}

export function AppearancePanel() {
  const { appearance, setTheme, setLayout, setPageLayout } = useAppearance()
  const shell = useShell()
  const page = shell?.page ?? null

  return (
    <div className="space-y-2.5 px-2 py-1.5">
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Theme</p>
        <div className="flex items-center gap-1.5">
          {THEME_KEYS.map((key) => {
            const t = THEMES[key]
            const active = appearance.theme === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTheme(key)}
                title={t.label}
                aria-pressed={active}
                className={cn(
                  'relative flex h-6 w-6 items-center justify-center rounded-full border transition-shadow',
                  active ? 'ring-2 ring-ring ring-offset-2 ring-offset-popover' : 'hover:scale-110',
                )}
                style={{ backgroundColor: t.swatch.bg, borderColor: t.swatch.accent }}
              >
                {active ? (
                  <Check className="h-3 w-3" style={{ color: t.swatch.accent }} />
                ) : (
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.swatch.accent }} />
                )}
              </button>
            )
          })}
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">{THEMES[appearance.theme].label}</p>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Layout</p>
        <LayoutSegment value={appearance.layout} onChange={(l) => l && setLayout(l)} />
      </div>

      {page && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            This page · {PAGE_LABELS[page]}
          </p>
          <LayoutSegment
            allowDefault
            value={appearance.pages[page] ?? null}
            onChange={(l) => setPageLayout(page, l)}
          />
        </div>
      )}
    </div>
  )
}

// Standalone palette button + dropdown — the /demo header has no account
// menu to embed the panel in, so it gets its own trigger.
export function AppearanceDropdown() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Theme & layout"
          aria-label="Theme and layout"
        >
          <SwatchBook className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <AppearancePanel />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
