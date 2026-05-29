import type { Metadata, Viewport } from 'next'
import { Toaster } from 'sonner'
import NextTopLoader from 'nextjs-toploader'
import './globals.css'

export const metadata: Metadata = {
  title: 'Euphoric Tickets',
  description: 'Open and manage tickets across your Discord communities.',
  icons: { icon: '/favicon.svg' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0a0c14',
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-svh bg-background text-foreground">
        {/* Top progress bar — appears on every route navigation and stays
            visible while server actions / pages are pending. Auto-hooks
            into the App Router; we just render it once at the root. */}
        <NextTopLoader
          color="hsl(var(--primary))"
          height={2}
          showSpinner={false}
          shadow={false}
        />
        {children}
        <Toaster theme="dark" position="bottom-right" richColors />
      </body>
    </html>
  )
}
