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
# We can't simply copy node_modules/drizzle-kit from the builder: pnpm's
# symlinked layout puts drizzle-kit's transitive deps (esbuild, tsx,
# @esbuild-kit/*, @drizzle-team/brocli) under .pnpm/<pkg>@<ver>/, and those
# don't follow through a Docker COPY of just the top-level symlink. The
# previous flat copy left drizzle-kit unable to require('esbuild') at
# runtime. Install it cleanly here at the same pinned version instead.
RUN npm install --no-save --prefix /opt/drizzle drizzle-kit@0.31.10 drizzle-orm@0.45.2 postgres@3.4.9
# Schema source lives next to drizzle-kit so its `drizzle-orm/pg-core`
# imports resolve to /opt/drizzle/node_modules — Next's standalone bundle
# inlines drizzle-orm and doesn't ship it as a separate /app/node_modules
# package, so the schema files can't resolve it from there.
COPY --from=builder /build/src/db/schema /opt/drizzle/schema
COPY drizzle.docker.config.cjs /opt/drizzle/drizzle.config.cjs

COPY scripts/docker-entrypoint.sh ./docker-entrypoint.sh
# Run as the unprivileged `node` user (uid 1000, shipped in the base image)
# instead of root. The entrypoint pushes the Drizzle schema from /opt/drizzle
# and runs the Next standalone server from /app, so both trees (and the Next
# runtime cache dir) must be owned by `node`.
RUN chmod +x docker-entrypoint.sh \
 && mkdir -p /app/.next/cache \
 && chown -R node:node /app /opt/drizzle

EXPOSE 3000

# Container-level liveness check. Busybox `wget` ships in the alpine base;
# /api/health runs a `select 1` against the database.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:3000/api/health || exit 1

USER node

ENTRYPOINT ["./docker-entrypoint.sh"]
