# Changelog

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

`v0.1.0`
