# Deployment & Rollback

## What changed that affects deployment
1. **Image now runs as non-root `node`** with a `HEALTHCHECK` — requires a rebuild (CI does this on merge to `main`).
2. **Split `docker-compose.yml` now requires `POSTGRES_PASSWORD`** (no weak default). **Breaking** if you relied on the implicit `tickets_web_dev`.
3. Dependency upgrade `next 15.1.4 → 15.5.19` (+ `next-auth` beta.30) — verified `typecheck` + `build` locally; no app behaviour change expected.

## Pre-deploy gate (all green locally)
- `pnpm install --frozen-lockfile`
- `pnpm typecheck` ✓
- `pnpm test` ✓ (13/13)
- `pnpm build` ✓ (`next@15.5.19`)
- `pnpm audit` → 1 moderate (build-time only)

## ⚠️ Required: `POSTGRES_PASSWORD` migration (split compose)
The Postgres image sets the role password **only on first volume init**. If your
existing volume was created with the old default `tickets_web_dev`, you must
keep using that value (or rotate deliberately), or the app's `DATABASE_URL`
won't authenticate.

**Option A — preserve the existing volume (safe, recommended first step):**
```bash
# In the stack's .env, set the password to the value the volume already has:
echo "POSTGRES_PASSWORD=tickets_web_dev" >> .env   # if that was the old default
docker compose up -d
```

**Option B — rotate to a strong password (after Option A works):**
```bash
NEW=$(openssl rand -base64 24)
docker compose exec db psql -U tickets_web -c "ALTER ROLE tickets_web WITH PASSWORD '$NEW';"
# update .env POSTGRES_PASSWORD=$NEW, then:
docker compose up -d   # recreates web with the new DATABASE_URL
```
The `combined` compose already required `POSTGRES_PASSWORD`, so no change there.

## Deploy flow (unchanged mechanism)
1. Merge the PR to `main` (require the `CI` check first — see below).
2. `deploy.yml` builds + pushes `ghcr.io/jason-tucker/euphoric-tickets-web:{latest, sha-<sha>}`.
3. watchtower (60s poll) pulls `:latest` on the VPS and recreates `tickets-web`.
4. Entrypoint runs `drizzle-kit push --force` then `node server.js`.
5. Health: `GET /api/health` → `{ ok: true }` (now also the container `HEALTHCHECK`).

## Rollback
- **Fast:** repoint the running container to the previous immutable tag and disable auto-pull briefly:
  ```bash
  docker compose -f docker-compose.yml stop watchtower
  docker pull ghcr.io/jason-tucker/euphoric-tickets-web:sha-a7c6031
  WEB_IMAGE=ghcr.io/jason-tucker/euphoric-tickets-web:sha-a7c6031 docker compose up -d tickets-web
  ```
  (The compose `image:` already supports a `${WEB_IMAGE}` override.)
- **Source:** revert the PR merge commit; CI re-publishes the prior code.
- **DB:** `drizzle-kit push` is additive for these changes (no destructive diff expected). Backups exist via the restic systemd timer (`ops/`); restore with `restic restore` if needed. **Do not** run a destructive schema change without a verified backup.

## Staging / DAST
No staging target was provided (UNSPECIFIED) and the app needs live Discord
OAuth + Postgres + bot token to exercise. If a staging host is set up, run a
ZAP baseline against it (it must tolerate iframe embedding — do **not** assert
`X-Frame-Options`, which the app intentionally omits).

## Supply-chain follow-ups (manual)
- Pin `nickfedor/watchtower` by digest (or move to a docker-socket-proxy with a read-mostly socket).
- Pin `node:24-alpine` / `postgres:16-alpine` by digest.
- Enable branch protection (required `CI`), secret scanning + push protection, and CodeQL (if eligible).
