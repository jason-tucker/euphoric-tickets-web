// Used by the Docker entrypoint to push the Drizzle schema before starting
// the Next server. Both this config and the schema source live under
// /opt/drizzle so `import 'drizzle-orm/pg-core'` in the schema resolves to
// /opt/drizzle/node_modules — Next's standalone bundle doesn't expose
// drizzle-orm as a top-level /app/node_modules package.
const { defineConfig } = require('drizzle-kit')

module.exports = defineConfig({
  schema: './schema/index.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
})
