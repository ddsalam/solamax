#!/usr/bin/env bash
# ONE COMMAND: rebuild the synthetic Postgres 16 from the migration chain and run
# EVERY RLS verification from a clean checkout. Reproduces all exhibits — the
# independent reviewer runs exactly this and re-derives the evidence from scratch.
#
#   bash session-notes/rls-rehearsal/rebuild-and-verify.sh
#
# Requires: docker, psql, node>=18 (Prisma 5). Writes evidence into this dir.
set -euo pipefail
cd "$(dirname "$0")/../.."                                   # repo root
export PATH="/opt/homebrew/Cellar/node/24.10.0/bin:${PATH}" # ensure node>=18 for Prisma
PORT="${PORT:-55433}"; CONT="${CONT:-solamax-staging-pg}"
SUPER_PW=superpw; APP_PW=apppw; ING_PW=ingpw
SUP="postgresql://postgres:${SUPER_PW}@localhost:${PORT}/solamax"
APP="postgresql://dashboard_app:${APP_PW}@localhost:${PORT}/solamax"
EV=session-notes/rls-rehearsal

echo "== [1/7] fresh postgres:16 container on :${PORT} =="
docker rm -f "$CONT" >/dev/null 2>&1 || true
docker run -d --name "$CONT" -e POSTGRES_PASSWORD=$SUPER_PW -e POSTGRES_DB=solamax -p ${PORT}:5432 postgres:16 >/dev/null
for i in $(seq 1 40); do docker exec "$CONT" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 2; done

echo "== [2/7] prisma migrate deploy (0001→0017: RLS 0016 + audit 0017) =="
( cd apps/backend && DATABASE_URL="$SUP" ./node_modules/.bin/prisma migrate deploy >/dev/null )

echo "== [3/7] roles-bootstrap (reproduce out-of-git ingest/dashboard_app grants) =="
psql "$SUP" -q -v ON_ERROR_STOP=1 -v dashboard_app_pw="$APP_PW" -v ingest_pw="$ING_PW" -f apps/backend/scripts/roles-bootstrap.sql >/dev/null

echo "== [4/7] synthetic seed (2-unit PT + foreign tenant + enrichment) =="
psql "$SUP" -q -v ON_ERROR_STOP=1 -f $EV/synthetic-seed.sql >/dev/null

echo "== [5/7] tenant rename (SolaGroup → PT Sola Petra Abadi) =="
psql "$SUP" -q -v ON_ERROR_STOP=1 -f apps/backend/scripts/rename-tenant.sql >/dev/null

echo "== [6/7] full-app-under-RLS + rehearsal + 5 tests =="
PGHOSTPORT="localhost:${PORT}" bash $EV/full-app-rls-check.sh    | tee $EV/06-full-app-under-rls.txt   | tail -2
PGHOSTPORT="localhost:${PORT}" bash $EV/run-rehearsal.sh         | tee $EV/03-rehearsal-and-tests.txt  | grep -E "PASS/|FAIL|COMPLETE" | tail -1 || true

echo "== [7/7] integration suites as dashboard_app (scope + grant + surfaces) =="
SCOPE_LIVE_DB=1 GRANT_LIVE_DB=1 RLS_SURFACES_LIVE_DB=1 \
  DATABASE_URL="$APP" DASHBOARD_APP_DATABASE_URL="$APP" \
  pnpm --filter @solamax/dashboard test 2>&1 | tee $EV/07-integration-suites.txt | tail -8
echo "== DONE — evidence in $EV/ =="
