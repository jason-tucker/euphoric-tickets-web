# euphoric-tickets-web — AI Coding Instructions

See `/home/botuser/projects/claude-all.md` for VPS constraints (no `tsc` on the VPS — CI builds), CI/CD via GHCR + watchtower, and Discord patterns.

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

---

## What this app does

A web frontend for the `euphoric-tickets` Discord bot. Multi-tenant: any Discord-using business can have a `business` row that points to its guild ID. End users open tickets either in Discord (panel button → bot creates channel) or here (form → server action creates DB row + posts the opener's first message via the webhook).

### Auth + permissions

- Auth.js v5 with the Discord provider; JWT session.
- On login Discord returns the user's `guilds` array; we store the snapshot on the session and resolve per-business permissions from `business.discord_guild_id`.
- For each business the user is "in" (their Discord guilds intersect), we check:
  - If their member roles in that guild ∩ `business.admin_role_ids` → admin
  - Otherwise → member (can only see their own tickets in that business)
- Permission resolution lives in `src/server/permissions.ts` — every protected route/server action calls `requireBusinessAccess(slug, level)`.

### Multi-business

A user can belong to several businesses. The top-nav has a business switcher. URLs are scoped to `/b/<slug>/...`. Admin and end-user views live side-by-side; admin role is what unlocks `/b/<slug>/tickets` and `/b/<slug>/settings`. End users always hit `/dashboard` for the cross-business "my tickets" view.

---

## Routes

| Route | Who | Notes |
|---|---|---|
| `/login` | Anonymous | One-button Discord OAuth |
| `/dashboard` | Any user | My tickets across all businesses + business cards |
| `/t/new` | Any user | Open a ticket (pick business + category + subject + body) |
| `/t/[id]` | Opener | Read-only-ish view of a ticket they opened (reply via the bot in Discord, or via the form here) |
| `/b/[slug]` | Admin | Business overview: open ticket counts, recent activity |
| `/b/[slug]/tickets` | Admin | Full queue, filterable by status + category + assignee |
| `/b/[slug]/tickets/[id]` | Admin | Reply, claim, close from this view; mirrors the bot's controls |
| `/b/[slug]/settings` | Admin | Webhook URL, admin role IDs, category list |
| `/api/auth/[...nextauth]` | — | Auth.js handler |

Server actions live alongside their pages (`actions.ts` next to `page.tsx`).

---

## Database schema

| Table | Purpose |
|---|---|
| `users` | Auth.js user — id, discordId, name, email, image |
| `businesses` | Tenant — slug, name, discordGuildId, webhookUrl, settings JSON |
| `business_members` | userId × businessId × role (`member` / `admin` / `owner`) — cached from Discord at login, refreshed on each session refresh |
| `ticket_categories` | businessId × key × label × emoji × description — drives the open-ticket form's category picker |
| `tickets` | businessId × openerId × categoryId × subject × status × assigneeId × openedAt × closedAt × lastActivityAt |
| `ticket_messages` | ticketId × authorId × body × source (`web` / `discord`) × discordMessageId × createdAt |

`ticket_messages.source = 'discord'` rows arrive via a future webhook-ingestion endpoint the bot will POST to (not yet wired in v0.1.0 — for now the web view shows only what the web has sent).

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

## Production

Watchtower auto-pulls on push to main. Manual restart:

```bash
docker compose -f /home/botuser/projects/euphoric-tickets-web/docker-compose.yml restart web
docker compose -f /home/botuser/projects/euphoric-tickets-web/docker-compose.yml logs -f web
```

---

## Anti-patterns

- **Don't** post to Discord as the bot from the web layer. Always per-user webhook spoof.
- **Don't** trust `session.user.guilds` after ~10 minutes — Discord may have removed the user from a guild. Re-fetch on permission failure rather than caching aggressively.
- **Don't** add SQL migration files. The entrypoint pushes the schema.
- **Don't** add Cloudflare proxy on the public hostname — same FiveM CEF constraint as `info.euphoric.fm`.
- **Don't** mix tickets data from this DB with the bot's `tickets` DB without going through a service layer. The two are intentionally decoupled.
