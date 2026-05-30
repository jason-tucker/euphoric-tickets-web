import { redirect } from 'next/navigation'
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
  // requireSession() throws/redirects on missing auth; resolveBusinessAccess
  // checks DB membership. Both touch the session — but each one re-uses the
  // cached request-scoped auth() result, so running concurrently is cheap.
  const [, resolved] = await Promise.all([requireSession(), resolveBusinessAccess(slug)])
  if (!resolved) redirect('/dashboard')
  const isAdmin = resolved.level === 'admin' || resolved.level === 'owner'

  return (
    <>
      <TopNav activeBusinessSlug={slug} />
      <BusinessNav slug={slug} isAdmin={isAdmin} />
      {children}
    </>
  )
}
