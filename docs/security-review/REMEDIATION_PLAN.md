# Remediation Plan — euphoric-tickets-web

Status of each finding from `SECURITY_REVIEW_REPORT.md`. Applied = landed on
`ai/security-optimization-review/20260609-a7c6031`.

## Applied in this PR (auto-fixed, verified by typecheck + test + build)

| ID | Action | Files |
|---|---|---|
| F-01/02/03 | Upgrade `next 15.1.4 → 15.5.19` (clears 2 Critical + 8 High + 14 Moderate + 4 Low); bump `eslint-config-next`, `next-auth→beta.30`, `postcss` | `package.json`, `pnpm-lock.yaml` |
| F-04 | Add `src/lib/ssrf.ts`; use `assertPublicHttpUrl` for the user ntfy server (private-IP deny + DNS resolution) | `src/lib/ssrf.ts`, `src/server/notify.ts` |
| F-05 | Add `AbortSignal.timeout` to every outbound Discord/notify call | `src/lib/discord.ts`, `src/server/notify.ts` |
| F-06 | Non-root `node` user + `HEALTHCHECK` | `Dockerfile` |
| F-07 | Require `POSTGRES_PASSWORD` (remove weak default) | `docker-compose.yml` |
| F-08 | `no-new-privileges` on combined watchtower | `docker-compose.combined.yml` |
| F-09 | SHA-pin all GitHub Actions | `.github/workflows/{ci,deploy,security}.yml` |
| F-10 | `permissions: contents: read` on CI | `.github/workflows/ci.yml` |
| F-11 | `pnpm test` gate + `pnpm audit` workflow | `ci.yml`, `security.yml`, `vitest.config.ts`, `src/lib/ssrf.test.ts` |
| F-12 | Constant-time token compare + Zod body schema | `src/app/api/internal/notify/route.ts` |
| F-13 | Clamp members `q` to 100 chars | `src/app/api/discord/[guildId]/members/route.ts` |
| F-14 | Validate `guildId` (`^\d{17,20}$`) | `src/app/admin/bot/actions.ts` |
| F-15 | Validate `categoryId` (UUID) | `src/app/b/[slug]/settings/actions.ts` |
| F-16 | Tighten `/demo/persona` redirect boundary | `src/app/demo/persona/route.ts` |
| F-17 | Structural `parseSafeHttpUrl` reject of unsafe ntfy URL at save time | `src/app/settings/notifications/actions.ts` |

## Requires human action (documented, not auto-applied)

| ID | Why not auto-fixed | Recommended action |
|---|---|---|
| F-07 | Changing the compose password is operationally breaking for an existing volume | Set `POSTGRES_PASSWORD` to the existing value, then rotate (`DEPLOYMENT_AND_ROLLBACK.md`) |
| F-08 | Pinning a digest requires a trusted registry lookup and is a maintainer policy call | Pin `nickfedor/watchtower` by digest or adopt a docker-socket-proxy; pin base images by digest |
| F-19 | `esbuild` is a transitive build-time dep of `drizzle-kit`; forcing it may break the loader | Track `drizzle-kit` updates; no runtime exposure today |
| — | Repo settings are outside the codebase | Branch protection requiring `CI`; enable secret scanning + push protection; CodeQL default setup if eligible |

## Deliberately not changed (accepted risk)

- **F-18** inline remote `<img>` in ticket markdown — mirrors Discord's own behaviour; changing it would break legitimate image embeds. Documented privacy note.
- **F-20** 10-minute guild snapshot — intentional per `CLAUDE.md`; fail-safe redirect on a missing guild.
- **F-21** `update` script `git reset --hard` — operator convenience tool, run manually.
- **F-22** `drizzle-kit push --force` at boot — the project's chosen schema strategy (no SQL migration files); covered by restic backups.

## Patch principles followed
Minimal, framework-native, server-side, allowlist/deny-list explicit,
parameterized queries already in place. No behaviour change beyond the
documented breaking compose requirement. No giant rewrites.
