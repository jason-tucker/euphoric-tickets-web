# --- Stage 1: deps + build -------------------------------------------------
# Compilation runs HERE on the CI runner (7 GB), never on the VPS.
FROM node:24-alpine AS builder

RUN corepack enable pnpm

WORKDIR /build

# Lockfile first for layer cache.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Next.js needs DATABASE_URL at build-time only because `next build` runs
# server components that may construct the db client. We pass a placeholder
# that never connects — actual connection happens at runtime.
ENV DATABASE_URL="postgresql://placeholder/placeholder"
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm run build

# --- Stage 2: production ---------------------------------------------------
FROM node:24-alpine AS production

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# next.config.ts sets `output: 'standalone'`, which produces a self-contained
# server bundle at /build/.next/standalone. Static assets and the public/
# folder must be copied alongside.
COPY --from=builder /build/public ./public
COPY --from=builder /build/.next/standalone ./
COPY --from=builder /build/.next/static ./.next/static

# Drizzle schema push happens via the entrypoint so first boot creates tables.
COPY --from=builder /build/node_modules/drizzle-kit /app/node_modules/drizzle-kit
COPY --from=builder /build/node_modules/.bin/drizzle-kit /app/node_modules/.bin/drizzle-kit
COPY drizzle.docker.config.cjs ./drizzle.docker.config.cjs
COPY --from=builder /build/src/db/schema /app/src/db/schema-source
# Copy the compiled schema that Next's bundling emitted into the standalone
# server tree so drizzle-kit can read TypeScript-free JS at runtime.

COPY scripts/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
