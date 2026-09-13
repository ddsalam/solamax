#!/usr/bin/env bash
# Gerbang "migrasinya dapat DI-DEPLOY" — bukan "SQL-nya benar".
#
# ⚠️ KENAPA BERKAS INI ADA.
# Job `snapshot-postgres-14` sudah menjalankan 15 tes atas SQL migrasi 0039 dan
# semuanya hijau — pada 13 September 2026 migrasi itu tetap GAGAL di DB test,
# dua kali berturut-turut, pada DUA guard berbeda. Sebabnya: uji itu menyuntik
# migrasi lewat `psql` per pernyataan, sebagai peran pemilik, ke database yang
# uji itu sendiri baru saja siapkan. Deploy sebenarnya menjalankan
# `prisma migrate deploy` — SATU simple query berisi seluruh berkas — sebagai
# peran deployment, terhadap database yang SUDAH berisi keadaan sebelumnya.
# Uji itu tidak pernah bisa MERAH untuk mode kegagalan yang nyata.
#
# Empat kasus, dua di antaranya WAJIB bisa merah:
#   A  HIJAU  fixture generasi v1 yang konsisten → 0039 terpasang DAN keenam
#             saldo tidak berubah DAN keduabelas sisi merekonstruksinya.
#             (Hijau dengan SUBJEK: database kosong akan hijau tanpa menguji
#             rebuild apa pun — lihat [[bukti-harus-bisa-merah]].)
#   B  MERAH  sisa manifest `building` → guard `snapshot_v2_active_builder`.
#   C  MERAH  manifest `complete` yang tidak merekonstruksi → guard
#             `snapshot_v2_legacy_balance_mismatch`.
#   D  HIJAU  pemulihan sesudah C benar-benar bekerja.
#
# B dan C adalah dua kegagalan NYATA 13 September, bukan skenario karangan.
# Keduanya juga menegaskan ATOMISITAS: sesudah penolakan, nol kolom 0039 boleh
# tertinggal.
#
# MASUKAN (env):
#   MIGRATE_DEPLOY_ADMIN_URL  URL superuser (membuat peran + database sekali pakai)
#   MIGRATE_DEPLOY_HOST/PORT  host & port server yang sama
set -euo pipefail

ADMIN_URL="${MIGRATE_DEPLOY_ADMIN_URL:?MIGRATE_DEPLOY_ADMIN_URL wajib diisi}"
HOST="${MIGRATE_DEPLOY_HOST:?MIGRATE_DEPLOY_HOST wajib diisi}"
PORT="${MIGRATE_DEPLOY_PORT:?MIGRATE_DEPLOY_PORT wajib diisi}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BACKEND="$REPO_ROOT/apps/backend"
FIXTURE="$REPO_ROOT/scripts/ci/fixtures/snapshot-v1-generation.sql"
PRISMA="$BACKEND/node_modules/.bin/prisma"

# Peran deployment sengaja NOSUPERUSER + NOBYPASSRLS: tier ter-deploy memakai
# `ingest`, yang MEMILIKI tabelnya tetapi tidak melewati RLS.
DEPLOY_ROLE="migrate_deploy_owner"
DEPLOY_PASSWORD="migrate_deploy_only"
DB="migrate_deploy_gate"
DEPLOY_URL="postgresql://${DEPLOY_ROLE}:${DEPLOY_PASSWORD}@${HOST}:${PORT}/${DB}?schema=public"
DEPLOY_PSQL_URL="postgresql://${DEPLOY_ROLE}:${DEPLOY_PASSWORD}@${HOST}:${PORT}/${DB}"

fail() { echo; echo "GERBANG DEPLOY GAGAL — $*" >&2; exit 1; }
admin() { psql "$ADMIN_URL" -X -v ON_ERROR_STOP=1 -qAt "$@"; }
gate_sql() { psql "$DEPLOY_PSQL_URL" -X -v ON_ERROR_STOP=1 -qAt "$@"; }
migrate_deploy() { (cd "$BACKEND" && DATABASE_URL="$DEPLOY_URL" "$PRISMA" migrate deploy 2>&1); }

# ⚠️ Sasaran diasersikan, tidak diandaikan. `.env` repo menunjuk
# 127.0.0.1:5432 = port proxy PRODUKSI; skrip ini tidak boleh bisa nyasar ke
# sana walau seseorang salah mengisi env.
assert_disposable_target() {
  local db; db="$(gate_sql -c "SELECT current_database();")"
  [ "$db" = "$DB" ] || fail "sasaran bukan database sekali pakai (current_database=${db})"
}

new_columns() {
  gate_sql -c "SELECT count(*) FROM information_schema.columns
               WHERE table_schema='app' AND table_name='saldo_pelanggan_snapshot_row'
                 AND (column_name LIKE '%\_debet' OR column_name LIKE '%\_kredit');"
}

# 0001..0038 saja, lalu fixture, lalu 0039 lewat `migrate deploy` sungguhan.
STAGE_PRISMA="$(mktemp -d)"
trap 'rm -rf "$STAGE_PRISMA"' EXIT
cp -R "$BACKEND/prisma/." "$STAGE_PRISMA/"
rm -rf "$STAGE_PRISMA/migrations/0039_snapshot_debet_kredit"

prepare() { # $1 perturb, $2 building
  admin -c "DROP DATABASE IF EXISTS ${DB};" >/dev/null
  admin -c "CREATE DATABASE ${DB} OWNER ${DEPLOY_ROLE};" >/dev/null
  assert_disposable_target
  (cd "$BACKEND" && DATABASE_URL="$DEPLOY_URL" "$PRISMA" migrate deploy --schema "$STAGE_PRISMA/schema.prisma" >/dev/null 2>&1) \
    || fail "0001..0038 gagal terpasang"
  psql "$DEPLOY_PSQL_URL" -X -v ON_ERROR_STOP=1 -q \
    -v perturb="$1" -v building="$2" -f "$FIXTURE" >/dev/null
}

preflight() { DATABASE_URL="$DEPLOY_URL" "$REPO_ROOT/scripts/ci/check-snapshot-quiescent.sh" 2>&1; }

echo "== server =="
admin -c "SELECT version();"
SERVER_NUM="$(admin -c "SELECT current_setting('server_version_num')::int;")"
echo "server_version_num=${SERVER_NUM}"
admin -c "DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${DEPLOY_ROLE}') THEN
    CREATE ROLE ${DEPLOY_ROLE} LOGIN PASSWORD '${DEPLOY_PASSWORD}' NOSUPERUSER NOBYPASSRLS NOCREATEROLE;
  END IF;
END \$\$;" >/dev/null

# ── A · HIJAU DENGAN SUBJEK ─────────────────────────────────────────────────
echo
echo "== A · generasi v1 konsisten → 0039 terpasang tanpa mengubah saldo =="
prepare none no
BEFORE="$(gate_sql -c "SET app.unit_ids='1';
  SELECT string_agg(customer_code||'='||trim_scale(akhir_piutang_lokal)||'/'||trim_scale(akhir_piutang_online)||'/'||trim_scale(akhir_hutang_lokal), ' ' ORDER BY customer_code)
  FROM app.saldo_pelanggan_snapshot_row;")"
[ -n "$BEFORE" ] || fail "A: fixture tidak terlihat — cek scope RLS, bukan anggap kosong"
echo "subjek sebelum: $BEFORE"
if ! OUT="$(preflight)"; then echo "$OUT"; fail "A: preflight menolak database yang bersih"; fi
echo "$OUT" | grep -E 'PREFLIGHT_(SCOPE|SUBJEK|OK)'
OUT_A="$(migrate_deploy)" || { echo "$OUT_A"; fail "A: migrasi gagal atas fixture yang konsisten"; }
[ "$(new_columns)" = "12" ] || fail "A: 12 kolom debet/kredit tidak terpasang"
[ "$(gate_sql -c "SELECT count(*) FROM pg_constraint WHERE conname LIKE '%\_sides';")" = "12" ] \
  || fail "A: 12 CHECK sisi tidak terpasang"
[ "$(gate_sql -c "SELECT count(*) FROM pg_constraint
      WHERE conname IN ('sps_manifest_base_generation_fkey','sps_pointer_generation_fkey',
                        'sps_row_generation_fkey','sps_dirty_coverage_generation_fkey',
                        'sps_work_generation_fkey') AND (condeferrable OR condeferred);")" = "0" ] \
  || fail "A: FK tertinggal DEFERRABLE"
AFTER="$(gate_sql -c "SET app.unit_ids='1';
  SELECT string_agg(customer_code||'='||trim_scale(akhir_piutang_lokal)||'/'||trim_scale(akhir_piutang_online)||'/'||trim_scale(akhir_hutang_lokal), ' ' ORDER BY customer_code)
  FROM app.saldo_pelanggan_snapshot_row;")"
[ "$AFTER" = "$BEFORE" ] || fail "A: saldo yang dilihat pengguna BERUBAH: $BEFORE -> $AFTER"
# `trim_scale` dipakai dengan sengaja: rebuild 0039 menulis ulang SKALA numerik
# (mis. -673010538 menjadi -673010538.0) tanpa mengubah NILAI. Jalur baca
# dashboard memakai ::float8, jadi ini tak terlihat pengguna — tetapi ia nyata,
# dan gerbang ini menyatakan invariannya sebagai kesetaraan NILAI, bukan teks.
SIDES_OK="$(gate_sql -c "SET app.unit_ids='1';
  SELECT count(*) FROM app.saldo_pelanggan_snapshot_row
  WHERE akhir_piutang_lokal <> akhir_piutang_lokal_debet - akhir_piutang_lokal_kredit
     OR akhir_hutang_lokal  <> akhir_hutang_lokal_debet  - akhir_hutang_lokal_kredit;")"
[ "$SIDES_OK" = "0" ] || fail "A: debet-kredit tidak merekonstruksi saldo pada $SIDES_OK baris"
IBLOCAL="$(gate_sql -c "SET app.unit_ids='1';
  SELECT akhir_piutang_lokal_debet||'-'||akhir_piutang_lokal_kredit
  FROM app.saldo_pelanggan_snapshot_row WHERE customer_code='IBLOCAL';")"
[ "$IBLOCAL" = "122345938294-109293254106.50" ] \
  || fail "A: sisi IBLOCAL tak sesuai sumber (dapat ${IBLOCAL})"
echo "A OK — saldo identik, 12 sisi merekonstruksinya, IBLOCAL debet-kredit = ${IBLOCAL}."

# ── B · MERAH: sisa build aktif ─────────────────────────────────────────────
echo
echo "== B · sisa manifest 'building' (bentuk fixture B6) =="
prepare none yes
if OUT="$(preflight)"; then echo "$OUT"; fail "B: preflight MELULUSKAN database yang akan menjatuhkan migrasi"; fi
echo "$OUT" | grep -q 'PREFLIGHT_BLOCKER building_manifest unit=1 .* ref=b6000000-0000-4000-8000-00000000a112' \
  || { echo "$OUT"; fail "B: preflight tidak menyebut unit/manifest pemblokirnya"; }
echo "$OUT" | grep 'PREFLIGHT_BLOCKER'
OUT_B="$(migrate_deploy)" && { echo "$OUT_B"; fail "B: deploy LULUS padahal ada build aktif"; }
gate_sql -c "SELECT coalesce(logs,'') FROM _prisma_migrations WHERE migration_name='0039_snapshot_debet_kredit';" \
  | grep -q snapshot_v2_active_builder \
  || echo "  (catatan: sebabnya TIDAK terekam di _prisma_migrations.logs — lihat 2026-09-14-0039-p3009-diagnosis.md §5.2)"
[ "$(new_columns)" = "0" ] || fail "B: kolom 0039 tertinggal — migrasi tidak atomik"
echo "B OK — preflight menolak lebih dulu, migrasi juga menolak, nol kolom tertinggal."

# ── C · MERAH: generasi complete yang tidak merekonstruksi ──────────────────
echo
echo "== C · manifest 'complete' yang tidak lolos rebuild-and-verify =="
prepare amount no
# Batas yang diakui: preflight TIDAK dapat melihat kelas ini tanpa menjalankan
# rekonstruksinya. Itu ditulis, bukan disembunyikan.
# Prasyarat kasus ini diasersikan pada NILAI, bukan pada teks galat: karena
# 0039 membawa transaksinya sendiri, galat yang Prisma laporkan tertutupi
# (diagnosis §5.2), jadi "ditolak" saja tidak membuktikan guard MANA.
PERTURBED="$(gate_sql -c "SET app.unit_ids='1';
  SELECT trim_scale(akhir_piutang_lokal) FROM app.saldo_pelanggan_snapshot_row WHERE customer_code='IBLOCAL';")"
[ "$PERTURBED" = "13052684188.5" ] \
  || fail "C: prasyarat tidak terpasang — nilai tersimpan ${PERTURBED}, sumber mengimplikasikan 13052684187.5"
if OUT="$(preflight)"; then echo "  preflight LULUS (memang buta terhadap kelas ini — batas yang diketahui)"; fi
OUT_C="$(migrate_deploy)" && { echo "$OUT_C"; fail "C: deploy LULUS padahal generasi tidak merekonstruksi"; }
echo "$OUT_C" | grep -qE 'legacy_balance_mismatch|current transaction is aborted' \
  || { echo "$OUT_C"; fail "C: ditolak, tetapi bukan oleh guard yang dimaksud"; }
[ "$(new_columns)" = "0" ] || fail "C: kolom 0039 tertinggal — migrasi tidak atomik"
echo "C OK — ditolak oleh guard rebuild-and-verify, nol kolom tertinggal."

# ── D · HIJAU: pemulihan ───────────────────────────────────────────────────
echo
echo "== D · pemulihan sesudah C =="
(cd "$BACKEND" && DATABASE_URL="$DEPLOY_URL" "$PRISMA" migrate resolve --rolled-back 0039_snapshot_debet_kredit >/dev/null 2>&1) \
  || fail "D: 'migrate resolve --rolled-back' gagal"
gate_sql -c "SET app.unit_ids='1';
  UPDATE app.saldo_pelanggan_snapshot_row SET akhir_piutang_lokal = akhir_piutang_lokal - 1,
    awal_piutang_lokal = awal_piutang_lokal - 1 WHERE customer_code='IBLOCAL';" >/dev/null
gate_sql -c "SET app.unit_ids='1';
  UPDATE app.saldo_pelanggan_snapshot_manifest m SET row_keyed_checksum = (
    SELECT sha256(convert_to(string_agg(concat_ws('|', unit_id::text, as_of_date::text, customer_code,
      awal_piutang_lokal::text, akhir_piutang_lokal::text, awal_piutang_online::text,
      akhir_piutang_online::text, awal_hutang_lokal::text, akhir_hutang_lokal::text),
      E'\n' ORDER BY customer_code), 'UTF8'))
    FROM app.saldo_pelanggan_snapshot_row r WHERE r.generation_id = m.generation_id),
    akhir_piutang_lokal_total = (SELECT sum(akhir_piutang_lokal) FROM app.saldo_pelanggan_snapshot_row r WHERE r.generation_id = m.generation_id),
    awal_piutang_lokal_total  = (SELECT sum(awal_piutang_lokal)  FROM app.saldo_pelanggan_snapshot_row r WHERE r.generation_id = m.generation_id);" >/dev/null
OUT_D="$(migrate_deploy)" || { echo "$OUT_D"; fail "D: deploy ulang gagal sesudah pemulihan"; }
[ "$(new_columns)" = "12" ] || fail "D: 0039 tidak benar-benar terpasang sesudah pemulihan"
echo "D OK — pemulihan terbukti, bukan dijanjikan."

admin -c "DROP DATABASE IF EXISTS ${DB};" >/dev/null
echo
echo "GERBANG DEPLOY HIJAU pada server_version_num=${SERVER_NUM} — A/D hijau, B/C terbukti bisa merah."
