#!/usr/bin/env bash
# Self-test penjaga sintaks SQL — membuktikan ia bisa berbunyi MERAH.
#
# Penjaga yang tak pernah bisa gagal bukan penjaga. Berkas ini menjalankan
# `check-sql-syntax.mjs` YANG SEBENARNYA (lewat argumen direktori) terhadap
# kasus tiruan — bukan meniru logikanya. Self-test yang meniru hanya menguji
# tiruannya.
#
# Kasus pertama adalah BUG NYATA yang menyumbat CD pada 13 Agustus 2026:
# `///` (doc-comment Prisma schema) di dalam `0030_edc_settlement/migration.sql`.
#
# Pola berkas ini mengikuti check-arsip-g4.selftest.sh / check-backup-files.selftest.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECKER="$ROOT/scripts/ci/check-sql-syntax.mjs"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

gagal=0
lulus=0

# mk <nama>  — baca SQL dari stdin ke $TMP/<nama>/0001_x/migration.sql
mk() {
  mkdir -p "$TMP/$1/0001_x"
  cat > "$TMP/$1/0001_x/migration.sql"
}

harus_merah() {
  local nama="$1" dir="$2"
  if node "$CHECKER" "$dir" >/dev/null 2>&1; then
    echo "❌ SELFTEST GAGAL: '$nama' seharusnya DITOLAK, tetapi lolos."
    gagal=$((gagal + 1))
  else
    echo "✓ merah pada: $nama"
    lulus=$((lulus + 1))
  fi
}

harus_hijau() {
  local nama="$1" dir="$2"
  if node "$CHECKER" "$dir" >/dev/null 2>&1; then
    echo "✓ hijau pada: $nama"
    lulus=$((lulus + 1))
  else
    echo "❌ SELFTEST GAGAL: '$nama' seharusnya LOLOS, tetapi ditolak (false positive)."
    node "$CHECKER" "$dir" 2>&1 | sed 's/^/      /' || true
    gagal=$((gagal + 1))
  fi
}

# --- 1. BUG NYATA: `///` doc-comment Prisma di dalam .sql (0030, 13 Agu 2026) ---
mk kasus_slash <<'SQL'
CREATE TABLE "app"."t" (
    "id" UUID NOT NULL,
    /// Tanggal uang MASUK rekening (H+1).
    "d" DATE NOT NULL
);
SQL
harus_merah "/// doc-comment Prisma di berkas .sql (bug nyata 0030)" "$TMP/kasus_slash"

# --- 2. Varian gramatika lain yang harus tertangkap ---
mk kasus_kurung <<'SQL'
CREATE TABLE "app"."t" ("id" UUID NOT NULL;
SQL
harus_merah "kurung tak seimbang" "$TMP/kasus_kurung"

mk kasus_dollar <<'SQL'
DO $$
BEGIN
  PERFORM 1;
END
SQL
harus_merah "dollar-quote tak tertutup" "$TMP/kasus_dollar"

mk kasus_katakunci <<'SQL'
CREATE TABEL "app"."t" ("id" UUID);
SQL
harus_merah "kata kunci salah (TABEL)" "$TMP/kasus_katakunci"

# --- 3. Kontrol HIJAU: konstruksi sah yang memang dipakai migrasi nyata ---
#     Tanpa kontrol ini, penjaga yang menolak SEGALANYA juga akan "lulus"
#     seluruh uji merah di atas — hijau-tanpa-daya-beda.
mk kasus_sah <<'SQL'
CREATE TABLE IF NOT EXISTS "app"."t" (
    "id"  UUID NOT NULL DEFAULT gen_random_uuid(),
    -- komentar SQL yang benar
    "g"   DECIMAL(17,2) GENERATED ALWAYS AS (1 - 0) STORED,
    CONSTRAINT "t_pkey" PRIMARY KEY ("id")
);
DO $$
DECLARE
  predicate text := $p$unit_id = ANY (ARRAY(SELECT 1))$p$;
BEGIN
  EXECUTE 'ALTER TABLE "app"."t" ENABLE ROW LEVEL SECURITY';
  EXECUTE format('CREATE POLICY unit_scope ON "app"."t" USING (%s)', predicate);
END
$$;
SQL
harus_hijau "SQL sah: GENERATED + dollar-quote bersarang + EXECUTE format" "$TMP/kasus_sah"

# --- 4. Kontrol HIJAU: korpus migrasi SUNGGUHAN (jaga terhadap false positive) ---
harus_hijau "seluruh migrasi nyata di repo" "$ROOT/apps/backend/prisma/migrations"

# --- 5. Penjaga tak boleh hijau karena TAK PUNYA SUBJEK ---
mkdir -p "$TMP/kosong"
harus_merah "direktori tanpa migrasi (hijau-tanpa-subjek)" "$TMP/kosong"

echo
if [ "$gagal" -gt 0 ]; then
  echo "SELFTEST GAGAL: $gagal dari $((lulus + gagal)) kasus."
  exit 1
fi
echo "OK: penjaga sintaks SQL terbukti bisa MERAH ($lulus kasus, termasuk bug nyata 0030)."
