#!/bin/sh
set -e

echo "▶ Applying database schema (drizzle-kit push)..."
# drizzle-kit lives at /opt/drizzle (out of /app/node_modules to avoid
# tangling with Next's standalone tree) but needs to resolve drizzle-orm
# at runtime to validate the schema. drizzle-orm is in the Next bundle at
# /app/node_modules; expose it via NODE_PATH just for this invocation so
# the Next server's process env isn't affected.
NODE_PATH=/app/node_modules /opt/drizzle/node_modules/.bin/drizzle-kit push \
  --config=drizzle.docker.config.cjs \
  --force

echo "▶ Starting Euphoric Tickets Web on :${PORT:-3000}..."
exec node server.js
