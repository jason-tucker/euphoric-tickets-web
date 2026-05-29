# Changelog

## [0.1.3] — 2026-05-29

### Fixed
- `drizzle.docker.config.cjs`: with drizzle-kit installed at `/opt/drizzle` (out of band from Next's standalone `/app/node_modules`), `require('drizzle-kit')` resolved relative to the config's own directory (`/app`) and missed it. Point at the absolute `/opt/drizzle/node_modules/drizzle-kit` path so the schema-push entrypoint completes and the Next server actually boots.

## [0.1.2] — 2026-05-29

### Fixed
- `Dockerfile` / `scripts/docker-entrypoint.sh`: the production stage previously copied only the top-level `node_modules/drizzle-kit` symlink from the builder. With pnpm's nested layout, drizzle-kit's runtime deps (esbuild, tsx, @esbuild-kit/*, @drizzle-team/brocli) live under `.pnpm/<pkg>@<ver>/` and don't follow through that COPY — so the entrypoint crashed with `Cannot find module 'esbuild'` on every boot and the container restart-looped without ever serving. Install drizzle-kit fresh in the production stage via `npm --prefix /opt/drizzle` at the same pinned version (0.31.10) and point the entrypoint at that bin.

## [0.1.1] — 2026-05-29

### Fixed
- `src/server/auth.ts`: cast `session.user` through `unknown` before `Record<string, unknown>` so the session callback compiles against `AdapterUser`'s narrower shape — the prior direct cast was rejected by TS as "neither type sufficiently overlaps" and broke the CI build, blocking the very first GHCR image.

## [0.1.0] — 2026-05-29

### Added
- Initial scaffold: Next.js 15 App Router + React 19 + Tailwind 3 + shadcn/ui.
- Drizzle ORM + Postgres 16 in own container. Schema: users, businesses, business_members, ticket_categories, tickets, ticket_messages.
- Auth.js v5 with Discord provider (scopes `identify email guilds guilds.members.read`); JWT session enriched with discordId and guild list.
- Multi-tenant: every page is scoped to a business via `/b/[slug]`. Users can be members or admins of multiple businesses; admin status is derived from Discord role membership in the business's linked guild.
- End-user pages: `/` dashboard with my-tickets list, `/t/new` open-a-ticket form, `/t/[id]` ticket view.
- Admin pages: `/b/[slug]` overview, `/b/[slug]/tickets` queue with filters, `/b/[slug]/tickets/[id]` reply UI, `/b/[slug]/settings` config.
- Outbound replies posted to Discord via per-user webhook spoof — `username` + `avatar_url` overrides on every POST so messages appear as the user, not the bot.
- Docker + GHCR build pipeline. `docker-compose.yml` binds to `127.0.0.1:6095` and joins the `efm-public-net` external network so the euphoricfm-website Caddy can reverse-proxy `tickets.euphoric.fm` to the container.
- Project board #10 created.

`v0.1.2 · 283e976`
