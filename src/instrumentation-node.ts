// Node-runtime half of src/instrumentation.ts.
//
// Never runs during `next build` or with the build-time placeholder
// DATABASE_URL. INTEGRATION_DISPATCHER=off disables the dispatcher (the
// advisory lock already guarantees a single active dispatcher across
// processes; this is an operator kill-switch).
import { startIntegrationDispatcher } from './server/integrations/dispatcher'

export function startNodeInstrumentation(): void {
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  if (process.env.INTEGRATION_DISPATCHER === 'off') return
  const url = process.env.DATABASE_URL
  if (!url || url === 'postgresql://placeholder/placeholder') return
  startIntegrationDispatcher()
}
