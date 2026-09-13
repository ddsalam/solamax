#!/usr/bin/env bash
# Preflight `0039_snapshot_debet_kredit` — dijalankan SEBELUM `prisma migrate
# deploy` menyentuh database tier mana pun.
#
# ⚠️ KENAPA SEBELUM, bukan mengandalkan penjaga di dalam migrasinya.
# Migrasi 0039 sudah gagal-tertutup sendiri. Tetapi ketika ia menolak, Prisma
# sudah menulis baris `_prisma_migrations` yang belum selesai — dan database itu
# kemudian terkunci **P3009**: setiap migrasi berikutnya ditolak sampai seorang
# manusia menjalankan `migrate resolve`. Itu yang terjadi pada `solamax-pg-rlsstg`
# 13 September 2026. Menolak di sini membuat migrasinya tidak pernah MULAI,
# sehingga tidak ada P3009 yang perlu dibereskan — terutama penting pada tier
# pilot, karena di sana biayanya jatuh pada DB live.
#
# ⚠️ KENAPA `app.unit_ids` DIISI SELURUH UNIT.
# Tabel snapshot ber-RLS unit-scoped dan FORCE. Tanpa scope, kueri memulangkan
# NOL BARIS TANPA GALAT — dan nol itu terbaca seperti "bersih". Gerbang pra-merge
# 13 September memeriksa dengan scope `'1'` saja; migrasinya memindai SELURUH
# `public.unit`. Lihat [[nol-rls-bukan-fakta]].
#
# Preflight ini MENIRU penjaga 0039 satu per satu, read-only:
#   1. manifest `status='building'`            → snapshot_v2_active_builder
#   2. work `state='leased'`                   → snapshot_v2_active_builder
#   3. formula_version <> 'saldo-pelanggan-v1' → snapshot_v2_unexpected_formula
#   4. predikat cut sumber lengkap             → snapshot_v2_source_cut_incomplete
#
# Ia MELEWATI diri sendiri bila 0039 sudah terpasang, atau bila tabel snapshot
# belum ada — supaya ia tidak menjadi pajak permanen atas setiap deploy.
#
# MASUKAN (env): DATABASE_URL — tidak pernah di-echo.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL wajib diisi}"

# psql menolak parameter `schema` milik Prisma, tetapi MEMBUTUHKAN `host` pada
# mode unix-socket Cloud SQL. Buang `schema`, pertahankan sisanya. Nilai secret
# tidak pernah dicetak.
strip_schema_param() {
  local url="$1" base query kept item
  base="${url%%\?*}"
  if [ "$base" = "$url" ]; then printf '%s' "$url"; return; fi
  query="${url#*\?}"
  kept=""
  local IFS='&'
  for item in $query; do
    case "$item" in
      schema=*) ;;
      *) kept="${kept:+$kept&}$item" ;;
    esac
  done
  printf '%s%s' "$base" "${kept:+?$kept}"
}

PSQL_URL="$(strip_schema_param "$DATABASE_URL")"

report="$(psql "$PSQL_URL" -X -v ON_ERROR_STOP=1 -qAt 2>&1 <<'SQL'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';
DO $preflight$
DECLARE
  scope text;
  blockers bigint := 0;
  detail record;
BEGIN
  IF to_regclass('app.saldo_pelanggan_snapshot_manifest') IS NULL THEN
    RAISE NOTICE 'PREFLIGHT_SKIP tabel snapshot belum ada (0037 belum terpasang)';
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public._prisma_migrations
    WHERE migration_name = '0039_snapshot_debet_kredit'
      AND finished_at IS NOT NULL AND rolled_back_at IS NULL
  ) THEN
    RAISE NOTICE 'PREFLIGHT_SKIP 0039 sudah terpasang';
    RETURN;
  END IF;

  -- Seluruh unit, bukan satu. Nol baris dari scope sempit bukan fakta.
  SELECT string_agg(unit_id::text, ',' ORDER BY unit_id) INTO scope FROM public.unit;
  IF scope IS NULL THEN
    RAISE NOTICE 'PREFLIGHT_OK nol unit terdaftar; tidak ada yang dapat memblokir';
    RETURN;
  END IF;
  PERFORM set_config('app.unit_ids', scope, true);
  RAISE NOTICE 'PREFLIGHT_SCOPE app.unit_ids=%', scope;

  -- Kontrol positif: bila scope benar-benar terpasang, manifest yang ADA harus
  -- terlihat. Jumlahnya dicetak supaya "nol pemblokir" punya subjek.
  SELECT count(*) INTO blockers FROM app.saldo_pelanggan_snapshot_manifest;
  RAISE NOTICE 'PREFLIGHT_SUBJEK manifest terlihat=%, work terlihat=%',
    blockers, (SELECT count(*) FROM app.saldo_pelanggan_build_work);
  blockers := 0;

  FOR detail IN
    SELECT 'building_manifest' AS kind, unit_id, as_of_date::text AS as_of_date,
           generation_id::text AS ref
    FROM app.saldo_pelanggan_snapshot_manifest WHERE status = 'building'
    UNION ALL
    SELECT 'leased_work', unit_id, as_of_date::text, work_id::text
    FROM app.saldo_pelanggan_build_work WHERE state = 'leased'
    UNION ALL
    SELECT 'unexpected_formula', unit_id, as_of_date::text, formula_version
    FROM app.saldo_pelanggan_snapshot_manifest
    WHERE formula_version <> 'saldo-pelanggan-v1'
    UNION ALL
    SELECT 'source_cut_incomplete', m.unit_id, m.as_of_date::text, m.generation_id::text
    FROM app.saldo_pelanggan_snapshot_manifest m
    WHERE NOT EXISTS (
      SELECT 1 FROM app.saldo_pelanggan_source_cycle c
      WHERE c.unit_id = m.unit_id AND c.source_cycle_id = m.source_cycle_id
        AND c.source_cycle_sequence = m.source_cycle_sequence AND c.status = 'complete'
        AND c.source_completed_at = m.source_completed_at
        AND c.pelanggan_keyed_checksum IS NOT NULL
        AND c.bppiut_keyed_checksum IS NOT NULL
        AND c.bphut_keyed_checksum IS NOT NULL
        AND c.pelanggan_row_count = (SELECT count(*) FROM app.saldo_pelanggan_source_pelanggan p
                                     WHERE p.unit_id = c.unit_id AND p.source_cycle_id = c.source_cycle_id)
        AND c.bppiut_row_count = (SELECT count(*) FROM app.saldo_pelanggan_source_bppiut p
                                  WHERE p.unit_id = c.unit_id AND p.source_cycle_id = c.source_cycle_id)
        AND c.bphut_row_count = (SELECT count(*) FROM app.saldo_pelanggan_source_bphut h
                                 WHERE h.unit_id = c.unit_id AND h.source_cycle_id = c.source_cycle_id)
    )
    ORDER BY 1, 2, 3
  LOOP
    blockers := blockers + 1;
    RAISE NOTICE 'PREFLIGHT_BLOCKER % unit=% tanggal=% ref=%',
      detail.kind, detail.unit_id, detail.as_of_date, detail.ref;
  END LOOP;

  IF blockers = 0 THEN
    RAISE NOTICE 'PREFLIGHT_OK nol pemblokir pada % unit', array_length(string_to_array(scope, ','), 1);
  ELSE
    RAISE NOTICE 'PREFLIGHT_FAIL % pemblokir', blockers;
  END IF;
END
$preflight$;
ROLLBACK;
SQL
)"

echo "$report"

if printf '%s' "$report" | grep -q 'PREFLIGHT_FAIL'; then
  cat >&2 <<'MSG'

DITOLAK: migrasi 0039 akan gagal terhadap database ini, dan kegagalannya akan
meninggalkan database itu terkunci P3009 (setiap migrasi berikutnya ditolak
sampai seorang manusia menjalankan `prisma migrate resolve`).

Setiap baris PREFLIGHT_BLOCKER di atas menyebut unit, tanggal, dan referensinya.

PERBAIKANNYA (owner):
  · `building_manifest` / `leased_work` milik build yang benar-benar berjalan —
    tunggu sampai selesai, lalu ulangi. Cron unit 1 mulai 02:05 WIB; jendela
    deploy aman 05:15-01:30 WIB.
  · `building_manifest` sisa fixture pada DB test — jalankan
    `scripts/piutang-b6/cleanup-rlsstg.sql` terhadap `solamax-pg-rlsstg`.
  · `source_cut_incomplete` / `unexpected_formula` — JANGAN dipaksa; itu bukan
    sisa, melainkan keadaan yang belum dipahami. Laporkan.
MSG
  exit 1
fi

if printf '%s' "$report" | grep -qE 'PREFLIGHT_OK|PREFLIGHT_SKIP'; then
  exit 0
fi

echo "DITOLAK: preflight tidak memulangkan vonis apa pun — jangan anggap itu lulus." >&2
exit 1
