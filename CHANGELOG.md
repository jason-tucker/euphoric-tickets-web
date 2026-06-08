# Changelog

## [0.8.6] — 2026-06-08 — Tickets console: filters live on the board

### Changed
- **The Tickets console toolbar is now part of the board, not floating above it.** Search, the team / Admin-view / assignee filters, the status-chip row, and the live result count moved *inside* the board's card as a pinned header above the grid — so the board owns its own filters. The grid scrolls beneath a header that stays put; nothing about what each filter does changed, and the team/category dropdowns still render in a portal so the card's clipping doesn't affect them.

## [0.8.5] — 2026-06-06 — "Admin view" is now a ticket-level toggle; staff detection fixed for admins

### Fixed
- **The dashboard "Team" tab was empty for admins/owners/sudo even on tickets they staff.** `listMyStaffCategoryIds` (which drives the Team tier) read the cached `business_members` role snapshot, and that snapshot is **empty for admins/owners/sudo** — their Discord roles are never fetched once Manage-Server/Administrator grants access. It now reads **live guild roles** (cached ~5 min), so your staffed categories resolve correctly and the Team tab shows their tickets. (The console's per-ticket scope is derived from the same fixed function.)

### Changed
- **The team filter's "Hide admin-only teams" toggle is replaced by a ticket-level "Admin view" toggle** in the console toolbar — this is what it should have been all along. **Off by default**, you see the console *as if you weren't an admin*: only tickets you **opened, were added to, or staff** (hold a staff role in the category). **Turn Admin view on** to additionally see every ticket in the teams you administer (the admin "fallback" access). Previously the toggle hid whole *teams*, which wrongly removed your staff tickets on a team where you were both admin and staff.
- The team multi-select now simply lists **all** your teams (each still tagged **Staff** / **Admin** by role); it no longer hides or filters teams itself — scope is the Admin-view toggle's job.

## [0.8.4] — 2026-06-06 — One header everywhere; Settings team switcher; Team Admin/Staff badges

### Changed
- **There's never more than one header now.** The per-team sub-nav (`BusinessNav` — the second row of Overview/Settings tabs under `/b/<slug>`) is removed; the single app-wide top bar is the only header. Tickets already live in the global `/tickets` console, and team settings carry their own switcher (below).
- **The Settings page has a team switcher at the top.** "Settings — &lt;team&gt;" is now a dropdown: pick which business/team you're editing without leaving the page (searchable; renders as plain text when you manage only one team). The standalone `/settings/teams` hub is gone — the header's **Settings** tab opens a team's settings directly, and `/settings/teams` redirects there.
- **Team Admin and Team Staff are now distinct, role-based badges in the team filter.** A team shows a **Staff** badge when you hold a real staff role in one of its categories and an **Admin** badge when you administer it — and **both** when both apply, so the two ways you reach a team are each first-class. (Staff remains the primary reason a team shows by default; admin-only teams still hide behind the toggle.)

## [0.8.3] — 2026-06-06 — Tickets console: detect staff teams from live Discord roles

### Fixed
- **A team you both administer and staff is now correctly tagged `staff` (and shown by default), not `admin` (hidden).** The `staff` tag means "you hold a real Discord staff role in one of this team's ticket categories" — staff is the *primary* reason for access; admin is the fallback for categories you'd otherwise never reach. Previously the staff check read the cached `business_members` role snapshot, which `resolveBusinessAccess` stores **empty** for admins and sudo users (it never fetches their roles). So every team an admin/owner could see was reported as having "no staff role," mislabeled `admin`, and auto-hidden behind the *Hide admin-only teams* toggle — even teams where they genuinely held a staff role. The console now resolves the viewer's **live guild roles** (`fetchGuildMemberRoles`, cached ~5 min per guild) and intersects them with each category's `staff_role_ids`, so the `staff`/`admin` tag and the default visibility are accurate for admins and bot-owners too.

## [0.8.2] — 2026-06-06 — Tickets console: invert the team-visibility toggle

### Changed
- **The team filter now shows every team you can see by default.** The bottom-right toggle is inverted: it's **"Hide admin-only teams," off by default**, and turning it **on** narrows the view to just the teams you staff (hiding the teams you only administer). Previously the default hid admin-only teams, so an owner/admin who holds no explicit category staff role saw an empty or near-empty console and had to enable a toggle to see their own teams — backwards. Off = everything; on = staffed-only. `?team=<slug>` deep-links to an admin-only team un-hide it as before.

## [0.8.1] — 2026-06-06 — Tickets console: per-column filters, staff-first teams, guild identities

### Added
- **Live per-column filter row** under the grid headers. Free-text columns (`#`, Subject, Opener, Assignee) filter **per character — no submit, no Enter**; the Category column is a **dynamic options dropdown** that lists exactly the values present in the data (with counts).
- **Staff-first team filter.** The console now defaults to showing only the teams you actually **staff**. The team-filter popover has a **toggle (bottom-right) to reveal admin-only teams** — teams you administer but hold no staff role in — **off by default**. Each team in the list is tagged `staff` or `admin`.
- **Team deep-links.** The "You administer" cards, the Teams page, and the (now-redirected) per-team queue all open the console **pre-filtered to that team** via `/tickets?team=<slug>`; the param is consumed and stripped so the view stays URL-free afterward (and an admin-only deep-link auto-reveals that team).

### Changed
- **Opener and assignee now show their Discord *server profile*** (per-guild nickname + server avatar) — matching what shows inside the ticket — instead of the global account name. Resolved through the cached guild-identity helper, falling back to the global profile when unavailable.
- **Opened / Last activity now track the conversation**, not the ticket row's bookkeeping columns: **Opened = first message timestamp, Last activity = last message timestamp** (falling back to the ticket columns when there are no messages). Fixes drift on ingested TicketTool tickets.
- **TicketTool tickets**: their channel-name `#` prefix is **stripped** from the Subject, and they show **"TicketTool"** in the Category column (and as a filterable category) instead of a blank.

### Removed
- **The per-team ticket queue (`/b/<slug>/tickets`)** — it now redirects to the console (`/tickets?team=<slug>`), and the per-team sub-nav drops its **Tickets** tab (Overview + Settings remain). The per-ticket detail view `/b/<slug>/tickets/<id>` is unchanged.
- **The Priority column** — `tickets.priority` has no configuration surface anywhere (every ticket is the `2`/"Normal" default), so it was noise.

## [0.8.0] — 2026-06-06 — Tickets console: a live cross-team data grid + one consolidated header

### Added
- **A brand-new cross-team Tickets console at `/tickets`** — a dense, ConnectWise-Manage-style data grid that replaces the old server-rendered queue. It's fully client-side and live, so once you're on the page there are **no navigations, no URL changes, and no spinners**:
  - **Every field is a sortable column** — `#`, Subject, Team, Category, Status, Priority, Opener, Assignee, Opened, and Last activity. Click any header to sort; click again to flip direction.
  - **A multi-team filter.** All your teams are always listed in one popover; tick any subset to narrow the grid to just those teams (no selection = all teams). This is what the old header team-dropdown used to do — now it's an in-grid filter you can combine with everything else.
  - **Status chips with live counts**, an **assignee filter** (Anyone / Mine / Unassigned), a **search** box (subject, opener, assignee, team, category, or `#id`), and a **row-density** toggle.
  - **Live updates with no loading state.** A global SSE nudge triggers a silent background refetch and swaps the data in place; a 20s poll and a tab-focus refetch cover any gap. A small "Live / Polling" indicator shows the stream state.
  - Your team/status/assignee/sort/density choices **persist to `localStorage`**, so a reload restores your view — without ever putting state in the URL.
- **`src/server/tickets.ts`** — one access-scoped query (admin teams + staffed categories + your own tickets) that powers both the first server render and the JSON feed, so they're always identical.
- **`/api/tickets/list`** (JSON snapshot) and **`/api/tickets/stream`** (a ticket-agnostic `ticket_activity` SSE nudge) back the live grid. Scope is re-resolved server-side on every refetch, so the generic nudge can never leak a ticket you shouldn't see.
- **A Settings hub at `/settings/teams`** for admins who manage more than one team.

### Changed
- **The header is now a single consolidated bar.** Brand · **Overview · Tickets · Settings** on the left (active tab highlighted via the new `MainNav`), with **Sudo · Help · account** on the right — everything in one row.
  - **Tickets** shows for admins and category staff; everyone keeps the personal **Overview** ("My tickets").
  - **Settings** smart-links: if you administer exactly one team it opens that team's settings directly; several teams open the new hub.
- Overview (`/dashboard`) and the per-team pages are unchanged.

### Removed
- **The header "switch view" team dropdown.** Team selection now lives in the Tickets console's multi-team filter, so the dropdown is gone — `business-switcher.tsx` is deleted and `TopNav` no longer takes an `activeBusinessSlug`.

## [0.7.6] — 2026-06-06 — My tickets: relabel to Mine › Team › Admin; admins get all three

### Changed
- **The "My tickets" toggle is now `Mine › Team › Admin`** — a disjoint "why can I see this ticket?" split where each ticket lands in exactly **one** tab:
  - **Mine** — you opened it or were added to it.
  - **Team** — you're not on it, but you hold a staff role in its category.
  - **Admin** — you're not on it and don't staff its category, but you administer the team.

  The Admin query now **subtracts the categories you personally staff** (keeping `NULL`-category tickets), so Team and Admin no longer double-count a ticket.
- **Admins always see all three toggles.** Before, the Team tab (formerly "Staff") only showed if you held a staff role in a team you were *merely a member* of — so a Manage-Server admin saw only User/Admin. Now admin implies the full `Mine / Team / Admin` set; the Team tab shows an explanatory empty state when you hold no staff role of your own.
- **Team categories are resolved from your real Discord guild list** (the OAuth `guilds` snapshot) instead of `listMyBusinesses` — which expands to *every* team for sudo users. This includes categories you staff inside teams you also administer, and bounds the live-role fallback to your own guild count.
- `?mode=` query values changed `staff` → `team`; `mine` is the default (no param).

## [0.7.5] — 2026-06-06 — Add a pull-request CI gate (typecheck + build)

### Added
- **`.github/workflows/ci.yml` — a `pull_request` check that runs `pnpm typecheck` then `pnpm build`.** Until now the only workflow (`deploy.yml`) ran on push to `main`, so PRs had no checks: a type error or a build break only surfaced post-merge, where it silently blocks every deploy. The new job reproduces the Dockerfile's build (placeholder `DATABASE_URL`, Node 24, pnpm from `packageManager`) so that breakage fails the PR instead — and gives branch protection a required status check to gate **auto-merge** on. Enabling "Allow auto-merge" + a `main` ruleset that requires the `Typecheck & build` check is a repo-settings step (done in the GitHub UI), not part of this change.

## [0.7.4] — 2026-06-06 — My tickets: a true Staff tier alongside User and Admin

### Added
- **A "Staff" view on `/dashboard`, distinct from Admin.** The My-tickets toggle now has three tiers instead of two:
  - **User** — tickets you opened or were added to (unchanged).
  - **Staff** — tickets you can reach *because of your team*: those in categories whose `staff_role_ids` intersect a Discord role you hold, across teams you're a *member* of (not an admin). This is the same staff tier `resolveTicketAccess` already grants on the ticket page, now surfaced as its own cross-team queue.
  - **Admin** — every ticket in a team you administer. This is what the old "Staff" toggle actually showed; it has been **renamed to Admin** to free up "Staff" for the role-based tier above.

  The three buckets are disjoint — Staff and Admin both exclude tickets you opened or were added to, so each ticket lands under exactly one tab. The toggle only offers tiers you actually have: a member who staffs a category sees **User · Staff**, a Manage-Server admin sees **User · Admin**, someone with both sees all three, and a plain end user sees no toggle at all.

### Changed
- **New `listMyStaffCategoryIds` in `src/server/permissions.ts`** resolves the categories you staff from the cached `business_members.discord_roles_snapshot`, falling back to a single live bot read per team that has staff-gated categories but no snapshot yet. It's `React.cache`-wrapped so the dashboard's tab-visibility check and the staff query share one resolution per request.

## [0.7.3] — 2026-06-06 — Fix: ship CHANGELOG.md in the Docker build context

### Fixed
- **The 0.7.2 build failed** with `Module not found: Can't resolve '../../../CHANGELOG.md'`. `.dockerignore` excludes `*.md`, so `CHANGELOG.md` wasn't in the `COPY . .` build context and the changelog dialog's `asset/source` import couldn't resolve inside the builder. Added `!CHANGELOG.md` to keep just that file in context (other docs stay excluded). No prod impact — the failed build never produced an image, so the site stayed on 0.7.1.

## [0.7.2] — 2026-06-06 — Footer version opens the changelog

### Added
- **The footer version is now a button that pops up the changelog.** Clicking `v<x.y.z>` opens a dialog rendering `CHANGELOG.md`. The file is inlined into the bundle at build time (an `asset/source` webpack rule in `next.config.ts` + a `*.md` type declaration), so it ships in the standalone Docker image without a runtime file read. A small built-in Markdown renderer handles the headings / lists / inline formatting we use — no new dependency.

## [0.7.1] — 2026-06-06 — Show the app version in a site footer

### Added
- **Site footer with the running version.** A slim, full-width footer (`SiteFooter`) now renders on every page showing `Euphoric Tickets v<x.y.z>`. The semver is read from `package.json` at build time and injected as `NEXT_PUBLIC_APP_VERSION` via `next.config.ts`, so it stays in sync with releases automatically. The root layout is now a flex column so the footer pins to the bottom of the viewport on short pages.

### Changed
- **`NEXT_PUBLIC_APP_VERSION` is now actually populated** (it was only referenced as the `/api/version` fallback before). The deploy-detection build id is unchanged — the footer shows the human semver, the version-watcher still keys off the Next `BUILD_ID`.

## [0.7.0] — 2026-06-05 — Drop the host/client distinction — every tenant is just a Team

### Removed
- **The host/client team distinction is gone.** `businesses.kind` (`host`/`client`), `businesses.parent_business_id`, and `tickets.client_business_id` are dropped from the schema — `drizzle-kit push --force` removes the columns on next deploy. Every tenant is now simply a **Team**.
  - `/admin` create-team form loses the **Kind** and **Parent team** selectors; the page lists one flat **Teams** section (no more "Clients").
  - The ticket queue (`/b/<slug>/tickets`) loses the **Client** column and the client filter — a team's queue is always the tickets it operates (`business_id`).
  - `/t/new` no longer routes a submission to a "parent host" or tags a `client_business_id`.
  - The ticket detail page no longer shows a "For client …" line.
- **The per-team "terminology" toggle is gone.** `businesses.terminology` (`business`/`client`) and `src/lib/terminology.ts` are removed; the UI always says **Team**. The Terminology selector is dropped from team settings.
- **Route rename:** the all-teams rollup moved from `/clients` to **`/teams`** (nav label "All teams"); `middleware.ts` updated to match.

### Paired with
- **Bot 0.7.0** — mirrors the schema drop (`kind` / `parent_business_id` / `client_business_id` / `terminology`) and removes the host/client options from `/admin business create` + `list`; auto-provisioning just inserts a team row.

## [0.6.56] — 2026-06-05 — Manage Server unlocks per-guild admin + a bot-owner Sudo dashboard (pairs with bot 0.6.0)

### Added
- **Bot-owner "Sudo" controls on the Bot dashboard** (`/admin/bot`, sudo-only). Two new controls:
  - **Bot name** — persists to the new `app_settings` store and pushes the bot's global Discord username via the bot's internal endpoint. The name is saved even when Discord rejects the push (it rate-limits username changes to ≈2/hour); the page shows that as a warning so the next save reapplies it.
  - **Servers** — lists every guild the bot is in (via the bot token, `fetchBotGuilds`), maps each to its team(s), and offers a confirm-gated **Force leave** that asks the bot to leave (team rows stay in the DB).
- **`app_settings` table** — a flat key/value store for bot-owner global settings; created by the entrypoint's `drizzle-kit push`. Accessors in `src/server/appSettings.ts`; the web→bot control bridge is `src/server/botControl.ts` (same `BOT_INTERNAL_URL` + `INTERNAL_TOKEN` transport as the TicketTool/DM bridges).
- **Nav: the sudo area is now labelled "Sudo"** (it was "Admin") to match the model — **Admin** = per-guild admin (each team's own pages, now reachable by Manage Server holders), **Sudo** = bot-owner global controls.

### Changed
- **Discord's Manage Server permission now grants per-guild admin.** `deriveLevel` (the cheap dashboard path) and `resolveBusinessAccess` (the protected-route resolver) previously treated only **ADMINISTRATOR** as `owner` and everyone else as `member` until a role-level check. They now also read the **MANAGE_GUILD** bit (`1 << 5 = 32`) from the OAuth guild snapshot and resolve those users to `admin` — unlocking `/b/<slug>` settings, the ticket queue, and reply/claim/close. ADMINISTRATOR (and the guild owner, whose snapshot carries the bit) still resolve to `owner`. The existing "Ticket Master" role check (`business.admin_role_ids`, fetched via the bot token) is unchanged and is now short-circuited when Manage Server already granted admin, saving a Discord round-trip per gated page view.

### Paired with
- **Bot 0.6.0** — auto-provisions a `host` team row for any guild it joins (so every server a user shares with the bot appears in the unified dashboard, with no manual setup), applies the same Manage Server / Ticket Master gate to panels + settings on the Discord side, and serves the two internal endpoints behind the Sudo dashboard (`/api/internal/bot/username`, `/api/internal/guild/leave`).

## [0.6.55] — 2026-06-05 — Reopen recreates a deleted channel + replays the convo (and adopts TicketTool tickets whose channel is gone)

### Added
- **Reopen now spins up a fresh Discord channel when the old one is gone.** Previously `reopenTicket` only flipped the DB status; if the channel had been hard-deleted (admin Delete button, or — for TicketTool tickets — TicketTool deleted it), the ticket came back online with nowhere to talk. Now reopen detects `discordChannelId IS NULL` and creates a new private channel under the ticket's category (per-category Discord parent → business fallback), mints a per-ticket webhook, posts a green header embed (subject / opener / opened / previously-closed / reopened-by), and replays the **last 20 user-facing messages** as silent (`SUPPRESS_NOTIFICATIONS`) user-spoofed webhook posts with the original author's nickname + avatar and the original timestamp prefixed. Internal staff notes are NEVER replayed (they'd leak to the opener). Posts are paced 500 ms apart to stay well under the per-webhook rate budget; the whole replay runs in ~10–12 s.
- **TicketTool tickets become reopen-able once TicketTool deletes the channel.** Before this, `canReopen` was hard-blocked for any `externalSource='tickettool'` row, so a TicketTool ticket whose channel was deleted was a dead-end on the web. Now the Reopen button shows when the ticket is closed AND the channel is gone, AND choosing it **promotes the ticket to native** (`externalSource: 'euphoric'`) — TicketTool no longer owns the lifecycle because there's no TicketTool channel left to own. The ingested transcript and `externalTranscriptUrl` are preserved; only the source flag changes so the native lifecycle controls (Claim, Close, Move, Rename) light up on the next render. Reopen is still blocked for TicketTool tickets whose channel **still exists** — those should be reopened via `$reopen` from inside the channel.

### Changed
- **For native tickets that were closed (channel still archived under the closed category), reopen now moves the channel back.** New `unarchiveTicketChannel` helper strips the `closed-` prefix and moves the channel back to the original parent (per-category override → business fallback). No replay in this path — the in-channel history is already intact.
- **`postWebhook` now takes an optional `silent: true` flag** that sets Discord's `SUPPRESS_NOTIFICATIONS` (`1 << 12`) flag. Used by the reopen replay; existing webhook callers are unchanged.
- **The "Discord channel has been deleted" hint on closed tickets now reads "Reopen to spin up a fresh channel" / "(which promotes this to a native ticket)" for the TicketTool case**, so staff aren't left guessing what the button will do.
- **Help page** "Close / reopen" line and "A ticket says its channel went missing" FAQ updated to describe the new replay-and-recreate path.

### Paired with
- **Bot 0.5.36** (already on `main`, image on GHCR) — `closeShadowTicket` now clears `discord_channel_id` (and the webhook fields) and writes a `channel_deleted` audit row when a TicketTool channel is deleted. Without that pair, the new web reopen path can't fire for TicketTool tickets ingested before 0.5.36 (stale channelId would still appear "alive" to the web).

### Notes
- Originally landed on PR #62 at v0.6.51; closed and re-cut as #67 at v0.6.54; rebased again to v0.6.55 after PR #66 (dockerignore chore) took the 0.6.54 slot on `main`.

## [0.6.54] — 2026-06-05 — Chore: add .dockerignore so a host .env can't be baked into the image

### Changed
- **Added `.dockerignore`.** The repo had none, and the Dockerfile does `COPY . .`. CI builds from a clean git checkout (where `.env` is gitignored and absent), so it was safe there — but a local `docker compose build` on the VPS would have copied the host `.env` (secrets) into the image. The new `.dockerignore` excludes `.env`/`.env.*`, `.git`, `.github`, `node_modules`, `.next`, build cruft, compose/ops files, and docs, while keeping everything the build needs (`package.json`, `pnpm-lock.yaml`, `src/`, `public/`, `scripts/`, `drizzle.docker.config.cjs`, the config files). Verified with a full `docker build` (exit 0) and confirmed the resulting image contains no `/app/.env`.

## [0.6.53] — 2026-06-05 — Fix: login works on both tickets.euphoric.fm and tickets.euphoric.gg

### Fixed
- **OAuth login was hard-pinned to a single domain, breaking the new `.gg` host.** With a fixed `AUTH_URL=https://tickets.euphoric.fm`, a login *begun* on `tickets.euphoric.gg` set its PKCE/state cookies on `.gg` but was bounced to the `.fm` callback (which can't read `.gg` cookies) → `InvalidCheck: pkceCodeVerifier value could not be parsed` → the generic "There is a problem with the server configuration" error page. Root cause: next-auth v5 derives the OAuth `redirect_uri` from `request.url`, which the Next.js standalone server pins to the container bind address (`0.0.0.0:3000`); `AUTH_URL` was the only thing rewriting it, and it can hold just one domain.
- **Fix:** the Auth route handler ([`src/app/api/auth/[...nextauth]/route.ts`](src/app/api/auth/[...nextauth]/route.ts)) now reconstructs `request.url` per-request from the proxy's `X-Forwarded-Host` (falling back to `Host`) and `X-Forwarded-Proto` — the same thing `reqWithEnvURL` does for `AUTH_URL`, but per-request — so `redirect_uri`, the PKCE/state cookies, and the callback all stay on whichever domain the user actually used. The authority is composed as a string to avoid the WHATWG `URL.host` setter leaking the internal `:3000` port. When `AUTH_URL` is set (local dev) the rewrite is skipped. **Ops:** `AUTH_URL` must be **unset** in the production `.env` for this to engage, and **both** callback URLs (`https://tickets.euphoric.fm/api/auth/callback/discord` and `https://tickets.euphoric.gg/api/auth/callback/discord`) must be registered on the Discord application.

## [0.6.52] — 2026-06-05 — Docs: restructure README to the shared two-repo structure

### Changed
- **README restructured to the shared section order** used by the sibling bot
  ([`euphoric-tickets`](https://github.com/jason-tucker/euphoric-tickets)):
  Overview → Architecture → Stack → Quick start → Configuration → Usage →
  Deployment → Conventions. Existing content (routes table, permission model,
  feature tour, env table, scaling/backups) was kept and reorganized, with the
  data model, the per-user webhook-spoof anti-pattern, and the iframe-safe /
  no-Cloudflare-proxy constraints called out explicitly. Verified against source
  (`src/server/permissions.ts`, `src/db/schema/*`, `src/lib/discord.ts`).
- **Fixed the stale README footer** (was `v0.6.22`) to track the
  version-from-`package.json` convention.

Docs only — no runtime change.

## [0.6.51] — 2026-06-05 — Full mobile optimization for the phone-width CEF iframe

### Changed
- **Responsive card padding.** `Card` content/header/footer now use `p-4` on phones and `sm:p-6` on larger screens, reclaiming ~16px of width on each side at 360px without changing the desktop look. The table cards that render flush (`p-0`) and the compact stat cards were pinned (`p-0 sm:p-0` / `py-4 sm:py-4`) so they stay correct on desktop.
- **Tighter mobile gutters.** The `.container` gutter steps down to `0.875rem` below `sm` (and the existing `0.75rem` under 380px), so content isn't double-padded by the container *and* the cards on a narrow iframe.
- **Top nav no longer crowds on mobile.** The standalone **Admin** link (sudo only) is hidden below `sm` — it's already in the profile dropdown — so the logo, business switcher, Help, and avatar fit a 360px bar without overflow.
- **Board search rows wrap.** The subject-search input on `/tickets` and `/b/[slug]/tickets` now flexes to fill the row and wraps the Apply/Clear controls below it on narrow screens instead of squeezing into one line.

### Fixed
- **No more horizontal overflow from menus/popovers on a phone.** Dropdown menus are capped at `max-w-[calc(100vw-1rem)]`, the default popover width is now `min(18rem, 100vw-1.5rem)`, and dialogs get a `2rem` viewport gutter, full rounding, and a scrollable `max-h` so they never exceed the screen. Long unbreakable tokens (Discord IDs, webhook URLs, inline `code`) wrap instead of forcing a horizontal scrollbar.
- **Ticket-detail rename control wraps** its input + button on very narrow widths instead of overflowing the action row.

## [0.6.50] — 2026-06-05 — Dashboard: closed tickets hidden by default + Show closed toggle

### Changed
- **`/dashboard` now hides closed tickets by default in both User and Staff modes**, with a new **Show closed / Hide closed** toggle next to the User/Staff switch. Default-off keeps the "My tickets" list focused on what still needs attention; toggling adds `?closed=1` to the URL and the same filter relaxes in whichever mode you're in. The other boards (`/tickets`, `/b/[slug]/tickets`) already defaulted to Active via the status FilterBar — this brings the personal dashboard in line.

## [0.6.49] — 2026-06-02 — Native-ticket parity: web Rename + colored status_changed events

### Added
- **Rename works on native tickets from the web.** Previously only TicketTool tickets had a web Rename; native tickets could only be renamed via `/tickets rename` in Discord. New `renameTicket` server action (staff+) updates the subject and renames the Discord channel to `ticket-<id>-<slug>` (mirrors the bot), posts a status footer, and writes a `renamed` audit. The header Rename control now shows for both native and TicketTool tickets and routes to the right action; `renameDiscordChannel` added to the Discord lib.

### Changed
- **`status_changed` events are now colored** like close/open, so native status changes read at a glance: closed = red, completed/open = green, in_progress = blue, waiting/on_hold = amber. `eventTone` now takes the event metadata and tints by the target status. (Native tickets already shared the colored close/open events, two-column layout, in-server name resolution, and People+roles — this closes the last visible gaps so non-TicketTool tickets match.)

### Added
- **Two-column ticket layout on wide (16:9) screens.** The ticket detail page widens to `max-w-6xl` at `lg` and splits into a grid: **chat + reply on the right**, **People · internal notes · Log on the left**. The conversation stays first in the DOM so phones/the embedded CEF iframe still lead with the chat in a single column.

### Changed
- **Close/open status events are colored.** The inline status dividers in the conversation are now tinted by action — **closed / channel-deleted = red**, **opened / reopened = green** — so a TicketTool (or native) close/reopen reads at a glance. Driven by the `closed`/`reopened` audit rows the bot writes (see bot 0.5.30).
- **Add/remove/owner events resolve the target's in-server name.** `member_added` / `member_removed` / `owner_changed` lines used to show a raw Discord ID when no name was stored; they now resolve the user's **server nickname** via the same per-guild identity resolver (their IDs are added to the resolve set), falling back to the stored name, then the ID. External (not-in-guild) members keep the "(external)" tag.

## [0.6.47] — 2026-06-02 — Fix: external users (not in a guild with the bot) now see their tickets on /dashboard

### Fixed
- **"My tickets" was gated by guild membership, hiding tickets from external users.** The dashboard query was wrapped in `if (businessIds.length > 0)` and filtered `tickets.businessId IN (my guilds)`, where `businessIds` came from `listMyBusinesses()` (teams whose Discord you're in). An external user — added to a ticket (or the ingested opener of a TicketTool ticket) but **not in that server** — has no businesses, so the query never ran and they saw nothing. The user-mode query is now scoped purely to `openerUserId = me OR ticket_external_members.userId = me`, with **no** guild-membership filter, so it works for users in zero guilds. Per-ticket access is still re-checked on the detail page (soft auth). The staff "residual" view still scopes to the teams you administer. `session.user.id` resolves to the `users` row keyed by Discord ID (Auth.js upsert on `discordId`), so the external user's id matches the `ticket_external_members` / opener rows the bot wrote. The "No teams yet" card now only shows when you also have no tickets.

## [0.6.46] — 2026-06-02 — Back-grab open TicketTool tickets when categories are linked (paired with bot 0.5.27)

### Added
- **Linking a TicketTool category now back-grabs already-open tickets immediately.** Previously, existing open TicketTool tickets under a newly-watched category were only ingested on the next bot restart (or when someone next posted in them). Now, saving the settings form (when the team is in TicketTool mode with categories set) calls a new bot endpoint `POST /api/internal/tickettool/reconcile` (auth `INTERNAL_TOKEN`, via `reconcileTicketTool(businessId)`), which scans those categories and ingests every existing channel right away. Best-effort — silently skipped if the bot is unreachable.

## [0.6.45] — 2026-06-02 — Per-team ticket mode + TicketTool People roles + no duplicate status (paired with bot 0.5.26)

### Added
- **Per-team ticket mode** (`businesses.ticket_mode`, `'euphoric'` default / `'tickettool'`). A team set to **TicketTool** mode no longer opens euphoric's own tickets — the web `/t/new` flow hides those teams and `openTicketAction` refuses them (with a "open it in TicketTool" message); euphoric only ingests + controls TicketTool's tickets there. Toggle lives in the new **Ticket system** select on `/b/[slug]/settings`. drizzle-kit push adds the column (existing teams default to `'euphoric'`).
- **People panel shows roles too.** The ticket People card now lists both the members AND the **roles** with access, read live off the Discord channel's permission overwrites (`fetchChannelOverwrites` + `fetchGuildRoles`), with `@everyone` filtered out. Matters most for TicketTool tickets, where access is usually granted by role.

### Changed
- **No duplicate status lines on TicketTool tickets.** When euphoric drives a TicketTool ticket from the web (add / remove / rename / request-close), it no longer writes its own audit/status — TicketTool posts its own log message (it has its own logging settings), which we ingest. Removes the double "Tucker added X" + "X was added" the web conversation showed. Add/remove still keep a quiet `ticket_external_members` row so `/dashboard` reflects membership, but emit no euphoric status.
- Internal notes on a TicketTool ticket now flow through TicketTool's own private notes thread (see bot 0.5.26) instead of euphoric creating a second thread.

## [0.6.44] — 2026-06-01 — TicketTool coexistence: ingest + control third-party TicketTool tickets (paired with bot 0.5.25)

### Added
- **TicketTool coexistence (web side).** When a server also runs the third-party TicketTool bot, Euphoric Tickets now ingests TicketTool's tickets into the shared archive and lets staff control them from the web. Schema: `tickets.external_source` (`'euphoric'` default / `'tickettool'`) + `tickets.external_transcript_url`, and `businesses.ticket_tool_category_ids` (CSV of watched GUILD_CATEGORY snowflakes — empty = feature off) + `businesses.ticket_tool_prefix` (default `$`). New `tickets_external_source_idx`. drizzle-kit push at deploy adds the columns; existing rows backfill to `'euphoric'`.
- **Settings → TicketTool coexistence card** (`/b/[slug]/settings`, admin-gated): a multi-category picker (`ticketToolCategoryIds`), a prefix input (`ticketToolPrefix`), and one-time-setup instructions showing this bot's user ID to whitelist in TicketTool's Server Configs → Bot.
- **Ticket-detail control of TicketTool tickets.** A `TicketTool` origin badge; **Rename**, **Add**/**Remove** people, and **Request close** route to TicketTool's `$rename` / `$add` / `$remove` / `$closeRequest` commands via the bot's internal HTTP bridge (`emitTicketToolCommand` → `POST /api/internal/tickettool/command`, auth `INTERNAL_TOKEN`). Replies still post via the per-ticket webhook (minted by the bot at ingest), so two-way replies work unchanged. Native hard Close / Delete / Move-category / Claim / Status are hidden and their actions guarded so euphoric never mutates a TicketTool-owned channel.
- **Help page** gains a "TicketTool coexistence" section (setup, ingest, two-way replies, control set, the whitelist gotcha).

## [0.6.43] — 2026-05-30 — Fix: 0.6.42 CI failed on renderAuditLine gName return-type mismatch

### Fixed
- **0.6.42 CI failed `next build` type-check.** `renderAuditLine`'s `gName` parameter was typed `... => string | null`, but the actual `gName` in `page.tsx` returns `string | null | undefined` (because its `fallback` parameter is itself `string | null | undefined`). Widened the helper's signature to match. No runtime change vs 0.6.42 — that commit just never produced an image.

## [0.6.42] — 2026-05-30 — Lifecycle audit log: chronological status events in the conversation + Log card

### Added
- **New `audit_logs` table** (`(business_id, ticket_id, actor_user_id, action, metadata jsonb, created_at)`). Captures every lifecycle event — `opened`, `claimed`, `unclaimed`, `status_changed`, `assigned`, `unassigned`, `category_changed`, `member_added`, `member_removed`, `owner_changed`, `closed`, `reopened`, `channel_deleted`, `renamed` — written by both the web (server actions) and the bot (panel-button opens, claim button, /tickets close, etc.). Distinct from `ticket_messages` so chat and lifecycle events can render independently without one fighting the other. Indexes on `(ticket_id, created_at)` for the hot path and `(business_id, created_at)` for a future audit-tail view. drizzle-kit push at the next bot deploy creates the table.
- **`writeAudit(...)` helper** in `src/server/audit.ts` (web) and `src/services/audit.ts` (bot mirror). Best-effort — never throws; a failed audit insert can't block the action it was tracking, same pattern as the existing notify/post-status calls.
- **Audit writes wired into every state-changing server action** on the web: `/t/new` openTicketAction → `opened`; `setTicketStatus` → `status_changed {from, to}`; `claimTicket` → `claimed`; `unclaimTicket` → `unclaimed`; `assignTicket` → `assigned {assigneeUserId, assigneeMention}` / `unassigned`; `closeTicket` → `closed`; `reopenTicket` → `reopened`; `changeTicketCategory` → `category_changed {fromCategoryId, toCategoryId, toCategoryLabel}`; `addTicketMember` → `member_added {discordUserId, name, isExternal}` (both in-guild and external branches); `removeTicketMember` → `member_removed {discordUserId, name}`; `setTicketOwner` → `owner_changed {discordUserId, name}`; `deleteTicketChannel` → `channel_deleted`. Reply / internal-note actions deliberately skipped — those are chat, not lifecycle.
- **Status events render inline in the conversation feed**, chronologically interleaved with chat messages. New `mergeConversation()` helper merges `ticket_messages` and `audit_logs` by `created_at` (ties resolved messages-before-events so the audit row written a hair after an action doesn't reorder). Event rows show as a compact centered "—— Tucker claimed the ticket · 3m ago ——" line with a horizontal divider, matching the Discord "joined the channel" pattern.
- **"Log" button at the top of the Conversation card** appears when any audit rows exist; clicking jumps to a new **Log** card below the conversation that lists every lifecycle event in order, each with the wall-clock timestamp and an actor-named sentence ("Tucker claimed the ticket", "Bob set status to Completed", etc.). `renderAuditLine()` handles per-action wording; falls back to a generic phrase for unknown actions so future verbs render without a code change. Actor identity uses the same per-guild nickname/avatar resolver the conversation does, so the Log respects server nicknames.
- Audit rows are forward-only — old tickets (pre-0.6.42) have no audit history. The bot's `-#` status footers in Discord remain the historical record for those, and the Log card simply hides when empty.

## [0.6.41] — 2026-05-30 — Opener + client checkbox filters on the board views

### Added
- **Opener and client checkbox filters on both ticket boards.** Both `/tickets` (all I can see) and `/b/[slug]/tickets` (per-team queue) gain a `<details>` panel below the subject search labelled "Filters". Expanded shows a row of opener checkboxes (every distinct opener from the board's overall scope, regardless of currently-active filter selections — so checkboxes don't disappear as you pick them) and, on the per-team queue, a row of client checkboxes (every distinct `clientBusinessId` in the team's tickets). Submitting reloads with repeated `?openers=…&openers=…` (and `?clients=…&clients=…` on team queues); both array and comma-separated string shapes are accepted server-side. Hand-typed URLs with `?openers=uuid1,uuid2` still work. `hp` carries the selections through to SortHeader so column sorts preserve filter state. The details element starts open when any filter is active; the summary shows an "(N active)" badge so you don't lose track of off-screen selections. UUID-validation drops anything that isn't a real id. Clients filter on `/tickets` is intentionally skipped — the all-tickets board doesn't surface clients today.

## [0.6.40] — 2026-05-30 — Board subject search

### Added
- **Subject search field on both ticket boards.** `/tickets` (all I can see) and `/b/[slug]/tickets` (per-team queue) gain a small `<input type="search">` above the status FilterBar. Submitting reloads the page with `?q=…`, the SQL adds `ILIKE %q%` against `tickets.subject`, and the query stays scoped to whatever status/sort/dir were already active (the form forwards them via hidden inputs, and `hp` now carries `q` through to SortHeader so column-sorts keep the search). A small **Clear** link next to the input drops `?q=` without nuking the other filters. Opener / client checkbox filters land separately in the next patch.

## [0.6.39] — 2026-05-30 — My-tickets dashboard surfaces tickets you were added to + User/Staff filter for staff + external-user reply bug

### Added
- **`/dashboard` now shows tickets you were *added to*, not just ones you opened.** Query was `tickets WHERE opener = me`; now it's `tickets WHERE opener = me OR id IN (SELECT ticket_id FROM ticket_external_members WHERE user_id = me)`. Externals were already getting rows there at add time (P16); in-guild adds now write one too (see Fixed). Bumped the limit from 20 → 50 since the list grows once memberships count.
- **User / Staff toggle on `/dashboard` for staff and admins.** Default view ("User") shows tickets you opened or were explicitly added to — the personally-relevant set. Staff/admins get a second toggle ("Staff") that swaps the list to *tickets in admin businesses you are NOT personally on* — the residual "I can see it because I'm staff" queue. Toggle is hidden entirely for non-staff users (it would be a no-op). URL state via `?mode=staff`; the empty-state copy and the page subtitle update with the toggle.

### Fixed
- **External users can finally send replies — server actions were redirecting them mid-submit.** `loadTicketAccess` (the shared loader behind `replyToTicket`, `claimTicket`, etc.) called `requireBusinessAccess(slug, 'member')`, which hard-redirects to `/dashboard` for any user not in the guild. External members (added via DM-link / P16) fell into that branch every time, so clicking **Send reply** bounced them to the dashboard and the reply never landed. Rewrote `loadTicketAccess` to use soft auth (mirroring the ticket detail page itself): load the business directly, fall back to `level='member'` when the user has no guild access, compute `resolveTicketAccess`, and short-circuit on `!flags.canSee`. External users with a `ticket_external_members` row now get `canReply` and reply correctly; everyone else is unaffected.
- **In-guild "Add to ticket" now writes a `ticket_external_members` row alongside the channel overwrite.** Without this, in-guild members added via the People card showed up in the channel but never appeared on their own `/dashboard` — `canSee` worked (via business role), but the dashboard query couldn't find them because there was no DB-queryable signal. Now both branches of `addTicketMember` produce a row; `removeTicketMember` (already updated in 0.6.37) deletes it on the way out. The row is informational for in-guild adds since their `canSee` is already covered by guild role; for externals it's still the authoritative grant.

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

`v0.8.6 · 7f8b246`
