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

// Raw postgres-js client — exposed for LISTEN/NOTIFY (the SSE live-refresh
// endpoint subscribes to the `ticket_activity` channel). postgres-js opens a
// dedicated connection for listens (not from the pool) and fans every
// notification out to all registered callbacks, so many SSE viewers share one
// listen connection.
export const pgClient = client

// P7: idempotent NOTIFY triggers. ticket_messages INSERT and tickets UPDATE
// both notify `ticket_activity` with the ticket id, so any open conversation
// can refresh within ~instant of a Discord-side or web-side change. Runs once
// per process (CREATE OR REPLACE → safe to re-run; needs Postgres 14+).
const TRIGGER_SQL = `
CREATE OR REPLACE FUNCTION et_tm_notify() RETURNS trigger AS $fn$
BEGIN PERFORM pg_notify('ticket_activity', NEW.ticket_id::text); RETURN NEW; END;
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER et_tm_notify_tr
AFTER INSERT ON ticket_messages
FOR EACH ROW EXECUTE FUNCTION et_tm_notify();

CREATE OR REPLACE FUNCTION et_tk_notify() RETURNS trigger AS $fn$
BEGIN PERFORM pg_notify('ticket_activity', NEW.id::text); RETURN NEW; END;
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER et_tk_notify_tr
AFTER UPDATE ON tickets
FOR EACH ROW EXECUTE FUNCTION et_tk_notify();
`

let triggersEnsured: Promise<void> | null = null
export function ensureNotifyTriggers(): Promise<void> {
  if (!triggersEnsured) {
    triggersEnsured = client
      .unsafe(TRIGGER_SQL)
      .then(() => undefined)
      .catch((err) => {
        triggersEnsured = null
        throw err
      })
  }
  return triggersEnsured
}
