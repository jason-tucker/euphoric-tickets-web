# Euphoric Tickets — Web UI

ConnectWise-Manage-style web frontend for the Discord-backed `euphoric-tickets` bot. Discord OAuth login, multi-tenant (multiple businesses, multiple guilds), per-user webhook spoof for outbound replies.

Public URL (planned): `https://tickets.euphoric.fm`

## What you can do here

- **End users** — log in with Discord, see your recent tickets across every business you're a member of, open a new ticket, watch staff reply, reply yourself.
- **Business admins** — see the full queue for every business you're an admin of, claim/close tickets, change assignment, reply to anyone's ticket. Manage business settings (Discord webhook URL, admin role IDs).
- **Sudo** (account-wide) — create/edit businesses, assign them to Discord guilds.

Every reply you make from the web posts into the matching Discord ticket channel via a webhook that spoofs your Discord identity (`username` + `avatar_url`), so the conversation feels native.

## Stack

- Next.js 15 App Router · React 19 · Tailwind 3 · shadcn/ui
- Auth.js v5 with Discord provider, JWT session
- Drizzle ORM · Postgres 16 (own container, `drizzle-kit push`)
- Docker + GHCR build · Watchtower auto-pull on the VPS
- pnpm 10 · Node 24

## Local dev

```bash
pnpm install
cp .env.example .env  # fill in AUTH_SECRET, AUTH_DISCORD_ID, AUTH_DISCORD_SECRET
docker compose up -d db
pnpm db:push
pnpm dev
# open http://localhost:3000
```

You'll need a Discord application with the OAuth redirect set to
`http://localhost:3000/api/auth/callback/discord`. The bot's existing
Discord app works fine — just add the redirect URL.

## Production deployment

1. **DNS**: add `tickets.euphoric.fm` → VPS IP (Cloudflare orange-cloud off if you want CEF in-game phones to load it directly; the same constraint that drives `info.euphoric.fm`).
2. **Shared network**: `docker network create efm-public-net` (once).
3. **Caddy block** in `euphoricfm-website/Caddyfile`:
   ```caddy
   tickets.euphoric.fm {
     reverse_proxy web:3000
   }
   ```
   (See the matching commit in `euphoricfm-website`.)
4. **Clone + start**: on the VPS:
   ```bash
   git clone https://github.com/jason-tucker/euphoric-tickets-web.git ~/projects/euphoric-tickets-web
   cd ~/projects/euphoric-tickets-web
   cp .env.example .env && nano .env
   docker compose up -d
   ```

Subsequent deploys: push to `main` → CI builds → GHCR push → watchtower restarts the container in ~60s.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection. Compose overrides this to the in-network `db` service. |
| `AUTH_SECRET` | Yes | Random 32+ bytes base64. `openssl rand -base64 32`. |
| `AUTH_URL` | Yes | Public URL of the site. `https://tickets.euphoric.fm` in prod. |
| `AUTH_TRUST_HOST` | Yes | `true` — required when behind Caddy. |
| `AUTH_DISCORD_ID` | Yes | Discord application's client ID. |
| `AUTH_DISCORD_SECRET` | Yes | Discord application's client secret. |
| `POSTGRES_PASSWORD` | Yes | Postgres password (compose only). |
| `WEB_IMAGE` | No | Override the GHCR image tag. |

`euphoric-tickets-web v0.1.0`
