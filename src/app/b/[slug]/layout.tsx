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
  await requireSession()
  const { slug } = await params
  const resolved = await resolveBusinessAccess(slug)
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
