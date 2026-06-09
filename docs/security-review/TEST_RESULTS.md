# Test Results

All commands run in this review environment (Node v22, pnpm 10.33.2) on branch
`ai/security-optimization-review/20260609-a7c6031`.

| Command | Result | Notes |
|---|---|---|
| `pnpm install` | ✅ pass (exit 0) | Lockfile regenerated for upgrades + vitest |
| `pnpm typecheck` (`tsc --noEmit`) | ✅ pass | Clean at baseline and after every change |
| `pnpm test` (`vitest run`) | ✅ pass | **13/13** in `src/lib/ssrf.test.ts` (306 ms) |
| `pnpm build` (`next build`) | ✅ pass | Verified on `next@15.5.19`; all routes compile |
| `pnpm audit` | ✅ 28 → 1 | Only build-time `esbuild` (moderate) remains |
| `pnpm lint` (`next lint`) | ⚠️ not run | `next lint` is **unconfigured/interactive** (no ESLint config file present; prompts and exits 1). Pre-existing; not introduced here. Documented as a follow-up. |

## New regression tests — `src/lib/ssrf.test.ts`
Covers the SSRF guard that protects the one user-controlled outbound URL:

- `isPrivateOrReservedIp`: IPv4 loopback/private/CGNAT (`127/8`, `10/8`, `172.16/12`, `192.168/16`, `100.64/10`, `0/8`); cloud metadata `169.254.169.254`; multicast/reserved/broadcast; **allows** public v4 (`8.8.8.8`, `1.1.1.1`); IPv6 loopback/ULA/link-local/v4-mapped/multicast; **allows** public v6; fails closed on garbage.
- `parseSafeHttpUrl`: accepts public http(s); rejects private/loopback/metadata literals, `localhost`/`*.internal`/`*.local`/bare single-label hosts, and non-http(s) schemes (`ftp:`, `file:`, `javascript:`).
- `assertPublicHttpUrl`: resolves for a public IP literal; rejects private literals, internal names, and bad schemes with `BlockedUrlError`.

```
 Test Files  1 passed (1)
      Tests  13 passed (13)
```

## Verification not possible here (and why)
- **End-to-end / browser flows:** require live Discord OAuth, a Discord bot token, and a Postgres instance with seeded businesses — none available in this container. The build's route compilation is the strongest automated signal available.
- **DAST (ZAP):** no running staging target (UNSPECIFIED).
- **Image build / non-root runtime:** Docker not available here; the `Dockerfile` change is static-reviewed (uses the base image's existing `node` uid 1000 and `chown`s `/app` + `/opt/drizzle`).
