# Security Changelog — v0.10.0 (2026-06-09)

Security-relevant changes from the review on branch
`ai/security-optimization-review/20260609-a7c6031` (base `a7c6031`).

## Fixed
- **[Critical] CVE-2025-29927** Next.js middleware authorization bypass — `next 15.1.4 → 15.5.19`.
- **[Critical]** Next.js React-flight RCE (`<15.1.9`) — same upgrade.
- **[High]** Next.js SSRF, App Router XSS, Server Actions source-code exposure, multiple DoS (`<15.5.16`) — same upgrade.
- **[Medium] SSRF (CWE-918)** via user-supplied `ntfyServer` — new `src/lib/ssrf.ts` deny-list (private/reserved IPs, internal hostnames, DNS resolution) applied in `src/server/notify.ts` (send) and `src/app/settings/notifications/actions.ts` (save).
- **[Medium] Resource exhaustion (CWE-400)** — `AbortSignal` timeouts on all Discord (`src/lib/discord.ts`) and notification (`src/server/notify.ts`) outbound calls.
- **[Medium] Container hardening (CWE-250)** — Dockerfile runs as non-root `node` + `HEALTHCHECK`.
- **[Medium] Weak default credential (CWE-1188)** — `docker-compose.yml` requires `POSTGRES_PASSWORD` (breaking; see deploy doc).
- **[Low] Timing side-channel (CWE-208)** — `/api/internal/notify` token compared with `crypto.timingSafeEqual`; body validated with Zod.
- **[Low] Supply chain (CWE-1357)** — all GitHub Actions SHA-pinned; CI `permissions: contents: read`; `pnpm test` gate; `security.yml` `pnpm audit` job.
- **[Low] Input validation** — members `?q=` length clamp; `guildId` / `categoryId` format checks; tightened `/demo/persona` redirect (CWE-601 robustness).

## Mitigated / documented (manual follow-up)
- watchtower Docker-socket image: `no-new-privileges` added (combined); digest-pin pending.
- `esbuild` build-time advisory (transitive via `drizzle-kit`): no runtime exposure.
- Base image digest pinning; branch protection; secret scanning; CodeQL.

## Accepted (by design)
- 10-minute guild-permission snapshot; `drizzle-kit push --force` at boot; inline remote `<img>` in ticket markdown (viewer-IP privacy note).

## Verification
`pnpm typecheck` ✓ · `pnpm test` 13/13 ✓ · `pnpm build` ✓ · `pnpm audit` 28 → 1.
