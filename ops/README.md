# Ops — backup & multi-VPS (lantern P18 + P19)

## P19 — GFS database backups (restic)

The Postgres DB holds **everything**, including all team/category/notification
settings — so backing up the DB backs up the settings too.

**Term:** the schedule is **Grandfather-Father-Son (GFS)** tiered retention.
Combined with restic's content-addressable dedup, ~17 retained snapshots over
4 months cost roughly **1.2–1.5× the live DB size** (not 17× a full dump).

### Install (on the Postgres host)

```sh
apt-get install -y restic            # or download the static binary
install -m755 ops/tickets-backup.sh /usr/local/bin/tickets-backup.sh
cp ops/tickets-backup.{service,timer} /etc/systemd/system/

# secrets + repo location
cat >/etc/tickets-backup.env <<'EOF'
RESTIC_REPOSITORY=/var/backups/restic-tickets
RESTIC_PASSWORD=<long random>
PGDATABASE=tickets_web
PGUSER=tickets_web
PGPASSWORD=<db password>
PGHOST=127.0.0.1
UPTIME_KUMA_BACKUP_URL=<optional push url>
EOF
chmod 600 /etc/tickets-backup.env

restic init                          # one-time, with the RESTIC_* env loaded
systemctl daemon-reload
systemctl enable --now tickets-backup.timer
```

### Retention policy (in the script)

```
--keep-within-hourly 5h   # ~6–7 from the 45-min cadence
--keep-daily   3
--keep-weekly  4
--keep-monthly 4
```

### Off-site mirror (recommended)

Nightly `rclone copy /var/backups/restic-tickets b2:my-bucket/restic-tickets`
protects against losing the VPS. The restic repo is encrypted at rest.

### Restore drill

```sh
restic snapshots
restic restore <id> --target /tmp/restore
createdb tickets_web_restore
pg_restore -d tickets_web_restore /tmp/restore/tickets_web.dump
# verify row counts, then promote or cherry-pick tables.
```

Settings-only rollback: restore to a scratch DB, then
`pg_dump --data-only --table=businesses --table=ticket_categories tickets_web_restore | psql tickets_web`.

---

## P18 — multi-VPS load balancing

**Web is stateless** (in-memory caches regenerate on cold start), so any number
of VPS can serve it behind a load balancer with no session affinity. Put this
on the ingress Caddy:

```caddyfile
tickets.euphoric.gg {
  reverse_proxy vps1:3000 vps2:3000 vps3:3000 {
    lb_policy least_conn
    health_uri /api/health
    health_interval 10s
    flush_interval -1          # keep SSE (live refresh) working
  }
}
```

`/api/health` returns 200 only when Postgres is reachable.

**Bot is single-leader.** Discord rejects multiple gateway connections for a
non-sharded bot, so every container runs `ensureLeadership()` (a Postgres
`pg_try_advisory_lock` on a dedicated connection) before `client.login()`.
Only one wins; followers poll every 30s. When the leader dies, its session
drops, Postgres releases the lock, and a follower takes over within ~30s.
Single-VPS deploys set `LEADER_ELECTION=off` to skip the wait.

All VPS share **one Postgres** (already the case via the `tickets-db` alias on
`efm-public-net`). No Redis needed — `LISTEN/NOTIFY` is broadcast, so each
web instance's SSE subscribers all wake independently.
