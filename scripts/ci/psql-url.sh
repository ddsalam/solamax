#!/usr/bin/env bash
# SATU tempat untuk mengubah DATABASE_URL Prisma menjadi URL yang psql terima.
#
# ⚠️ KENAPA BERKAS INI ADA. Logika ini sempat hidup DUA KALI: sebagai
# `strip_schema_param` di check-snapshot-quiescent.sh (benar, lengkap dengan
# komentar "psql menolak `schema` tetapi MEMBUTUHKAN `host`"), dan sebagai
# `${DATABASE_URL%%\?*}` yang ditulis ulang di dalam YAML action — yang membuang
# SELURUH query string, termasuk `host=/cloudsql/<instance>`. Cloud SQL Auth
# Proxy memakai unix socket, jadi psql jatuh ke TCP localhost:5432 dan
# memulangkan "Connection refused". Itu menjatuhkan deploy PILOT 15-09-2026.
#
# Jawabannya sudah ada di repo, di berkas yang disunting pada sesi yang sama.
# Menulis ulang logika yang sudah terbukti adalah cara membuat versi kedua yang
# salah — dan versi kedua itu selalu yang dipakai di tempat yang paling mahal.
#
# Dipakai sebagai perintah:  PSQL_URL="$(bash scripts/ci/psql-url.sh "$DATABASE_URL")"
# atau di-source:            . scripts/ci/psql-url.sh && strip_schema_param "$url"
set -euo pipefail

# Buang HANYA parameter `schema` (milik Prisma, ditolak psql). Semua parameter
# lain — terutama `host` — DIPERTAHANKAN.
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

# Dijalankan langsung (bukan di-source) → bertindak sebagai CLI.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  strip_schema_param "${1:?berikan DATABASE_URL}"
  printf '\n'
fi
