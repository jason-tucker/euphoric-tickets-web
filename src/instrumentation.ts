// Next.js instrumentation hook — runs once per server process at boot.
//
// Node runtime only: validates the boot env (INTERNAL_TOKEN set and ≥ 32
// characters — P1c; a failure exits the process non-zero) and then
// starts the Integration API webhook dispatcher (plan §4.5). Keep this exact
// `if (NEXT_RUNTIME === 'nodejs') import()` shape: Next inlines NEXT_RUNTIME
// per bundle, so the edge build drops the Node-only module graph (postgres-js,
// undici, node:dns).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startNodeInstrumentation, exitOnBootError } = await import('./instrumentation-node')
    try {
      startNodeInstrumentation()
    } catch (err) {
      exitOnBootError(err)
    }
  }
}
