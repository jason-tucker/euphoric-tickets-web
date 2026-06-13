import { describe, expect, it } from 'vitest'
import { avatarUrl, relativeTime, statusLabel } from './format'

describe('avatarUrl', () => {
  it('builds the CDN url for a static avatar hash', () => {
    expect(avatarUrl('200000000000000002', 'abc123')).toBe(
      'https://cdn.discordapp.com/avatars/200000000000000002/abc123.png?size=64',
    )
  })

  it('uses gif for animated (a_-prefixed) hashes and honors the size param', () => {
    expect(avatarUrl('200000000000000002', 'a_xyz', 128)).toBe(
      'https://cdn.discordapp.com/avatars/200000000000000002/a_xyz.gif?size=128',
    )
  })

  it("falls back to Discord's default avatar, indexed by the id's high bits mod 6", () => {
    // (id >> 22) % 6 — picked to land on a known index.
    expect(avatarUrl(String(5n << 22n), null)).toBe('https://cdn.discordapp.com/embed/avatars/5.png')
    expect(avatarUrl(String(12n << 22n), undefined)).toBe('https://cdn.discordapp.com/embed/avatars/0.png')
  })
})

describe('statusLabel', () => {
  it("reads legacy 'claimed' and 'in_progress' as In Progress", () => {
    expect(statusLabel('claimed')).toBe('In Progress')
    expect(statusLabel('in_progress')).toBe('In Progress')
  })

  it('special-cases on_hold and capitalizes the rest', () => {
    expect(statusLabel('on_hold')).toBe('On Hold')
    expect(statusLabel('open')).toBe('Open')
    expect(statusLabel('waiting')).toBe('Waiting')
    expect(statusLabel('some_custom')).toBe('Some custom')
  })
})

describe('relativeTime', () => {
  it('renders a past date with the "ago" suffix', () => {
    expect(relativeTime(Date.now() - 65_000)).toBe('1 minute ago')
  })

  it('accepts Date objects and ISO strings', () => {
    const d = new Date(Date.now() - 2 * 60 * 60 * 1000)
    expect(relativeTime(d)).toBe('2 hours ago')
    expect(relativeTime(d.toISOString())).toBe('2 hours ago')
  })
})
