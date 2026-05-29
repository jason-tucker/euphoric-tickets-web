// Used by the Docker entrypoint to push the Drizzle schema before starting
// the Next server. Schema source is copied unbuilt into /app/src/db/schema-source
// (drizzle-kit's TS-aware loader handles it without tsc).
const { defineConfig } = require('drizzle-kit')

module.exports = defineConfig({
  schema: './src/db/schema-source/index.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
})
