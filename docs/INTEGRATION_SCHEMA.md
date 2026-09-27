# Integration API — schema (v0.12.0)

This web repo **owns** the schema (`drizzle-kit push`); the bot repo
(`euphoric-tickets`) mirrors it **by name**. This file is the exact list to
diff the bot mirror against. Source files:

- `src/db/schema/integrations.ts` — `integrations`, `integration_webhook_allowlist`, `integration_deliveries`, `integration_audit`
- `src/db/schema/integrationState.ts` — `integration_ticket_state`, `integration_open_claims`
- `src/db/schema/tickets.ts`, `ticketMessages.ts`, `ticketCategories.ts` — the added columns

Every change is **additive**. Nothing existing is renamed, retyped or dropped.

## New tables

### `integrations`

| column | type | null | default | notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK |
| `business_id` | uuid | NOT NULL | | FK → `businesses.id` ON DELETE CASCADE |
| `name` | text | NOT NULL | | display name; used in the Discord footer and as the webhook username |
| `slug` | text | NOT NULL | | used in audit `via='integration:<slug>'` |
| `key_prefix` | text | NOT NULL | | 10 base62 chars |
| `key_hash` | text | NOT NULL | | hex sha256 of the 43-char secret |
| `scopes` | text[] | NOT NULL | *(none)* | ⊆ `tickets:read`, `tickets:write`, `tickets:close`, `guild:read` |
| `allowed_category_keys` | text[] | NOT NULL | *(none)* | `ticket_categories.key` values within `business_id` |
| `link_origin` | text | NULL | | exact origin required of `card.link.url` |
| `actor_impersonation` | boolean | NOT NULL | `false` | |
| `webhook_url` | text | NULL | | must match an allowlist row at save time |
| `webhook_secret_enc` | text | NULL | | `v1:<iv>:<tag>:<ct>` AES-256-GCM (`INTEGRATION_ENC_KEY`), AAD = integration id |
| `enabled` | boolean | NOT NULL | `true` | |
| `created_by` | uuid | NULL | | FK → `users.id` |
| `created_at` | timestamptz | NOT NULL | `now()` | |
| `last_used_at` | timestamptz | NULL | | throttled to at most one write per minute |

Indexes: `integrations_key_prefix_uq` UNIQUE (`key_prefix`), `integrations_slug_uq` UNIQUE (`slug`), `integrations_business_idx` (`business_id`).

The array columns deliberately have **no column default**. drizzle-kit 0.31 re-diffs array defaults on every push, which would make the second gate run non-empty.

### `integration_webhook_allowlist`

| column | type | null | notes |
|---|---|---|---|
| `integration_id` | uuid | NOT NULL | FK → `integrations.id` ON DELETE CASCADE |
| `scheme` | text | NOT NULL | `http` \| `https` |
| `host` | text | NOT NULL | lowercase |
| `port` | integer | NOT NULL | explicit (80/443 filled in when the URL omits it) |
| `path` | text | NOT NULL | exact path, e.g. `/api/hooks/tickets` |
| `expected_network_cidr` | text | NOT NULL | e.g. `172.30.40.0/24` (the `efm-music-hooks` subnet) |

PK `integration_webhook_allowlist_pk` (`integration_id`, `scheme`, `host`, `port`, `path`). The name is explicit because the generated one exceeds Postgres' 63-byte identifier limit.

### `integration_deliveries`

| column | type | null | default | notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK; also the `X-Euphoric-Delivery` header |
| `integration_id` | uuid | NOT NULL | | FK → `integrations.id` ON DELETE CASCADE |
| `event` | text | NOT NULL | | see `docs/INTEGRATION_API.md` |
| `source_key` | text | NOT NULL | | message id, or a per-transition key for state events |
| `payload` | jsonb | NOT NULL | | the signed body |
| `attempts` | integer | NOT NULL | `0` | |
| `next_attempt_at` | timestamptz | NULL | `now()` | NULL = delivered or given up |
| `delivered_at` | timestamptz | NULL | | |
| `last_status` | integer | NULL | | HTTP status of the last attempt |
| `last_error_class` | text | NULL | | coarse class only (`http_5xx`, `timeout`, `blocked_address`, `expired`, …) |
| `created_at` | timestamptz | NOT NULL | `now()` | **addition beyond plan §4.1**: the 24 h backoff budget and the log ordering are measured from it |

Indexes: `integration_deliveries_source_uq` UNIQUE (`integration_id`, `event`, `source_key`), `integration_deliveries_due_idx` (`next_attempt_at`), `integration_deliveries_integration_idx` (`integration_id`, `created_at`).

### `integration_ticket_state`

| column | type | null | notes |
|---|---|---|---|
| `ticket_id` | integer | NOT NULL | PK, FK → `tickets.id` ON DELETE CASCADE |
| `last_status` | text | NULL | |
| `last_assignee` | uuid | NULL | FK → `users.id` ON DELETE SET NULL |
| `msg_cursor_created_at` | timestamptz | NULL | |
| `msg_cursor_id` | uuid | NULL | |

### `integration_open_claims` (written by the **bot**)

| column | type | null | default | notes |
|---|---|---|---|---|
| `integration_id` | uuid | NOT NULL | | FK → `integrations.id` ON DELETE CASCADE |
| `external_ref` | text | NOT NULL | | |
| `state` | text | NOT NULL | | `opening` \| `open` \| `failed` |
| `channel_id` | text | NULL | | written immediately after channel create |
| `ticket_id` | integer | NULL | | FK → `tickets.id` ON DELETE SET NULL |
| `updated_at` | timestamptz | NOT NULL | `now()` | the 2-minute takeover clock |

PK (`integration_id`, `external_ref`) — generated name `integration_open_claims_integration_id_external_ref_pk`.

### `integration_audit`

| column | type | null | default | notes |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK |
| `integration_id` | uuid | NULL | | **no FK** (non-cascading, survives deletion) |
| `business_id` | uuid | NULL | | no FK |
| `actor_user_id` | uuid | NULL | | no FK; the sudo user for admin actions, NULL for API calls |
| `action` | text | NOT NULL | | e.g. `integration.created`, `key.rotated`, `ticket.opened` |
| `metadata` | jsonb | NOT NULL | `'{}'` | never secrets, keys, or headers |
| `created_at` | timestamptz | NOT NULL | `now()` | |

Index: `integration_audit_integration_idx` (`integration_id`, `created_at`).

## Columns added to existing tables

### `tickets`

| column | type | null | notes |
|---|---|---|---|
| `integration_id` | uuid | NULL | FK → `integrations.id` (no action on delete) |
| `external_ref` | text | NULL | |
| `integration_card` | jsonb | NULL | `{title, lines[], link:{label,url}}` |

Index `tickets_integration_external_ref_uq` UNIQUE (`integration_id`, `external_ref`). It is not partial: NULLs are distinct. `external_source` stays `'euphoric'` for integration tickets.

### `ticket_messages`

| column | type | null | default | notes |
|---|---|---|---|---|
| `metadata` | jsonb | NOT NULL | `'{}'` | integration rows: `{integrationId, itemRef, actorDiscordId, kind}` |
| `author_kind` | text | NOT NULL | `'human'` | `human` \| `integration`. **Every non-API insert path leaves the default** |
| `idempotency_key` | text | NULL | | the API `Idempotency-Key` header |

Index `ticket_messages_ticket_idempotency_uq` UNIQUE (`ticket_id`, `idempotency_key`).

### `ticket_categories`

| column | type | null | default |
|---|---|---|---|
| `integration_only` | boolean | NOT NULL | `false` |

## Schema-push gate

Run `scripts/schema-push-gate.sh` against a **scratch** restore of the latest production dump before merging:

```sh
SCHEMA_GATE_SCRATCH=yes scripts/schema-push-gate.sh postgresql://user:pw@scratch-host:5432/db
# or, inside the new image (the script is copied to /opt/drizzle):
docker run --rm --network <scratch-net> --entrypoint sh \
  -e SCHEMA_GATE_SCRATCH=yes -e DATABASE_URL=postgresql://… <new-image> /opt/drizzle/schema-push-gate.sh
```

The script runs `drizzle-kit push --force --verbose` twice. It fails if run 1 contains `DROP`/`TRUNCATE`, and fails if run 2 emits any statement. `push --force` has no dry-run mode, so run 1 is applied before it is inspected. That is why the script refuses to start without `SCHEMA_GATE_SCRATCH=yes`.
