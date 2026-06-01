# Changelog

## [0.6.38] — 2026-05-30 — Fix: 0.6.37 CI failed on missing kind/staffOnly fields in CategoryFormFields type

### Fixed
- **0.6.37 CI failed `next build` type-check.** The new `<select name="kind">` and `<input name="staffOnly">` inputs in the per-category form read `v?.kind` / `v?.staffOnly`, but the `CategoryFormFields` component's `defaults` prop type literal still only listed the v0.6.36 fields, so `tsc --noEmit` rejected the new property accesses. Added `staffOnly: boolean` and `kind: 'normal' | 'project'` to the type. No runtime change vs 0.6.37 — that commit just never produced an image because CI never got past `next build`.

## [0.6.37] — 2026-05-30 — Staff-only categories, per-category ticket Type, 403 ticket page, external members in People box

### Added
- **Per-category "Staff-only destination" toggle in team settings.** New `staff_only` boolean column on `ticket_categories` (default false). When checked, the category disappears from the open-ticket form on `/t/new` (filter on `page.tsx`) and from the bot's panel buttons (filter in `settingsService.getPanelCategories`). Staff/admins can still **move** existing tickets into the category from the ticket detail page (the change-category dropdown does not filter, since it's already gated to staff/admin). Defense-in-depth: `/t/new`'s `openTicketAction` rejects a staff-only category id ("That category is staff-only — pick another."), and the bot's `openTicket()` refuses with a friendly Discord reply if a stale panel still has a button. Useful for triage/archive landing zones that should never be a fresh-ticket option.
- **Per-category ticket Type (`kind`) in team settings.** New `kind` enum column on `ticket_categories` (`'normal' | 'project'`, default `'normal'`). The previous per-ticket Type picker on `/t/new` is gone — Type is now a property of the category, set once in team settings. Replaces the dropdown that used to ask every opener whether their ticket was a one-off or a project. Sub-tickets still force `kind='normal'` regardless of the parent category. Bot's `openTicket()` reads the category's kind when inserting the ticket row, so panel-opened tickets pick up the same setting as web-opened ones.

### Fixed
- **External members now show up in the ticket's People card so staff can remove them.** Adding someone via Discord ID when they aren't in the guild created a `ticket_external_members` row and DM'd them a web link (P16) — but the People card only listed Discord channel overwrites, so external members were invisible and there was no UI to revoke their access. Now the page also reads `ticket_external_members ⋈ users` and merges those rows into the list, marked with a small **external** badge. `removeTicketMember` was updated in lockstep: it tries the channel overwrite delete (best-effort, silent 404 for external-only users), then also deletes the `ticket_external_members` row so the removed user actually loses `canSee`. The status footer also switches from `<@id>` (which would render as a raw id for non-guild members) to the stored display name for external removals.

### Changed
- **Ticket pages return a friendly 403 instead of a blank 404 when you don't have access.** `/b/[slug]/tickets/[id]` was calling `notFound()` for both "ticket doesn't exist" and "you can't see this ticket" cases, which meant a signed-in user following a shared link to someone else's ticket saw the generic "This page could not be found." Now the no-access branch renders a small card — "You don't have access to this ticket" — that tells the user the ticket *does* exist in this team but they're not on it / not staff, and offers a Back to dashboard link. The "ticket doesn't exist" branch still 404s.

## [0.6.36] — 2026-05-30 — Ticket viewer status badge wrap fix + stale settings tooltip

### Fixed
- **`In Progress` status badge no longer wraps to a "double-line bubble" on narrow screens.** The badge style was `inline-flex rounded-full px-2 py-0.5 text-[11px] uppercase tracking-wider` with no `whitespace-nowrap`, so on phone-width viewports the longer labels ("IN PROGRESS", "COMPLETED") could wrap inside the pill, leaving a weird two-line oval. Added `whitespace-nowrap` to `StatusBadge` so every status renders as a single-line pill regardless of available width. Affects the ticket detail header, both queue tables, the all-tickets board, the dashboard, and sub-ticket rows.

### Changed
- **Team-settings: per-category first-message template tooltip no longer references unreleased work.** Was "Blank = default welcome card. Used by the bot once P4 ships." — P4 was already implemented in the bot (commit `31249b4`, bot v0.5.22) and the template is live in production. Updated to "The bot uses this as the ticket's first message in the Discord channel." Also dropped the internal "(P4)" phase marker — user-visible copy should not leak Lantern phase identifiers.

## [0.6.35] — 2026-05-30 — Fix: deleting a category with tickets threw a server error

### Fixed
- **Deleting a category no longer 500s.** `tickets.category_id` is a RESTRICT foreign key, so deleting a category that still had tickets attached threw a server-side exception ("Application error"). `deleteCategoryAction` now **orphans those tickets first** (sets `category_id = null`, which the column already allows) before deleting the category. Notification prefs cascade-delete on their own as before.

## [0.6.34] — 2026-05-30 — Rename compose service `web` → `tickets-web` to clear shared-network alias collision

### Changed
- **Compose service renamed `web` → `tickets-web`.** Matches the explicit `tickets-web` alias already declared on the shared `efm-public-net`, so all current resolvers (the `euphoricfm-website` Caddy uses `reverse_proxy tickets-web:3000`) keep working unchanged. The reason for the rename: both this stack and `euphoricfm-website` previously auto-claimed the unqualified `web` alias on `efm-public-net` (docker-compose adds the service name as a network alias automatically). No consumer resolved plain `web` today, but anything new joining the network and resolving `web` would round-robin between two backends — same failure shape as the `db` collision that broke otterbot's `/oc` earlier today. After this commit the auto-alias on `efm-public-net` is `tickets-web` for this service and `efm-web` for the other — unique. Container name changes from `euphoric-tickets-web-web-1` → `euphoric-tickets-web-tickets-web-1`; brief downtime on `tickets.euphoric.fm` while `docker compose up -d` recreates it; the postgres data volume is unaffected. The explicit `aliases: [tickets-web]` block on the network is now redundant (the auto-alias provides the same name) but kept as load-bearing documentation.

## [0.6.33] — 2026-05-30 — Reply preview toggle, make-owner, picker dedupe, update prompt

### Added
- **Make owner.** Each non-opener on the **People** card gets a crown button (staff/admin) that promotes them to the ticket's owner; the change is posted to the channel as a status footer. The current owner is labelled "owner".
- **New-version reload prompt.** A `VersionWatcher` polls `/api/version` (Next build id) and, when a new image is serving, shows a sticky toast with a **Reload** button. Polling pauses while the tab is hidden.

### Changed
- **Reply preview is now a toggle below the input** instead of a side-by-side / tabbed pane. Defaults to hidden; "Show preview" reveals the rendered Discord output under the textarea.
- **Add-person picker hides people already on the ticket** — pass `exclude` to `<DiscordPicker>`; already-added members no longer appear in the directory list.

## [0.6.32] — 2026-05-30 — More statuses + formatted conversation text

### Added
- **More ticket statuses:** Open, In Progress, Waiting, On Hold, Completed, Closed. New `statusLabel()` + badge colors. A **Status** dropdown on the ticket detail (staff/admin) sets any non-closed status; the status footer is posted to the channel. Both ticket boards' filter bars gain In Progress / On Hold / Completed.
- Claiming/assigning now sets **In Progress** (the legacy 'claimed' still renders as "In Progress").

### Changed
- **Conversation text now renders Discord formatting** — message bodies (and internal notes) go through `<DiscordMarkdown>` so `**bold**`, `*italics*`, code, mentions, etc. render properly instead of showing raw markdown characters.

## [0.6.31] — 2026-05-30 — Per-guild identity (nickname + server avatar) in tickets

### Changed
- The ticket conversation now shows each person's **per-guild identity** — their **server nickname and server-specific avatar** for that team's Discord guild — instead of their global Discord profile. Applies to message authors (and internal notes), the opener line, the assignee badge, and the People card.
- New `fetchGuildMemberIdentity` / `resolveGuildIdentities` helpers (lib/discord.ts) resolve nick + guild avatar via the bot token, cached 5 min per (guild, user) so SSE-driven re-renders don't re-hit Discord. Falls back to the stored global name/avatar when a member has no per-guild override or isn't in the guild.

## [0.6.30] — 2026-05-30 — Assign & Move as dropdown buttons

### Changed
- The **Assign** and **Move** (category) controls on the ticket detail page are now **button-triggered dropdown menus** instead of always-visible `<select>` boxes — cleaner action row. New `<TicketActionMenu>` client component: each option is a tiny form that submits the bound server action with the chosen value (a ✓ marks the current one).

## [0.6.29] — 2026-05-30 — Admin tab + dynamic per-team/category notifications + custom ntfy server

### Added
- **Admin tab** in the header bar (next to Help) — visible only to sudo.
- **Dynamic notification settings.** `/settings/notifications` is rebuilt: a **Global default** plus collapsible **per-team** sections, each with a **whole-team** row and a row **per category**. Each scope toggles new-ticket / reply × ntfy / DM independently. The dispatcher already does most-specific-wins, so you can (e.g.) enable globally but mute one noisy category.
- **Custom ntfy server** (optional) — a per-user `ntfy_server` field; leave blank for ntfy.sh, or point at a self-hosted server. Wired through the dispatcher (`postNtfy` uses the per-user server, falling back to `NTFY_BASE_URL`/ntfy.sh).

### Changed
- `saveNotificationPrefs` now persists the full matrix: it reads a rendered `scopes` list + `pref:<bid>:<cid>:<event>:<channel>` checkboxes, wipes the user's prefs, and re-inserts the checked ones (ntfy topic/server applied to ntfy rows).

## [0.6.28] — 2026-05-30 — Internal endpoints fall back to the bot token

### Changed
- The notification dispatcher's DM call, the `/api/internal/notify` route, and the external-member invite DM now authenticate with `INTERNAL_TOKEN` **if set, else the shared bot token**. So Discord-DM notifications need no separate secret — only `BOT_INTERNAL_URL` (where the bot's internal server lives) is required config. ntfy push needs nothing.

## [0.6.27] — 2026-05-30 — Fix: build was broken (lucide `title` prop)

### Fixed
- `<Info title=...>` on the `/admin` webhook tooltip — lucide icons don't accept a `title` prop, which failed `next build` type-checking, so **every CI build since v0.6.7 failed** and nothing deployed. Wrapped the icon in a `<span title=…>` instead. `tsc --noEmit` is clean; this unblocks the whole backlog of web releases (P3–P19, the perf pass, Help, board filters).

## [0.6.26] — 2026-05-30 — Identical filter bar on both ticket boards

### Changed
- The per-team queue (`/b/[slug]/tickets`) now has the **same filter buttons** as the All-tickets board: **Active / Open / Claimed / Waiting / Closed / All**, defaulting to **Active** (was "Open", which also hid claimed/waiting). Closed stays one click away. The filter now preserves the active sort when switched.

## [0.6.25] — 2026-05-30 — All-tickets board hides closed by default

### Changed
- The **All tickets** board (`/tickets`) now defaults to **Active** (everything except closed) instead of showing every ticket. Added a filter bar — **Active / Open / Claimed / Waiting / Closed / All** — so closed tickets are one click away but don't clutter the default view. Filter composes with sorting. (The per-team queue already defaulted to hiding closed via its status pills.)

## [0.6.24] — 2026-05-30 — Help as a top-level tab

### Changed
- **Help** is now a visible tab in the header bar (always shown, signed-in or not) instead of being tucked inside the user dropdown.

## [0.6.23] — 2026-05-30 — Web help / documentation page

### Added
- **`/help`** — a public, comprehensive how-to page: what the system is, opening tickets (Discord + web), the live conversation, audio/file attachments, notifications, staff actions, admin actions, a who-can-do-what table, a full command reference, and a FAQ. On-page jump nav + linked from the top-nav user menu. Pairs with the bot's context-aware `/help` command, which links here.

## [0.6.22] — 2026-05-30 — Perf pass: drop Discord round-trips off the hot path

### Changed
- **`resolveTicketAccess`** no longer makes a live Discord API call on every ticket render. The category-staff check now reads the cached `business_members.discord_roles_snapshot` (written whenever the user hits a team page), falling back to Discord only when no snapshot exists yet. This matters a lot under live refresh — every SSE-driven `router.refresh()` previously did a Discord member fetch.
- **`fetchChannelMemberIds`** (People card) gained a 20s in-process TTL cache, so the burst of `router.refresh()` re-renders on a chatty ticket reuses one `GET /channels/{id}` instead of one per message.
- **`notify` dispatcher** — was a prefs `SELECT` per recipient (N+1); now one batched query grouped in memory, and the per-recipient ntfy/DM fan-out runs concurrently.

Net effect: an open ticket receiving Discord replies now re-renders with **DB-only** queries (no Discord calls on the access path) and notifications fan out in parallel.

## [0.6.21] — 2026-05-30 — Lantern P17–P19: single-stack deploy, LB health, backups

### Added — P17 single deployable stack
- **`docker-compose.combined.yml`** — Postgres + web + bot + watchtower in one `docker compose up`. (The two repos are separate, so a literal one-container-two-process image would need a monorepo; running both GHCR images in one compose stack is the practical "one thing to deploy" and keeps process isolation.)

### Added — P18 multi-VPS load balancing
- **`GET /api/health`** — 200 when Postgres is reachable, 503 otherwise; what Caddy's `health_uri` polls.
- `ops/README.md` documents the Caddy `reverse_proxy` LB block (`least_conn`, `health_uri /api/health`, `flush_interval -1` for SSE). The bot's single-leader election ships in bot v0.5.16.

### Added — P19 GFS database backups
- **`ops/tickets-backup.sh`** — `pg_dump --format=custom` piped into **restic** with Grandfather-Father-Son retention (`--keep-within-hourly 5h --keep-daily 3 --keep-weekly 4 --keep-monthly 4`). Dedup keeps ~17 snapshots at ~1.2–1.5× live DB size.
- **`ops/tickets-backup.{service,timer}`** — systemd oneshot + timer (every 45min + 02:00 daily anchor), with an Uptime-Kuma ping on failure.
- **`ops/README.md`** — install, retention, off-site B2 mirror, restore drill, settings-only rollback.

Closes the lantern plan (P1–P19). L1/L2 remain as board placeholders.

## [0.6.20] — 2026-05-30 — Lantern P16: external Discord users (add by ID, no guild)

### Added
- **`ticket_external_members`** table — web-only access grant for Discord users not in the team's guild.
- **`addTicketMember` now branches**: in-guild users get a channel overwrite (P6 path); users NOT in the guild are looked up via `fetchDiscordUser` (works for any Discord id), upserted into `users`, granted a `ticket_external_members` row, and best-effort DM'd a link to the ticket.
- **`resolveTicketAccess`** honors external membership — an external member gets `canSee` + `canReply` on that one ticket. Call sites now pass `ticket.id`.
- **Soft auth on `/b/[slug]` for external members**: the layout no longer hard-redirects non-members, and the ticket-detail page uses `requireSession` + `resolveBusinessAccess` (nullable) so an external member reaching the DM link can view + reply. Member-only pages (overview/queue/settings) keep their own guards.

External users never join the guild and never see the bot; their replies post into the Discord channel via the webhook spoof (labelled external). Closes euphoric-tickets-web#27.

## [0.6.19] — 2026-05-30 — Lantern P15: sudo bot dashboard

### Added
- **`/admin/bot`** (sudo-only) — health-at-a-glance: team count, open tickets, needs-attention count, errors-in-24h, the 10 most recent error rows (link to the full `/admin/errors`), and health notes. "Bot dashboard" link added to the top-nav sudo section.

## [0.6.18] — 2026-05-30 — Lantern P13: notification prefs (ntfy + DM)

### Added
- **`user_notification_prefs` schema** — per-user rows scoped optionally by team/category, for (channel × event): `ntfy` / `dm` × `new_ticket` / `reply`.
- **`src/server/notify.ts`** dispatcher — resolves recipients (opt-in users for new tickets; opener/assignee for replies, minus the actor), picks the most-specific enabled pref per channel, and fans out to **ntfy** (`POST https://ntfy.sh/<topic>`) and/or **Discord DM** (via the bot's `/api/internal/dm`).
- **`/api/internal/notify`** (bot → web bridge, `INTERNAL_TOKEN`-authed) so Discord-origin events dispatch through the same path.
- **`/settings/notifications`** page — ntfy topic + a toggle grid for new-ticket / reply × ntfy / DM. "Notifications" link in the top-nav.
- Web-origin replies (`replyToTicket`) now call `notify` directly.

### Env
- `INTERNAL_TOKEN` (shared with the bot), `BOT_INTERNAL_URL` (e.g. `http://euphoric-tickets:8787`), optional `NTFY_BASE_URL`.

## [0.6.17] — 2026-05-30 — Lantern P12: sudo error-log viewer

### Added
- **`bot_errors` schema** (web owns; bot mirrors) — `id bigserial, level, source, message, stack, context jsonb, created_at` + `created_at` index.
- **`/admin/errors`** sudo-only page — most recent 200 rows, level filter pills (error/warn/info), JSON context preview. "Bot errors" link added to the top-nav sudo section.

The bot writes rows via `persistError()` and sweeps anything older than 5 days hourly (bot v0.5.12).

## [0.6.16] — 2026-05-30 — Lantern P11 mirror: needs_attention banner

### Added
- **`tickets.needs_attention`** column (mirror of bot v0.5.11) — set by the bot's startup resync when a ticket's Discord channel vanishes.
- An amber **"channel went missing"** banner on the ticket detail page for flagged tickets (the transcript stays intact).

## [0.6.15] — 2026-05-30 — Lantern P10: Discord-formatted reply preview

### Added
- **Two-pane reply form** — write on the left, a live **Discord-rendered preview** on the right (collapses to a Write/Preview tab toggle on narrow screens / the in-game phone). Submit path is unchanged: raw text still posts to the webhook spoof and Discord renders it natively.
- **`<DiscordMarkdown>`** (`components/app/discord-markdown.tsx`) — a small dependency-free renderer covering bold / italic / underline / strikethrough / spoiler / inline + block code / blockquote / headers / `-#` subtext / autolinks, plus styled mention + custom-emoji pills (`<@id>`, `<#id>`, `<@&id>`, `<:name:id>`). No npm dep added (avoids CJS/ESM interop in the standalone build).

Mention **name** resolution (showing `@DisplayName` instead of `@id`) is a small follow-up — the pill already shows what you're tagging.

Closes euphoric-tickets-web#23.

## [0.6.14] — 2026-05-30 — Lantern P9: sortable ticket lists

### Added
- **Clickable, URL-driven sort** on both the per-team queue (`/b/[slug]/tickets`) and the all-tickets tab (`/tickets`). New `<SortHeader>` + `parseSort()` in `components/app/sort-header.tsx` toggle `?sort=&dir=` while preserving the rest of the query string.
- Sortable columns: id, subject, status, last activity, opener (both pages) and team (all-tickets). Default remains last-activity desc.
- The per-team status-filter pills are unchanged and compose with sort.

Closes euphoric-tickets-web#22.

## [0.6.13] — 2026-05-30 — Lantern P8: "All tickets" cross-business tab

### Added
- **`/tickets`** — a cross-business view: every ticket in a team you administer, plus your own tickets in any team you belong to. One query (`business_id IN <admin teams>` OR `opener = me AND business_id IN <my teams>`), ordered by last activity, capped at 300. Columns include **Team** so you can scan which team owns each row.
- **"All tickets" link** in the top-nav user menu (shown to anyone who administers at least one team, or sudo).

Sorting + filtering land in P9. Closes euphoric-tickets-web#21.

## [0.6.12] — 2026-05-30 — Lantern P7: live conversation refresh (SSE + LISTEN/NOTIFY)

### Added
- **Postgres NOTIFY triggers** (`ensureNotifyTriggers()` in `db/client.ts`, idempotent `CREATE OR REPLACE`, run once per process): `ticket_messages` INSERT and `tickets` UPDATE both `pg_notify('ticket_activity', <ticket id>)`.
- **SSE endpoint** `GET /api/tickets/[id]/messages/stream` — permission-checked, `LISTEN`s on `ticket_activity` via a dedicated postgres-js connection, forwards a `refresh` event when the ticket changes, 25s heartbeat to keep proxies from closing the idle stream.
- **`<LiveRefresh>`** client component on the ticket page — opens the stream and calls `router.refresh()` on each `refresh` event (re-runs the SSR, so message rendering / attachments / permission filtering stay server-side). Falls back to 5s polling when the stream errors and refreshes on tab focus.

### Result
- A reply typed in Discord (or by another staff member on the web) appears in an open conversation typically **<1s** later, with no manual reload. The `tickets.euphoric.gg` Caddy block already has `flush_interval -1`; the cloudflared tunnel passes SSE; the response sets `X-Accel-Buffering: no`.

Closes euphoric-tickets-web#20.

## [0.6.11] — 2026-05-30 — Lantern P6: People card (add/remove members on the web)

### Added
- **"People" card** on `/b/[slug]/tickets/[id]` (staff/admin, non-closed tickets) — lists the per-user Discord channel overwrites with avatars, and an add row using `<DiscordPicker kind="user" />`.
  - `addTicketMember` — upserts a `users` row (name/avatar resolved via `fetchGuildMemberAsBot`), grants the channel overwrite (`addChannelMember`), and posts a `-# … was added to the ticket by @x` footer.
  - `removeTicketMember` — revokes the overwrite (`removeChannelMember`), refuses the opener, posts the matching footer.
- New `lib/discord.ts` helpers: `fetchChannelMemberIds`, `addChannelMember`, `removeChannelMember`.

This finishes the web side of the lifecycle status footers (the add/remove footers were deferred from the earlier footer change until this card existed). Discord channel overwrites remain the single source of truth — same model as the bot's `/tickets add|remove`.

Closes euphoric-tickets-web#19.

## [0.6.10] — 2026-05-30 — Lantern P5: change a ticket's category (web)

### Added
- **`changeTicketCategory(slug, ticketId, formData)` server action** (admin-only via `resolveTicketAccess.canChangeCategory`) — validates the target category belongs to the same team, updates `tickets.category_id`, best-effort moves the Discord channel under the new parent + grants the new category's staff roles via the new `changeTicketChannelCategory()` helper in `lib/discord.ts`, and posts a `-# Ticket category changed to … by @x` footer.
- **"Move" category `<select>`** in the admin action row on `/b/[slug]/tickets/[id]` (shown to admins on non-closed tickets). The team's categories load in the same parallel query batch as the rest of the page.

Closes euphoric-tickets-web#18.

## [0.6.9] — 2026-05-30 — Audio + file attachments in the conversation

### Added
- **Attachment rendering** in the ticket conversation (and internal notes). Audio attachments get an inline `<audio controls>` player; other files get a download chip. Driven by the `ticket_messages.attachments` column the bot now populates (relay + `/tickets convert`).
- **`GET /api/tickets/[id]/attachment?m=<discordMessageId>&a=<attachmentId>`** — permission-checked (`resolveTicketAccess.canSee`) endpoint that uses the bot token to fetch a **fresh** signed Discord CDN URL and 302-redirects to it. Because Discord attachment URLs expire (~24h), audio/files always refresh through this endpoint rather than the stored URL.
- **`fetchFreshAttachmentUrl()`** helper in `src/lib/discord.ts`.

### Notes
- **Nothing is stored on the VPS.** The browser follows the 302 and streams the media directly from Discord's CDN; the web server only issues the redirect. Range requests (audio seeking) are served by the CDN.
- Web-origin rows without a `discord_message_id` fall back to the stored URL (web replies are text-only, so this is rarely hit).

Closes euphoric-tickets-web#52.

## [0.6.8] — 2026-05-30 — Rename "business" → "Team" across the UI

### Changed
- The umbrella tenant noun is now **Team** everywhere in the UI (was "Business"). The operator tenant kind also reads as **Team** (was "Host"); the visitor kind stays **Client**. End-user copy that said "community / communities" now says "team / teams" for one consistent vocabulary.
- Touched surfaces: top-nav ("Team settings", "All teams / clients"), team switcher ("Teams"), `/admin` (Create team, Teams/Clients sections, Kind = Team), team settings page (card titles + helper text), dashboard, `/t/new`, `/clients` rollup, login.
- `src/lib/terminology.ts` default noun flipped from "business" to "team" (the `terminology` enum value stays `'business'` in the DB for back-compat; only the surface label changed).
- **Scope:** display strings only. DB columns (`businesses`, `business_id`, …), routes (`/b/<slug>`, `/clients`), the `kind` enum (`host`/`client`), and all code identifiers are unchanged — no migration.

## [0.6.7] — 2026-05-30 — Multiple businesses per Discord guild + webhook tooltip

### Changed
- **Dropped the unique constraint on `businesses.discord_guild_id`.** A Discord guild can now host multiple businesses. The web is slug-scoped (`/b/<slug>`) and `listMyBusinesses` already iterates every business whose guild the signed-in user belongs to, so this "just works" on the web. Fixes the `businesses_discord_guild_id_unique` 500 when creating a second business in a guild from `/admin`.
  - Known follow-up: the bot still resolves one business per guild for ticket-opening (`getBusinessByGuildId`). Multiple bot-driven panels in one guild would need a panel→business mapping; not needed yet.
- **`/admin` "Outbound webhook URL (optional)"** now has an info-icon tooltip + helper line clarifying it's a fallback-only field (per-ticket channels don't need it) and how to obtain the URL.

### Added (groundwork)
- **`ticket_messages.attachments`** — `jsonb` column (default `[]`) storing captured Discord attachments `{ id, name, url, contentType, size }`. Unused until the upcoming audio-playback feature; ships now so the schema migration lands once.

## [0.6.6] — 2026-05-29 — Silent lifecycle status footers

### Added
- **`postChannelStatus()`** in `src/lib/discord.ts` — posts a small grey `-# ` subtext line into a ticket channel as the bot, with the `SUPPRESS_NOTIFICATIONS` flag (1<<12 — a "@silent" message) and `allowed_mentions: { parse: [] }` so mentions render as names without pinging. This is the one place the web posts a bot-authored line; replies still go via the per-user webhook spoof.
- Two helpers in the ticket detail actions: `postStatus(ticket, text)` (no-ops when channel/bot-token missing) and `mentionForUserId(uuid)` (resolves a `users.id` to a `<@discordId>` mention).
- Wired into web lifecycle actions:
  - **claim** → `Ticket claimed by <@x>`
  - **unclaim** → `Ticket unclaimed by <@x>`
  - **assign** → `Ticket assigned to <@target> by <@actor>` (or `Ticket unassigned by <@actor>`)
  - **close** → `Ticket closed by <@actor>` (posted before the archive move; the channel survives close on the web)
  - **reopen** → `Ticket reopened by <@actor>`

### Not changed by design
- **Internal notes post nothing** to the ticket channel — hard rule. They stay private to the staff thread.

Closes euphoric-tickets-web#51.

## [0.6.5] — 2026-05-29 — Lantern P3: Discord directory picker

### Added — Phase P3 of the lantern plan
- **`<DiscordPicker>`** at `src/components/app/discord-picker.tsx` — one reusable client component for any Discord directory shape:
  - `kind: 'channel' | 'category' | 'role' | 'user'`
  - `multi` for CSV multi-select, single-select otherwise
  - Input doubles as filter and as raw-snowflake paste. Pressing Enter on a value matching `/^\d{17,20}$/` adds it immediately without waiting on resolution.
  - Channels/roles: fetched once on first open and filtered client-side per character (instant feel on small lists).
  - Users: hit the search API with an 80ms debounce — feels per-keystroke but coalesces bursts.
  - Selected items render as badges with × to remove.
  - Hidden CSV input named via `name` so existing server-action FormData flows need no change.
- **3 Discord REST helpers** in `src/lib/discord.ts`: `fetchGuildChannels`, `fetchGuildRoles`, `fetchGuildMembers(query?)`. The members helper uses Discord's `/guilds/{id}/members/search?query=…` when a query is set and the `/members?limit=100` listing otherwise.
- **3 API routes** under `src/app/api/discord/[guildId]/{channels,roles,members}/route.ts` — admin-gated via `requireBusinessAccess`, in-process 60s cache for channels + roles, no cache for member search (queries vary per keystroke).
- **`src/components/ui/popover.tsx`** and **`src/components/ui/command.tsx`** — small shadcn-style wrappers around `@radix-ui/react-popover` and `cmdk` so the picker has a consistent visual home and other components can reuse them.
- **Settings page (`/b/[slug]/settings`)** swapped every snowflake `<Input>` to `<DiscordPicker>` — admin roles, fallback category, closed-tickets category, and per-category open category / closed category / allow-to-open roles / staff roles. Same form-data shape; categories CSV still posts to the same `updateCategoryAction` / `saveBusinessSettings`.

### Dependencies
- Added `cmdk@^1.0.4` and `@radix-ui/react-popover@^1.1.4` to `package.json`.

Closes euphoric-tickets-web#17.

### Notes
- The picker requires `DISCORD_BOT_TOKEN` to be set on the web container (already configured; same one used by `fetchGuildMemberAsBot`).
- Member-by-id resolution still falls back to showing the raw snowflake as the badge label — a small follow-up could hit `GET /users/{id}` for a name on paste.

## [0.6.4] — 2026-05-29 — Lantern P2: three-tier permissions enforced

### Added — Phase P2 of the lantern plan
- **`resolveTicketAccess` helper** in `src/server/permissions.ts` returns per-ticket flags `{ isAdmin, isStaff, isOpener, canSee, canReply, canClaim, canClose, canChangeCategory, canManageMembers, canDeleteChannel }`. React.cache'd so the page and any server actions called from it share one DB round-trip per request. The staff check fetches the user's roles via `fetchGuildMemberAsBot` only when the ticket's category has non-empty `staff_role_ids` — admin and opener paths skip the Discord call.
- **`/b/[slug]/tickets/[id]` page** now resolves the flags after loading the ticket and uses them to drive button visibility. The staff-list dropdown that powers Assign is now visible to staff (not just admin), and the internal-notes panel is staff-or-admin.
- **Every server action** in the page's `actions.ts` was refactored to load through a shared `loadTicketAccess(slug, ticketId)` helper that returns the same flags. Mapping:

| Action | Required flag |
| --- | --- |
| `replyToTicket` | `canReply` |
| `claimTicket` / `unclaimTicket` / `assignTicket` | `canClaim` |
| `closeTicket` | `canClose` |
| `reopenTicket` | `canClaim` |
| `addInternalNote` | `canManageMembers` |
| `deleteTicketChannel` | `canDeleteChannel` (admin-only — throws on staff attempts) |

### Behavior change
- A user holding a role in a `ticket_categories.staff_role_ids` row can now see every ticket of that category, claim / close / reply / add internal notes on it, even without being on `businesses.admin_role_ids`. Channel deletion stays admin-only — staff hitting the action gets a server-side throw, and the Delete button is hidden in their UI.

Closes euphoric-tickets-web#16.

### Notes
- Pickers (P3) still pending — role-ID fields on the settings page remain plain text inputs for one more release.

## [0.6.3] — 2026-05-29 — Lantern P1: edit categories + per-category role tiers

### Added — Phase P1 of the lantern plan (see `/home/botuser/.claude/plans/valiant-tinkering-lantern.md`)
- **`ticket_categories` schema columns** (mirrored on the bot side):
  - `allow_role_ids text NOT NULL DEFAULT ''` — comma-separated Discord role snowflakes that may click the open-this-category panel button. Empty = anyone in the guild. Enforced in P2.
  - `staff_role_ids text NOT NULL DEFAULT ''` — comma-separated Discord role snowflakes that get manage-channel perms on tickets of this category. Empty = inherit `businesses.admin_role_ids` (current behavior). Bot uses this in P2; web tier check uses it in P2.
  - `first_message_template text NULL` — optional template the bot will render as the ticket's first message in P4. Supports `{{user}}`, `{{ticketId}}`, `{{subject}}`, `{{category}}` substitutions. Null = default welcome card.
- **`/b/[slug]/settings` ticket-categories card** rewritten:
  - Each existing category is now a `<details>` row — click to expand into a full edit form with every field (including the three new columns).
  - New `updateCategoryAction(slug, categoryId, formData)` server action mirrors `addCategoryAction`'s zod schema with one shared `CategoryFormFields` component driving both add and edit.
  - Delete moves into the expanded view as its own sibling form (no nested `<form>` elements).
- The add-new form now also exposes the three new columns so categories get the full shape from creation.

Closes euphoric-tickets-web#15.

### Notes
- Schema migration applies on the next deploy via the entrypoint's `drizzle-kit push --force` — non-nullable columns ship with safe defaults so existing rows fill in automatically.
- The role-ID inputs remain plain `<Input>`s until P3 lands the searchable Discord picker — at which point they'll swap to `<DiscordPicker kind="role" multi />`.
- No functional gating yet: P2 will make the bot reject button clicks for users outside `allow_role_ids` and use `staff_role_ids` for per-channel overwrites.

## [0.6.2] — 2026-05-29 — Discord deep links + SSR parallelization

### Added
- **"In Discord server <name>" + "Open in Discord" deep link on `/b/[slug]/tickets/[id]`** — uses `https://discord.com/channels/<guildId>/<channelId>` so staff/opener can jump straight into the actual ticket channel. The server name comes from `business.name`. Closes euphoric-tickets-web#13.
- **Per-row "Open in Discord" icon on `/b/[slug]/tickets`** — small external-link icon in a new rightmost column (lg+ screens) on the queue.

### Changed
- **`/b/[slug]/tickets/[id]` is now one `Promise.all`** instead of 5–7 sequential awaits. Opener, client business, assignee, staff list, message thread, sub-tickets, and parent ticket all run concurrently. Visible TTFB drop on the most-trafficked admin route.
- **`/b/[slug]/layout`** runs `requireSession` + `resolveBusinessAccess` concurrently.
- **`TopNav`** runs `listMyBusinesses` + `currentUserIsSudo` concurrently when signed in.
- **`listMyBusinesses` / `resolveBusinessAccess` / `currentUserIsSudo` wrapped in `React.cache`** — dedupes shared lookups between TopNav, the per-business layout, and the page below them within a single request. No correctness change; just one Postgres round-trip per request instead of two or three. Closes euphoric-tickets-web#14.

## [0.6.1] — 2026-05-29

### Added
- `ticket_panels` table moved into the shared web schema so the bot (which writes to it for `/panel post` + `/panel refresh`) can read/write on the consolidated DB after its A1+A2 rewire (euphoric-tickets v0.3.0). Columns: id, business_id (uuid nullable FK), guild_id (text), channel_id (text), message_id (text unique), posted_by_discord_id (text), created_at. The web doesn't surface this table yet — that's Phase C (euphoric-tickets#6).

## [0.6.0] — 2026-05-29

### Added — Phase G: Hosts and Clients (web#12)
Structurally distinguish two business kinds: **host** (vendor operating the ticket system, e.g. EuphoricFM, MKE) and **client** (visitor org coming in with members who open tickets, e.g. Echo Studios). Picked Shape A from the issue — single `businesses` table, `kind` column, `parent_business_id` for clients pointing at their host.

- **Schema**
  - `businesses.kind` (`'host'|'client'`, default `'host'`).
  - `businesses.parent_business_id` (uuid, nullable) — required when `kind='client'`.
  - `tickets.client_business_id` (uuid, nullable) — set on tickets opened on behalf of a client. Existing rows default to null and read as host-direct tickets.
- **`/admin`**
  - Create form now asks Kind first (Host / Client) and a Parent host dropdown that's required for clients.
  - "All businesses" listing split into Hosts + Clients sections; client cards show their parent host inline.
- **`/t/new`**
  - When the user submits from a client-kind business slug, the action transparently routes the ticket onto the client's parent host with `client_business_id` set. Categories + dedupe key + redirect all use the host context.
  - Same flow accepts an optional `asClientBusinessId` form field (for future "open on behalf of" UI on a host page); validated against the user's actual client memberships.
  - Discord post header annotates `(via client: …)` when applicable so staff sees the source org without clicking through.
- **Ticket detail** surfaces "For client &lt;X&gt;" linking to that client's slug.
- **`/b/[slug]/tickets` queue**
  - Host slugs filter by `business_id`; client slugs filter by `client_business_id`. Same page renders either way; the WHERE clause flips on `business.kind`.
  - Adds a Client column on host queues so staff can scan which incoming org owns each ticket.
- **`/clients` rollup** splits into a Hosts section and a Clients section, each with their own rollup query (`business_id` aggregation for hosts, `client_business_id` aggregation for clients).

### Migration
Existing data: every existing business is `kind='host'` with `parent_business_id=null`. Existing tickets are `client_business_id=null` and read as host-direct tickets. No backfill needed; drizzle-kit push at deploy adds the columns with their defaults.

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

`v0.6.35 · ddd0db5`
