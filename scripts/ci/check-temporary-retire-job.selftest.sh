#!/usr/bin/env bash
# Self-test gerbang job sementara — EMPAT keadaan, termasuk KEDUA jalur hijau.
#
# Gerbang yang hanya pernah dibuktikan MERAH tak dapat dibedakan dari gerbang
# yang rusak: orang berikutnya akan mengira ia salah dan mencari cara
# melewatinya. Itu pelajaran yang sudah dibayar repo ini pada G4.
#
# Self-test ini TIDAK menyentuh GCP — seluruh keputusannya murni dari masukan.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/check-temporary-retire-job.sh"
gagal=0

jalankan() { # $1 harapan(ok|merah) $2 label ; env sudah di-set pemanggil
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

# 1 · HIJAU — job tidak ada sama sekali.
JOB_URI="" ENDPOINT_ADA=true jalankan ok "job tidak ada"

# 2 · HIJAU — endpoint belum ter-deploy; job sementara masih satu-satunya cara.
JOB_URI="https://x-et.a.run.app/snapshot-worker" ENDPOINT_ADA=false \
  jalankan ok "endpoint belum ada, job sementara masih sah"

# 3 · MERAH — endpoint sudah ada, job masih menunjuk endpoint build.
JOB_URI="https://x-et.a.run.app/snapshot-worker" ENDPOINT_ADA=true \
  jalankan merah "endpoint sudah ada, job masih di endpoint build"

# 4 · HIJAU — job sudah dipindahkan. Host SENGAJA berbeda dari kasus 3:
#     Cloud Run punya beberapa bentuk URL yang sama-sama sah, jadi gerbangnya
#     harus memutuskan atas PATH. Kalau ia membandingkan host, kasus ini merah.
JOB_URI="https://solamax-ingest-staging-113869564052.asia-southeast2.run.app/snapshot-worker/retire" \
  ENDPOINT_ADA=true jalankan ok "job sudah dipindah ke /retire (host lain)"

# 5 · MERAH — bentuk yang tidak dipahami tidak boleh lulus diam-diam.
JOB_URI="https://x-et.a.run.app/endpoint-lain" ENDPOINT_ADA=true \
  jalankan merah "uri tak dikenali tidak boleh lulus"

[ "$gagal" -eq 0 ] && echo "check-temporary-retire-job: 5 keadaan sesuai harapan." || exit 1
