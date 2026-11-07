#!/usr/bin/env bash
# Starts a throwaway local PostgreSQL for RLS/isolation tests (no Docker needed).
# Usage: bash scripts/local-postgres.sh [start|stop]
# Not a Supabase replica: tests load tests/db/supabase-shim.sql to emulate auth.uid() and the
# anon/authenticated/service_role roles the way Supabase defines them.
set -euo pipefail
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
DATA="${PGDATA_DIR:-/tmp/pitchready-pgdata}"
PORT="${PGPORT:-54329}"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then RUN_AS=(runuser -u postgres --); fi
case "${1:-start}" in
  start)
    if [ ! -d "$DATA" ]; then
      mkdir -p "$DATA"; [ "$(id -u)" = "0" ] && chown postgres "$DATA"
      "${RUN_AS[@]}" "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust >/dev/null
    fi
    if ! "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" status >/dev/null 2>&1; then
      "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -l "$DATA/log.txt" start >/dev/null
    fi
    echo "postgres://postgres@127.0.0.1:$PORT/postgres"
    ;;
  stop) "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" stop >/dev/null && echo stopped ;;
esac
