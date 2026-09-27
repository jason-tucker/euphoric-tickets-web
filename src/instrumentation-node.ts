// Node-runtime half of src/instrumentation.ts.
//
// Boot validation (P1c): the web↔bot internal channel authenticates only with
// a dedicated INTERNAL_TOKEN of at least 32 characters. A missing or short
// token throws here, and src/instrumentation.ts hands that to exitOnBootError,
// so the server refuses to start instead of running with a broken or
// guessable internal secret. Skipped only during `next build` (Next sets
// NEXT_PHASE itself; the build has no runtime secrets).
//
// Why an explicit process.exit: Next 15 catches a register() rejection, logs
// "Failed to prepare server" and keeps the process alive (verified against the
// standalone server.js), so a throw alone would leave a half-started server
// that never exits and never gets restarted.
//
// Never starts the dispatcher during `next build` or with the build-time
// placeholder DATABASE_URL. INTEGRATION_DISPATCHER=off disables the dispatcher
// (the advisory lock already guarantees a single active dispatcher across
// processes; this is an operator kill-switch).
import { startIntegrationDispatcher } from './server/integrations/dispatcher'
import { getInternalToken } from './server/internalToken'

// Throws InternalTokenError when the boot-time env is unusable.
export function validateBootEnv(): void {
  getInternalToken()
}

export function startNodeInstrumentation(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  validateBootEnv()
  if (process.env.INTEGRATION_DISPATCHER === 'off') return
  const url = process.env.DATABASE_URL
  if (!url || url === 'postgresql://placeholder/placeholder') return
  startIntegrationDispatcher()
}

// Logs a boot-validation failure and exits non-zero. Rethrows afterwards so a
// caller that stubs process.exit (tests) still sees the failure.
export function exitOnBootError(err: unknown): never {
  console.error(`[boot] refusing to start: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
  throw err
}
