#!/usr/bin/env bash
# FULL-APP-UNDER-RLS — exhaustive proof that NO dashboard surface is RLS-starved.
# For EVERY RLS-enabled table: dashboard_app(context) count == superuser(WHERE unit_id)
# count, for pengawas (ctx=1), other unit (ctx=2), and direksi (ctx=1,2). If equal,
# the surface returns exactly the truth per scope — a 0 is a genuine empty, not a
# silent RLS starvation. Runs the read as the NON-SUPERUSER dashboard_app role.
set -u
HP="${PGHOSTPORT:-localhost:55433}"
SUP="postgresql://postgres:superpw@${HP}/solamax"
APP="postgresql://dashboard_app:apppw@${HP}/solamax"
pass=0; fail=0
appc(){ PGOPTIONS="-c app.unit_ids=$1" psql "$APP" -tAc "SELECT count(*) FROM $2;"; }  # ctx table
supc(){ psql "$SUP" -tAc "SELECT count(*) FROM $1 WHERE unit_id $2;"; }                 # table pred

printf "%-26s | %6s %6s %6s | %-7s %s\n" "table (RLS)" "ctx1" "ctx2" "d1,2" "status" "note"
echo "---------------------------------------------------------------------------"
TABLES=$(psql "$SUP" -tAc "SELECT n.nspname||'.'||c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN ('public','app') AND c.relrowsecurity ORDER BY 1;")
for t in $TABLES; do
  s1=$(supc "$t" "= 1"); s2=$(supc "$t" "= 2"); s12=$(supc "$t" "IN (1,2)")
  a1=$(appc 1 "$t");     a2=$(appc 2 "$t");     a12=$(appc 1,2 "$t")
  ok="OK"; [ "$a1" = "$s1" ] && [ "$a2" = "$s2" ] && [ "$a12" = "$s12" ] || ok="MISMATCH"
  tot=$((s1+s2+s12)); note="non-empty"; [ "$tot" = "0" ] && note="genuinely-empty-in-synthetic"
  if [ "$ok" = "OK" ]; then pass=$((pass+1)); mark="✅ PASS"; else fail=$((fail+1)); mark="❌ FAIL"; fi
  printf "%-26s | %6s %6s %6s | %-7s %s\n" "$t" "$a1/$s1" "$a2/$s2" "$a12/$s12" "$mark" "$note"
done
echo "---------------------------------------------------------------------------"
echo "app(ctx)/super(WHERE unit_id) — equal = correctly scoped.  PASS=$pass FAIL=$fail"
