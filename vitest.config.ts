import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Unit tests run in a plain Node environment (the security helpers use
// node:net / node:dns). Tests live next to the code they cover as *.test.ts.
// The alias mirrors tsconfig's `@/* → src/*` so server modules (which import
// `@/db/client` etc.) are testable — DB/auth access is mocked per test file.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
