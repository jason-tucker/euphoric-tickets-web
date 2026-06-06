import { TopNav } from '@/components/app/top-nav'
import { BusinessNav } from '@/components/app/business-nav'
import { resolveBusinessAccess, requireSession } from '@/server/permissions'

export default async function BusinessLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  // P16: don't hard-redirect non-members. External ticket members (not in the
  // guild) need to reach /b/<slug>/tickets/<id>; that page self-guards via
  // resolveTicketAccess. Member-only children (overview, queue, settings) keep
  // their own guards, so rendering the layout for non-members is safe — we
  // just omit the team nav.
  const [, resolved] = await Promise.all([requireSession(), resolveBusinessAccess(slug)])
  const isAdmin = resolved ? resolved.level === 'admin' || resolved.level === 'owner' : false

  return (
    <>
      <TopNav />
      {resolved && <BusinessNav slug={slug} isAdmin={isAdmin} />}
      {children}
    </>
  )
}
