#!/usr/bin/env bash
# Kumpulkan KURVA, bukan satu titik.
#
# Menguji dua hal yang belum terbukti:
#   (a) apakah autovacuum tertinggal pada tabel source;
#   (b) apakah job pemensiunan per jam benar-benar MENAHAN LAJU.
#
# PREDIKSI YANG DIKUNCI (14-09-2026, sebelum data ada):
#   `pg_relation_size('app.saldo_pelanggan_source_bppiut')` MENDATAR dalam
#   <= 6 jam pada tingkat <= ~1 GB. Bila ia naik monoton 24 jam, prediksi SALAH,
#   lag autovacuum nyata, dan tuning autovacuum menjadi bagian perbaikan aliran.
#
# JALANKAN SESUDAH `VACUUM FULL` selesai — titik yang diambil saat vacuum
# berjalan mengukur puncak rewrite, bukan keadaan tunak, dan akan mengotori
# kurvanya.
#
#   export DATABASE_URL_PILOT=...            # lewat cloud-sql-proxy
#   scripts/piutang-kapasitas/05-kurva.sh 12 > kurva.log &   # 12 jam
#   scripts/piutang-kapasitas/05-kurva.sh --baca kurva.log   # baca kurvanya
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "${1:-}" = "--baca" ]; then
  BERKAS="${2:?berikan berkas kurva}"
  echo "=== source_bppiut — heap (uji prediksi plateau) ==="
  awk -F'|' '$1=="KURVA" && $3=="saldo_pelanggan_source_bppiut" {
    printf "%s  %8.2f GB  hidup=%-10s mati=%-10s av=%-4s sejak_av=%ss\n",
      $2, $4/1e9, $5, $6, $7, $8 }' "$BERKAS"
  echo
  echo "=== database + staging (uji apakah laju tertahan) ==="
  awk -F'|' '$1=="KURVA_DB" {
    printf "%s  db=%6.2f GB  gerbang_terbuka=%-5s staging=%-4s failed=%s\n",
      $2, $3/1e9, $4, $5, $6 }' "$BERKAS"
  exit 0
fi

JAM="${1:-12}"
: "${DATABASE_URL_PILOT:?DATABASE_URL_PILOT wajib diisi (lewat cloud-sql-proxy)}"
for i in $(seq 1 "$JAM"); do
  psql "$DATABASE_URL_PILOT" -X -q -f "$HERE/05-kurva.sql"
  [ "$i" -lt "$JAM" ] && sleep 3600
done
