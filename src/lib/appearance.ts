// Appearance preferences — color theme + chrome layout, persisted in a single
// cookie so the server can render the right chrome on the first paint (no
// flash). Shared by server (root layout / AppChrome) and client (provider,
// shell, pickers); keep it dependency-free and serializable.

export const APPEARANCE_COOKIE = 'et_appearance'

export type ThemeKey = 'midnight' | 'graphite' | 'ocean' | 'forest' | 'paper'
export type LayoutKey = 'top' | 'sidebar' | 'compact'

// The page *contexts* a layout can be overridden for. Routes not listed here
// (help, new-ticket form, …) always follow the app-wide default.
export type PageKey = 'dashboard' | 'tickets' | 'ticket' | 'settings' | 'sudo'

export type Appearance = {
  theme: ThemeKey
  layout: LayoutKey
  // Per-page overrides — e.g. sidebar app-wide but compact on the console.
  pages: Partial<Record<PageKey, LayoutKey>>
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'midnight',
  layout: 'top',
  pages: {},
}

// Swatch colors are raw CSS so the picker can preview a theme without
// activating it. `light` themes drop the `dark` class so `dark:` variants
// (status tints, banners) resolve to their light styles.
export const THEMES: Record<ThemeKey, { label: string; light: boolean; swatch: { bg: string; accent: string } }> = {
  midnight: { label: 'Midnight', light: false, swatch: { bg: 'hsl(222 24% 8%)', accent: 'hsl(267 84% 64%)' } },
  graphite: { label: 'Graphite', light: false, swatch: { bg: 'hsl(220 8% 9%)', accent: 'hsl(213 80% 60%)' } },
  ocean: { label: 'Ocean', light: false, swatch: { bg: 'hsl(208 38% 9%)', accent: 'hsl(190 85% 50%)' } },
  forest: { label: 'Forest', light: false, swatch: { bg: 'hsl(150 12% 8%)', accent: 'hsl(152 60% 46%)' } },
  paper: { label: 'Paper', light: true, swatch: { bg: 'hsl(40 20% 96%)', accent: 'hsl(243 58% 50%)' } },
}

export const THEME_KEYS = Object.keys(THEMES) as ThemeKey[]

export const LAYOUTS: Record<LayoutKey, { label: string; hint: string }> = {
  top: { label: 'Top bar', hint: 'Horizontal tabs under a classic header' },
  sidebar: { label: 'Sidebar', hint: 'Navigation rail on the left, content fills the rest' },
  compact: { label: 'Compact', hint: 'Slim chrome, maximum room for the work' },
}

export const LAYOUT_KEYS = Object.keys(LAYOUTS) as LayoutKey[]

export const PAGE_LABELS: Record<PageKey, string> = {
  dashboard: 'Overview',
  tickets: 'Tickets console',
  ticket: 'Ticket view',
  settings: 'Settings',
  sudo: 'Sudo',
}

function isThemeKey(v: unknown): v is ThemeKey {
  return typeof v === 'string' && v in THEMES
}
function isLayoutKey(v: unknown): v is LayoutKey {
  return typeof v === 'string' && v in LAYOUTS
}

function tryJson(s: string): Partial<Appearance> | null {
  try {
    return JSON.parse(s) as Partial<Appearance>
  } catch {
    return null
  }
}

// Defensive parse — the cookie is client-writable, so anything malformed
// falls back to the defaults rather than throwing during SSR. The value may
// arrive already URI-decoded or still encoded depending on the runtime's
// cookie parser, so accept both forms.
export function parseAppearance(raw: string | undefined | null): Appearance {
  if (!raw) return DEFAULT_APPEARANCE
  try {
    let v = tryJson(raw)
    if (!v) v = tryJson(decodeURIComponent(raw))
    if (!v) return DEFAULT_APPEARANCE
    const pages: Appearance['pages'] = {}
    if (v.pages && typeof v.pages === 'object') {
      for (const key of Object.keys(PAGE_LABELS) as PageKey[]) {
        const l = (v.pages as Record<string, unknown>)[key]
        if (isLayoutKey(l)) pages[key] = l
      }
    }
    return {
      theme: isThemeKey(v.theme) ? v.theme : DEFAULT_APPEARANCE.theme,
      layout: isLayoutKey(v.layout) ? v.layout : DEFAULT_APPEARANCE.layout,
      pages,
    }
  } catch {
    return DEFAULT_APPEARANCE
  }
}

export function serializeAppearance(a: Appearance): string {
  return encodeURIComponent(JSON.stringify(a))
}

// Map a pathname (real app or its /demo mirror) to the layout-override
// context it belongs to. Anything unrecognized follows the app default.
export function pageKeyFromPathname(pathname: string): PageKey | null {
  let p = pathname
  if (p.startsWith('/demo')) p = p.slice('/demo'.length) || '/dashboard'
  if (p === '/' || p === '/dashboard') return 'dashboard'
  if (/^\/b\/[^/]+\/tickets\/[^/]+/.test(p) || /^\/t\/\d+/.test(p)) return 'ticket'
  if (p === '/tickets' || /^\/b\/[^/]+\/tickets\/?$/.test(p)) return 'tickets'
  if (p.startsWith('/settings') || /^\/b\/[^/]+\/settings/.test(p)) return 'settings'
  if (p.startsWith('/admin')) return 'sudo'
  if (/^\/b\/[^/]+\/?$/.test(p)) return 'dashboard'
  return null
}

export function resolveLayout(a: Appearance, page: PageKey | null): LayoutKey {
  return (page && a.pages[page]) || a.layout
}
