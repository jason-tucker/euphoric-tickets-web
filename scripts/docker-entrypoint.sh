#!/bin/sh
set -e

echo "▶ Applying database schema (drizzle-kit push)..."
# drizzle-kit + drizzle-orm both live at /opt/drizzle (out of
# /app/node_modules to avoid tangling with Next's standalone tree).
# drizzle-kit's existence check for drizzle-orm doesn't honor NODE_PATH,
# so we install both into the same prefix.
/opt/drizzle/node_modules/.bin/drizzle-kit push \
  --config=drizzle.docker.config.cjs \
  --force

echo "▶ Starting Euphoric Tickets Web on :${PORT:-3000}..."
exec node server.js
