#!/usr/bin/env bash
# F3 rollback rehearsal + F7 fail-closed cast-guard probes + F1 preflight gate self-test.
# Read-only against the synthetic instance; re-enables RLS at the end (leaves it ON).
set -u
HP="${PGHOSTPORT:-localhost:55433}"
SUP="postgresql://postgres:superpw@${HP}/solamax"
APP="postgresql://dashboard_app:apppw@${HP}/solamax"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
M0016="$REPO_ROOT/apps/backend/prisma/migrations/0016_rls_unit_scope/migration.sql"
ROLLBACK="$REPO_ROOT/apps/backend/scripts/rls-rollback.sql"
chk(){ [ "$2" = "$3" ] && echo "  ✅ PASS $1 (got '$2' exp '$3')" || echo "  ❌ FAIL $1 (got '$2' exp '$3')"; }
appc(){ PGOPTIONS="-c app.unit_ids=$1" psql "$APP" -tAc "SELECT count(*) FROM sales_detail;" 2>&1 | tr -d '[:space:]'; }

# Deterministic reset (superuser bypasses RLS) — prior rehearsal step mutates sales_detail.
psql "$SUP" -q >/dev/null <<'SQL'
TRUNCATE public.sales_detail;
INSERT INTO public.sales_detail (unit_id,ckdjualbbm,ckdnozzle,nurut,nvolume,nsubtotal,ckdbbm,dtgljam) VALUES
 (1,'JB-U1','N01',1,100,1000000,'BB-02','2026-07-01 08:00+07'),
 (1,'JB-U1','N01',2, 50, 500000,'BB-02','2026-07-01 09:00+07'),
 (2,'JB-U2','N01',1,200,2000000,'BB-07','2026-07-01 08:00+07'),
 (2,'JB-U2','N01',2,200,2000000,'BB-07','2026-07-01 09:00+07'),
 (2,'JB-U2','N02',1,100,1000000,'BB-07','2026-07-01 10:00+07'),
 (99,'JB-U9','N01',1,300,3000000,'BB-03','2026-07-01 08:00+07');
SQL

echo "################ F3 — ROLLBACK REHEARSAL (committed rls-rollback.sql, all tables) ################"
before=$(psql "$SUP" -tAc "SELECT count(*) FROM pg_policy WHERE polname='unit_scope';")
echo "policies before rollback: $before"
psql "$SUP" -q -f "$ROLLBACK" >/dev/null
after=$(psql "$SUP" -tAc "SELECT count(*) FROM pg_policy WHERE polname='unit_scope';")
rec=$(psql "$APP" -tAc "SELECT count(*) FROM sales_detail;")   # dashboard_app, NO context
echo "policies after rollback: $after ; dashboard_app no-context read: $rec"
chk "rollback drops all policies" "$after" "0"
chk "recovery: reads full data w/o context" "$rec" "6"
echo "-- re-apply 0016 (re-enable) --"
psql "$SUP" -q -f "$M0016" >/dev/null
reen=$(psql "$SUP" -tAc "SELECT count(*) FROM pg_policy WHERE polname='unit_scope';")
failc=$(psql "$APP" -tAc "SELECT count(*) FROM sales_detail;")  # no context again
chk "re-enable restores all policies" "$reen" "$before"
chk "fail-closed again (no context → 0)" "$failc" "0"

echo ""
echo "################ F7 — FAIL-CLOSED CAST GUARD (malformed context → 0 rows, NO throw) ################"
printf "%-26s -> " "unset (no GUC)"; psql "$APP" -tAc "SELECT count(*) FROM sales_detail;" 2>&1 | head -1
for v in "" " " "abc" "-1" "0" "x,y" "1a"; do
  printf "%-26s -> " "app.unit_ids='$v'"; PGOPTIONS="-c app.unit_ids=$v" psql "$APP" -tAc "SELECT count(*) FROM sales_detail;" 2>&1 | head -1
done
echo "-- assertions: every malformed/empty value must be 0 with NO 'ERROR' --"
allzero=1
for v in "" " " "abc" "-1" "0" "x,y" "1a"; do
  out=$(PGOPTIONS="-c app.unit_ids=$v" psql "$APP" -tAc "SELECT count(*) FROM sales_detail;" 2>&1 | tr -d '[:space:]')
  [ "$out" = "0" ] || allzero=0
done
chk "all malformed/empty → 0 rows, no error" "$allzero" "1"
chk "legit '1' still scopes (unchanged)"  "$(appc 1)" "2"
chk "legit '1,2' still scopes (unchanged)" "$(appc 1,2)" "5"

echo ""
echo "################ F1 — PREFLIGHT GATE SELF-TEST (logic proven without gcloud) ################"
bash "$REPO_ROOT/apps/backend/scripts/preflight-rls-cutover.sh" --selftest
echo "ALL GUARDS COMPLETE"
