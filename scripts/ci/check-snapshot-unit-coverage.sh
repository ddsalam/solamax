#!/usr/bin/env bash
# Gerbang: SETIAP unit terdaftar harus tercakup di KEDUA sisi — build DAN
# pemensiunan.
#
# ⚠️ DUA KEJADIAN, SATU BENTUK. Penjadwal snapshot bersifat per-unit, dan
# cakupannya bergantung pada seseorang mengingat membuat job saat unit baru
# di-onboard. Ingatan itu gagal dua kali:
#
#   · 14-09-2026, sisi PEMENSIUNAN — unit 4 menumpuk 32 cut staging
#     (30,3 juta baris bppiut) berbulan-bulan tanpa satu pun pemensiunan.
#   · 14-09-2026, sisi BUILD — unit 4 (Bundaran Kotabaru) punya 39 cycle dengan
#     `complete = 0` sejak 12 September. Cut-nya LENGKAP (seq 38: 935.132
#     bppiut / 95.969 bphut); tidak pernah ada yang membangunnya, karena hanya
#     `solamax-snapshot-unit-1` yang ada. Dua hari snapshot hilang tanpa
#     berbunyi.
#
# Sisi pemensiunan diselesaikan di aplikasi (satu endpoint mengiterasi seluruh
# unit aktif). Sisi BUILD tidak bisa begitu: build memegang lease global-1 dan
# anggaran 18 menit, jadi tujuh build dalam satu permintaan tidak muat. Build
# TETAP per-unit — dan karena itu cakupannya tetap butuh gerbang.
#
# MASUKAN (env):
#   UNIT_BERCUT      id unit yang BENAR-BENAR mengirim source cut (dari DB),
#                    dipisah koma. KOSONG = galat, bukan "tidak ada unit".
#   BUILD_UNITS      id unit yang punya job build, dipisah koma
#   RETIRE_UNITS     id unit yang punya job retire per-unit, dipisah koma
#   RETIRE_ITERASI   "true" bila ada job retire yang mencakup SELURUH unit
set -euo pipefail

UNIT_BERCUT="${UNIT_BERCUT:?wajib}"
BUILD_UNITS="${BUILD_UNITS:-}"
RETIRE_UNITS="${RETIRE_UNITS:-}"
RETIRE_ITERASI="${RETIRE_ITERASI:-false}"

jumlah() { [ -z "$1" ] && echo 0 || tr ',' '\n' <<<"$1" | grep -c . ; }

BUILD_N="$(jumlah "$BUILD_UNITS")"
RETIRE_N="$(jumlah "$RETIRE_UNITS")"
BERCUT_N="$(jumlah "$UNIT_BERCUT")"
gagal=0

# ⚠️ KONTROL ANTI-VAKUM. Daftar yang kosong karena ekstraksinya rusak akan
# membuat gerbang ini LULUS tanpa memeriksa apa pun — persis kelas kegagalan
# yang ia ada untuk mencegah. Terjadi saat pengembangannya: `sed` BSD tidak
# mengenal `\+`, daftar job jadi kosong, dan gerbangnya berbunyi atas nol.
if [ "$BERCUT_N" -eq 0 ]; then
  echo "DITOLAK: UNIT_BERCUT kosong. Itu berarti kuerinya gagal atau scope RLS" >&2
  echo "tidak terpasang — bukan berarti tidak ada unit yang mengirim cut." >&2
  exit 1
fi

# Unit yang mengirim cut TETAPI tidak punya job build.
tanpa_build=""
for unit in ${UNIT_BERCUT//,/ }; do
  case ",${BUILD_UNITS}," in
    *",${unit},"*) ;;
    *) tanpa_build="${tanpa_build:+$tanpa_build,}${unit}" ;;
  esac
done

# ── Sisi BUILD ─────────────────────────────────────────────────────────────
if [ -n "$tanpa_build" ]; then
  cat >&2 <<MSG
DITOLAK: unit ${tanpa_build} MENGIRIM source cut tetapi tidak punya job BUILD.
  unit yang mengirim cut : ${UNIT_BERCUT}
  unit yang punya build  : ${BUILD_UNITS:-<tidak ada>}

Cut-nya lengkap, snapshotnya tidak pernah terbit, dan tidak ada yang berbunyi.
Itu persis yang menyembunyikan Bundaran Kotabaru selama dua hari: 39 cycle,
complete = 0, cut seq 38 berisi 935.132 bppiut / 95.969 bphut.

Unit yang BELUM mengirim cut sengaja TIDAK dituntut punya job — menuntutnya
membuat gerbang ini menyala untuk unit yang agent-nya memang belum ditukar.

PERBAIKANNYA (owner) — satu job per unit, di-stagger di dalam jendela build
02:00-05:00 WIB (build memegang lease global-1, jadi ia tidak boleh tumpang
tindih):

  gcloud scheduler jobs create http solamax-snapshot-unit-<N> \\
    --project=solamax --location=asia-southeast2 \\
    --schedule='<MM> <HH> * * *' --time-zone=Asia/Pontianak \\
    --uri="<URL>/snapshot-worker" --http-method=POST \\
    --headers="Content-Type=application/json,x-snapshot-secret=<dari Secret Manager>" \\
    --message-body='{"unit_id":<N>}' \\
    --attempt-deadline=1200s --max-retry-attempts=0
MSG
  gagal=1
fi

# ── Sisi PEMENSIUNAN ───────────────────────────────────────────────────────
tanpa_retire=""
for unit in ${UNIT_BERCUT//,/ }; do
  case ",${RETIRE_UNITS}," in
    *",${unit},"*) ;;
    *) tanpa_retire="${tanpa_retire:+$tanpa_retire,}${unit}" ;;
  esac
done

if [ "$RETIRE_ITERASI" = "true" ]; then
  echo "Pemensiunan: satu job mengiterasi seluruh unit aktif — cakupan otomatis,"
  echo "termasuk unit yang di-onboard nanti. OK."
elif [ -n "$tanpa_retire" ]; then
  cat >&2 <<MSG
DITOLAK: unit ${tanpa_retire} mengirim source cut tetapi tidak punya job
PEMENSIUNAN, dan tidak ada job yang mengiterasi seluruh unit.

Unit tanpa pemensiunan menumpuk cut staging tanpa batas — unit 4 mencapai
30,3 juta baris sebelum ketahuan.

PERBAIKANNYA (owner) — SATU job tanpa unit_id mencakup seluruh unit aktif,
termasuk yang di-onboard nanti, dan menghapus job per-unit yang harus dirawat:

  gcloud scheduler jobs update http solamax-snapshot-retire-unit-1 \\
    --project=solamax --location=asia-southeast2 \\
    --message-body='{}' --format='value(name)'
MSG
  gagal=1
else
  echo "Pemensiunan: ${RETIRE_N} job per-unit menutupi ${BERCUT_N} unit ber-cut. OK,"
  echo "tetapi satu job yang mengiterasi menghapus ketergantungan pada ingatan"
  echo "saat unit berikutnya di-onboard — dan job-job yang harus dirawat."
fi

[ "$gagal" -eq 0 ] || exit 1
echo "Cakupan unit: ${BERCUT_N} unit ber-cut, build ${BUILD_N} job, pemensiunan OK."
