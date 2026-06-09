# Dependencies, Advisories & SBOM Notes

Package manager: **pnpm 10.33.2**; lockfile committed; CI uses `--frozen-lockfile`.

## Advisory remediation (`pnpm audit`)

**Before:** 28 advisories — 2 Critical, 8 High, 14 Moderate, 4 Low (all in `next`
except `esbuild`, `postcss`, `next-auth`).

**After:** **1 Moderate** — `esbuild` only.

| Package | Was | Now | Why |
|---|---|---|---|
| `next` | 15.1.4 | **15.5.19** | Clears 26 advisories incl. CVE-2025-29927 (auth bypass, fix ≥15.2.3), React-flight RCE (≥15.1.9), SSRF (≥15.5.16), App Router XSS, Server Actions source exposure, multiple DoS |
| `eslint-config-next` | 15.1.4 | 15.5.19 | Keep in lockstep with `next` |
| `next-auth` | 5.0.0-beta.25 | 5.0.0-beta.30 | Clears the email-misdelivery advisory (not exploitable here — Discord-only auth, no email provider) — hygiene |
| `postcss` (direct) | ^8.5.0 | ^8.5.10 | XSS-in-CSS-stringify (build-time tooling) |
| `postcss` (transitive) | 8.4.31 | ≥8.5.10 | `pnpm.overrides` dedupe |
| `vitest` | — | ^4.1.8 (dev) | Added for regression tests |

### Residual: `esbuild` ≤0.24.2 (Moderate, accepted)
- Path: transitive via `drizzle-kit` → `@esbuild-kit/esm-loader@2.6.5` → `esbuild@0.18.20`.
- Advisory: esbuild dev-server lets any site send requests to the dev server. **We never run `esbuild serve`** — drizzle-kit only uses esbuild to bundle the config at schema-push time. **No runtime/production exposure.**
- Not force-overridden: bumping esbuild under the old `@esbuild-kit` loader risks breaking `drizzle-kit push`. Track upstream `drizzle-kit` updates instead.

## Supply-chain posture
- No abandoned/typosquat-looking packages; reputable ecosystem (`@radix-ui`, `drizzle`, `next-auth`, `zod`).
- pnpm's default **ignores lifecycle build scripts** (`esbuild`, `sharp`, `unrs-resolver` shown as "ignored") — a good default; nothing is auto-run on install.
- Docker base images (`node:24-alpine`, `postgres:16-alpine`) and the watchtower image are tag-pinned, **not digest-pinned** — recommended follow-up.
- GitHub Actions are now **SHA-pinned** (see `ci.yml`/`deploy.yml`/`security.yml`).

## SBOM
**Not generated in this environment** — no `syft`/`trivy`/`cdxgen` available. Generate on a machine that has them:

```bash
# CycloneDX (SBOM) for the JS dependency tree
pnpm dlx @cyclonedx/cyclonedx-npm --output-file sbom.cdx.json
# or, from a built image:
syft packages dir:. -o spdx-json > sbom.spdx.json
trivy fs --scanners vuln,license .
```

Production dependency count: **31** (top-level prod deps + transitive runtime).
Full list reproducible with `pnpm ls --prod`.

## Recommended CI additions (beyond what's applied)
- The new `security.yml` runs `pnpm audit` on PRs + weekly.
- If the repo is public or has GitHub Advanced Security: enable **CodeQL default setup** (JS/TS) and **dependency-review** on PRs.
- Consider Dependabot/Renovate for automated minor/patch bumps with the CI gate.
