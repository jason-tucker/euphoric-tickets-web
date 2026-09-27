// /api/v1 internal-host gate (defense in depth ahead of the P1d edge rule).
import { describe, expect, it } from 'vitest'
import { DEFAULT_INTERNAL_API_HOSTS, internalApiHosts, isInternalApiRequest } from './internalHost'

const h = (host?: string, extra: Record<string, string> = {}) => new Headers({ ...(host ? { host } : {}), ...extra })

describe('isInternalApiRequest', () => {
  it('allows only the internal aliases by default', () => {
    expect(DEFAULT_INTERNAL_API_HOSTS).toBe('tickets-web:3000,tickets-web')
    expect(isInternalApiRequest(h('tickets-web:3000'), {})).toBe(true)
    expect(isInternalApiRequest(h('tickets-web'), {})).toBe(true)
    expect(isInternalApiRequest(h('TICKETS-WEB:3000'), {})).toBe(true)
    for (const host of ['tickets.euphoric.fm', 'tickets.euphoric.gg', 'tickets.euphoric.fm:443', '127.0.0.1:16095', 'localhost:3000', 'tickets-web:3001', 'tickets-web.evil']) {
      expect(isInternalApiRequest(h(host), {}), host).toBe(false)
    }
    expect(isInternalApiRequest(h(), {})).toBe(false)
  })

  it('never trusts X-Forwarded-Host (caller-controlled)', () => {
    expect(isInternalApiRequest(h('tickets.euphoric.fm', { 'x-forwarded-host': 'tickets-web:3000' }), {})).toBe(false)
  })

  it('INTERNAL_API_HOSTS replaces the list (e.g. to add a local-test host); blank means default', () => {
    const env = { INTERNAL_API_HOSTS: ' tickets-web:3000 , tickets-web,127.0.0.1:16095 ' }
    expect(isInternalApiRequest(h('127.0.0.1:16095'), env)).toBe(true)
    expect(isInternalApiRequest(h('tickets-web:3000'), env)).toBe(true)
    expect(isInternalApiRequest(h('tickets.euphoric.fm'), env)).toBe(false)
    expect([...internalApiHosts({ INTERNAL_API_HOSTS: '   ' })]).toEqual(['tickets-web:3000', 'tickets-web'])
    expect([...internalApiHosts({})]).toEqual(['tickets-web:3000', 'tickets-web'])
  })
})
