#!/bin/sh
set -e

echo "▶ Applying database schema (drizzle-kit push)..."
/opt/drizzle/node_modules/.bin/drizzle-kit push \
  --config=drizzle.docker.config.cjs \
  --force

echo "▶ Starting Euphoric Tickets Web on :${PORT:-3000}..."
exec node server.js
