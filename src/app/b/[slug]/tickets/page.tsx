import { redirect } from 'next/navigation'

// The per-team ticket queue is gone — tickets now live in the unified, live
// cross-team console at /tickets. Any old link or bookmark to /b/<slug>/tickets
// lands on the console pre-filtered to that team. (The per-ticket detail view
// at /b/<slug>/tickets/<id> is unaffected — it's a separate route segment.)
export default async function TeamTicketsRedirect({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  redirect(`/tickets?team=${encodeURIComponent(slug)}`)
}
