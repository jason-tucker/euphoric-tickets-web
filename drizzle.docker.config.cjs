// Used by the Docker entrypoint to push the Drizzle schema before starting
// the Next server. Schema source is copied unbuilt into /app/src/db/schema-source
// (drizzle-kit's TS-aware loader handles it without tsc).
//
// drizzle-kit is installed in an isolated prefix at /opt/drizzle so it
// doesn't tangle with Next's standalone /app/node_modules. Node resolves
// requires relative to this file's directory (/app), so we point at the
// absolute path rather than relying on resolution.
const { defineConfig } = require('/opt/drizzle/node_modules/drizzle-kit')

module.exports = defineConfig({
  schema: './src/db/schema-source/index.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
})
