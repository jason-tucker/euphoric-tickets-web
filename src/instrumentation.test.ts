// P1c boot validation: in the Node runtime, register() exits the process with
// code 1 when INTERNAL_TOKEN is missing or shorter than 32 characters — even
// with DISCORD_BOT_TOKEN set. process.exit is stubbed (it then rethrows) and
// the dispatcher is mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { startDispatcher } = vi.hoisted(() => ({ startDispatcher: vi.fn() }))
vi.mock('./server/integrations/dispatcher', () => ({ startIntegrationDispatcher: startDispatcher }))

import { register } from './instrumentation'
import { InternalTokenError } from './server/internalToken'

const KEYS = ['NEXT_RUNTIME', 'NEXT_PHASE', 'INTERNAL_TOKEN', 'DISCORD_BOT_TOKEN', 'DATABASE_URL', 'INTEGRATION_DISPATCHER'] as const
let exitSpy: ReturnType<typeof vi.spyOn>
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]))

beforeEach(() => {
  for (const k of KEYS) delete process.env[k]
  process.env.NEXT_RUNTIME = 'nodejs'
  process.env.DISCORD_BOT_TOKEN = 'b'.repeat(72)
  process.env.DATABASE_URL = 'postgres://boot-test/unused'
  startDispatcher.mockClear()
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('instrumentation register() boot validation', () => {
  it('exits 1 when INTERNAL_TOKEN is missing, and never starts the dispatcher', async () => {
    await expect(register()).rejects.toBeInstanceOf(InternalTokenError)
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(startDispatcher).not.toHaveBeenCalled()
  })

  it('exits 1 when INTERNAL_TOKEN is shorter than 32 characters', async () => {
    process.env.INTERNAL_TOKEN = 'z'.repeat(31)
    await expect(register()).rejects.toThrow(/too short/)
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(startDispatcher).not.toHaveBeenCalled()
  })

  it('boots (and starts the dispatcher) with a valid token', async () => {
    process.env.INTERNAL_TOKEN = 'z'.repeat(32)
    await expect(register()).resolves.toBeUndefined()
    expect(exitSpy).not.toHaveBeenCalled()
    expect(startDispatcher).toHaveBeenCalledTimes(1)
  })

  it('does not validate during `next build`', async () => {
    process.env.NEXT_PHASE = 'phase-production-build'
    await expect(register()).resolves.toBeUndefined()
    expect(exitSpy).not.toHaveBeenCalled()
    expect(startDispatcher).not.toHaveBeenCalled()
  })

  it('does nothing outside the Node runtime', async () => {
    process.env.NEXT_RUNTIME = 'edge'
    await expect(register()).resolves.toBeUndefined()
    expect(exitSpy).not.toHaveBeenCalled()
  })
})
