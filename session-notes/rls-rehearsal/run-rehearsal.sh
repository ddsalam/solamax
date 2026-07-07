#!/usr/bin/env bash
# RLS rehearsal + 5-test harness. Runs as the NON-SUPERUSER roles (dashboard_app,
# ingest) so RLS is actually enforced. Reproducible + deterministic (resets the
# mutated tables to a known synthetic state first). Point PGHOSTPORT at any PG16
# that has migrations + roles-bootstrap + synthetic-seed applied.
#
# Assertion context is set via the connection GUC (PGOPTIONS -c app.unit_ids=…),
# which the RLS predicate reads identically to qScoped()'s transaction-local
# set_config(). Exhibit B additionally demonstrates the exact qScoped() txn flow.
set -u
HP="${PGHOSTPORT:-localhost:55433}"
SUP="postgresql://postgres:superpw@${HP}/solamax"
APP="postgresql://dashboard_app:apppw@${HP}/solamax"
ING="postgresql://ingest:ingpw@${HP}/solamax"
line(){ echo "------------------------------------------------------------"; }
chk(){ [ "$2" = "$3" ] && echo "  ✅ PASS $1 (got '$2', expected '$3')" || echo "  ❌ FAIL $1 (got '$2', expected '$3')"; }
appctx(){ PGOPTIONS="-c app.unit_ids=$1" psql "$APP" -tAc "$2" 2>&1 | tr -d '[:space:]'; }  # $1=ctx $2=sql

echo "### RESET synthetic mutable state (superuser) → deterministic counts ###"
psql "$SUP" -v ON_ERROR_STOP=1 >/dev/null <<'SQL'
TRUNCATE public.sales_detail;
TRUNCATE app.audit_log;
INSERT INTO public.sales_detail (unit_id,ckdjualbbm,ckdnozzle,nurut,nvolume,nsubtotal,ckdbbm,dtgljam) VALUES
  (1,'JB-U1','N01',1,100,1000000,'BB-02','2026-07-01 08:00+07'),
  (1,'JB-U1','N01',2, 50, 500000,'BB-02','2026-07-01 09:00+07'),
  (2,'JB-U2','N01',1,200,2000000,'BB-07','2026-07-01 08:00+07'),
  (2,'JB-U2','N01',2,200,2000000,'BB-07','2026-07-01 09:00+07'),
  (2,'JB-U2','N02',1,100,1000000,'BB-07','2026-07-01 10:00+07'),
  (99,'JB-U9','N01',1,300,3000000,'BB-03','2026-07-01 08:00+07');
SQL
echo "reset done (u1=2, u2=3, u99=1)"; line

echo "################ EXHIBIT A — zero-rows failure (RLS on, NO app.unit_ids) ################"
echo "Simulates the NOT-YET-updated image doing bare pool.query() with RLS enabled:"
psql "$APP" -c "SELECT count(*) AS rows_visible FROM sales_detail;"
chk "whole-table SELECT, no context" "$(psql "$APP" -tAc "SELECT count(*) FROM sales_detail;")" "0"; line

echo "################ EXHIBIT B — fix via qScoped (transaction-local set_config) ################"
echo "The EXACT flow of apps/dashboard/src/lib/db.ts qScoped(): BEGIN; set_config(local); SELECT; COMMIT"
psql "$APP" <<'SQL'
BEGIN;
SELECT set_config('app.unit_ids','1',true) AS ctx_set;
SELECT count(*) AS rows_visible_unit1 FROM sales_detail;
COMMIT;
SQL
chk "context '1' via txn-local set_config" "$(appctx 1 'SELECT count(*) FROM sales_detail;')" "2"; line

echo "################ EXHIBIT C — rollback rehearsal (DISABLE RLS → recovery) ################"
psql "$SUP" -c "ALTER TABLE public.sales_detail DISABLE ROW LEVEL SECURITY;" >/dev/null
chk "after DISABLE, no-context SELECT (recovery)" "$(psql "$APP" -tAc "SELECT count(*) FROM sales_detail;")" "6"
psql "$SUP" -c "ALTER TABLE public.sales_detail ENABLE ROW LEVEL SECURITY;" >/dev/null
chk "after RE-ENABLE, no-context SELECT (fail-closed)" "$(psql "$APP" -tAc "SELECT count(*) FROM sales_detail;")" "0"; line

echo "################ TEST 1 — cross-UNIT negative (DB layer, no WHERE unit_id) ################"
for c in 1 2 99; do echo "context='$c':"; PGOPTIONS="-c app.unit_ids=$c" psql "$APP" -c "SELECT unit_id, count(*) FROM sales_detail GROUP BY unit_id ORDER BY unit_id;"; done
chk "context='1': NON-unit-1 rows leaked" "$(appctx 1 'SELECT count(*) FROM sales_detail WHERE unit_id<>1;')" "0"; line

echo "################ TEST 2 — DB-layer independent of app choke-point (SELECT *) ################"
echo "Raw SELECT (no getDataScope, no WHERE) under context='2' — distinct unit_ids visible:"
PGOPTIONS="-c app.unit_ids=2" psql "$APP" -c "SELECT DISTINCT unit_id FROM sales_detail;"
chk "context='2': distinct units visible" "$(appctx 2 "SELECT string_agg(DISTINCT unit_id::text,',') FROM sales_detail;")" "2"; line

echo "################ TEST 3 — IB-unaffected regression / direksi-sees-both ################"
echo "Direksi over PT (scope.unitIds=[1,2]) context='1,2':"
PGOPTIONS="-c app.unit_ids=1,2" psql "$APP" -c "SELECT unit_id, count(*) FROM sales_detail GROUP BY unit_id ORDER BY unit_id;"
chk "direksi visible unit_ids"           "$(appctx 1,2 "SELECT string_agg(DISTINCT unit_id::text,',' ORDER BY unit_id::text) FROM sales_detail;")" "1,2"
chk "foreign unit 99 visible to direksi" "$(appctx 1,2 'SELECT count(*) FROM sales_detail WHERE unit_id=99;')" "0"
chk "pengawas-IB (ctx='1') IB row count" "$(appctx 1 'SELECT count(*) FROM sales_detail;')" "2"; line

echo "################ TEST 4 — ingest write-path under RLS (WITH CHECK) ################"
echo "(4a) ingest, context='2', INSERT unit-2 row → expect SUCCEED:"
PGOPTIONS="-c app.unit_ids=2" psql "$ING" -c "INSERT INTO sales_detail (unit_id,ckdjualbbm,ckdnozzle,nurut,nvolume,nsubtotal,ckdbbm,dtgljam) VALUES (2,'JB-U2','N09',1,10,100000,'BB-07','2026-07-01 11:00+07');" 2>&1 | tail -1
echo "(4b) ingest, context='2', INSERT unit-1 row → expect REJECT (WITH CHECK):"
PGOPTIONS="-c app.unit_ids=2" psql "$ING" -c "INSERT INTO sales_detail (unit_id,ckdjualbbm,ckdnozzle,nurut,nvolume,nsubtotal,ckdbbm,dtgljam) VALUES (1,'JB-U1','N09',1,10,100000,'BB-02','2026-07-01 11:00+07');" 2>&1 | grep -iE 'row-level security|ERROR' | head -1
echo "(4c) ingest, NO context, INSERT → expect REJECT (fail-closed):"
psql "$ING" -c "INSERT INTO sales_detail (unit_id,ckdjualbbm,ckdnozzle,nurut,nvolume,nsubtotal,ckdbbm,dtgljam) VALUES (2,'JB-U2','N08',1,10,100000,'BB-07','2026-07-01 11:00+07');" 2>&1 | grep -iE 'row-level security|ERROR' | head -1; line

echo "################ TEST 5 — audit_log append-only grants ################"
echo "(5a) dashboard_app INSERT audit row → expect SUCCEED:"
psql "$APP" -c "INSERT INTO app.audit_log (actor_user_id, actor_email, action, target, detail) VALUES (1,'direksi@syn.test','grant_access','2','{\"role\":\"pengawas\"}'::jsonb);" 2>&1 | tail -1
echo "(5b) dashboard_app UPDATE audit → expect DENIED:"
psql "$APP" -c "UPDATE app.audit_log SET action='tampered';" 2>&1 | grep -iE 'permission denied|ERROR' | head -1
echo "(5c) dashboard_app DELETE audit → expect DENIED:"
psql "$APP" -c "DELETE FROM app.audit_log;" 2>&1 | grep -iE 'permission denied|ERROR' | head -1
chk "audit rows present after (superuser)" "$(psql "$SUP" -tAc "SELECT count(*) FROM app.audit_log;")" "1"; line
echo "ALL SECTIONS COMPLETE"
