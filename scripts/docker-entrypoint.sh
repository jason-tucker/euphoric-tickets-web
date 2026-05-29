#!/bin/sh
set -e

echo "▶ Applying database schema (drizzle-kit push)..."
# drizzle-kit + its deps (drizzle-orm, postgres) + the schema source all
# live under /opt/drizzle so the schema's `drizzle-orm/pg-core` imports
# resolve to the same prefix. Run from /opt/drizzle so the config's
# relative `./schema/index.ts` path lines up. drizzle-kit eats its own
# tsx-load errors (exits 0) on schema parse failure — capture stderr and
# fail loudly if the push didn't actually finish.
cd /opt/drizzle
PUSH_LOG=$(./node_modules/.bin/drizzle-kit push \
  --config=./drizzle.config.cjs \
  --force 2>&1)
echo "$PUSH_LOG"
if echo "$PUSH_LOG" | grep -qiE 'cannot find module|MODULE_NOT_FOUND|Error:'; then
  echo "✗ drizzle-kit push failed (see above)" >&2
  exit 1
fi
cd /app

echo "▶ Starting Euphoric Tickets Web on :${PORT:-3000}..."
exec node server.js
