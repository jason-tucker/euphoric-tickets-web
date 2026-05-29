# Changelog

## [0.1.13] — 2026-05-29

### Changed
- `src/server/auth.ts`: temporary `console.log` instrumentation around the `jwt` and `session` Auth.js callbacks to diagnose a persistent post-OAuth `ERR_TOO_MANY_REDIRECTS` loop between `/login` and `/dashboard`. To be removed in the next patch once the cause is identified.

## [0.1.12] — 2026-05-29

### Fixed
- `src/server/permissions.ts`, `src/app/dashboard/page.tsx`, `src/app/t/new/page.tsx`: replaced `sql\`... IN ${array}\`` patterns with drizzle's `inArray()` helper. The raw `sql` tag doesn't expand JS arrays into a Postgres tuple — every authenticated render of `/dashboard`, `/t/new`, or any business-scoped page would throw a SQL error on the very first DB lookup, surfacing as a silent hang in production. With this in place a logged-in user actually reaches `/dashboard` instead of the page never finishing.

## [0.1.11] — 2026-05-29

### Fixed
- `src/app/login/page.tsx`: `ERR_TOO_MANY_REDIRECTS` after a fresh login. The /login redirect-when-signed-in check tested `session?.user` (truthy whenever the JWT cookie decrypted into any user object) while /dashboard required `session?.user?.id`. A half-baked session — cookie present but jwt callback never populated `userId` — looped between them. Tighten /login to also require `user.id` so the two sides agree on what "signed in" means.

## [0.1.10] — 2026-05-29

### Fixed
- `src/server/auth.ts`: after OAuth succeeded, the very next request to `/dashboard` returned Chrome's `ERR_HTTP_RESPONSE_CODE_FAILURE 431 (Request Header Fields Too Large)` for users in many Discord servers. The JWT-encrypted session cookie embedded the full raw `guilds` array from Discord (`name`, `icon`, `features`, `owner`, `permissions`) and quickly blew past the ~8KB header limit. Strip each guild to just `{id, permissions}` before stashing in the JWT — the only two fields `src/server/permissions.ts` actually reads.

## [0.1.9] — 2026-05-29

### Fixed
- `src/server/auth.ts`: Discord's authorize page hung — clicking "Authorize" did nothing and the URL never left `discord.com/oauth2/authorize?…`. The `guilds.members.read` scope forces Discord into a "Select a server" flow that needs the application's bot to be in at least one of the user's servers; with the bot not yet added anywhere, the dropdown rendered empty and the button no-op'd with no visible error. Drop the scope so OAuth completes; admin resolution now falls back to the `permissions` field on each guild snapshot (only the guild owner / ADMINISTRATOR users get admin until we ship the bot into linked guilds).

## [0.1.8] — 2026-05-29

### Fixed
- `src/server/auth.ts`: clicking "Continue with Discord" threw `TypeError: Invalid URL`. The Discord provider override `authorization: { params: { scope } }` replaced the whole `authorization` object instead of merging — Auth.js v5 doesn't deep-merge it — which dropped the provider's default `url: 'https://discord.com/api/oauth2/authorize'`. `signIn` then fell through to `new URL(provider.issuer)` (Discord has no issuer) and threw. Spell out the url alongside the scope override so it survives.

## [0.1.7] — 2026-05-29

### Fixed
- `Dockerfile` / `drizzle.docker.config.cjs` / `scripts/docker-entrypoint.sh`: in v0.1.6 the Next server started but the schema push silently failed. The schema files in `/app/src/db/schema-source` import `drizzle-orm/pg-core`, which Node resolved from `/app/node_modules` — but Next's `output: 'standalone'` bundle inlines drizzle-orm rather than exposing it there, so the import threw `MODULE_NOT_FOUND` and drizzle-kit exited 0 anyway. Move the schema source into `/opt/drizzle/schema` so imports resolve to the same prefix as drizzle-kit + drizzle-orm, run the push from `/opt/drizzle`, and scan its output for module-resolution errors so the entrypoint aborts (rather than booting Next on top of an empty database).

## [0.1.6] — 2026-05-29

### Fixed
- `Dockerfile`: drizzle-kit also needs a Postgres driver visible from `/opt/drizzle` to actually connect during schema push. Add `postgres@3.4.9` (lockfile pin, matches the app's `postgres.js` driver) to the isolated prefix.

## [0.1.5] — 2026-05-29

### Fixed
- `Dockerfile` / `scripts/docker-entrypoint.sh`: drizzle-kit's "required packages" probe for drizzle-orm doesn't honor `NODE_PATH`, so the v0.1.4 attempt to point at `/app/node_modules` from `/opt/drizzle` still failed at boot. Install `drizzle-orm@0.45.2` (the lockfile pin) alongside drizzle-kit in `/opt/drizzle` so they resolve as siblings, and drop the now-unused NODE_PATH wrapper.

## [0.1.4] — 2026-05-29

### Fixed
- `scripts/docker-entrypoint.sh`: drizzle-kit (running from `/opt/drizzle`) couldn't resolve drizzle-orm — it lives in Next's `/app/node_modules` bundle, out of drizzle-kit's normal lookup path. Set `NODE_PATH=/app/node_modules` for the schema-push command only, leaving the Next server's environment unchanged.

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

`v0.1.12 · e1f316a`
