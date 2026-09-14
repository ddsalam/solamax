#!/usr/bin/env bash
# Self-test — DELAPAN keadaan, termasuk SEMUA jalur hijau.
#
# Gerbang yang hanya pernah dibuktikan MERAH tak dapat dibedakan dari gerbang
# yang rusak: orang berikutnya akan mengira ia salah dan mencari cara
# melewatinya. Pelajaran itu sudah dibayar repo ini pada G4.
#
# TIDAK menyentuh GCP: seluruh keputusannya murni dari masukan.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/check-snapshot-scheduler-jobs.sh"
OK_HEADERS="Content-Type,User-Agent,x-snapshot-secret"
gagal=0

jalankan() {
  local harapan="$1" label="$2" keluar=0 keluaran
  keluaran="$(bash "$GATE" 2>&1)" || keluar=$?
  if [ "$harapan" = "ok" ] && [ "$keluar" -ne 0 ]; then
    echo "GAGAL: '$label' seharusnya HIJAU, keluar=$keluar"; echo "$keluaran"; gagal=1
  elif [ "$harapan" = "merah" ] && [ "$keluar" -eq 0 ]; then
    echo "GAGAL: '$label' seharusnya MERAH, tetapi lulus"; echo "$keluaran"; gagal=1
  else
    echo "  ok  $label"
  fi
}

# ── Bentuk header ──────────────────────────────────────────────────────────
# 1 · MERAH — Content-Type default sesudah --update-headers menimpa set header.
#     INI kejadian nyata yang menghabiskan build 02:05 WIB 14-09-2026.
JOB_NAME=uji JOB_URI="https://x/snapshot-worker" JOB_CONTENT_TYPE="application/octet-stream" \
  JOB_HEADER_KEYS="Content-Type,x-snapshot-secret" ENDPOINT_ADA=false \
  jalankan merah "Content-Type octet-stream (malam yang hilang)"

# 2 · MERAH — Content-Type hilang sama sekali.
JOB_NAME=uji JOB_URI="https://x/snapshot-worker" JOB_CONTENT_TYPE="" \
  JOB_HEADER_KEYS="x-snapshot-secret" ENDPOINT_ADA=false \
  jalankan merah "Content-Type tidak ada"

# 3 · MERAH — arah sebaliknya: memperbaiki Content-Type saja menghapus secret.
JOB_NAME=uji JOB_URI="https://x/snapshot-worker" JOB_CONTENT_TYPE="application/json" \
  JOB_HEADER_KEYS="Content-Type,User-Agent" ENDPOINT_ADA=false \
  jalankan merah "x-snapshot-secret terhapus"

# ── Job sementara ──────────────────────────────────────────────────────────
# 4 · HIJAU — job tidak ada.
JOB_NAME=uji JOB_URI="" JOB_CONTENT_TYPE="" JOB_HEADER_KEYS="" ENDPOINT_ADA=true \
  jalankan ok "job tidak ada"

# 5 · HIJAU — endpoint /retire belum ada; job sementara masih satu-satunya cara.
JOB_NAME=uji JOB_URI="https://x/snapshot-worker" JOB_CONTENT_TYPE="application/json" \
  JOB_HEADER_KEYS="$OK_HEADERS" ENDPOINT_ADA=false \
  jalankan ok "endpoint belum ada, job sementara masih sah"

# 6 · MERAH — endpoint sudah ada, job masih di endpoint build.
JOB_NAME=uji JOB_URI="https://x/snapshot-worker" JOB_CONTENT_TYPE="application/json" \
  JOB_HEADER_KEYS="$OK_HEADERS" ENDPOINT_ADA=true \
  jalankan merah "endpoint sudah ada, job masih di endpoint build"

# 7 · HIJAU — sudah dipindah. Host SENGAJA berbeda dari kasus 6: Cloud Run punya
#     beberapa bentuk URL yang sama-sama sah, jadi keputusannya harus atas PATH.
JOB_NAME=uji JOB_CONTENT_TYPE="application/json" JOB_HEADER_KEYS="$OK_HEADERS" ENDPOINT_ADA=true \
  JOB_URI="https://solamax-ingest-staging-113869564052.asia-southeast2.run.app/snapshot-worker/retire" \
  jalankan ok "sudah dipindah ke /retire (host lain)"

# 8 · MERAH — bentuk tak dipahami tidak boleh lulus diam-diam.
JOB_NAME=uji JOB_URI="https://x/endpoint-lain" JOB_CONTENT_TYPE="application/json" \
  JOB_HEADER_KEYS="$OK_HEADERS" ENDPOINT_ADA=true \
  jalankan merah "uri tak dikenali tidak boleh lulus"

# ── Cakupan per-unit ───────────────────────────────────────────────────────
# 9 · MERAH — job pemensiunan mematok satu unit. INI akar insiden 14-09-2026:
#     pemensiunan per-unit + penjadwal yang hanya mencakup unit 1 => unit 4
#     menumpuk 32 cut staging (30,3 juta baris) tanpa berbunyi.
JOB_NAME=uji JOB_URI="https://x/snapshot-worker/retire" JOB_CONTENT_TYPE="application/json" \
  JOB_HEADER_KEYS="$OK_HEADERS" ENDPOINT_ADA=true ALL_UNITS_ADA=true JOB_ROLE=retire JOB_BODY_UNIT=1 \
  jalankan merah "job pemensiunan mematok satu unit"

# 10 · MERAH — body tak terbaca tidak boleh dianggap aman.
JOB_NAME=uji JOB_URI="https://x/snapshot-worker/retire" JOB_CONTENT_TYPE="application/json" \
  JOB_HEADER_KEYS="$OK_HEADERS" ENDPOINT_ADA=true ALL_UNITS_ADA=true JOB_ROLE=retire JOB_BODY_UNIT='?' \
  jalankan merah "body job pemensiunan tak terbaca"

# 11 · HIJAU — body kosong = seluruh unit aktif.
JOB_NAME=uji JOB_URI="https://x/snapshot-worker/retire" JOB_CONTENT_TYPE="application/json" \
  JOB_HEADER_KEYS="$OK_HEADERS" ENDPOINT_ADA=true ALL_UNITS_ADA=true JOB_ROLE=retire JOB_BODY_UNIT="" \
  jalankan ok "job pemensiunan mencakup seluruh unit"

# 12 · HIJAU — job BUILD memang harus mematok satu unit; aturan di atas tidak
#      boleh ikut menjatuhkannya.
JOB_NAME=uji JOB_URI="https://x/snapshot-worker" JOB_CONTENT_TYPE="application/json" \
  JOB_HEADER_KEYS="$OK_HEADERS" ENDPOINT_ADA=false JOB_ROLE=build JOB_BODY_UNIT=1 \
  jalankan ok "job build mematok unit (memang seharusnya)"

# 13 · HIJAU — revisi ter-deploy BELUM mendukung /retire tanpa unit_id, jadi
#      body yang mematok unit masih SATU-SATUNYA bentuk yang bekerja.
#      Menuntut '{}' di sini akan membuat job 404 dan pemensiunan BERHENTI.
JOB_NAME=uji JOB_URI="https://x/snapshot-worker/retire" JOB_CONTENT_TYPE="application/json" \
  JOB_HEADER_KEYS="$OK_HEADERS" ENDPOINT_ADA=true ALL_UNITS_ADA=false JOB_ROLE=retire JOB_BODY_UNIT=1 \
  jalankan ok "body mematok unit sementara revisi belum mendukung semua-unit"

[ "$gagal" -eq 0 ] && echo "check-snapshot-scheduler-jobs: 13 keadaan sesuai harapan." || exit 1
