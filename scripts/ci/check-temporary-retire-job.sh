#!/usr/bin/env bash
# Gerbang: JOB SEMENTARA TIDAK BOLEH JADI PERMANEN.
#
# ⚠️ KENAPA BERKAS INI ADA.
# Untuk mengejar tenggat kapasitas 14-09-2026, pemensiunan per jam dijadwalkan
# ke `/snapshot-worker` — endpoint BUILD — karena endpoint `/snapshot-worker/
# retire` belum ter-deploy (promosi ke `main` beku). Endpoint build memulangkan
# **425 di luar jendela build**, jadi job itu tampil MERAH ~20 kali sehari di
# console.
#
# Itu persis antipola yang dipakai untuk MENOLAK rancangan sebelumnya: job yang
# selalu merah berhenti dibaca, dan ketidakmampuan membedakan "wajar" dari
# "gawat" adalah kelas kegagalan yang menyembunyikan insiden 12-14 Sep
# berhari-hari. Menandainya "SEMENTARA" di deskripsi job TIDAK menutup apa pun:
# label tidak mencabut apa pun, dan hal sementara adalah hal yang paling sering
# menjadi permanen.
#
# Maka pemicunya dibuat MEKANIS: begitu `/snapshot-worker/retire` benar-benar
# ada di revisi yang baru di-deploy ke tier pilot, deploy itu GAGAL selama job
# masih menunjuk endpoint build. Gerbang ini tidak menghapus job apa pun — ia
# menolak diam. Perintah perbaikannya dicetak di pesan gagalnya.
#
# Logikanya dipisah dari YAML supaya CI DAN self-test memanggil kode yang SAMA
# (pola yang sama dengan check-arsip-g4.sh). Self-test tidak menyentuh GCP.
#
# MASUKAN (env):
#   JOB_URI       uri httpTarget job saat ini; KOSONG = job tidak ada
#   ENDPOINT_ADA  "true" bila /snapshot-worker/retire ada di sumber ter-deploy
#   JOB_NAME      nama job (kosmetik, untuk pesan)
set -euo pipefail

JOB_NAME="${JOB_NAME:-solamax-snapshot-retire-unit-1}"
JOB_URI="${JOB_URI:-}"
ENDPOINT_ADA="${ENDPOINT_ADA:-false}"

if [ -z "$JOB_URI" ]; then
  echo "Job '${JOB_NAME}' tidak ada — tidak ada yang sementara. OK."
  exit 0
fi

if [ "$ENDPOINT_ADA" != "true" ]; then
  echo "Endpoint /snapshot-worker/retire belum ada di revisi ini."
  echo "Job '${JOB_NAME}' yang menunjuk endpoint build masih SAH — itu satu-satunya"
  echo "cara memensiunkan per jam sebelum endpoint khususnya ter-deploy. OK."
  exit 0
fi

# Perbandingan pada PATH, bukan host: URL Cloud Run punya beberapa bentuk
# (…-wn6i64kvza-et.a.run.app dan …-<nomor-proyek>.<region>.run.app) dan
# keduanya sah. Yang menentukan adalah endpoint mana yang dipanggil.
case "$JOB_URI" in
  */snapshot-worker/retire)
    echo "Job '${JOB_NAME}' sudah menunjuk /snapshot-worker/retire. OK."
    exit 0
    ;;
  */snapshot-worker)
    cat >&2 <<MSG
DITOLAK: '${JOB_NAME}' masih menunjuk endpoint BUILD, padahal revisi ini sudah
membawa /snapshot-worker/retire.

Job itu dibuat SEMENTARA untuk mengejar tenggat kapasitas 14-09-2026. Ia
memulangkan 425 sekitar 20 kali sehari dan tampil merah permanen. Selama itu
dibiarkan, konsol penuh kegagalan yang "memang begitu" — dan kegagalan yang
sesungguhnya berhenti terlihat.

PERBAIKANNYA (owner) — arahkan ke endpoint yang memulangkan 200:

  URL="\$(gcloud run services describe solamax-ingest-staging \\
        --project=solamax --region=asia-southeast2 --format='value(status.url)')"
  gcloud scheduler jobs update http ${JOB_NAME} \\
    --project=solamax --location=asia-southeast2 \\
    --uri="\$URL/snapshot-worker/retire" \\
    --description='Pemensiunan source cut per jam' \\
    --format='value(name)'

Header dan jadwalnya dipertahankan; hanya uri dan deskripsi yang berubah.
Bila job itu memang sudah tidak diperlukan, hapus:

  gcloud scheduler jobs delete ${JOB_NAME} --project=solamax --location=asia-southeast2
MSG
    exit 1
    ;;
  *)
    echo "DITOLAK: uri job '${JOB_NAME}' tidak dikenali: ${JOB_URI}" >&2
    echo "Gerbang ini tidak boleh LULUS atas bentuk yang tidak dipahaminya." >&2
    exit 1
    ;;
esac
