import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import NextTopLoader from 'nextjs-toploader'
import { VersionWatcher } from '@/components/app/version-watcher'
import { SiteFooter } from '@/components/app/site-footer'
import { AppearanceProvider, ThemedToaster } from '@/components/app/appearance-provider'
import { APPEARANCE_COOKIE, parseAppearance, THEMES } from '@/lib/appearance'
import './globals.css'

export const metadata: Metadata = {
  title: 'Euphoric Tickets',
  description: 'Open and manage tickets across your Discord communities.',
  icons: { icon: '/favicon.svg' },
}

// themeColor follows the active color theme so mobile browser chrome matches.
export async function generateViewport(): Promise<Viewport> {
  const appearance = parseAppearance((await cookies()).get(APPEARANCE_COOKIE)?.value)
  return {
    width: 'device-width',
    initialScale: 1,
    themeColor: THEMES[appearance.theme].swatch.bg,
    viewportFit: 'cover',
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Appearance prefs (theme + layout) ride a cookie so the very first paint
  // is already in the chosen theme — no flash, no client-side swap.
  const appearance = parseAppearance((await cookies()).get(APPEARANCE_COOKIE)?.value)
  const isLight = THEMES[appearance.theme].light

  return (
    <html lang="en" data-theme={appearance.theme} className={isLight ? undefined : 'dark'}>
      <body className="flex min-h-svh flex-col bg-background text-foreground">
        <AppearanceProvider initial={appearance}>
          {/* Top progress bar — appears on every route navigation and stays
              visible while server actions / pages are pending. Auto-hooks
              into the App Router; we just render it once at the root. */}
          <NextTopLoader
            color="hsl(var(--primary))"
            height={2}
            showSpinner={false}
            shadow={false}
          />
          {/* Page content grows to fill the viewport so the footer stays pinned
              to the bottom on short pages. */}
          <div className="flex-1">{children}</div>
          <SiteFooter />
          <VersionWatcher />
          <ThemedToaster />
        </AppearanceProvider>
      </body>
    </html>
  )
}
