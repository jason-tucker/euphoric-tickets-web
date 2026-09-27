// Every /api/v1 route answers OPTIONS and its unimplemented methods through
// the Host gate: a public Host gets the bare 404, never Next's automatic
// OPTIONS 204 / 405 (which would reveal the route exists).
import { describe, expect, it } from 'vitest'
import * as openRoute from './tickets/route'
import * as ticketRoute from './tickets/[id]/route'
import * as messagesRoute from './tickets/[id]/messages/route'
import * as rolesRoute from './guild/roles/route'
import * as memberRoute from './members/[discordId]/route'

const ALL = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const

const ROUTES: Array<{ name: string; mod: Record<string, unknown>; implemented: string[] }> = [
  { name: '/api/v1/tickets', mod: openRoute, implemented: ['POST'] },
  { name: '/api/v1/tickets/:id', mod: ticketRoute, implemented: ['GET', 'PATCH'] },
  { name: '/api/v1/tickets/:id/messages', mod: messagesRoute, implemented: ['POST'] },
  { name: '/api/v1/guild/roles', mod: rolesRoute, implemented: ['GET'] },
  { name: '/api/v1/members/:discordId', mod: memberRoute, implemented: ['GET'] },
]

type Handler = (req: Request) => Response
const req = (method: string, host?: string) =>
  new Request('http://x/api/v1/whatever', { method, headers: host ? { host } : {} })

describe('/api/v1 OPTIONS + unsupported methods are Host-gated', () => {
  for (const r of ROUTES) {
    // HEAD is derived from GET by Next when GET exists; otherwise it is ours.
    const unsupported = ALL.filter((m) => !r.implemented.includes(m) && !(m === 'HEAD' && r.implemented.includes('GET')))

    it(`${r.name}: exports OPTIONS and a handler for ${unsupported.join(', ')}`, () => {
      for (const m of ['OPTIONS', ...unsupported, ...r.implemented]) expect(typeof r.mod[m], m).toBe('function')
    })

    it(`${r.name}: public / missing Host → bare 404`, async () => {
      for (const m of ['OPTIONS', ...unsupported]) {
        for (const host of ['tickets.euphoric.fm', 'tickets.euphoric.gg', undefined]) {
          const res = await (r.mod[m] as Handler)(req(m, host))
          expect(res.status, `${m} ${host}`).toBe(404)
          expect(await res.text()).toBe('')
        }
      }
    })

    it(`${r.name}: internal Host → OPTIONS 204 / 405, both with Allow`, async () => {
      const opt = await (r.mod.OPTIONS as Handler)(req('OPTIONS', 'tickets-web:3000'))
      expect(opt.status).toBe(204)
      const allow = opt.headers.get('Allow')!.split(', ')
      for (const m of r.implemented) expect(allow).toContain(m)
      expect(allow).toContain('OPTIONS')
      for (const m of unsupported) {
        const res = await (r.mod[m] as Handler)(req(m, 'tickets-web'))
        expect(res.status, m).toBe(405)
        expect(res.headers.get('Allow')).toBe(opt.headers.get('Allow'))
      }
    })
  }
})
