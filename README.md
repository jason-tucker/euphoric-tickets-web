# Euphoric Tickets — Web UI

The web surface of the Euphoric Tickets system. The Discord bot
([`euphoric-tickets`](https://github.com/jason-tucker/euphoric-tickets)) and
this web app are **one system with two front-ends** sharing a single Postgres
database: Discord is the primary end-user surface, the web is the primary
staff surface, and **every feature and setting is available on both**.

Public URLs: `https://tickets.euphoric.fm` (via cloudflared) and
`https://tickets.euphoric.gg` (direct DNS → Caddy).

---

## Table of contents

- [What you can do](#what-you-can-do)
- [How the two halves fit together](#how-the-two-halves-fit-together)
- [Permission model](#permission-model)
- [Feature tour](#feature-tour)
- [Routes](#routes)
- [Stack](#stack)
- [Local development](#local-development)
- [Production deployment](#production-deployment)
- [Scaling: multiple VPS](#scaling-multiple-vps)
- [Backups](#backups)
- [Environment variables](#environment-variables)
- [Conventions](#conventions)

---

## What you can do

- **End users** — sign in with Discord, open a ticket (pick a team + category +
  subject), watch the conversation update **live**, and reply. Your web replies
  post into the Discord channel spoofed as your Discord identity (name +
  avatar), so the thread reads natively.
- **Staff** (a per-category role tier) — see every ticket in their categories;
  claim / unclaim / assign / close / reopen; reply; add or remove people; post
  staff-only internal notes; move a ticket to another category.
- **Admins / managers** — everything staff can do, plus delete the Discord
  channel of a closed ticket, edit team settings + categories, and change a
  ticket's category. The only tier allowed to delete channels.
- **Sudo** (account-wide) — create/edit teams, a system **bot dashboard**, a
  persistent **error log**, and a cross-team **All tickets** view.

A **team** is one tenant. Multiple teams can share one Discord guild, and a
team can be flagged as a *client* (a visitor org whose members open tickets at
a host team).

---

## How the two halves fit together

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
- **Outbound web → Discord.** Replies post via a **per-user webhook spoof**
  (username + avatar overridden). System lifecycle notices (claim, assign,
  close, …) post as the bot as small silent `-#` subtext footers. Internal
  notes never leave the private staff thread.
- **Inbound Discord → web.** The bot's `messageCreate` relay writes Discord
  messages (and attachments) into `ticket_messages`. The web shows them.
- **Live refresh.** Postgres `LISTEN/NOTIFY` triggers fire on message inserts
  and ticket changes → an SSE endpoint here forwards a "refresh" event →
  the open conversation re-renders in well under a second, no manual reload.
- **Internal endpoints.** The bot exposes `POST /api/internal/dm` (for the web
  to DM a user through the bot); the web exposes `POST /api/internal/notify`
  (for the bot to trigger notification fan-out). Both are authed by a shared
  `INTERNAL_TOKEN`.

---

## Permission model

Three tiers, resolved per-ticket by `resolveTicketAccess` (cached per request,
reads role snapshots from `business_members` so the hot path avoids live
Discord calls):

| Tier | Who | Can |
|---|---|---|
| **admin / owner** | guild ADMINISTRATOR, in `admin_role_ids`, or sudo | everything, incl. **delete channel**, change category, edit settings |
| **staff** | holds a role in the category's `staff_role_ids` | see/claim/close/reply/add-remove members/internal notes — **not** delete |
| **opener** | opened the ticket | see + reply + close their own |
| **external** | added by ID, not in the guild | see + reply on that one ticket (web only) |

Per-category `allow_role_ids` additionally gate *who can open* a category.

---

## Feature tour

- **Team settings** (`/b/<slug>/settings`) — edit categories in place, each with
  emoji/label/description, Discord parent + closed categories, **allow-to-open
  roles**, **staff roles**, and a **custom first-message template**
  (`{{user}}`, `{{ticketId}}`, `{{subject}}`, `{{category}}`). Every
  snowflake field is a **searchable Discord picker** (channels/roles/users)
  that also accepts a raw ID.
- **Ticket detail** (`/b/<slug>/tickets/<id>`) — live conversation with
  **audio/file attachments** (audio plays inline, streamed from Discord's CDN —
  nothing stored on the VPS), claim/assign/close/reopen, **move category**,
  a **People** card (add/remove members, incl. external-by-ID), staff
  **internal notes**, and a **two-pane reply box with a live Discord-formatted
  preview**.
- **Queues** — per-team queue and a cross-team **All tickets** tab, both with
  clickable column sorting and status filters.
- **Notifications** (`/settings/notifications`) — opt into **ntfy** push and/or
  **Discord DM** for new-ticket / reply events.
- **Sudo** — `/admin` (create teams), `/admin/bot` (health dashboard),
  `/admin/errors` (persistent 5-day error log).

---

## Routes

| Route | Who | Notes |
|---|---|---|
| `/login` | anon | one-button Discord OAuth |
| `/dashboard` | any user | my tickets across all teams |
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
| `/api/tickets/[id]/messages/stream` | per-ticket | SSE live-refresh |
| `/api/tickets/[id]/attachment` | per-ticket | 302 → fresh Discord CDN URL |
| `/api/discord/[guildId]/{channels,roles,members}` | admin | picker data |
| `/api/internal/notify` | bot | notification fan-out bridge |
| `/api/auth/[...nextauth]` | — | Auth.js handler |

---

## Stack

- **Next.js 15** App Router (`output: 'standalone'`) · **React 19** · Tailwind 3 · shadcn/ui · cmdk
- **Auth.js v5** Discord provider, JWT session (chunked cookies)
- **Drizzle ORM** · **Postgres 16** (schema via `drizzle-kit push`, no SQL migration files)
- Postgres `LISTEN/NOTIFY` → SSE for live refresh
- Docker + GHCR build (CI compiles; the VPS never runs `next build`) · watchtower auto-pull
- pnpm 10 · Node 24

---

## Local development

```bash
pnpm install
cp .env.example .env   # AUTH_SECRET, AUTH_DISCORD_ID, AUTH_DISCORD_SECRET, DISCORD_BOT_TOKEN
docker compose up -d db
pnpm db:push
pnpm dev               # http://localhost:3000
```

Add `http://localhost:3000/api/auth/callback/discord` as a redirect on the
Discord application (the bot's existing app is fine).

---

## Production deployment

Two options:

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

Subsequent deploys: push to `main` → CI builds → GHCR → watchtower restarts
the container in ~60–90 s. The container entrypoint runs `drizzle-kit push`
on boot so schema changes apply automatically.

### B. Single combined stack (fresh VPS)

`docker-compose.combined.yml` brings up **Postgres + web + bot + watchtower**
in one command — the simplest way to stand the whole system up on a new box:

```bash
docker compose -f docker-compose.combined.yml up -d
```

(See the file header for the required `.env` keys.)

> **Ingress note:** Cloudflare proxy must be **off** for `tickets.*` hostnames —
> the in-game phone CEF iframe can't load Cloudflare-fronted content, same
> constraint as `info.euphoric.fm`.

---

## Scaling: multiple VPS

The web is **stateless** (in-memory caches regenerate on cold start), so any
number of VPS can serve it behind a load balancer with no session affinity:

```caddyfile
reverse_proxy vps1:3000 vps2:3000 vps3:3000 {
  lb_policy least_conn
  health_uri /api/health
  health_interval 10s
  flush_interval -1          # keep SSE working
}
```

The **bot is single-leader** (Postgres advisory lock) so only one instance
connects to the Discord gateway; failover is ~30 s. See
[`ops/README.md`](ops/README.md) for the full multi-VPS notes.

---

## Backups

Grandfather-Father-Son (GFS) tiered backups of the Postgres DB (which also
holds **all settings**) via **restic**: every 45 min → daily → weekly →
monthly, deduped so ~17 retained snapshots cost ~1.2–1.5× the live DB size.
Script + systemd units + restore drill in [`ops/`](ops/).

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection (compose points it at the shared `tickets-db`). |
| `AUTH_SECRET` | Yes | `openssl rand -base64 32`. |
| `AUTH_DISCORD_ID` / `AUTH_DISCORD_SECRET` | Yes | Discord OAuth app credentials. |
| `AUTH_TRUST_HOST` | Yes | `true` behind Caddy/cloudflared. |
| `DISCORD_BOT_TOKEN` | Yes | Used for picker data, channel ops, attachment refresh, member resolution. |
| `PUBLIC_BASE_URL` | Rec. | Public site URL, used in notification links. |
| `INTERNAL_TOKEN` | Rec. | Shared secret for the web↔bot internal endpoints (notifications/DM). |
| `BOT_INTERNAL_URL` | Rec. | e.g. `http://euphoric-tickets:8787` — where the bot's DM endpoint lives. |
| `NTFY_BASE_URL` | No | Override the ntfy server (default `https://ntfy.sh`). |
| `POSTGRES_PASSWORD` | compose | Postgres password. |

---

## Conventions

- **Never** run `next build` / `tsc` on the VPS — CI builds; the VPS pulls the
  image. (`next build` is memory-heavy and runs on GitHub Actions.)
- Schema lives in `src/db/schema/*.ts`; the entrypoint pushes it. No SQL
  migration files.
- Outbound user replies go via the per-user webhook spoof — **never** post user
  content as the bot from the web. System status footers are the one exception.
- Iframe-safe: no `X-Frame-Options`, responsive down to ~360 px.
- See `CLAUDE.md` for the full working agreement and `CHANGELOG.md` for the
  per-release history (the system is at the lantern milestone P1–P19).

`euphoric-tickets-web v0.6.22`
