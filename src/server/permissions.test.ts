import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Business } from '@/db/schema'
import type { DiscordGuildSnapshot } from './auth'

// permissions.ts pulls in Auth.js, the DB client, and next/navigation at
// module scope — mock all three so the pure logic + flag derivation are
// testable in a plain Node environment.
vi.mock('./auth', () => ({ auth: vi.fn(async () => null) }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/db/client', async () => {
  const { FakeDb } = await import('@/test/dbMock')
  return { db: new FakeDb() }
})
vi.mock('@/lib/discord', () => ({
  fetchGuildMemberAsBot: vi.fn(async () => null),
  fetchGuildMemberRoles: vi.fn(async () => null),
}))

import { db } from '@/db/client'
import type { FakeDb } from '@/test/dbMock'
import { deriveLevel, hasAtLeast, resolveTicketAccess } from './permissions'

const fakeDb = db as unknown as FakeDb

function biz(over: Partial<Business> = {}): Business {
  return { id: 'biz-1', slug: 'team', discordGuildId: '111111111111111111', adminRoleIds: '', ...over } as Business
}

function guild(permissions: string, id = '111111111111111111'): DiscordGuildSnapshot {
  return { id, name: 'Guild', permissions } as DiscordGuildSnapshot
}

beforeEach(() => {
  fakeDb.reset()
})

describe('hasAtLeast', () => {
  it('ranks member < admin < owner', () => {
    expect(hasAtLeast('owner', 'admin')).toBe(true)
    expect(hasAtLeast('admin', 'admin')).toBe(true)
    expect(hasAtLeast('member', 'admin')).toBe(false)
    expect(hasAtLeast('admin', 'owner')).toBe(false)
    expect(hasAtLeast('member', 'member')).toBe(true)
  })
})

describe('deriveLevel', () => {
  it('returns null when the user is not in the business guild', () => {
    expect(deriveLevel(biz(), [guild('8', '999999999999999999')])).toBeNull()
    expect(deriveLevel(biz(), [])).toBeNull()
  })

  it('ADMINISTRATOR (1 << 3) derives owner', () => {
    expect(deriveLevel(biz(), [guild('8')])).toBe('owner')
  })

  it('MANAGE_GUILD (1 << 5) derives admin', () => {
    expect(deriveLevel(biz(), [guild('32')])).toBe('admin')
  })

  it('ADMINISTRATOR wins when both bits are set', () => {
    expect(deriveLevel(biz(), [guild(String(8 | 32))])).toBe('owner')
  })

  it('other permission bits derive plain member', () => {
    // SEND_MESSAGES (1 << 11) alone — no manage rights.
    expect(deriveLevel(biz(), [guild(String(1 << 11))])).toBe('member')
  })

  it('treats a missing/empty permissions string as no permissions', () => {
    expect(deriveLevel(biz(), [guild('')])).toBe('member')
  })

  it('handles permission bitfields beyond 32 bits (Discord sends them as strings)', () => {
    // 1 << 40 with ADMINISTRATOR — BigInt parsing must not truncate.
    expect(deriveLevel(biz(), [guild(String((1n << 40n) | 8n))])).toBe('owner')
  })
})

describe('resolveTicketAccess', () => {
  const session = { user: { id: 'user-1', discordId: '200000000000000002' } }

  it('admin level grants every flag including delete + change-category', async () => {
    const flags = await resolveTicketAccess({
      business: biz(),
      level: 'admin',
      ticket: { openerUserId: 'someone-else', categoryId: null },
      session,
    })
    expect(flags).toMatchObject({
      isAdmin: true,
      isStaff: true,
      canSee: true,
      canReply: true,
      canClaim: true,
      canClose: true,
      canChangeCategory: true,
      canManageMembers: true,
      canDeleteChannel: true,
    })
  })

  it('the opener can see, reply, and close — but not claim or manage', async () => {
    const flags = await resolveTicketAccess({
      business: biz(),
      level: 'member',
      ticket: { openerUserId: 'user-1', categoryId: null },
      session,
    })
    expect(flags).toMatchObject({
      isOpener: true,
      isAdmin: false,
      isStaff: false,
      canSee: true,
      canReply: true,
      canClose: true,
      canClaim: false,
      canManageMembers: false,
      canDeleteChannel: false,
    })
  })

  it('a member whose cached role snapshot matches the category staff roles is staff', async () => {
    fakeDb.queueSelect([{ staffRoleIds: 'r1,r2' }]) // ticket_categories
    fakeDb.queueSelect([{ snapshot: JSON.stringify(['r2', 'zz']) }]) // business_members
    const flags = await resolveTicketAccess({
      business: biz(),
      level: 'member',
      ticket: { openerUserId: 'someone-else', categoryId: 'cat-1' },
      session,
    })
    expect(flags.isStaff).toBe(true)
    expect(flags).toMatchObject({ canClaim: true, canClose: true, canChangeCategory: false, canDeleteChannel: false })
  })

  it('a member whose snapshot has no matching role is not staff', async () => {
    fakeDb.queueSelect([{ staffRoleIds: 'r1' }])
    fakeDb.queueSelect([{ snapshot: JSON.stringify(['zz']) }])
    const flags = await resolveTicketAccess({
      business: biz(),
      level: 'member',
      ticket: { openerUserId: 'someone-else', categoryId: 'cat-1' },
      session,
    })
    expect(flags.isStaff).toBe(false)
    expect(flags.canSee).toBe(false)
  })

  it('an empty staff_role_ids column stays admin-only (no staff fallthrough)', async () => {
    fakeDb.queueSelect([{ staffRoleIds: '' }])
    const flags = await resolveTicketAccess({
      business: biz(),
      level: 'member',
      ticket: { openerUserId: 'someone-else', categoryId: 'cat-1' },
      session,
    })
    expect(flags.isStaff).toBe(false)
  })

  it('an external ticket member can see + reply but not claim', async () => {
    fakeDb.queueSelect([{ userId: 'user-1' }]) // ticket_external_members hit
    const flags = await resolveTicketAccess({
      business: biz(),
      level: 'member',
      ticket: { id: 5, openerUserId: 'someone-else', categoryId: null },
      session,
    })
    expect(flags).toMatchObject({ canSee: true, canReply: true, canClaim: false, canClose: false })
  })

  it('an unrelated member sees nothing', async () => {
    fakeDb.queueSelect([]) // not an external member
    const flags = await resolveTicketAccess({
      business: biz(),
      level: 'member',
      ticket: { id: 5, openerUserId: 'someone-else', categoryId: null },
      session,
    })
    expect(flags.canSee).toBe(false)
    expect(flags.canReply).toBe(false)
  })
})
