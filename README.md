# Euphoric Tickets — Web

The web half of the Euphoric Tickets system. This app and its Discord sibling
([`euphoric-tickets`](https://github.com/jason-tucker/euphoric-tickets)) are
**one system with two front-ends** sharing a single Postgres database —
everything you can do here you can do in Discord, and vice-versa. Discord is the
primary end-user surface; the web is the primary staff surface.

Public URLs: `https://tickets.euphoric.fm` (cloudflared tunnel) and
`https://tickets.euphoric.gg` (direct DNS → Caddy).

---

## Table of contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Stack](#stack)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Usage](#usage)
- [Deployment](#deployment)
- [Conventions](#conventions)

---

## Overview

A **team** is one tenant. Multiple teams can share a single Discord guild.
Everyone signs in with Discord; what they can do is decided per-team
and per-ticket.

- **End users** — sign in, open a ticket (pick a team + category + subject),
  watch the conversation update **live**, and reply. Web replies post into the
  Discord channel **spoofed as your Discord identity** (name + avatar), so the
  thread reads natively. External users (added to a ticket but not in the guild)
  can still see and reply to that one ticket.
- **Staff** (a per-category role tier) — see every ticket in their categories;
  claim / unclaim / assign / close / reopen; reply; add or remove people; post
  staff-only internal notes; rename; move a ticket to another category.
- **Admins** — everything staff can do, plus **delete the Discord channel** of a
  closed ticket, edit team settings + categories, and change a ticket's
  category. The only tier allowed to delete channels.
- **Sudo** (account-wide) — create/edit teams, a system **bot dashboard**, a
  persistent **error log**, and a cross-team **All tickets** view.

---

## Architecture

How the two halves fit together:

```
                 ┌────────────────────────────┐
   Discord  ◄───►│  euphoric-tickets (bot)     │
   gateway       │  panels, slash cmds, relay  │
                 └─────────────┬──────────────┘
                               │  shared Postgres
                 ┌─────────────┴──────────────┐
   browser  ◄───►│  euphoric-tickets-web       │
   (this app)    │  SSR + server actions + SSE │
                 └────────────────────────────┘
```

- **Shared database.** Both apps read/write the same Postgres. This web repo
  **owns the schema** (`drizzle-kit push`); the bot mirrors the schema files.
- **Outbound web → Discord.** User replies post via a **per-user webhook spoof**
  — the channel webhook's username + avatar are overridden to the replying
  staffer (`postWebhookMessage` in `src/lib/discord.ts`). System lifecycle
  notices (claim, assign, close, …) post as the bot as small silent `-#`
  subtext footers. **User content is never posted as the bot** — system footers
  are the one exception. Internal notes never leave the private staff thread.
- **Inbound Discord → web.** The bot's `messageCreate` relay writes Discord
  messages (and attachments) into `ticket_messages`; the web renders them.
- **Live refresh.** Postgres `LISTEN/NOTIFY` triggers fire on message inserts
  and ticket changes → an SSE endpoint here forwards a "refresh" event → the
  open conversation re-renders in well under a second, no manual reload.
- **Internal endpoints.** The bot exposes `POST /api/internal/dm` (for the web
  to DM a user through the bot); the web exposes `POST /api/internal/notify`
  (for the bot to trigger notification fan-out). Both are authed by a shared
  `INTERNAL_TOKEN`.

**Auth & permissions.** Auth.js v5 with the Discord provider, JWT session. On
sign-in the JWT carries a **guilds snapshot** (`/users/@me/guilds`), refreshed
when stale. Admin is the **intersection of the user's guild roles and the team's
`admin_role_ids`**: guild `ADMINISTRATOR` ⇒ `owner`; otherwise gated routes do a
one-shot bot-token member fetch (`resolveBusinessAccess` in
`src/server/permissions.ts`), with `business_members.discordRolesSnapshot` as the
cached fast path and a live re-fetch when the snapshot is missing. Large guild
lists push the session over the cookie size limit, so Auth.js **chunks the
session cookie** (`__Secure-authjs.session-token`, `.0`/`.1`); middleware and
any cookie sniffs match it **by prefix**.

---

## Stack

- **Next.js 15** App Router (`output: 'standalone'`) · **React 19** · Tailwind 3 · shadcn/ui · cmdk
- **Auth.js v5** Discord provider, JWT session (chunked cookies)
- **Drizzle ORM** · **Postgres 16** — schema via `drizzle-kit push`, **no SQL
  migration files** (schema mirrored to the bot repo)
- Postgres `LISTEN/NOTIFY` → SSE for live refresh
- Docker + GHCR build (CI compiles; the VPS never runs `next build`) · watchtower auto-pull
- pnpm 10 · Node 24

---

## Quick start

```bash
pnpm install
cp .env.example .env   # AUTH_SECRET, AUTH_DISCORD_ID, AUTH_DISCORD_SECRET, DISCORD_BOT_TOKEN, DATABASE_URL
docker compose up -d db
pnpm db:push           # push the Drizzle schema (no migration files)
pnpm dev               # http://localhost:3000
```

Add `http://localhost:3000/api/auth/callback/discord` as a **redirect URI** on
the Discord application (the bot's existing app is fine). Point `DATABASE_URL` at
the same Postgres the bot uses if you want both halves talking to one DB.

---

## Configuration

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection (compose points it at the shared `tickets-db`). |
| `AUTH_SECRET` | Yes | `openssl rand -base64 32`. |
| `AUTH_DISCORD_ID` / `AUTH_DISCORD_SECRET` | Yes | Discord OAuth app credentials. |
| `AUTH_TRUST_HOST` | Yes | `true` behind Caddy/cloudflared. |
| `DISCORD_BOT_TOKEN` | Yes | Picker data, channel ops, attachment refresh, member resolution, admin-role checks. |
| `PUBLIC_BASE_URL` | Rec. | Public site URL, used in notification links. |
| `INTERNAL_TOKEN` | Rec. | Shared secret for the web↔bot internal endpoints (notify / DM). |
| `BOT_INTERNAL_URL` | Rec. | e.g. `http://euphoric-tickets:8787` — where the bot's DM endpoint lives. |
| `NTFY_BASE_URL` | No | Override the ntfy server (default `https://ntfy.sh`). |
| `POSTGRES_PASSWORD` | compose | Postgres password. |

---

## Usage

### Routes

| Route | Who | Notes |
|---|---|---|
| `/login` | anon | one-button Discord OAuth |
| `/dashboard` | any user | my tickets across all teams (closed hidden by default; **Show closed** toggle) |
| `/tickets` | staff/admin | **All tickets** cross-team view (sortable) |
| `/t/new` | any user | open a ticket |
| `/b/[slug]` | member | team overview |
| `/b/[slug]/tickets` | admin | queue (sort + status filter) |
| `/b/[slug]/tickets/[id]` | per-ticket | conversation + controls (soft-auth: external members allowed) |
| `/b/[slug]/settings` | admin | team + category settings |
| `/settings/notifications` | any user | ntfy/DM prefs |
| `/admin` | sudo | create/list teams |
| `/admin/bot` | sudo | health dashboard |
| `/admin/errors` | sudo | error log |
| `/api/health` | — | LB health probe (200 iff Postgres reachable) |
| `/api/version` | — | running build id (drives the "new version, reload" toast) |
| `/api/tickets/[id]/messages/stream` | per-ticket | SSE live-refresh |
| `/api/tickets/[id]/attachment` | per-ticket | 302 → fresh Discord CDN URL |
| `/api/discord/[guildId]/{channels,roles,members}` | admin | picker data |
| `/api/internal/notify` | bot | notification fan-out bridge |
| `/api/auth/[...nextauth]` | — | Auth.js handler |

Multi-tenant URLs live under `/b/<slug>/…`; a **business switcher** in the top
nav moves between the teams you belong to.

### Permission model

Three tiers, resolved per-ticket by `resolveTicketAccess` and per-team by
`requireBusinessAccess(slug, level)` (`level` ∈ `member | admin | owner`).
Resolution is cached per request and reads role snapshots from
`business_members`, so the hot path avoids live Discord calls.

| Tier | Who | Can |
|---|---|---|
| **admin / owner** | guild `ADMINISTRATOR`, a role in `admin_role_ids`, or sudo | everything, incl. **delete channel**, change category, edit settings |
| **staff** | holds a role in the category's `staff_role_ids` | see / claim / close / reply / add-remove members / internal notes — **not** delete |
| **opener** | opened the ticket | see + reply + close their own |
| **external** | added by ID, not in the guild | see + reply on that one ticket (web only) |

Per-category `allow_role_ids` additionally gate *who can open* a category.

### Feature tour

- **Team settings** (`/b/<slug>/settings`) — edit categories in place, each with
  emoji/label/description, Discord parent + closed categories, **allow-to-open
  roles**, **staff roles**, and a **custom first-message template** (`{{user}}`,
  `{{ticketId}}`, `{{subject}}`, `{{category}}`). Every snowflake field is a
  **searchable Discord picker** (channels/roles/users) that also accepts a raw
  ID.
- **Ticket detail** (`/b/<slug>/tickets/<id>`) — live conversation with
  **audio/file attachments** (audio plays inline, streamed from Discord's CDN —
  nothing stored on the VPS), claim/assign/close/reopen, **rename**, **move
  category**, a **People** card (add/remove members, incl. external-by-ID),
  staff **internal notes**, and a **two-pane reply box with a live
  Discord-formatted preview**. Widens to a two-column layout on 16:9 screens.
- **Queues** — per-team queue and a cross-team **All tickets** tab, both with
  clickable column sorting and status filters.
- **Notifications** (`/settings/notifications`) — opt into **ntfy** push and/or
  **Discord DM** for new-ticket / reply events.
- **Sudo** — `/admin` (create teams), `/admin/bot` (health dashboard),
  `/admin/errors` (persistent 5-day error log).

### Data model

The schema lives in `src/db/schema/*.ts` (this repo owns it; the bot mirrors
it). Core tables: **`users`**, **`businesses`** (teams), **`business_members`**
(membership + cached `discordRolesSnapshot`), **`ticket_categories`**,
**`tickets`**, **`ticket_messages`** (Discord relay, dedup'd by
`discord_message_id`), and **`ticket_external_members`** (members added by ID who
aren't in the guild). Supporting tables: `ticket_panels`,
`user_notification_prefs`, `audit_logs`, and `bot_errors`. There are **no SQL
migration files** — `drizzle-kit push` applies the schema.

---

## Deployment

### A. Split stack (current prod)

The web and bot run as separate compose stacks sharing the external
`efm-public-net` network and one Postgres. Ingress is Caddy
(`tickets.euphoric.gg`) and a cloudflared tunnel (`tickets.euphoric.fm`).

```bash
docker network create efm-public-net    # once
git clone https://github.com/jason-tucker/euphoric-tickets-web ~/projects/euphoric-tickets-web
cd ~/projects/euphoric-tickets-web
cp .env.example .env && nano .env
docker compose up -d
```

Subsequent deploys are automatic: push to `main` → GitHub Actions builds →
GHCR → watchtower pulls and restarts (~60–90 s). The container entrypoint runs
`drizzle-kit push` on boot, so schema changes apply automatically. After editing
`.env`, re-run `docker compose up -d` (a plain `restart` won't re-read it).

### B. Single combined stack (fresh VPS)

`docker-compose.combined.yml` brings up **Postgres + web + bot + watchtower** in
one command — the simplest way to stand the whole system up on a new box:

```bash
docker compose -f docker-compose.combined.yml up -d
```

(See the file header for the required `.env` keys.)

### Scaling & backups

The web is **stateless** (in-memory caches regenerate on cold start), so any
number of VPS can sit behind a load balancer with no session affinity; the bot
is **single-leader** via a Postgres advisory lock (failover ~30 s). Postgres
holds **all settings**, backed up GFS-tiered (every 45 min → daily → weekly →
monthly) via restic. Full multi-VPS leader-election notes, the Caddy LB config,
and the restic backup/restore drill live in **[`ops/README.md`](ops/README.md)**.

> **Ingress note:** the in-game phone runs in a **FiveM CEF iframe**, so the app
> is **iframe-safe** — no `X-Frame-Options`, no `window.top` assumptions,
> responsive down to ~360 px — and the **Cloudflare proxy must be off** for the
> `tickets.*` public hostnames (CEF can't load Cloudflare-fronted content, same
> constraint as `info.euphoric.fm`).

---

## Conventions

- **Never** run `next build` / `tsc` on the VPS — CI builds the image and the box
  pulls it. A type error blocks the build, so run `tsc --noEmit` locally before
  pushing.
- Schema lives in `src/db/schema/*.ts` and is mirrored to the bot repo; the
  entrypoint pushes it. **No SQL migration files.**
- **Webhook spoof.** Outbound user replies go via the per-user webhook spoof —
  **never** post user content as the bot from the web. System status footers are
  the one exception.
- **Iframe-safe.** No `X-Frame-Options`, no `window.top` dependence, responsive
  to ~360 px, and no Cloudflare proxy on the public host — the FiveM CEF iframe
  depends on all four.
- **CHANGELOG.** Real semver, one dated section per PR, version reflected in the
  README footer below (sourced from `package.json`); no `[Unreleased]`.
- **Project board.** Every PR / unit of work gets an item on project board #10.
- See `CLAUDE.md` for the full working agreement and `CHANGELOG.md` for the
  per-release history (the system is at the lantern milestone P1–P19).

`euphoric-tickets-web v0.6.52`
