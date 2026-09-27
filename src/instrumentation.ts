// Next.js instrumentation hook — runs once per server process at boot.
//
// Starts the Integration API webhook dispatcher (plan §4.5). Node runtime
// only (it needs postgres-js LISTEN, a reserved connection and undici), and
// never during `next build` or with the build-time placeholder DATABASE_URL.
// Set INTEGRATION_DISPATCHER=off to disable it (e.g. a second replica that
// should never dispatch — the advisory lock already makes that safe).

export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  if (process.env.INTEGRATION_DISPATCHER === 'off') return
  const url = process.env.DATABASE_URL
  if (!url || url === 'postgresql://placeholder/placeholder') return
  const { startIntegrationDispatcher } = await import('./server/integrations/dispatcher')
  startIntegrationDispatcher()
}
