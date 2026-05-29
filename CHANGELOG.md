# Changelog

## [0.5.1] — 2026-05-29

### Added
- **Top progress bar** — `nextjs-toploader` mounted once at the root layout shows a thin animated bar across the top of every route navigation and server-action submit. Color uses the primary brand HSL.
- **`<SubmitButton>` component** (`src/components/app/submit-button.tsx`) — drop-in for `<Button type="submit">`. Uses `useFormStatus()` to disable itself and show a `Loader2` spinner while the form action is pending. Optional `pendingChildren` swaps the label ("Open ticket" → "Opening…"). Applied to every submit-style button in the app: login, /admin create-business, /t/new open-ticket, /b/[slug]/settings (save settings, delete category, add category), /b/[slug]/tickets/[id] (claim, unclaim, assign, close, reopen, delete-channel, add internal note), plus the reply form.
- **Server-side dedupe on open-ticket** — `openTicketAction` keeps a tiny in-process Map keyed by `userId + businessId + lowercased(subject)` for 5 seconds. If a second submission arrives within that window with the same key, it redirects to the first ticket's URL instead of inserting another row. Belt-and-suspenders for the client-side disable: covers multi-tab and network-retry double-submits.

Closes the "I clicked New ticket too fast and got two tickets" pain.

## [0.5.0] — 2026-05-29

### Added
- **Internal notes (D3)** — staff-only `ticket_messages` with `source='internal'`. Never shown to the opener (filter on the server, not just the UI). First note lazily creates a Discord **private thread** (`type: 12 PRIVATE_THREAD`, `invitable: false`) on the per-ticket channel and posts subsequent notes there as the bot. UI: amber-tinted panel below the conversation on `/b/[slug]/tickets/[id]`, admin-only.
- **Project + sub-tickets (E2)** — `/t/new` now has a Type select (Normal / Project). Sub-ticket flow: project ticket page shows a Sub-tickets card listing children + "Add sub-ticket" link, which deep-links to `/t/new?b=<slug>&parent=<id>` and hides the Type selector. Validation rejects parents that don't belong to the same business, aren't `kind='project'`, or don't exist. Sub-tickets are always `kind='normal'` regardless of form submission.
- **`/clients` rollup view (F1)** — top-level page with one card per business showing open count, project count, last activity. Sudo sees every business; admins/owners see only the ones they administer. New link in the avatar dropdown.
- **Terminology helper (F2)** — `src/lib/terminology.ts` with `nounSingular`/`nounPlural`/`titleSingular`/`titlePlural` driven by `businesses.terminology`. `/clients` page already reads from it; per-page label rewrites land as later patches.

### Changed
- Middleware now matches `/clients/...` so the auth-cookie guard applies.

Bot-side parity (internal-note slash command, project + sub-ticket commands, equivalent rollup queries) is queued under euphoric-tickets #5, #8.

## [0.4.0] — 2026-05-29

### Added
- **Server-specific webhook identity (D1)** — `resolveWebhookIdentity()` fetches the user's per-guild nickname + per-guild avatar via the bot token before every user-spoofed webhook post. Web replies now show your guild nickname/avatar in Discord instead of your global Discord profile. Falls back to global identity when bot token is missing or guild lookup fails.
- **Unclaim + Assign (D4)** — `unclaimTicket()` releases a claimed ticket back to the unassigned pool (allowed for current assignee or any admin); `assignTicket()` admin-only dropdown picks a staff member by id. Wired into the ticket-detail page header with an inline `<select>`.
- **On-close channel move (B1)** — closing a ticket moves its per-ticket channel into the configured "closed" Discord category (per-ticket-category override → business fallback → no move). `closeTicket()` resolves the destination at call time. Still renames with `closed-` prefix.
- **Manual delete-channel button (B3)** — admins can hard-delete the Discord channel of a closed ticket. DB row + ticket_messages stay so transcripts survive. Visible only when `status='closed'` AND `discord_channel_id` is set.
- **Closed-state banner (B4)** — closed tickets show a "Closed X ago. Channel was moved/deleted." banner above the conversation thread.

### Changed
- Settings UI now exposes `discord_closed_category_id` (business + per-category), `delete_closed_after_days`, and `terminology` (business / client) — all editable from `/b/[slug]/settings` per the feature-parity principle (#10).

Bot-side parity (slash commands for these same actions) lives at euphoric-tickets#11 + #5 and is queued for a follow-up.

## [0.3.1] — 2026-05-29

### Added (schema only — UI follows in subsequent patches)
- `businesses.discord_closed_category_id` (text) — where to move closed per-ticket channels. Per-category override below.
- `businesses.delete_closed_after_days` (integer, nullable) — bot-scheduled cleanup horizon. Null = keep forever.
- `businesses.terminology` (`'business'|'client'`, default `'business'`) — UI noun toggle.
- `ticket_categories.discord_closed_category_id` (text) — per-category override for closed destination.
- `tickets.kind` (`'normal'|'project'`, default `'normal'`) — distinguishes long-term/retainer parents from regular tickets.
- `tickets.parent_ticket_id` (integer, nullable) — sub-ticket parent reference.
- `tickets.discord_internal_thread_id` (text, nullable) — lazily-created Discord thread for staff-only internal notes.
- `ticket_messages.source` enum now includes `'internal'`.

Schema-only PR. Drizzle-kit push at next deploy adds the columns. UI/lifecycle changes for each ship over the next patches; tracked as project items euphoric-tickets-web#1–#11 + euphoric-tickets#1–#11.

## [0.3.0] — 2026-05-29

### Added
- Per-ticket Discord channels. When a ticket opens from the web, the bot token now creates a private text channel under the right Discord category, creates a webhook on that channel, stores `channel_id` + `webhook_url` on the ticket, and posts the opener's first message (and every subsequent web reply) via that per-channel webhook. The legacy single business-wide `webhook_url` becomes a fallback for when no Discord category is mapped.
- Schema: `ticket_categories.discord_parent_category_id`, `businesses.discord_fallback_category_id`, `tickets.discord_webhook_id` + `tickets.discord_webhook_url`.
- `src/lib/discord.ts`: `createTicketChannel()`, `createChannelWebhook()`, `archiveTicketChannel()` — bot-token helpers that handle the channel lifecycle. Per CLAUDE.md the web still never posts as the bot; the webhook flow keeps every message user-spoofed.
- Settings UI: Discord channel-category ID fields per ticket-category and per-business fallback. Each category row now displays its Discord mapping (or "uses business fallback").
- Close action archives the per-ticket channel (renames with `closed-` prefix) so transcripts stay readable but the queue stays clean.

### Changed
- `docker-compose.yml`: `db` joins `efm-public-net` with alias `tickets-db`. Sets up the shared-DB consolidation — the `euphoric-tickets` bot will switch its `DATABASE_URL` to `postgresql://tickets_web:…@tickets-db:5432/tickets_web` in the next PR and its own Postgres volume gets dropped. Decoupling rule in CLAUDE.md is being retired with that change.
- `DISCORD_BOT_TOKEN` is now plumbed through the web container env (copied from the bot's `.env` to the web's `.env`; both repos use the same Discord application).

## [0.2.1] — 2026-05-29

### Added
- `/admin` — sudo-only page with a **Create business** form (slug, display name, Discord guild ID, optional description + webhook URL) and a list of every business in the app. Guarded server-side by `requireSudo()`; included in the middleware's auth-cookie matcher.
- `/b/[slug]/settings` — ticket categories CRUD. Lists every category for the business, lets admins add a new one (key + label + emoji + description + sort order), and delete existing rows. Revalidates `/t/new` so the open-ticket form picks up changes immediately.
- TopNav user dropdown — surfaces **Ticket queue** + **Business settings** for the currently-active business when the user is admin/owner there, and an **Admin** link when the user is sudo. Brings every configurable surface into the UI so SQL pokes aren't required.
- `src/server/sudo.ts` — `currentUserIsSudo()` (cheap nav-time check) and `requireSudo()` (hard guard).

## [0.2.0] — 2026-05-29

### Added
- Global sudo flag on the `users` table (`is_sudo boolean not null default false`). Sudo users resolve as `owner` of every business in both `listMyBusinesses` and `resolveBusinessAccess`, so they can see and administer every tenant without being a member of its Discord guild. Toggled by direct SQL for now; the planned `/admin` UI for managing this is still future work.

## [0.1.14] — 2026-05-29

### Fixed
- `src/middleware.ts`: root cause of the `ERR_TOO_MANY_REDIRECTS` loop. The middleware only checked for the unchunked `__Secure-authjs.session-token` cookie. Auth.js v5 splits large JWT-encrypted session payloads across `.0`, `.1`, … chunked cookies once the encoded value exceeds the per-cookie size budget — and for users in many Discord guilds (95 in the reporter's case), it does. Middleware saw no cookie → redirected to /login. /login's `auth()` reassembled the chunks → bounced back to /dashboard. Match the cookie name by prefix so chunked sessions count as signed in.

### Changed
- `src/server/auth.ts`: removed the temporary `[auth][jwt]` / `[auth][session]` `console.log` instrumentation added in v0.1.13. The middleware mismatch was the actual cause, not anything inside the callbacks.

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

`v0.5.1 · 03735fa`
