import { defineConfig } from 'vitest/config'

// Unit tests run in a plain Node environment (the security helpers use
// node:net / node:dns). Tests live next to the code they cover as *.test.ts.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
