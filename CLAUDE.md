# euphoric-tickets-web — AI Coding Instructions

See `/home/botuser/projects/claude-all.md` for VPS constraints (no `tsc` on the VPS — CI builds), CI/CD via GHCR + watchtower, and Discord patterns.

---

## Agent usage

Always spawn agents to do work. Haiku for lookups. Sonnet for coding. Opus for planning.

Use agents proactively — delegation is the default, not a fallback. Match the model to the task:

- **Haiku** — file discovery, repository searches, quick lookups, lightweight analysis, and simple verification.
- **Sonnet** — coding, implementation, refactoring, debugging, writing tests, editing documentation, and normal technical work.
- **Opus** — architecture, complex planning, cross-repository strategy, high-risk changes, difficult debugging strategy, and final reconciliation.

How to delegate well:

- Run independent work in parallel; serialize only when there is a real dependency.
- Give every delegated task a precise scope and a concrete expected output.
- Require every agent to cite the paths, symbols, commands, or repository evidence behind its conclusions.
- Demand actionable results, not generic summaries.
- Never let two agents edit the same file at once — assign explicit file ownership and coordinate overlaps through the orchestrator.
- Resolve conflicting recommendations with repository evidence, not preference.
- Validate every agent's output before accepting it; re-run or re-scope on doubt.
- Use agents to improve speed or quality — not to create pointless duplication.
- The orchestrator reviews all delegated work and remains responsible for final correctness.

Never run `pnpm build`, `next build`, or `pnpm typecheck` on the VPS — they OOM the box; run them locally or in CI. Before completing a code task run `pnpm lint && pnpm typecheck && pnpm test` locally and report failures rather than suppressing them.

---

## Mandatory rules

### 1. Always update `CHANGELOG.md`
Real semver heading (never `[Unreleased]`), bumped in the same commit as the change. Footer: `v<x.y.z> · <sha>`.

### 2. Project board card per PR
Project board **#10 — euphoric-tickets-web**. Add an item before opening the PR.

### 3. `drizzle-kit push` — no SQL migration files
Schema lives in `src/db/schema/*.ts`. Container entrypoint runs `drizzle-kit push --force` against the schema. `src/db/migrations/` is in `.gitignore`.

### 4. Iframe-safe
This site is embedded in the EuphoricFM in-game phone CEF iframe (same constraint as `euphoricfm-website`). Don't `window.top` break-out, don't set `X-Frame-Options`, keep responsive down to ~360px wide.

### 5. Web → Discord goes via per-user webhook spoof
When staff replies in the web UI, we POST to the business's configured Discord webhook URL with `username` overridden to the staff member's Discord global name and `avatar_url` overridden to their avatar URL. Never post to Discord as the bot itself from the web layer — that's the bot's job.

### 6. Keep `/demo` in parity (read-only against the real system)
`/demo/*` is a public, unauthenticated, fully-interactive mirror of the whole app on synthetic data. It is interactive, but **every change is saved only in the visitor's browser (localStorage)** and never touches the DB or Discord. When you add or change a screen/control, mirror it in `/demo` as an overlay-backed version. `src/app/demo/**`, `src/server/demo/**`, and `src/components/demo/**` must **never** import `@/db/client` or any `actions.ts`, and define no `'use server'` actions. See `src/app/demo/CLAUDE.md`.

---

## What this app does

A web frontend for the `euphoric-tickets` Discord bot. Multi-tenant: any Discord-using business can have a `business` row that points to its guild ID. End users open tickets either in Discord (panel button → bot creates channel) or here (form → server action creates DB row + posts the opener's first message via the webhook).

### Auth + permissions

- Auth.js v5 with the Discord provider; JWT session.
- On login Discord returns the user's `guilds` array; we store the snapshot on the session and resolve per-business permissions from `business.discord_guild_id`.
- For each business the user is "in" (their Discord guilds intersect), we resolve a level:
  - Discord **ADMINISTRATOR** (or the guild owner) → `owner`
  - Discord **Manage Server** (`MANAGE_GUILD`, bit `1 << 5`) → `admin`
  - A "Ticket Master" role — member roles in that guild ∩ `business.admin_role_ids` → `admin`
  - Otherwise → `member` (can only see their own tickets in that business)
- Permission resolution lives in `src/server/permissions.ts` — every protected route/server action calls `requireBusinessAccess(slug, level)`. The Manage-Server / owner bits come straight from the OAuth guild snapshot; the role-level Ticket Master check needs the bot token and runs only in `resolveBusinessAccess`.
- **Businesses are auto-provisioned by the bot.** The `euphoric-tickets` bot creates a business row (a team) for any guild it joins (and backfills existing guilds on startup), so a guild generally has a row by the time anyone logs in here. The web's `/admin` create form is still there for manual/edge cases.

### Multi-business

A user can belong to several businesses. The top-nav has a business switcher. URLs are scoped to `/b/<slug>/...`. Admin and end-user views live side-by-side; admin role is what unlocks `/b/<slug>/tickets` and `/b/<slug>/settings`. End users always hit `/dashboard` for the cross-business "my tickets" view.

**Admin vs Sudo.** Per-guild **admin** (Manage Server / Administrator / a Ticket Master role) manages a single team via its own `/b/<slug>` pages. Bot-owner **sudo** (the `users.is_sudo` flag) gets the `/admin/*` "Sudo" area — team CRUD (`/admin`), the bot dashboard with **bot name** + **force-leave server** controls (`/admin/bot`), and bot errors (`/admin/errors`). The nav surfaces this as a **Sudo** tab.

---

## Routes

| Route | Who | Notes |
|---|---|---|
| `/login` | Anonymous | One-button Discord OAuth |
| `/dashboard` | Any user | My tickets across all businesses + business cards |
| `/tickets` | Staff / Admin | Unified cross-team console — sortable, filterable; the primary queue view |
| `/t/new` | Any user | Open a ticket (pick business + category + subject + body) |
| `/t/[id]` | Opener | Convenience redirect — resolves the ticket's business and forwards to `/b/<slug>/tickets/<id>` (`src/app/t/[id]/page.tsx` renders nothing) |
| `/b/[slug]` | Admin | Business overview: open ticket counts, recent activity |
| `/b/[slug]/tickets` | Admin | **Redirects** to `/tickets?team=<slug>` — the per-team filter of the unified console |
| `/b/[slug]/tickets/[id]` | Admin / Staff | Reply, claim, close from this view; mirrors the bot's controls |
| `/b/[slug]/settings` | Admin | Webhook URL, admin role IDs, category list |
| `/settings/notifications` | Any user | ntfy / Discord DM notification preferences |
| `/help` | Any user | Help and feature explainer page |
| `/admin` | Sudo | Team CRUD (create / list) |
| `/admin/bot` | Sudo | Bot health dashboard + bot name |
| `/admin/errors` | Sudo | Persistent bot error log |
| `/demo/*` | Anonymous | Public, interactive, read-only-against-the-system mirror of the whole app on synthetic data; all edits persist in the visitor's browser only (never DB/Discord). 4 personas via the `demo_persona` cookie |
| `/api/auth/[...nextauth]` | — | Auth.js handler |

Server actions live alongside their pages (`actions.ts` next to `page.tsx`).

---

## Database schema

| Table | Purpose |
|---|---|
| `users` | Auth.js user — id, discordId, name, email, image; `isSudo` flag drives the sudo tier |
| `businesses` | Tenant — slug, name, discordGuildId, webhookUrl, settings JSON |
| `business_members` | userId × businessId × role (`member` / `admin` / `owner`) — cached from Discord at login, refreshed on each session refresh |
| `ticket_categories` | businessId × key × label × emoji × description — drives the open-ticket form's category picker |
| `tickets` | businessId × openerId × categoryId × subject × status × assigneeId × openedAt × closedAt × lastActivityAt |
| `ticket_messages` | ticketId × authorId × body × source (`web` / `discord` / `system` / `internal`) × discordMessageId × createdAt. `internal` = staff-only note in a private Discord thread. |
| `ticket_panels` | One row per posted Discord panel message (guildId × channelId × messageId × businessId) — used by the bot's `/panel` commands to find and refresh panels |
| `ticket_external_members` | Members added to a ticket by Discord ID who are not in the guild (web-only access) |
| `user_notification_prefs` | Per-user ntfy + Discord DM notification opt-ins |
| `audit_logs` | Per-ticket lifecycle events (open / claim / close / rename / …) written by both web and bot |
| `bot_errors` | Persistent error log written by the bot; surfaced in `/admin/errors` |
| `app_settings` | Bot-owner global key/value settings (e.g. `bot_name`), set on the Sudo dashboard (`/admin/bot`) and applied to the bot via its internal HTTP |

`ticket_messages.source = 'discord'` rows arrive via the bot's relay: the bot POSTs to `/api/internal/notify` on new Discord messages, which triggers notification fan-out; the bot also writes `ticket_messages` rows directly into the shared DB.

---

## Local dev

```bash
pnpm install
docker compose up -d db
cp .env.example .env  # fill AUTH_SECRET, AUTH_DISCORD_ID, AUTH_DISCORD_SECRET
pnpm db:push
pnpm dev
```

Add `http://localhost:3000/api/auth/callback/discord` as a redirect on the Discord application before logging in.

Beyond the three `AUTH_*` vars, several runtime features require additional env vars that are read directly via `process.env` (not Zod-validated in `env.ts`):

| Variable | Purpose |
|---|---|
| `DISCORD_BOT_TOKEN` | Permission resolution (Ticket Master role check), member fetch for admin checks, Discord channel ops — **required** for any protected route to work correctly. |
| `INTERNAL_TOKEN` | Shared secret for the web↔bot internal bridge (`/api/internal/notify`). Set the same value in the bot's env. |
| `BOT_INTERNAL_URL` | Base URL of the bot's internal HTTP server (e.g. `http://euphoric-tickets:8787`). Required for web→bot DM and bot-name/force-leave Sudo controls. |
| `PUBLIC_BASE_URL` | Public site URL, used in notification links and cookie domain. |

## Bot ↔ Web bridge

The web and bot share one Postgres database (this repo owns the schema and runs `drizzle-kit push`; the bot mirrors the schema files and only connects). Two internal HTTP endpoints bridge the halves:

- **`POST /api/internal/notify`** (this app) — the bot POSTs here on new Discord messages to trigger notification fan-out (ntfy / Discord DM). Guarded by `INTERNAL_TOKEN` (constant-time compare).
- **`POST <BOT_INTERNAL_URL>/api/internal/...`** (bot) — the web calls the bot to send DMs (`/api/internal/dm`) and to push bot-name changes or force-leave a guild from the Sudo dashboard.

See also the companion bot repo: [`euphoric-tickets`](https://github.com/jason-tucker/euphoric-tickets).

## Production

Watchtower auto-pulls on push to main. Manual restart:

```bash
docker compose -f /home/botuser/projects/euphoric-tickets-web/docker-compose.yml restart tickets-web
docker compose -f /home/botuser/projects/euphoric-tickets-web/docker-compose.yml logs -f tickets-web
```

---

## Anti-patterns

- **Don't** post to Discord as the bot from the web layer. Always per-user webhook spoof.
- **Don't** trust `session.user.guilds` after ~10 minutes — Discord may have removed the user from a guild. Re-fetch on permission failure rather than caching aggressively.
- **Don't** add SQL migration files. The entrypoint pushes the schema.
- **Don't** add Cloudflare proxy on the public hostname — same FiveM CEF constraint as `info.euphoric.fm`.
- **Don't** bypass the Drizzle ORM / `src/server/` service layer for cross-concern data access. The web and bot are decoupled at the code level — each has its own service layer — even though they share one Postgres database.
