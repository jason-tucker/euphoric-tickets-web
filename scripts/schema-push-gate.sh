#!/bin/sh
# Schema push gate (plan §4.1). Run BEFORE merging any schema change.
#
#   scripts/schema-push-gate.sh <DATABASE_URL>
#   DATABASE_URL=postgresql://… scripts/schema-push-gate.sh
#
# Point it at a SCRATCH Postgres restored from the latest production dump
# (never at production). It runs `drizzle-kit push --force --verbose` twice:
#
#   run 1 must not contain DROP or TRUNCATE (an additive-only change), and
#   run 2 must emit NO statement at all ("No changes detected") — i.e. the
#         declared schema and the pushed database have converged, so the
#         container entrypoint's push on every boot is a no-op.
#
# Exit 0 = pass. Any failure exits non-zero and prints the offending output.
#
# SAFETY: `push --force` has no dry-run mode, so run 1 is APPLIED before it is
# inspected. That is why the target must be a scratch database, and why the
# script refuses to run unless SCHEMA_GATE_SCRATCH=yes is set explicitly.
#
# Where drizzle-kit comes from (first match wins):
#   DRIZZLE_KIT / DRIZZLE_CONFIG env vars, if set;
#   the production image layout (/opt/drizzle, drizzle.config.cjs) — so the
#     gate can run inside the NEW image exactly as the entrypoint would:
#       docker run --rm --entrypoint sh -e DATABASE_URL=… <image> \
#         /opt/drizzle/schema-push-gate.sh        (see docs/INTEGRATION_SCHEMA.md)
#   else the repo checkout (node_modules/drizzle-kit + drizzle.config.ts).
set -eu

URL="${1:-${DATABASE_URL:-}}"
if [ -z "$URL" ]; then
  echo "usage: $0 <DATABASE_URL>   (or set DATABASE_URL)" >&2
  exit 2
fi

if [ "${SCHEMA_GATE_SCRATCH:-}" != "yes" ]; then
  echo "refusing: this gate APPLIES the schema to the target database." >&2
  echo "Point it at a scratch restore of the production dump and set SCHEMA_GATE_SCRATCH=yes." >&2
  exit 2
fi

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)

if [ -n "${DRIZZLE_KIT:-}" ]; then
  KIT="$DRIZZLE_KIT"
  CONFIG="${DRIZZLE_CONFIG:?DRIZZLE_CONFIG must be set with DRIZZLE_KIT}"
  WORKDIR="${DRIZZLE_WORKDIR:-$(pwd)}"
elif [ -f /opt/drizzle/drizzle.config.cjs ] && [ -f /opt/drizzle/node_modules/drizzle-kit/bin.cjs ]; then
  KIT="node /opt/drizzle/node_modules/drizzle-kit/bin.cjs"
  CONFIG="./drizzle.config.cjs"
  WORKDIR=/opt/drizzle
else
  REPO=$(cd "$SCRIPT_DIR/.." && pwd)
  KIT="node $REPO/node_modules/drizzle-kit/bin.cjs"
  CONFIG="./drizzle.config.ts"
  WORKDIR="$REPO"
fi

# Strip ANSI colour/cursor sequences so the checks see plain text.
ESC=$(printf '\033')
CR=$(printf '\r')
strip_ansi() {
  sed -e "s/${ESC}\[[0-9;]*[A-Za-z]//g" -e "s/${CR}//g"
}

run_push() {
  # shellcheck disable=SC2086 # KIT is intentionally word-split ("node <path>")
  (cd "$WORKDIR" && DATABASE_URL="$URL" $KIT push --config="$CONFIG" --force --verbose 2>&1) | strip_ansi
}

# Same failure sniffing as scripts/docker-entrypoint.sh: drizzle-kit swallows
# some schema-load errors and still exits 0.
check_errors() {
  if printf '%s\n' "$1" | grep -qiE 'cannot find module|MODULE_NOT_FOUND|Error:|error:'; then
    echo "✗ drizzle-kit push failed ($2):" >&2
    printf '%s\n' "$1" >&2
    exit 1
  fi
}

# A statement line = starts (after optional whitespace) with a SQL verb.
STATEMENT_RE='^[[:space:]]*(CREATE|ALTER|DROP|TRUNCATE|INSERT|UPDATE|DELETE|COMMENT|GRANT|REVOKE|DO|SELECT|SET)[[:space:]]'

echo "▶ schema-push-gate: run 1 (apply)"
OUT1=$(run_push)
printf '%s\n' "$OUT1"
# Destructive-statement check first: it is the more important verdict, and a
# destructive push often also trips a drizzle-kit error part-way through.
if printf '%s\n' "$OUT1" | grep -qE '^[[:space:]]*(DROP|TRUNCATE)[[:space:]]|[[:space:]](DROP|TRUNCATE)[[:space:]]'; then
  echo "✗ GATE FAIL: run 1 contains DROP or TRUNCATE — the change is not additive:" >&2
  printf '%s\n' "$OUT1" | grep -E '(DROP|TRUNCATE)[[:space:]]' >&2
  exit 1
fi
check_errors "$OUT1" "run 1"

echo "▶ schema-push-gate: run 2 (must be empty)"
OUT2=$(run_push)
printf '%s\n' "$OUT2"
check_errors "$OUT2" "run 2"
if printf '%s\n' "$OUT2" | grep -qE "$STATEMENT_RE"; then
  echo "✗ GATE FAIL: run 2 emitted statements — schema and database have not converged:" >&2
  printf '%s\n' "$OUT2" | grep -E "$STATEMENT_RE" >&2
  exit 1
fi
if ! printf '%s\n' "$OUT2" | grep -q 'No changes detected'; then
  echo "✗ GATE FAIL: run 2 did not report 'No changes detected'." >&2
  exit 1
fi

echo "✓ schema-push-gate: PASS (run 1 additive, run 2 empty)"
