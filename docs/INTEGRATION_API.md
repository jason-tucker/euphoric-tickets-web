# Integration API (v0.12.1)

A general, multi-tenant way for other services to talk to the ticket system.
Its first client is the EFM Music Portal: each music batch or request becomes
a ticket that behaves exactly like a bot-opened one. Public replies flow back
through signed webhooks; internal staff notes never do.

Design source: the vault plan "EFM Music Portal — Plan" §4 (v3.2, approved). The schema is in [`INTEGRATION_SCHEMA.md`](./INTEGRATION_SCHEMA.md).

**Reachability:** `/api/v1/*` is meant for the internal docker networks only. The edge must return 404 for `^/api/(internal|v1)/` (plan §4.6 P1d). There is no browser or CORS surface.

**In-app host gate (defense in depth, before P1d):** every `/api/v1/*` request whose `Host` header is not listed in `INTERNAL_API_HOSTS` gets a bare `404` before any key work — including `OPTIONS` and methods a route does not implement, which would otherwise get Next's automatic `204` / `405` (an internal `Host` gets `204` / `405 {"error":"method_not_allowed"}` with `Allow`). The default is `tickets-web:3000,tickets-web` (the internal alias the music worker and the staging stack use). Requests through the public tunnel or Caddy carry `Host: tickets.euphoric.fm` / `tickets.euphoric.gg`, which an external caller cannot change into the internal alias through those proxies. Only `Host` is read, never `X-Forwarded-Host`. Assumption: neither proxy rewrites `Host` to the internal alias. To call the API through a published port for local testing (for example staging's `127.0.0.1:16095`), set `INTERNAL_API_HOSTS=tickets-web:3000,tickets-web,127.0.0.1:16095`; the variable replaces the list, and a blank value means the default. `/api/internal/*` is **not** gated this way yet, because the bot still reaches `/api/internal/notify` through the public URL until it deploys `WEB_INTERNAL_URL`; that gate is P1d.

---

## Authentication

```
Authorization: Bearer etk.<prefix10>.<secret43>
```

- Keys are base62. The secret is 32 CSPRNG bytes. Only `sha256(secret)` is stored, and it is compared in constant time. An unknown prefix gets a dummy compare.
- A bad, unknown or disabled key returns `401 {"error":"unauthorized"}`.
- **Failed-auth brake.** The key is always verified first. Only a request that **fails** authentication is counted: after 20 failures in 10 minutes from one client bucket, further **failing** requests from that bucket get `429 rate_limited` with `Retry-After` instead of `401`. A valid, enabled key is never blocked by the brake, so someone else's failures cannot lock an integration out. A request with no (or a malformed) `Authorization` header costs no database lookup. Once a bucket is braked, a request whose key prefix is not one that recently authenticated is answered `429` **before** any database lookup; the recently-valid set (at most 1 024 prefixes, in memory) is re-seeded from the enabled integrations at most every 5 s when a braked request misses it, so a valid key — even one not used since a restart — still reaches full verification.
  - **Client bucket.** tickets-web cannot see the TCP peer from a route handler, and on the internal networks `cf-connecting-ip` / `x-forwarded-for` are whatever the caller sends. So by default those headers are **ignored** and all failing requests share one bucket (`untrusted`). Set `INTEGRATION_TRUST_PROXY_HEADERS=1` only if a proxy you control sits in front of `/api/v1` and overwrites both headers; then the bucket is `cf-connecting-ip`, else the first `x-forwarded-for` hop, which must be a literal IP (IPv4 per address, IPv6 per /64, IPv4-mapped IPv6 as IPv4; anything else shares an `invalid` bucket).
  - **Bounded state.** At most 10 000 buckets are tracked (the oldest is evicted), and each request does a small, constant amount of limiter work.
- Each key may make 60 requests a minute. Opens are additionally capped at 10 a minute. Exceeding either returns `429` with `Retry-After`.
- A missing scope returns `403 {"error":"scope_missing","required":"<scope>"}`.
- Scopes: `tickets:read`, `tickets:write`, `tickets:close`, `guild:read`.
- **Scoping:** every `/tickets/:id*` route matches `id AND integration_id AND business_id`. Anything else, including a real ticket owned by another integration or team, is `404 not_found`.
- Request bodies are JSON, at most 32 KB (`413` above that; `415` for a non-JSON content type). Invalid input returns `422 {"error":"validation","issues":[{path,message}]}`.
- An unexpected server error returns `500 {"error":"internal"}` and is logged as an error class only.

## Endpoints

### `POST /api/v1/tickets` — `tickets:write`

```json
{ "categoryKey": "newsong", "openerDiscordId": "…", "subject": "≤100, not blank",
  "card": { "title": "≤100", "lines": ["≤200", "… ≤25 lines"], "link": { "label": "≤40", "url": "https://<link_origin>/… (≤512)" } },
  "externalRef": "≤100 visible ASCII" }
```

- Unknown keys are rejected. `card.link.url` must satisfy `new URL(url).origin === link_origin` and be **at most 512 characters** (Discord's link-button limit), both as sent and once normalised by `new URL`; otherwise `422`.
- **Plain text, not markdown.** `subject`, `card.title` and every `card.lines[]` entry are treated as plain text: the web escapes Discord markdown (backslash, `*`, `_`, `~`, backtick, `|`, `>`, `[`, `]`, `<`, and line-leading heading/list/subtext markers, including ones behind NBSP or other Unicode spaces) and defuses `@everyone` / `@here` **before** forwarding them to the bot, and the bot does not escape again. A masked link such as `[Approve](https://…)` therefore renders literally in the welcome card. Escaping can lengthen a field; the escaped value is trimmed to the bot's limit (subject and title 100, each line 200 characters) and ends in `…` when trimmed. `subject` is trimmed (Unicode whitespace) **before** it is escaped, and the stored ticket subject is the escaped form. `card.link.label` is a button label (never markdown) and is forwarded as-is.
- The whole body must fit in 13 500 bytes of UTF-8 JSON, both as sent and once escaped, so the bot's 16 KB bridge cap is never hit.
- The category must be in `allowed_category_keys` **and** exist in the key's team; otherwise `403 category_forbidden`.
- Responses:
  - `201 {ticketId, number, webUrl, discordChannelUrl, created:true}`
  - `200 {…, created:false}`: the same `externalRef` was already opened or adopted
  - `404 opener_not_member`
  - `403 opener_pending | category_forbidden`
  - `409 opening_in_progress` with `Retry-After: 5`
  - `409 ticket_channel_missing`: this `externalRef` already has a ticket, but its Discord channel no longer exists, so it cannot be adopted. Not transient (no `Retry-After`); staff must resolve the old ticket, or open under a new `externalRef`.
  - `502 bot_unavailable`

### `GET /api/v1/tickets/:id` — `tickets:read`

`200 {status, claimedBy, closedAt, webUrl, discordChannelUrl}`. `claimedBy` is the assignee's Discord id or null.

### `PATCH /api/v1/tickets/:id` — `tickets:write` (`closed` also needs `tickets:close`)

`{status: in_progress|waiting|on_hold|completed|closed, actorDiscordId?, reason?≤500}`. `reason` is plain text: it is markdown-escaped with mentions defused (and trimmed to 500 characters) before it reaches the bot, which quotes it in the opener's DM.

- `closed` goes to the bot's close route. The bot closes as the actor if one is given and is in the **staff set** (below; the opener does **not** count for close); otherwise it closes as the bot itself. The response is `200 {status:'closed', claimedBy, closedAt, webUrl, discordChannelUrl, closedBy}`, where `closedBy` is `'actor'` or `'bot'` as reported by the bot (`null` only if the bot did not say). `closedBy` is also written to the integration audit. `actorDiscordId` also requires `actor_impersonation`, else `403 actor_forbidden`.
- Without `tickets:close`, closing returns `403`.
- A ticket that is already closed returns `409 already_closed`.
- Other statuses are set directly. A silent `-# Ticket status set to X by <integration>` footer is posted, and the change is written to `audit_logs` with `via: integration:<slug>`.

### `POST /api/v1/tickets/:id/messages` — `tickets:write`

The header `Idempotency-Key: [A-Za-z0-9._:-]{1,128}` is required. The body is `{kind: system|comment, body≤1800, itemRef?≤100, actorDiscordId?}`.

**Order of operations:**
1. `INSERT … ON CONFLICT (ticket_id, idempotency_key) DO NOTHING RETURNING`.
2. On a conflict (a replay of the key):
   - the stored row reached Discord → `200 {messageId, discordMessageId, created:false}`;
   - it never reached Discord and is more than 30 s old (DB clock) → it is re-posted exactly once, under a conditional lease, and the lease winner gets `200 {…, created:false}`;
   - it never reached Discord and the first attempt (or another replay's re-post) may still be in flight → `409 {"error":"in_progress","messageId"}` with `Retry-After` (seconds until a replay may re-post). Retry with the same key.
   - it never reached Discord and the ticket is now closed → `409 {"error":"ticket_closed","messageId"}` (not retryable).

   A replay must name the **same** `actorDiscordId` as the original request (or omit it if the original did); otherwise it gets `409 {"error":"idempotency_conflict","messageId"}`. A re-post always uses the identity stored on the original row: that actor's nickname and avatar if the actor still passes the actor check, otherwise the integration's own name. It never posts under the replay request's actor.

   **Only a non-null `discordMessageId` means the message was delivered.**
3. Otherwise post through the ticket channel's webhook. When the ticket has no webhook, web first calls the bot's `/webhook/ensure` and stores the URL.
4. `UPDATE discord_message_id`. The response is `201 {messageId, discordMessageId, created:true}`.

**Failure responses:**
- A Discord failure returns `502 discord_unavailable` with `Retry-After: 30`. The row is kept, so retry with the same key after 30 s. A deleted webhook (404/401) is forgotten and re-ensured on the next try.
- A bot failure returns `502 bot_unavailable`.
- A closed ticket returns `409 ticket_closed`. A replay of a key accepted before the close gets `200` only if that message was delivered (non-null `discordMessageId`); an undelivered one is never re-posted into a closed ticket and gets `409 {"error":"ticket_closed","messageId"}`.

**`actorDiscordId`** requires `actor_impersonation` **and** a live bot-token member lookup. The actor must be a non-pending member who is in the **staff set**, **or** be the ticket's opener. Otherwise the response is `403 actor_forbidden`. The post then uses the actor's server nickname and avatar.

**The staff set** (used for every integration actor check, on the web and in the bot's close-actor rule alike) is the role-based union of:
- the category's `staff_role_ids`,
- the team's `businesses.staff_role_ids` ("Team Member" roles), and
- the team's `businesses.admin_role_ids` ("Team Manager" roles).

Only the member's roles count. Discord's **Manage Server** / **Administrator** permissions and the web's **sudo** flag do **not** make an actor staff. The ticket's opener additionally counts for `POST /messages` only, never for close.

**What gets posted:**
- The body is markdown-escaped, and mentions are defused.
- `allowed_mentions: {parse: []}` is set.
- The server appends `-# via <integration> · <itemRef>`.
- The webhook username falls back to the integration name, then `Euphoric Tickets`, when a name contains `clyde` or `discord`, or is exactly `everyone` or `here`.

**What gets stored:** `source='system'`, `author_kind='integration'`, `author_user_id` = the actor's user row or null, and `metadata {integrationId, itemRef, actorDiscordId, kind}`.

### `GET /api/v1/guild/roles` — `guild:read`

`200 [{id, name, color, position}]`, cached for 5 minutes per guild.

### `GET /api/v1/members/:discordId` — `guild:read`

`200 {member, pending, roleIds[]}`. A non-member returns `{member:false, pending:false, roleIds:[]}`.

## Integration audit (`integration_audit`)

Besides the admin actions and `ticket.opened` / `ticket.closed` (with `closedBy`) / `ticket.status_changed`, the API writes:

| Action | When | Metadata |
|---|---|---|
| `actor.forbidden` | every refused `actorDiscordId` (messages, re-posts and close) | `{ticketId, actorDiscordId, reason: impersonation_disabled\|not_member\|pending\|not_staff, purpose: message\|message_repost\|close}` |
| `message.posted_as_actor` | a message reached Discord under an impersonated actor's name | `{ticketId, messageId, actorDiscordId, repost}` (never the body) |
| `auth.failed` | failed authentication, **sampled**: at most one row per client bucket per minute and 10 rows per minute overall | `{bucket, reason: missing_or_malformed\|unknown_prefix\|bad_secret\|disabled\|business_missing\|unverified_while_braked, braked}`; `integration_id` is set only when the key prefix matched a row. Never the header, prefix or secret. |

## Web → bot bridge (plan §4.4)

The web calls `POST <BOT_INTERNAL_URL>/api/internal/tickets/{open,close,webhook/ensure}` with the header `x-internal-token: $INTERNAL_TOKEN`. There is **no** `DISCORD_BOT_TOKEN` fallback; if the token is missing, the call fails closed as `bot_unavailable`. The request bodies are exactly the §4.4 table, and the business is always passed by id.

| Route | Web sends | Web accepts |
|---|---|---|
| `open` | `{integrationId, integrationSlug, integrationName, businessId, categoryKey, openerDiscordId, subject, card, externalRef}` | `201/200 {ticketId:int, channelId:snowflake, created:bool}`; `404`; `403 {error:'opener_pending'\|'category_forbidden'}`; `409 {error:'opening_in_progress'\|'ticket_channel_missing'}`; `503` |
| `close` | `{ticketId, businessId, integrationId, actorDiscordId?, reason?}` | `200 {closed:true, closedBy:'actor'\|'bot'}`; `409`; `404` |
| `webhook/ensure` | `{ticketId, businessId, integrationId}` | `200 {webhookUrl}` where the URL is a Discord execute URL `https://discord.com/api[/vN]/webhooks/<id>/<token>` |

The status code is authoritative. For 403 the web reads the code from `{error}` (or `{code}`); anything that is not `opener_pending` is treated as `category_forbidden`. For 409 on open, `ticket_channel_missing` is passed through; any other 409 is `opening_in_progress`. The bot requires `integrationId` on `close` and `webhook/ensure` and refuses a ticket that is not bound to that integration and business. Any other status, a malformed body, or a timeout (20 s for open, 10 s for the others) becomes `502 bot_unavailable`. After an open succeeds, the web re-reads the ticket under the caller's scope and requires `external_ref` to match, so a mismatch is also a 502.

## Outbound webhooks (plan §4.5)

A dispatcher runs inside tickets-web. It is started from `src/instrumentation.ts` in the Node runtime only, and does work only while it holds a Postgres advisory lock (`pg_try_advisory_lock(1163152177, 1)`) on a dedicated reserved connection. It re-checks the lock on every 15 s sweep. `NOTIFY ticket_activity` only wakes it early. `INTEGRATION_DISPATCHER=off` disables it.

**Events:**
- `message.created`: every `ticket_messages` row on an integration ticket with `author_kind IS DISTINCT FROM 'integration' AND source <> 'internal'`. That covers Discord relay, web replies and system rows. The cursor is (`created_at`, `id`) per ticket with a 60 s lookback, and `UNIQUE (integration_id, event, source_key)` absorbs the overlap.
- `ticket.status_changed`, `ticket.closed`, `ticket.claimed` and `ticket.unclaimed`: produced by diffing `tickets.status` and `assignee_user_id` against `integration_ticket_state`.

**Payload** (the raw JSON body is exactly what is signed):

```json
{ "event": "message.created", "ticketId": 42, "externalRef": "batch:12", "occurredAt": "…Z",
  "message": { "id": "uuid", "source": "discord|web|system", "body": "…", "createdAt": "…Z",
               "author": { "discordId": "…", "name": "…" } | null,
               "attachments": [ { "name": "…", "contentType": "…", "size": 123 } ] } }

{ "event": "ticket.status_changed|ticket.closed", "ticketId": 42, "externalRef": "…", "occurredAt": "…Z",
  "from": "open", "to": "waiting", "ticket": { "status": "…", "claimedBy": "…|null", "closedAt": "…|null" } }

{ "event": "ticket.claimed|ticket.unclaimed", "ticketId": 42, "externalRef": "…", "occurredAt": "…Z",
  "claimedBy": "…|null", "ticket": { … } }
```

Attachment URLs are never sent, because Discord's CDN URLs are signed and expire.

**Headers:**

```
Content-Type: application/json
X-Euphoric-Delivery: <delivery uuid>          (unique; dedupe on it)
X-Euphoric-Event: <event>
X-Euphoric-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, `${t}.${deliveryId}.${rawBody}`)>
```

`t` is fresh on every attempt. The HMAC key is the webhook secret string's UTF-8 bytes. **A receiver MUST:**
1. reject when `|now − t| > 300 s`;
2. recompute the HMAC over the raw bytes and compare it with `timingSafeEqual` **before** parsing;
3. keep delivery ids unique;
4. ignore unknown tickets.

`verifySignatureHeader` in `src/server/integrations/signature.ts` is the reference implementation.

**Delivery rules:**
- `redirect: 'manual'`, so a 3xx counts as a failure (`redirect`).
- Any 2xx is success.
- Failures back off exponentially: 15 s, 30 s, … capped at 1 h, with jitter, until 24 h after the event. After that the delivery shows as `failed`.
- The delivery log keeps only the HTTP status and an error class: `http_4xx`, `http_5xx`, `redirect`, `timeout`, `blocked_address`, `dns`, `connect_refused`, `tls`, `integration_disabled`, `not_configured`, `not_allowlisted`, `decrypt_failed`, or `expired`.

**SSRF policy:**
- **At save:** the webhook URL must exactly equal an allowlist row's (scheme, host, port, path). No query string or credentials are allowed.
- **At send:** an undici `connect` hook resolves the host, checks **every** address, and pins the socket to the validated IP. TLS still verifies the hostname. The address must lie inside the matching allowlist row's `expected_network_cidr` and never in `127/8`, `169.254/16`, `0/8`, `::1`, `::` or `fe80::/10`.
- **Fail closed:** if the stored webhook URL no longer matches a current allowlist row at send time, nothing is sent and the delivery records `not_allowlisted`. There is no fallback to a public-address policy. Removing an allowlist row and clearing a webhook URL that no longer matches happen in one transaction (under a lock on the integration row, shared with setting the URL).
- If the hooks network is recreated with a different subnet, deliveries fail as `blocked_address` until the allowlist row's CIDR is updated.

## Operating it

- **Admin:** `/admin/integrations` is sudo-only. It covers:
  - creating an integration, with the API key **and** the webhook secret shown **once**;
  - scopes, allowed categories, link origin and actor impersonation;
  - allowlist rows, where the CIDR must be private and no broader than /16 (IPv4) or /48 (IPv6);
  - the webhook URL;
  - rotating the key or the secret, where the old value stops working immediately;
  - enabling or disabling the integration;
  - per-category `integration_only`;
  - the delivery log and the audit trail.

  Team admins see a read-only list on `/b/<slug>/settings`.
- **Env:** `INTEGRATION_ENC_KEY` holds 32 bytes, base64 or 64 hex characters (`openssl rand -base64 32`). It must stay out of dumps and git. Losing it makes stored webhook secrets undecryptable: deliveries fail with `decrypt_failed`, and you rotate each integration's secret. `INTERNAL_TOKEN` and `BOT_INTERNAL_URL` are required for the bridge.
- **Secret scanning:** add a GitHub custom secret-scanning pattern for `etk\.[0-9A-Za-z]{10}\.[0-9A-Za-z]{43}`. This is a repository setting, so a human does it.

### Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Every call `404` (even with a valid key) | the request's `Host` is not in `INTERNAL_API_HOSTS` | call `http://tickets-web:3000/…` on the docker network, or add the host you use to `INTERNAL_API_HOSTS` |
| Every call `401` | wrong key, key rotated, or integration disabled | re-issue the key on `/admin/integrations` |
| `429 rate_limited` on requests with a bad key | 20+ failed auths from that bucket in 10 min (by default all failures share one bucket) | fix the caller's key; valid keys are never braked, and the window clears in 10 min |
| Opens return `502 bot_unavailable` | `INTERNAL_TOKEN` or `BOT_INTERNAL_URL` unset or mismatched, bot down, or guild unavailable | check the bot's health and both `.env` files |
| Messages `502 discord_unavailable` | Discord error or deleted webhook | retry the same `Idempotency-Key` after 30 s; the webhook is re-ensured |
| Deliveries `blocked_address` | receiver resolves outside `expected_network_cidr` (hooks network recreated with a new subnet) | update the allowlist row's CIDR |
| Deliveries `dns` | receiver container or alias missing from the hooks network | re-attach the receiver to the network |
| Deliveries `not_allowlisted` | the stored webhook URL matches no allowlist row (row removed, or a DB edit) | re-add the allowlist row, then set the webhook URL again |
| Deliveries `decrypt_failed` | `INTEGRATION_ENC_KEY` changed or lost | rotate the webhook secret, then update the receiver |
| Nothing is dispatched | another process holds the advisory lock, or `INTEGRATION_DISPATCHER=off` | check `pg_locks` (classid 1163152177, objid 1) |
