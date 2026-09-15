#!/usr/bin/env bash
# Self-test — enam bentuk URL. Tanpa jaringan, tanpa database.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Dapat diarahkan ke varian, supaya kontrol "bentuk yang salah harus MERAH"
# dijalankan terhadap skrip yang sah — bukan terhadap potongan yang rusak.
TARGET="${PSQL_URL_SH:-$HERE/psql-url.sh}"
gagal=0
periksa() { # $1 label, $2 masukan, $3 harapan
  local dapat; dapat="$(bash "$TARGET" "$2")"
  if [ "$dapat" = "$3" ]; then echo "  ok  $1"; else
    echo "GAGAL: $1"; echo "  masuk   : $2"; echo "  harapan : $3"; echo "  dapat   : $dapat"; gagal=1; fi
}

# 1 · KASUS YANG MENJATUHKAN DEPLOY PILOT 15-09-2026. `host` WAJIB bertahan;
#     membuangnya membuat psql jatuh ke TCP localhost dan "Connection refused".
periksa "socket Cloud SQL — host dipertahankan, schema dibuang" \
  'postgresql://ingest:pw@localhost/solamax?host=/cloudsql/solamax:asia-southeast2:solamax-pg&schema=public' \
  'postgresql://ingest:pw@localhost/solamax?host=/cloudsql/solamax:asia-southeast2:solamax-pg'

# 2 · schema di TENGAH, bukan di ujung.
periksa "schema di tengah" \
  'postgresql://u:p@h/db?sslmode=require&schema=app&connect_timeout=5' \
  'postgresql://u:p@h/db?sslmode=require&connect_timeout=5'

# 3 · schema satu-satunya parameter → tanda tanya ikut hilang.
periksa "schema satu-satunya" 'postgresql://u:p@h/db?schema=public' 'postgresql://u:p@h/db'

# 4 · tanpa query string sama sekali.
periksa "tanpa query" 'postgresql://u:p@h:5432/db' 'postgresql://u:p@h:5432/db'

# 5 · tanpa schema — tidak boleh menyentuh apa pun.
periksa "tanpa schema" 'postgresql://u:p@h/db?host=/cloudsql/x' 'postgresql://u:p@h/db?host=/cloudsql/x'

# 6 · KONTROL: parameter yang NAMANYA memuat "schema" bukan parameter schema.
#     Pencocokan yang ceroboh akan ikut membuangnya.
periksa "search_path bukan schema" \
  'postgresql://u:p@h/db?options=-c%20search_path%3Dapp,public&schema=app' \
  'postgresql://u:p@h/db?options=-c%20search_path%3Dapp,public'

[ "$gagal" -eq 0 ] && echo "psql-url: 6 bentuk sesuai harapan." || exit 1
