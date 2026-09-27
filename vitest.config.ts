import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests run in a plain Node environment (the security helpers use
// node:net / node:dns). Tests live next to the code they cover as *.test.ts.
//
// DB-backed suites (Integration API routes, idempotency, dispatcher cursor)
// run only when TEST_DATABASE_URL points at a SCRATCH Postgres; globalSetup
// pushes the schema into it. Without it those suites are skipped, so a plain
// `pnpm test` stays green with no database.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'server-only': fileURLToPath(new URL('./src/test/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['src/test/global-setup.ts'],
    setupFiles: ['src/test/setup.ts'],
    // DB suites share one scratch database; run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
  },
})
