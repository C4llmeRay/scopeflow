#!/usr/bin/env bash
# Applies every migration plus the seed to a throwaway Postgres container and
# runs the schema smoke test against it.
#
# This is not a substitute for `supabase start` — it stubs auth and PostgREST.
# It is the fast check: does the DDL execute, and do the security rules hold.
#
#   ./scripts/verify-schema.sh
set -euo pipefail

CONTAINER=scopeflow-verify
PORT=${PORT:-55432}
IMAGE=postgres:16-alpine
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export PGPASSWORD=postgres
PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

echo "==> starting $IMAGE on port $PORT"
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=postgres \
  -p "$PORT":5432 "$IMAGE" >/dev/null

echo -n "==> waiting for postgres"
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
    echo " ready"
    break
  fi
  echo -n "."
  sleep 1
done

echo "==> harness"
"${PSQL[@]}" -f "$ROOT/supabase/test/00_harness.sql"

for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "==> $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done

echo "==> seed.sql"
"${PSQL[@]}" -f "$ROOT/supabase/seed.sql"

echo "==> smoke test"
"${PSQL[@]}" -f "$ROOT/supabase/test/99_smoke.sql"

echo
echo "schema OK"
