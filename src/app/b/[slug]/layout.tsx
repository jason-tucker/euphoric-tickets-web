import { TopNav } from '@/components/app/top-nav'
import { requireSession } from '@/server/permissions'

// Single, app-wide header only. Tickets live in the global /tickets console and
// team settings carry their own team switcher, so the old per-team sub-nav
// (BusinessNav) is gone — there's never more than one header.
export default async function BusinessLayout({
  children,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  // P16: soft auth only — child pages (overview, settings, detail) self-guard.
  await requireSession()

  return (
    <>
      <TopNav />
      {children}
    </>
  )
}
