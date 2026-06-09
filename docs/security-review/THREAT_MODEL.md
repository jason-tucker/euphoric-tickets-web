# Threat Model — euphoric-tickets-web

Assumed hostile: internet-facing, untrusted end users, malicious ticket
content, token theft, SSRF, auth-bypass, cross-tenant attacks, CI/CD abuse.

## Assets
- **Ticket data & PII** — ticket subjects/bodies, opener/staff Discord identities, message transcripts (Postgres).
- **Discord bot token** (`DISCORD_BOT_TOKEN`) — full bot capability across all joined guilds. Highest-value secret.
- **`AUTH_SECRET`** — signs/encrypts JWT sessions.
- **Per-business Discord webhook URLs** — stored in DB; allow posting as the spoofed staff identity.
- **`INTERNAL_TOKEN`** — shared secret for web↔bot internal calls.
- **GHCR publish rights** — `packages: write` in the deploy workflow; the image watchtower auto-pulls to prod.

## Trust boundaries
1. **Browser ↔ server** — the FiveM CEF iframe / any browser is untrusted. All authz is server-side (`requireSession`/`requireBusinessAccess`/`requireSudo`); `middleware.ts` is only a cosmetic pre-redirect.
2. **Session snapshot ↔ live Discord** — `session.user.guilds` is a ≤10-min cached OAuth snapshot. Owner/Manage-Server bits come from it; role-level "Ticket Master" checks re-hit Discord live with the bot token.
3. **Web ↔ Discord API / webhooks** — outbound to a fixed host (`discord.com`) and DB-stored webhook URLs (validated `startsWith https://discord.com/api/webhooks/`).
4. **Web ↔ bot internal HTTP** — both directions authenticated by `INTERNAL_TOKEN`/bot token (now constant-time compared on the web side).
5. **Web ↔ user-supplied ntfy server** — the one user-controlled outbound destination; now SSRF-guarded.
6. **CI ↔ deploy** — PRs run read-only CI; only push-to-`main` publishes. watchtower (docker socket) pulls to prod.
7. **/demo ↔ real system** — `/demo/**` is isolated by construction: never imports `@/db/client` or `actions.ts`; all "writes" hit browser localStorage only.

## Attackers & capabilities
- **Anonymous internet user** — can reach `/login`, `/demo/*`, `/api/health`, `/api/version`, OAuth callback.
- **Authenticated end user (any Discord user)** — can open tickets, reply to their own, set their own notification prefs. Primary source of malicious ticket content + the ntfy-SSRF vector.
- **Business admin** (Manage-Server/Administrator/Ticket-Master role) — manages one team; can set the business webhook URL + admin role IDs + categories.
- **Sudo (bot owner)** — `/admin/*`: team CRUD, force-leave guild, bot name.
- **Compromised dependency / CI action** — supply-chain path into the published image.

## Key attack paths & status
| Path | Pre-review | Post-review |
|---|---|---|
| Stored XSS via ticket markdown rendered in staff browser | React-node renderer, http(s)-only autolinks — **safe** | unchanged (safe) |
| IDOR across tickets/categories/businesses | every query scoped by `businessId`/ownership — **safe** | unchanged (safe) |
| Auth bypass via middleware (CVE-2025-29927) | framework vuln present; impact limited (cosmetic middleware) | **patched** (next 15.5.19) |
| Blind SSRF via `ntfyServer` to metadata/internal hosts | only `^https?://` check — **exploitable (blind)** | **guarded** (private-IP deny + DNS resolve + timeout) |
| DoS by pointing webhook/ntfy at a slow host | no timeouts — action hangs | **bounded** (5–10s AbortSignal) |
| Internal endpoint token brute-force via timing | `!==` compare | **constant-time** |
| Container escape after web RCE | runs as **root** | **non-root** `node` |
| CI/action-tag compromise | floating tags | **SHA-pinned** |
| Secret leakage via committed `.env` | none committed; ignores correct | unchanged (safe) |
| Cross-tenant data via stale guild snapshot | ≤10-min window, fail-safe redirect on miss | accepted (by design) |

## Abuse cases worth monitoring
- Admin sets a business webhook to a Discord channel they don't own (Discord-side abuse controls apply; audit log records the actor).
- `drizzle-kit push --force` applying a destructive schema diff on deploy — keep backups (restic timer exists) and review schema changes pre-merge.
- watchtower auto-pulling a poisoned `:latest` if GHCR or the watchtower image is compromised — pin digests; require CI before merge.

## Blast radius
- Web process compromise → DB (full tenant data) + bot token (all guilds) + ability to post as spoofed staff. Mitigated by non-root container, loopback-only host binding, DB not host-exposed, and least-privilege CI.
- watchtower/docker-socket compromise → host-level control (highest residual; pin + socket-proxy recommended).
