import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

declare global {
  // eslint-disable-next-line no-var
  var __pgClient: ReturnType<typeof postgres> | undefined
}

// Reuse the postgres-js client across hot reloads in dev so we don't leak
// connections every time a server file re-evaluates.
function getClient() {
  if (process.env.NODE_ENV === 'production') {
    return postgres(process.env.DATABASE_URL!, {
      max: 10,
      idle_timeout: 30,
      connect_timeout: 10,
    })
  }
  if (!globalThis.__pgClient) {
    globalThis.__pgClient = postgres(process.env.DATABASE_URL!, {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    })
  }
  return globalThis.__pgClient
}

const client = getClient()
export const db = drizzle(client, { schema })
