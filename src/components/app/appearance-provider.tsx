'use client'

// Holds the appearance preferences (color theme + layout + per-page layout
// overrides) for the whole tree. The initial value is parsed from the
// et_appearance cookie by the root layout, so SSR and the first client render
// always agree — no theme flash. Every setter re-writes the cookie and theme
// changes are applied to <html> immediately, no reload or refresh needed.
// Demo-safe by design: the cookie is written from the browser only.

import * as React from 'react'
import { Toaster } from 'sonner'
import {
  APPEARANCE_COOKIE,
  DEFAULT_APPEARANCE,
  serializeAppearance,
  THEMES,
  type Appearance,
  type LayoutKey,
  type PageKey,
  type ThemeKey,
} from '@/lib/appearance'

type AppearanceContextValue = {
  appearance: Appearance
  setTheme: (theme: ThemeKey) => void
  setLayout: (layout: LayoutKey) => void
  setPageLayout: (page: PageKey, layout: LayoutKey | null) => void
}

const AppearanceContext = React.createContext<AppearanceContextValue | null>(null)

function persist(a: Appearance) {
  document.cookie = `${APPEARANCE_COOKIE}=${serializeAppearance(a)}; path=/; max-age=31536000; samesite=lax`
}

function applyThemeToDocument(theme: ThemeKey) {
  const el = document.documentElement
  el.dataset.theme = theme
  el.classList.toggle('dark', !THEMES[theme].light)
}

export function AppearanceProvider({
  initial,
  children,
}: {
  initial: Appearance
  children: React.ReactNode
}) {
  const [appearance, setAppearance] = React.useState<Appearance>(initial)

  const update = React.useCallback((next: Appearance) => {
    setAppearance(next)
    persist(next)
  }, [])

  const setTheme = React.useCallback(
    (theme: ThemeKey) => {
      applyThemeToDocument(theme)
      setAppearance((prev) => {
        const next = { ...prev, theme }
        persist(next)
        return next
      })
    },
    [],
  )

  const setLayout = React.useCallback(
    (layout: LayoutKey) => {
      setAppearance((prev) => {
        const next = { ...prev, layout }
        persist(next)
        return next
      })
    },
    [],
  )

  const setPageLayout = React.useCallback((page: PageKey, layout: LayoutKey | null) => {
    setAppearance((prev) => {
      const pages = { ...prev.pages }
      if (layout === null) delete pages[page]
      else pages[page] = layout
      const next = { ...prev, pages }
      persist(next)
      return next
    })
  }, [])

  const value = React.useMemo(
    () => ({ appearance, setTheme, setLayout, setPageLayout }),
    [appearance, setTheme, setLayout, setPageLayout],
  )

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export function useAppearance(): AppearanceContextValue {
  const ctx = React.useContext(AppearanceContext)
  // Outside the provider (shouldn't happen) fall back to inert defaults so a
  // stray usage degrades to the default look instead of crashing.
  return (
    ctx ?? {
      appearance: DEFAULT_APPEARANCE,
      setTheme: () => {},
      setLayout: () => {},
      setPageLayout: () => {},
    }
  )
}

// Sonner needs its light/dark mode as a prop; follow the active theme.
export function ThemedToaster() {
  const { appearance } = useAppearance()
  return (
    <Toaster
      theme={THEMES[appearance.theme].light ? 'light' : 'dark'}
      position="bottom-right"
      richColors
    />
  )
}
