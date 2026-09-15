#!/usr/bin/env bash
# Gerbang: job Cloud Scheduler yang memanggil endpoint snapshot harus BENAR
# BENTUKNYA, dan job SEMENTARA tidak boleh jadi permanen.
#
# ⚠️ DUA KEJADIAN NYATA YANG MELAHIRKAN BERKAS INI.
#
# 1 · MALAM YANG HILANG (14-09-2026 02:05 WIB). Sesudah rotasi secret, job
#     `solamax-snapshot-unit-1` diperbarui dengan `--update-headers` untuk
#     memasang `x-snapshot-secret`. `--update-headers` **MENGGANTI SELURUH SET
#     HEADER, bukan menambah** — jadi `Content-Type` kembali ke default
#     `application/octet-stream`, NestJS berhenti mem-parse body, `unit_id`
#     tidak terbaca, dan permintaannya ditolak 404 dalam 3 ms. Build malam itu
#     tidak pernah berjalan, dan karena pemeriksaan secret berada di DEPAN
#     segalanya, pemensiunan pun tidak berjalan. Perbaikan berikutnya memasang
#     `Content-Type` saja — dan menghapus `x-snapshot-secret`. Dua arah,
#     keduanya terbukti di job produksi hari itu.
#
#     Yang membuatnya mahal bukan kesalahannya, melainkan bahwa ia SENYAP:
#     `rejectWithoutOracle()` sengaja membuat secret salah tak terbedakan dari
#     unit tak dikenal — desain keamanan yang benar — sehingga header rusak
#     terlihat persis seperti unit yang tidak ada, dan tidak ada yang berbunyi.
#
# 2 · JOB SEMENTARA. Untuk mengejar tenggat kapasitas 14-09, pemensiunan per
#     jam dijadwalkan ke `/snapshot-worker` (endpoint BUILD) karena
#     `/snapshot-worker/retire` belum ter-deploy. Endpoint build memulangkan
#     425 di luar jendela build ⇒ job itu tampil MERAH ~20x sehari. Menandainya
#     "SEMENTARA" di deskripsi tidak mencabut apa pun; hal sementara adalah hal
#     yang paling sering menjadi permanen.
#
# Logikanya murni dari masukan supaya CI DAN self-test memanggil kode yang SAMA,
# dan supaya self-test tidak menyentuh GCP.
#
# MASUKAN (env):
#   JOB_NAME          nama job (untuk pesan)
#   JOB_URI           uri httpTarget; KOSONG = job tidak ada
#   JOB_CONTENT_TYPE  nilai header Content-Type ("" bila tak ada)
#   JOB_HEADER_KEYS   daftar kunci header, dipisah koma
#   JOB_BODY_UNIT     unit_id yang DIPATOK body ("" = tak mematok, "?" = tak terbaca)
#   JOB_ROLE          "retire" untuk job pemensiunan, selain itu job build
#   ENDPOINT_ADA      "true" bila /snapshot-worker/retire ada di sumber ter-deploy
#   ALL_UNITS_ADA     "true" bila revisi ter-deploy mendukung /retire TANPA unit_id
set -euo pipefail

JOB_NAME="${JOB_NAME:-<job>}"
JOB_URI="${JOB_URI:-}"
JOB_CONTENT_TYPE="${JOB_CONTENT_TYPE:-}"
JOB_HEADER_KEYS="${JOB_HEADER_KEYS:-}"
JOB_BODY_UNIT="${JOB_BODY_UNIT:-}"
JOB_ROLE="${JOB_ROLE:-build}"
ENDPOINT_ADA="${ENDPOINT_ADA:-false}"
ALL_UNITS_ADA="${ALL_UNITS_ADA:-false}"

perbaikan_header() {
  cat >&2 <<MSG

PERBAIKANNYA (owner) — sebut SELURUH header sekaligus. \'--update-headers\'
MENGGANTI set header, jadi menyebut satu saja menghapus sisanya:

  gcloud scheduler jobs update http ${JOB_NAME} \\
    --project=solamax --location=asia-southeast2 \\
    --update-headers="Content-Type=application/json,x-snapshot-secret=\$(gcloud secrets versions access latest \\
        --secret=solamax-warm-board-secret --project=solamax)"

Lalu VERIFIKASI — jangan percaya bahwa yang lain terpelihara:

  gcloud scheduler jobs describe ${JOB_NAME} --project=solamax \\
    --location=asia-southeast2 --format=json \\
  | python3 -c 'import json,sys;h=(json.load(sys.stdin).get("httpTarget") or {}).get("headers") or {};print("Content-Type=",h.get("Content-Type"));print("kunci=",",".join(sorted(h)))'

⚠️ Jangan pernah memakai --format yang menyebut httpTarget.headers secara utuh:
ia mencetak NILAI header, termasuk secret.
MSG
}

if [ -z "$JOB_URI" ]; then
  echo "Job '${JOB_NAME}' tidak ada — tidak ada yang diperiksa. OK."
  exit 0
fi

# ── 1 · Bentuk header. Diperiksa LEBIH DULU: header rusak menolak permintaan
#        di pintu, apa pun uri-nya, dan menolaknya TANPA alarm.
if [ "$JOB_CONTENT_TYPE" != "application/json" ]; then
  echo "DITOLAK: '${JOB_NAME}' punya Content-Type '${JOB_CONTENT_TYPE:-<tidak ada>}'," >&2
  echo "bukan application/json. Body tidak akan di-parse dan permintaannya" >&2
  echo "ditolak 404 — terlihat persis seperti unit tak dikenal. Itu yang" >&2
  echo "menghabiskan build 02:05 WIB 14-09-2026." >&2
  perbaikan_header
  exit 1
fi

case ",${JOB_HEADER_KEYS}," in
  *,x-snapshot-secret,*) ;;
  *)
    echo "DITOLAK: '${JOB_NAME}' tidak memuat header x-snapshot-secret." >&2
    echo "Kunci yang ada: ${JOB_HEADER_KEYS:-<kosong>}" >&2
    perbaikan_header
    exit 1
    ;;
esac

# ── 2 · Job sementara tidak boleh tertinggal sesudah /retire ter-deploy.
# Perbandingan pada PATH, bukan host: Cloud Run punya beberapa bentuk URL yang
# sama-sama sah, dan gerbang yang membandingkan host akan merah pada job yang
# SUDAH benar.
case "$JOB_URI" in
  */snapshot-worker/retire)
    # ⚠️ Job pemensiunan TIDAK BOLEH mematok satu unit. Pemensiunan bersifat
    # per-unit; penjadwal yang hanya mencakup unit 1 membuat unit 4 menumpuk
    # 32 cut staging = 30,3 juta baris, berbulan-bulan, tanpa berbunyi.
    # Endpoint `/retire` tanpa `unit_id` mengiterasi SELURUH unit aktif,
    # sehingga unit baru tercakup tanpa siapa pun perlu mengingatnya.
    # ⚠️ URUTAN MENGIKAT. Body dituntut kosong HANYA bila revisi ter-deploy
    # benar-benar menerima /retire tanpa unit_id. Mengosongkannya lebih dulu
    # membuat permintaannya ditolak 404 dan pemensiunan per jam BERHENTI SAMA
    # SEKALI — lebih buruk daripada cakupan yang kurang.
    if [ "$JOB_ROLE" = "retire" ] && [ "$ALL_UNITS_ADA" = "true" ] && [ -n "$JOB_BODY_UNIT" ]; then
      cat >&2 <<MSG
DITOLAK: '${JOB_NAME}' memanggil /snapshot-worker/retire tetapi MEMATOK
unit_id=${JOB_BODY_UNIT} di body-nya.

CATATAN: revisi baru SUDAH ter-deploy dan SEDANG melayani — langkah ini berjalan
sesudah deploy. Yang tersisa satu perintah; deploy berikutnya hijau sesudahnya.

Pemensiunan bersifat per-unit. Job yang mematok satu unit meninggalkan unit
lain tanpa pemensiunan sama sekali — akar insiden kapasitas 14-09-2026, ketika
unit 4 menumpuk 32 cut staging (30,3 juta baris) sementara setiap pengukuran
yang di-scope ke unit 1 tampak bersih.

PERBAIKANNYA (owner) — body kosong berarti SELURUH unit aktif:

  gcloud scheduler jobs update http ${JOB_NAME} \\
    --project=solamax --location=asia-southeast2 \\
    --message-body='{}' --format='value(name)'
MSG
      exit 1
    fi
    echo "Job '${JOB_NAME}': header benar, menunjuk /snapshot-worker/retire,"
    echo "tidak mematok unit. OK."
    exit 0
    ;;
  */snapshot-worker)
    # Job BUILD memang menunjuk /snapshot-worker selamanya — aturan
    # job-sementara di bawah hanya berlaku untuk job PEMENSIUNAN. Ketahuan saat
    # gerbang ini dijalankan terhadap job produksi nyata: tanpa syarat ini ia
    # menjatuhkan solamax-snapshot-unit-1, yang sama sekali tidak keliru.
    if [ "$JOB_ROLE" != "retire" ]; then
      echo "Job '${JOB_NAME}': header benar, job build menunjuk /snapshot-worker. OK."
      exit 0
    fi
    if [ "$ENDPOINT_ADA" != "true" ]; then
      echo "Job '${JOB_NAME}': header benar. Endpoint /retire belum ada di revisi"
      echo "ini, jadi menunjuk endpoint build masih SAH. OK."
      exit 0
    fi
    cat >&2 <<MSG
DITOLAK: '${JOB_NAME}' masih menunjuk endpoint BUILD, padahal revisi ini sudah
membawa /snapshot-worker/retire.

Job itu dibuat SEMENTARA untuk mengejar tenggat kapasitas 14-09-2026. Ia
memulangkan 425 sekitar 20 kali sehari dan tampil merah permanen. Selama itu
dibiarkan, konsol penuh kegagalan yang "memang begitu" — dan kegagalan yang
sesungguhnya berhenti terlihat.

PERBAIKANNYA (owner) — hanya uri dan deskripsi:

  URL="\$(gcloud run services describe solamax-ingest-staging \\
        --project=solamax --region=asia-southeast2 --format='value(status.url)')"
  gcloud scheduler jobs update http ${JOB_NAME} \\
    --project=solamax --location=asia-southeast2 \\
    --uri="\$URL/snapshot-worker/retire" \\
    --description='Pemensiunan source cut per jam' \\
    --format='value(name)'

✅ TERBUKTI 14-09-2026: '--uri' MEMPERTAHANKAN header. Job ini benar-benar
diarahkan ke /retire di produksi dan Content-Type serta x-snapshot-secret tetap
utuh sesudahnya. Dulu ini ditulis sebagai asumsi; kini ia pengamatan. Yang
MENGGANTI set header adalah '--update-headers', bukan '--uri'.

Bila job itu memang tak diperlukan lagi:
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
