// Team settings — category add/update round-trips the per-category
// "ping staff roles when a ticket opens" toggle (v0.12.3), and an edit never
// clobbers sudo-owned fields (integration_only). requireBusinessAccess is
// mocked (the session layer is out of scope); everything else runs against
// the scratch DB. Requires TEST_DATABASE_URL.

import { and, eq } from 'drizzle-orm'
import { beforeEach, expect, it, vi } from 'vitest'
import { db } from '@/db/client'
import { ticketCategories, type Business } from '@/db/schema'
import { describeDb, makeBusiness, makeCategory } from '@/test/fixtures'

const access = vi.hoisted(() => ({ business: null as Business | null }))
vi.mock('@/server/permissions', () => ({
  requireBusinessAccess: async () => {
    if (!access.business) throw new Error('NEXT_REDIRECT')
    return { business: access.business, level: 'admin' }
  },
}))
vi.mock('@/server/tickettool', () => ({ reconcileTicketTool: async () => {} }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const actions = await import('./actions')

function form(entries: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.append(k, v)
  return f
}

describeDb('team settings category actions', () => {
  beforeEach(async () => {
    access.business = await makeBusiness()
  })

  async function byKey(key: string) {
    const [row] = await db
      .select()
      .from(ticketCategories)
      .where(and(eq(ticketCategories.businessId, access.business!.id), eq(ticketCategories.key, key)))
    return row!
  }

  it('adds a category with the ping toggle on (checkbox checked) or off (unchecked)', async () => {
    const slug = access.business!.slug
    await actions.addCategoryAction(slug, form({ key: 'loud', label: 'Loud', pingStaffOnOpen: 'on' }))
    await actions.addCategoryAction(slug, form({ key: 'quiet', label: 'Quiet' }))
    expect((await byKey('loud')).pingStaffOnOpen).toBe(true)
    expect((await byKey('quiet')).pingStaffOnOpen).toBe(false)
  })

  it('updates the ping toggle both ways and preserves integration_only', async () => {
    const slug = access.business!.slug
    const cat = await makeCategory(access.business!.id, 'newsong', { integrationOnly: true })
    expect(cat.pingStaffOnOpen).toBe(true)

    await actions.updateCategoryAction(slug, cat.id, form({ key: 'newsong', label: 'New song' }))
    let row = await byKey('newsong')
    expect(row.pingStaffOnOpen).toBe(false)
    expect(row.integrationOnly).toBe(true)

    await actions.updateCategoryAction(slug, cat.id, form({ key: 'newsong', label: 'New song', pingStaffOnOpen: 'on' }))
    row = await byKey('newsong')
    expect(row.pingStaffOnOpen).toBe(true)
    expect(row.integrationOnly).toBe(true)
  })

  it('cannot update another team’s category', async () => {
    const other = await makeBusiness()
    const foreign = await makeCategory(other.id, 'songedit')
    await actions.updateCategoryAction(access.business!.slug, foreign.id, form({ key: 'songedit', label: 'x' }))
    const [row] = await db.select().from(ticketCategories).where(eq(ticketCategories.id, foreign.id))
    expect(row!.pingStaffOnOpen).toBe(true)
    expect(row!.label).toBe('songedit')
  })
})
