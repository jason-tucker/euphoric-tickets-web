// Next.js instrumentation hook — runs once per server process at boot.
//
// Starts the Integration API webhook dispatcher (plan §4.5) in the Node
// runtime only. Keep this exact `if (NEXT_RUNTIME === 'nodejs') import()`
// shape: Next inlines NEXT_RUNTIME per bundle, so the edge build drops the
// Node-only module graph (postgres-js, undici, node:dns).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startNodeInstrumentation } = await import('./instrumentation-node')
    startNodeInstrumentation()
  }
}
