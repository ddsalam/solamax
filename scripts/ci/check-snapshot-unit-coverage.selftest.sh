#!/usr/bin/env bash
# Self-test — tujuh keadaan, termasuk KEDUA bentuk jalur hijau. Tanpa GCP, tanpa DB.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="$HERE/check-snapshot-unit-coverage.sh"
gagal=0
jalankan() {
  local harapan="$1" label="$2" keluar=0 keluaran
  keluaran="$(bash "$GATE" 2>&1)" || keluar=$?
  if { [ "$harapan" = ok ] && [ "$keluar" -ne 0 ]; } || { [ "$harapan" = merah ] && [ "$keluar" -eq 0 ]; }; then
    echo "GAGAL: '$label' harapan=$harapan keluar=$keluar"; echo "$keluaran"; gagal=1
  else echo "  ok  $label"; fi
}

# 1 · MERAH — kasus Bundaran Kotabaru: unit 4 mengirim cut, tak punya job build.
UNIT_BERCUT="1,2,4" BUILD_UNITS="1" RETIRE_UNITS="1,2,3,4,5,6,7" RETIRE_ITERASI=false \
  jalankan merah "unit ber-cut tanpa job build (Kotabaru)"

# 2 · MERAH — unit ber-cut tanpa pemensiunan, tak ada yang mengiterasi.
UNIT_BERCUT="1,2,4" BUILD_UNITS="1,2,4" RETIRE_UNITS="1" RETIRE_ITERASI=false \
  jalankan merah "unit ber-cut tanpa pemensiunan"

# 3 · HIJAU — bentuk NYATA hari ini: cut dari 1,2,4; build 1,2,4; retire 1..7.
#     Unit 3,5,6,7 BELUM mengirim cut (bundle agent belum ditukar) dan karena
#     itu TIDAK dituntut punya job build. Gerbang yang menuntutnya akan menyala
#     tiap hari sampai unit terakhir di-onboard — alarm yang selalu menyala.
UNIT_BERCUT="1,2,4" BUILD_UNITS="1,2,4" RETIRE_UNITS="1,2,3,4,5,6,7" RETIRE_ITERASI=false \
  jalankan ok "bentuk nyata 14-09: cut 1,2,4 tercakup penuh"

# 4 · HIJAU — bentuk SESUDAH #362: satu job retire mengiterasi; nol per-unit.
UNIT_BERCUT="1,2,4" BUILD_UNITS="1,2,4" RETIRE_UNITS="" RETIRE_ITERASI=true \
  jalankan ok "retire mengiterasi, nol job retire per-unit"

# 5 · MERAH — iterasi pemensiunan TIDAK menutupi lubang sisi build.
UNIT_BERCUT="1,2,4" BUILD_UNITS="1" RETIRE_UNITS="" RETIRE_ITERASI=true \
  jalankan merah "iterasi retire tidak menutupi lubang build"

# 6 · MERAH — daftar unit ber-cut KOSONG. Itu kueri yang gagal atau scope RLS
#     yang tidak terpasang, bukan "tidak ada unit". Gerbang yang lulus di sini
#     lulus tanpa memeriksa apa pun.
UNIT_BERCUT="" BUILD_UNITS="1,2,4" RETIRE_UNITS="1" RETIRE_ITERASI=true \
  jalankan merah "daftar unit ber-cut kosong = galat, bukan nol"

# 7 · HIJAU — satu unit, cakupan penuh.
UNIT_BERCUT="1" BUILD_UNITS="1" RETIRE_UNITS="1" RETIRE_ITERASI=false \
  jalankan ok "satu unit, cakupan penuh"

[ "$gagal" -eq 0 ] && echo "check-snapshot-unit-coverage: 7 keadaan sesuai harapan." || exit 1
