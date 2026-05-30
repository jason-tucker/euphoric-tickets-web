#!/usr/bin/env bash
# P19 (lantern) — Grandfather-Father-Son (GFS) tiered backup of the Euphoric
# Tickets Postgres DB (which also holds all settings) using restic.
#
# Schedule it from the systemd timer (every 45min + a 02:00 daily anchor).
# Each run: pg_dump → restic backup (dedup) → restic forget --prune with the
# GFS retention policy below. Restic dedups across snapshots, so ~17 retained
# snapshots cost roughly 1.2–1.5× the live DB size, not 17× a full dump.
#
# Required env (e.g. in /etc/tickets-backup.env, loaded by the unit):
#   RESTIC_REPOSITORY   e.g. /var/backups/restic-tickets  (or s3:/b2: URL)
#   RESTIC_PASSWORD     repo encryption password
#   PGHOST PGUSER PGPASSWORD PGDATABASE   (or a single PG* / DATABASE_URL)
#
# First-time init:  restic init   (with the same RESTIC_* env)
set -euo pipefail

: "${RESTIC_REPOSITORY:?set RESTIC_REPOSITORY}"
: "${RESTIC_PASSWORD:?set RESTIC_PASSWORD}"
: "${PGDATABASE:=tickets_web}"
: "${PGUSER:=tickets_web}"

DUMP_NAME="tickets_web.dump"

echo "▶ $(date -Is) backup start → ${RESTIC_REPOSITORY}"

# --format=custom is compressed + selectively restorable. Stream straight into
# restic via stdin so nothing large lands on disk.
pg_dump --format=custom --no-owner --no-privileges "${PGDATABASE}" \
  | restic backup --stdin --stdin-filename "${DUMP_NAME}" --tag tickets --host tickets

# GFS retention — one snapshot kept per time slot:
#   ~6–7 within the last 5h (the 45-min cadence)  ·  3 daily  ·  4 weekly  ·  4 monthly
restic forget --prune \
  --keep-within-hourly 5h \
  --keep-daily   3 \
  --keep-weekly  4 \
  --keep-monthly 4

echo "✓ $(date -Is) backup + prune done"
restic snapshots --compact --tag tickets | tail -n 5
