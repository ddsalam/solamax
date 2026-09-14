#!/usr/bin/env bash
# Mengunci SEMANTIK probe kesegaran F1 (scripts/piutang-f1/probe-freshness.sql).
#
# Dua hal yang sama pentingnya diuji di sini:
#   · probe MENYALA untuk perubahan yang material, dengan rupiah yang BENAR;
#   · probe DIAM untuk perubahan yang tidak material.
# Banner yang selalu menyala sama tidak bergunanya dengan banner yang tak pernah
# menyala, jadi kontrol negatif (baris bertanggal masa depan, baris yang tidak
# berubah sejak cut) bukan pelengkap — ia setengah dari gerbangnya.
#
# Skenario A mereproduksi kejadian NYATA 13 September 2026: koreksi mundur yang
# masuk 08:34/08:38 WIB sesudah cut 02:05, yang membuat layar meleset
# Rp 35.979.362 (piutang) dan Rp 1.405.000 (hutang) selama ±18 jam tanpa satu
# pun indikator.
#
# MASUKAN (env): MIGRATE_DEPLOY_ADMIN_URL, MIGRATE_DEPLOY_HOST, MIGRATE_DEPLOY_PORT
set -euo pipefail

# Zona waktu dipatok: tanpa ini `perubahan_terakhir` tercetak dalam TZ mesin,
# sehingga asersinya lulus di laptop WIB dan gagal di runner UTC (atau
# sebaliknya) tanpa ada yang berubah pada probenya.
export PGTZ=UTC

ADMIN_URL="${MIGRATE_DEPLOY_ADMIN_URL:?wajib}"
HOST="${MIGRATE_DEPLOY_HOST:?wajib}"; PORT="${MIGRATE_DEPLOY_PORT:?wajib}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND="$REPO_ROOT/apps/backend"
PRISMA="$BACKEND/node_modules/.bin/prisma"
ROLE="migrate_deploy_owner"; PASS="migrate_deploy_only"; DB="piutang_probe_gate"
URL="postgresql://${ROLE}:${PASS}@${HOST}:${PORT}/${DB}?schema=public"
PSQL_URL="postgresql://${ROLE}:${PASS}@${HOST}:${PORT}/${DB}"
CUT="c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff"
CUT_AT="2026-09-12 19:05:15+00"   # 02:05:15 WIB 13-09-2026
ASOF="2026-09-13"

fail() { echo; echo "GERBANG PROBE F1 GAGAL — $*" >&2; exit 1; }
admin() { psql "$ADMIN_URL" -X -v ON_ERROR_STOP=1 -qAt "$@"; }
q() { psql "$PSQL_URL" -X -v ON_ERROR_STOP=1 -qAt "$@"; }
# ⚠️ Scope RLS dipasang PEMANGGIL, bukan berkas probe — di aplikasi itu tugas
# `qScoped()`. Tanpa ini probe memulangkan nol baris TANPA GALAT, dan nol itu
# terbaca persis seperti "tidak ada perubahan". Lihat [[nol-rls-bukan-fakta]].
probe() {
  psql "$PSQL_URL" -X -v ON_ERROR_STOP=1 -qAt -F'|' \
    -c "SET app.unit_ids = '1';" \
    -v unit=1 -v as_of="$ASOF" -v cut_id="$CUT" -v cut_at="$CUT_AT" \
    -f "$REPO_ROOT/scripts/piutang-f1/probe-freshness.sql"
}

admin -c "DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${ROLE}') THEN
    CREATE ROLE ${ROLE} LOGIN PASSWORD '${PASS}' NOSUPERUSER NOBYPASSRLS NOCREATEROLE;
  END IF; END \$\$;" >/dev/null
admin -c "DROP DATABASE IF EXISTS ${DB};" >/dev/null
admin -c "CREATE DATABASE ${DB} OWNER ${ROLE};" >/dev/null
[ "$(q -c 'SELECT current_database();')" = "$DB" ] || fail "sasaran bukan database sekali pakai"
(cd "$BACKEND" && DATABASE_URL="$URL" "$PRISMA" migrate deploy >/dev/null 2>&1) || fail "migrasi gagal"

q <<SQL >/dev/null
SET app.unit_ids = '1';
INSERT INTO app.tenant(id,name,slug,status) VALUES ('11111111-1111-4111-8111-111111111111','Probe','probe','active');
INSERT INTO public.unit(unit_id,code,name,api_key_hash,tenant_id)
VALUES (1,'6478111','Imam Bonjol','probe','11111111-1111-4111-8111-111111111111');
INSERT INTO app.saldo_pelanggan_source_cycle
 (unit_id,source_cycle_id,source_cycle_sequence,status,source_completed_at,promoted_at,
  pelanggan_row_count,pelanggan_keyed_checksum,bppiut_row_count,bppiut_keyed_checksum,
  bphut_row_count,bphut_keyed_checksum)
VALUES (1,'${CUT}',42,'complete','${CUT_AT}',now(),4,sha256('m'),4,sha256('p'),2,sha256('h'));

-- Master DI CUT: dua lokal (sjenis 1/5), satu online (kode bertitik), satu kelas 4.
INSERT INTO app.saldo_pelanggan_source_pelanggan(unit_id,source_cycle_id,ckdplg,vcnmplg,sjenis,row_keyed_checksum)
SELECT 1,'${CUT}',code,code,kind,sha256(code::bytea)
FROM (VALUES ('LOKAL-A',1),('LOKAL-B',5),('01.000.0003',3),('KELAS4',4)) v(code,kind);
INSERT INTO public.pelanggan_master(unit_id,ckdplg,vcnmplg,sjenis,saktif)
SELECT 1,code,code,kind,1 FROM (VALUES ('LOKAL-A',1),('LOKAL-B',5),('01.000.0003',3),('KELAS4',4)) v(code,kind);

-- Keadaan DI CUT (empat baris piutang, dua hutang).
INSERT INTO app.saldo_pelanggan_source_bppiut(unit_id,source_cycle_id,ckdbppiut,dtgl,ckdplg,njumlah,sjnsbp,sbatal,row_keyed_checksum)
SELECT 1,'${CUT}',k,d::date,c,n,s,0,sha256(k::bytea) FROM (VALUES
  ('CUT-LAMA'    ,'2026-08-01','LOKAL-A',900000000::numeric,1),
  ('CUT-BATAL'   ,'2026-09-01','LOKAL-A',  7000000::numeric,1),
  ('CUT-PINDAH-K','2026-09-13','LOKAL-B',  3000000::numeric,1),
  ('CUT-PINDAH-M','2026-09-25','LOKAL-B',  2000000::numeric,1)) v(k,d,c,n,s);
INSERT INTO app.saldo_pelanggan_source_bphut(unit_id,source_cycle_id,ckdbphut,dtgl,ckdplg,njumlah,sjnsbp,sbatal,row_keyed_checksum)
SELECT 1,'${CUT}',k,d::date,'LOKAL-A',n,s,0,sha256(k::bytea) FROM (VALUES
  ('HUT-LAMA','2026-08-01',673010538::numeric,2),
  ('HUT-NOL' ,'2026-08-01',        0::numeric,2)) v(k,d,n,s);

-- MIRROR sekarang. Baris yang TIDAK berubah membawa ingested_at SEBELUM cut —
-- persis efek skipUnchanged: full-sync tidak menyentuhnya.
INSERT INTO public.bppiut(unit_id,ckdbppiut,dtgl,ckdplg,njumlah,sjnsbp,sbatal,ingested_at)
VALUES
 (1,'CUT-LAMA'    ,'2026-08-01','LOKAL-A',900000000,1,0,'2026-09-01 00:00:00+00'),
 (1,'CUT-BATAL'   ,'2026-09-01','LOKAL-A',  7000000,1,1,'2026-09-13 02:00:00+00'),
 (1,'CUT-PINDAH-K','2026-09-20','LOKAL-B',  3000000,1,0,'2026-09-13 02:10:00+00'),
 (1,'CUT-PINDAH-M','2026-09-13','LOKAL-B',  2000000,1,0,'2026-09-13 02:20:00+00'),
 (1,'BARU-DEPAN'  ,'2026-09-20','LOKAL-A',500000000,1,0,'2026-09-13 03:00:00+00'),
 (1,'BARU-KELAS4' ,'2026-09-12','KELAS4' , 88000000,1,0,'2026-09-13 03:00:00+00');
INSERT INTO public.bphut(unit_id,ckdbphut,dtgl,ckdplg,njumlah,sjnsbp,sbatal,ingested_at)
VALUES
 (1,'HUT-LAMA','2026-08-01','LOKAL-A',673010538,2,0,'2026-09-01 00:00:00+00'),
 (1,'HUT-NOL' ,'2026-08-01','LOKAL-A',        0,2,0,'2026-09-01 00:00:00+00');
SQL

# ── Kontrol NEGATIF dulu: tanpa koreksi mundur 08:34/08:38, apa yang terlihat? ──
echo "== kontrol: hanya perubahan non-material + empat bentuk =="
BASE="$(probe)"; echo "$BASE"
PL="$(printf '%s\n' "$BASE" | awk -F'|' '$1=="piutang_lokal"{print $3}')"
# CUT-BATAL −7.000.000 · CUT-PINDAH-K keluar −3.000.000 · CUT-PINDAH-M masuk +2.000.000
[ "$PL" = "-8000000" ] || fail "empat bentuk: piutang_lokal seharusnya -8000000, dapat '${PL}'"
printf '%s\n' "$BASE" | grep -q '^piutang_online' && fail "online menyala padahal tak ada perubahan online"
printf '%s\n' "$BASE" | awk -F'|' '$1=="hutang_lokal"' | grep -q . && fail "hutang menyala padahal tak ada perubahan hutang"
echo "  OK — pembatalan, pindah-keluar, pindah-masuk terhitung; kelas 4 dan"
echo "       baris bertanggal 20-09 (Rp 500.000.000!) TIDAK menyalakan apa pun."

# ── Skenario A: reproduksi koreksi mundur 13 September 2026 ──────────────────
echo
echo "== skenario A · koreksi mundur 08:34 / 08:38 WIB =="
q <<SQL >/dev/null
SET app.unit_ids = '1';
INSERT INTO public.bppiut(unit_id,ckdbppiut,dtgl,ckdplg,njumlah,sjnsbp,sbatal,ingested_at)
SELECT 1,'MUNDUR-'||n,'2026-09-12','LOKAL-A',amount,1,0,'2026-09-13 01:34:10+00'
FROM (VALUES (1,6000000::numeric),(2,6000000::numeric),(3,6000000::numeric),
             (4,6000000::numeric),(5,6000000::numeric),(6,5979362::numeric)) v(n,amount);
INSERT INTO public.bphut(unit_id,ckdbphut,dtgl,ckdplg,njumlah,sjnsbp,sbatal,ingested_at)
VALUES (1,'HUT-MUNDUR','2026-09-12','LOKAL-A',1405000,1,0,'2026-09-13 01:38:05+00');
SQL
AFTER="$(probe)"; echo "$AFTER"
PL="$(printf '%s\n' "$AFTER" | awk -F'|' '$1=="piutang_lokal"{print $3}')"
HL="$(printf '%s\n' "$AFTER" | awk -F'|' '$1=="hutang_lokal"{print $3}')"
LAST="$(printf '%s\n' "$AFTER" | awk -F'|' '$1=="hutang_lokal"{print $4}')"
# 35.979.362 koreksi mundur − 8.000.000 dari keempat bentuk di atas
[ "$PL" = "27979362" ] || fail "A: piutang_lokal seharusnya 27979362 (35.979.362 − 8.000.000), dapat '${PL}'"
[ "$HL" = "1405000" ]  || fail "A: hutang_lokal seharusnya 1405000, dapat '${HL}'"
case "$LAST" in *"2026-09-13 01:38:05+00"*) ;; *) fail "A: perubahan_terakhir hutang bukan 08:38:05 WIB (01:38:05 UTC), dapat '${LAST}'";; esac
echo "  OK — Rp 35.979.362 piutang dan Rp 1.405.000 hutang terdeteksi,"
echo "       waktu perubahan terakhir 08:38:05 WIB."

# ── Kontrol: snapshot yang benar-benar segar harus DIAM ─────────────────────
echo
echo "== kontrol: cut sesudah semua perubahan → probe harus diam =="
# Kontrol positif LEBIH DULU: nol baris hanya bermakna kalau scope-nya memang
# memperlihatkan sesuatu. Tanpa ini, "diam" bisa berarti RLS menyaring semuanya.
SUBJEK="$(q -c "SET app.unit_ids='1'; SELECT count(*) FROM public.bppiut;")"
[ "$SUBJEK" -ge 12 ] || fail "kontrol positif gagal: hanya ${SUBJEK} baris bppiut terlihat — scope RLS, bukan tabel kosong"
FRESH="$(psql "$PSQL_URL" -X -v ON_ERROR_STOP=1 -qAt -F'|' \
  -c "SET app.unit_ids = '1';" \
  -v unit=1 -v as_of="$ASOF" -v cut_id="$CUT" -v cut_at="2026-09-13 23:59:00+00" \
  -f "$REPO_ROOT/scripts/piutang-f1/probe-freshness.sql")"
[ -z "$FRESH" ] || fail "cut yang lebih baru dari semua perubahan tetap menyala: ${FRESH}"
echo "  OK — nol baris, dengan ${SUBJEK} baris bppiut yang benar-benar terlihat."

admin -c "DROP DATABASE IF EXISTS ${DB};" >/dev/null
echo
echo "GERBANG PROBE F1 HIJAU — material menyala dengan rupiah yang benar, non-material diam."
