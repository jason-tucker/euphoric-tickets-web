import { describe, expect, it } from 'vitest'
import { isWebOpenableCategory } from './categories'

describe('isWebOpenableCategory', () => {
  it('refuses staff-only and integration-only categories', () => {
    expect(isWebOpenableCategory({ staffOnly: false, integrationOnly: false })).toBe(true)
    expect(isWebOpenableCategory({ staffOnly: true, integrationOnly: false })).toBe(false)
    expect(isWebOpenableCategory({ staffOnly: false, integrationOnly: true })).toBe(false)
    expect(isWebOpenableCategory({ staffOnly: true, integrationOnly: true })).toBe(false)
  })
})
