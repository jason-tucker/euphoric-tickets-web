# /demo — public interactive demo (read-only against the real system)

`/demo/*` is a public, unauthenticated mirror of the whole app, running on
deterministic synthetic data. It is fully interactive — visitors can reply,
claim/close/assign, edit settings, and open tickets — but **every change is saved
only in the visitor's browser (localStorage)** and **nothing ever reaches the
database, Discord, or any server mutation.** That isolation is the whole point;
keep it intact.

## Hard rules

- **Never import `@/db/client` or any `actions.ts`** from `src/app/demo/**`,
  `src/server/demo/**`, or `src/components/demo/**`. Define no `'use server'`
  actions here. The base data comes only from `src/server/demo/*`; writes go only
  to the localStorage overlay in `src/components/demo/store.tsx`.
- **No live Discord / SSE.** Don't use `DiscordPicker`, `LiveRefresh`,
  `ReplyForm`, `TitleEditor`, or hit `/api/discord/*` or `/api/tickets/*`. Reuse
  the real `TicketsConsole` with `live={false}`. Demo tickets set
  `discordChannelId: null` so there are no dead "Open in Discord" links.
- **Client components import server demo modules as `import type` only** (so the
  generator never enters the browser bundle). Plain-data constants live in
  `src/server/demo/meta.ts`, which is safe to import from the client.

## Agent usage

Always spawn agents to do work. Haiku for lookups. Sonnet for coding. Opus for planning.

Use agents proactively and match the model to the task — Haiku for lookups/searches/verification, Sonnet for coding and doc edits, Opus for planning and cross-cutting strategy. Run independent work in parallel, give each agent a precise scope and expected output, require repository-evidence citations, never let two agents edit the same file at once, and validate every result before accepting it. The full agent-usage policy and all other mandatory rules (CHANGELOG, project board, semver bump) are inherited from the parent [`../../../CLAUDE.md`](../../../CLAUDE.md); this file only adds the demo-specific invariants.

Before touching `src/app/demo/**`, `src/server/demo/**`, or `src/components/demo/**`, verify the read-only invariants:

```bash
grep -rn "use server\|@/db/client\|from '@/.*actions'" src/app/demo src/server/demo src/components/demo
```

Any hit outside this file is a violation. (A value import from `src/server/demo/meta.ts` — plain-data constants only — is the single permitted client import that is not `import type`.)

## Known parity gaps

The following real-app screens do not yet have a `/demo` mirror:

- `/demo/t/[id]` — individual ticket view for the opener (only `/demo/t/new` exists)
- `/demo/settings/*` — notification preferences and team settings hub
- `/demo/help` — help and feature explainer page

When adding or updating any of these real screens, mirror them in `/demo` per the parity rule above.

## How it fits together

- `src/server/demo/` — the read-only base: a seeded, date-independent generator
  (`rng.ts`, `data.ts`) projected to today-anchored, serializable views
  (`dates.ts`, `personas.ts`, `detail.ts`, `extras.ts`). 13 teams across 4 guilds,
  402–1673 tickets each; a small "today" cluster + a ~3-year spread, re-anchored
  on every request so dates stay fresh daily. Build-once, memoized.
- `src/components/demo/store.tsx` — the per-browser overlay (localStorage) and the
  pure merge helpers. All "writes" land here.
- Four personas (End user → Staff → Admin → Sudo) via the `demo_persona` cookie
  (`/demo/persona` GET handler). Visibility mirrors the real permission model
  exactly (`personas.ts`).

## When you change the real app

Mirror it here. New screen or control → add an interactive, overlay-backed
version under `/demo` so the demo stays a faithful, current preview.
