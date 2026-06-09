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
