# What's new

## v0.11 — June 2026 · Make it yours: themes & layouts

- **Pick your color theme.** Five looks — **Midnight**, **Graphite**, **Ocean**, **Forest**, and **Paper** (light) — switchable from your avatar menu in the header. Changes apply instantly and are remembered on this browser.
- **Pick your layout.** Three chrome styles — **Top bar**, **Sidebar**, and **Compact** — for the whole app, *and* per area: run Sidebar everywhere but Compact on the Tickets console, or give the ticket view its own layout. Set it from the same avatar menu ("This page").
- **A leaner, tool-first feel.** Slimmer header, tighter page titles, less wasted space — the same controls everywhere, in whatever skin you choose.
- The demo at `/demo` has the same theme and layout switcher (the palette button in its header).
- **This cleaner "What's new" dialog** — it now shows only what you'd notice, not every internal change.

## v0.9–v0.10 — June 2026 · Try-before-you-sign-in, prettier messages

- **A full interactive demo at [/demo](/demo)** — the entire app on sample data, no sign-in. Reply, claim, close, edit settings, even switch between End user / Staff / Admin / Sudo views. Everything you change is saved only in your browser.
- **Conversations render Discord formatting much more faithfully** — click-to-reveal `||spoilers||`, custom and animated emoji, inline image/gif embeds, and clean @user / #channel pills instead of raw IDs.
- Faster page loads and a round of security updates under the hood.

## v0.8 — June 2026 · The Tickets console

- **A live, cross-team Tickets console** for staff and admins: every ticket you can see in one dense grid — sortable columns, per-column filters (status, team, category, date ranges, free text), an Anyone/Mine/Unassigned toggle, and a row-density switch. It updates live, with no reloads, and remembers your view.
- **The console fills the whole screen** — no more centered card with wasted margins — and works down to phone width.
- **One header everywhere.** The per-team second nav row is gone; Settings has its own team switcher.
- **Rename a ticket from the pencil next to its title.** The toolbar got tidier too — assignment now lives on the Assign button itself.
- The activity log shows real names ("assigned to Sam") instead of raw Discord IDs.

## v0.7 — June 2026 · My tickets, three ways

- **The Overview now splits into Mine / Team / Admin** — tickets you're personally on, tickets you can reach through a staff role, and everything else in teams you administer. No more guessing why a ticket is in your list.
- **The version number in the footer opens this changelog.**

## v0.6 — May–June 2026 · The big build-out

- **Live two-way conversations** — Discord messages appear on the web within a second, and your web replies land in the Discord channel as you (your name + avatar).
- **Audio and file attachments** show up in the web conversation — audio plays inline.
- **Notifications** — get pinged via [ntfy](https://ntfy.sh) push or Discord DM for new tickets and replies, tunable globally, per team, or per category.
- **More statuses** — Open, In Progress, Waiting, On Hold, Completed, Closed — plus a Status dropdown on the ticket.
- **The People card** — see who's on a ticket, add or remove members, hand over ownership. You can even add someone **outside the Discord server** by ID; they get a DM link and can reply from the web.
- **Internal notes** — staff-only notes on a ticket the opener never sees.
- **A lifecycle log on every ticket** — opened, claimed, assigned, moved, closed — inline in the conversation and in a Log card.
- **Server nicknames and server avatars** are used everywhere, matching what you see in Discord.
- **TicketTool coexistence** — teams that run TicketTool can see and control those tickets here too.
- **Closed tickets reopen cleanly** — even if the Discord channel was deleted, reopening spins up a fresh channel and replays recent context.
- **A help page at [/help](/help)** covering the whole system.
- **Phone-friendly** — the whole app works down to ~360px wide.

## v0.1–v0.5 — May 2026 · The beginning

- First release: Discord sign-in, opening tickets from the web or the Discord panel, per-team queues, team settings with categories, and transcripts that stay on the web after a ticket closes.
