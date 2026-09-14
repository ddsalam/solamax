# Piutang Fase 2 — backfill dan aktivasi pemicu

Dokumen perintah untuk Dion. Tidak ada job, grant, secret, migrasi manual, atau deployment yang dijalankan oleh worker pembuat PR.

## Arti tanggal dan cut

Backfill tidak membutuhkan salinan source cut pada setiap tanggal lama. Predikat tanggal target `$2` dalam `MATERIALIZE_FULL_HISTORY_SQL` membatasi posting `< D` dan `<= D`, sementara `$4` memilih cut. Source cut 13 September dapat menghitung posisi 10 September dengan koreksi bertanggal mundur yang sudah tercatat pada waktu cut. Itu bukan arsip laporan EasyMax yang dicetak pada 10 September. Catatan yang sama ada pada layar daftar/detail dan CSV/PDF.

Baseline akhir bulan dipilih dari pointer yang cocok formula dan cut. Bukti read-only 13 September menunjukkan pointer 31 Agustus **ada**, generation 31f2f0cf-d5c3-4920-9496-1db61215d03c, direferensikan generasi 13 September. Klaim sebelumnya “complete tanpa pointer” muncul karena audit hanya mengambil pointer September. Jangan membuat baseline lewat SQL manual.

## Anggaran sebelum kanari

Pengukuran produksi read-only: database 7.595.179.031B, headroom 1.404.820.969B terhadap gerbang 9.000.000.000B. `pg_total_relation_size` snapshot row 933.888B untuk 5.946row / 2 generasi → 466.944B per tanggal IB. Ini meliputi heap, TOAST, dan index; bukan ukuran JSON.

| Cakupan tambahan | Proyeksi v1 | Cadangan 2× ekspansi kolom ×2 coexistence |
|---|---:|---:|
| 7 tanggal × 1 unit | 3.268.608B | 13.074.432B |
| 31 tanggal × 7 unit | 101.326.848B | 405.307.392B |

Tambahkan baseline lintas bulan: worst case dua baseline baru per unit pada rentang 31 hari adalah 14×466.944×4=26.148.864B, sehingga cadangan snapshot historis+baseline 431.456.256B. Hari ini tambahan paling banyak 7×466.944×4=13.074.432B jika belum ada; total 444.530.688B. Ini proyeksi dengan asumsi setiap unit sebesar IB dan faktor cadangan, bukan hasil ukuran produksi v2.

Cadangan dua generasi bersamaan adalah anggaran putaran awal, bukan batas pertumbuhan jangka panjang. Generasi snapshot lama tidak dihapus otomatis oleh collector source. Koreksi berulang dapat menambah generasi; ukur pertumbuhan harian dan jumlah generasi per tanggal selama kanari serta sebelum memperluas unit. Retensi snapshot memerlukan kebijakan terpisah, bukan DELETE manual pada tugas ini.

Ukuran source cut 5.566.316.544B mendominasi. Proyeksi snapshot di atas **tidak mencakup source cut baru enam unit**. Ukur cut yang tersedia dan kapasitas total sebelum mengaktifkan tiap unit; kode siap bukan bukti data/capacity unit itu siap. Collector tetap berjalan sebelum capacity gate, termasuk bila database sudah melewati 9 GB. Jangan menaikkan threshold untuk meloloskan kanari.

PostgreSQL 14 CI C run 34745716685 mengukur fixture yang sama: 10 row, payload v1 757 B → v2 1.201 B (1,5865×); `pg_total_relation_size` keduanya 32.768 B karena masih dalam alokasi halaman awal. Sesudah 20 row v2, relasi juga 32.768 B. Nilai relasi mencakup dead tuple sebelum vacuum. Faktor cadangan kolom 2× di atas lebih besar dari pertumbuhan payload fixture, tetapi tidak membuktikan ukuran fisik produksi v2. Bentuk fixture bukan estimasi ukuran tujuh unit; gunakan sebagai bukti ekspansi kolom dan ukur ulang produksi read-only setelah deployment melalui jalur yang diotorisasi.

## Pemeriksaan read-only

Jalankan melalui koneksi yang telah disetujui; jangan mengubah grant ketika query gagal.

```sql
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL app.unit_ids = '1,2,3,4,5,6,7';
SELECT unit_id, code, name, active FROM public.unit WHERE unit_id BETWEEN 1 AND 7 ORDER BY unit_id;
SELECT current_setting('app.unit_ids'), current_setting('transaction_read_only');
SELECT pg_database_size(current_database()) AS database_bytes,
       pg_total_relation_size('app.saldo_pelanggan_snapshot_row') AS snapshot_row_bytes;
SELECT unit_id,as_of_date,generation_id,formula_version,status,row_count,source_completed_at
FROM app.saldo_pelanggan_snapshot_manifest WHERE status='complete' ORDER BY unit_id,as_of_date;
SELECT unit_id,state,count(*) FROM app.saldo_pelanggan_build_work GROUP BY unit_id,state ORDER BY unit_id,state;
ROLLBACK;
```

Kontrol unit harus sesuai cakupan yang diminta sebelum menafsirkan hasil kosong. Periksa pointer/manifest untuk setiap tanggal kanari, bukan hanya respons HTTP. H1′ sudah lulus melalui rekonsiliasi selaras waktu; laporan 31 Agustus tetap menjadi titik uji kedua dan bukan pemblokir backfill.

## Daftar periksa tepat sebelum deploy C

Jalankan pemeriksaan ini lagi tepat sebelum merge/deploy C. Bukti 13 September pukul 16:14 WIB lulus, tetapi keadaan builder dan work dapat berubah. Waktu aman operasional adalah **05:15–01:30 WIB**; jangan deploy pada 02:00–05:00 WIB dan sisakan buffer sebelum cron unit 1 mulai 02:05.

- Jam WIB berada di dalam jendela aman 05:15–01:30.
- Scope read-only mencakup setiap unit yang sudah mempunyai snapshot/work; jangan menafsirkan nol dari koneksi RLS yang hanya membuka unit 1 sebagai nol global.
- Nol manifest `building`.
- Nol work `leased`.
- Semua manifest masih memakai `saldo-pelanggan-v1`.
- Manifest 31-08 dan 13-09 masih menunjuk cut lengkap: status cycle `complete`, waktu source sama, tiga checksum ada, dan declared row count sama dengan count aktual pelanggan/bppiut/bphut.
- Tidak ada lock penulis aktif pada empat tabel source cut. Capture sumber berjalan sepanjang hari, sehingga jam aman saja tidak membuktikan quiescence.
- Bila salah satu butir gagal, jangan merge/deploy C. Jangan mengubah grant, membersihkan cut, atau menjalankan migrasi manual untuk meloloskan pemeriksaan.

SQL predikat manifest unit 1 tersimpan di `evidence/2026-09-13-piutang-fase2-pramerge/02-migration-0039-gate.sql`. Unit 1 adalah satu-satunya unit rollout snapshot saat bukti itu diambil. Migrasi memindai seluruh `public.unit`; bila unit lain sudah mempunyai snapshot/work sebelum deploy, perluas `app.unit_ids` dan hilangkan filter unit 1 agar semua unit tercakup. Gunakan kembali melalui koneksi produksi read-only; hasil lulus lama bukan pengganti pemeriksaan saat deploy.

Periksa quiescence collector segera sebelum deploy tanpa menunggu lock. Nol row adalah hasil yang diharapkan:

```sql
SELECT c.relname, l.mode, count(*) AS lock_count
FROM pg_locks l
JOIN pg_class c ON c.oid = l.relation
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'app'
  AND c.relname IN (
    'saldo_pelanggan_source_cycle', 'saldo_pelanggan_source_pelanggan',
    'saldo_pelanggan_source_bppiut', 'saldo_pelanggan_source_bphut'
  )
  AND l.pid <> pg_backend_pid()
  AND l.granted
  AND l.mode IN ('RowExclusiveLock', 'ShareRowExclusiveLock',
                 'ExclusiveLock', 'AccessExclusiveLock')
GROUP BY c.relname, l.mode
ORDER BY c.relname, l.mode;
```

Masih ada sela balapan setelah pemeriksaan ini. Bila `0039` terkena `lock_timeout`, anggap deploy batal dengan aman, tunggu capture selesai, ulangi gerbang, lalu jalankan ulang melalui pipeline. Jangan menjalankan SQL migrasi manual.

## Perintah Scheduler yang diserahkan ke Dion

Gunakan kanari 7 hari terlebih dahulu. Siapkan perubahan pada jendela aman **05:15–01:30 WIB** agar job baru pertama kali berjalan pada jendela terjadwal berikutnya; jangan memakai `gcloud scheduler jobs run`. Satu request bekerja pada satu unit; beberapa item dijalankan berurutan dengan lease global 1, deadline 18 menit, batas lease 04:45 dan publikasi sebelum 05:00 WIB. Payload batas 31 hari baru setelah kanari diterima. Retry Scheduler tetap 0; retry durable ada di database.

> ⚠️ **KOREKSI 14-09-2026 — baca sebelum menjalankan blok mana pun di bawah.**
> Klaim "mempertahankan header yang sudah ada" **tidak berlaku** bila
> `--update-headers` dipakai: bendera itu **MENGGANTI seluruh set header**.
> Terbukti dua arah di job produksi hari itu — memasang `x-snapshot-secret`
> saja mengembalikan `Content-Type` ke `application/octet-stream`, body
> berhenti di-parse, dan permintaannya ditolak 404 dalam 3 ms; build 02:05 WIB
> hilang tanpa alarm. Blok di bawah memakai `--message-body`/`--uri` dan
> karenanya *seharusnya* selamat, tetapi itu **belum diuji**: verifikasi
> sesudah setiap `jobs update http` dengan
> `--format=json | python3 scripts/ci/scheduler-job-facts.py`.
> Gerbang otomatisnya: `scripts/ci/check-snapshot-scheduler-jobs.sh`.

Pembaruan unit 1 berikut adalah tahap kanari pertama. Ia mempertahankan header yang sudah ada dan tidak memerlukan nilai secret di shell. Output mutasi dibatasi `value(name)` agar respons resource tidak mencetak header.

```bash
set -euo pipefail
PROJECT_ID=solamax
REGION=asia-southeast2
SERVICE=solamax-ingest-staging
URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)')"
test -n "$URL"

# Unit 1 sudah memiliki job; pembaruan body mempertahankan header yang ada.
gcloud scheduler jobs update http solamax-snapshot-unit-1 \
  --project="$PROJECT_ID" --location="$REGION" \
  --schedule='5 2 * * *' --time-zone=Asia/Pontianak \
  --uri="$URL/snapshot-worker" --http-method=POST \
  --message-body='{"unit_id":1,"backfill_days":7,"max_items":8}' \
  --attempt-deadline=1200s --max-retry-attempts=0 --format='value(name)'
```

Enam job berikut adalah tahap terpisah, hanya sesudah Dion menerima kanari unit 1 dan menyetujui kapasitas serta cut setiap unit. `SNAPSHOT_SECRET` harus disiapkan lewat prosedur tepercaya yang sudah ada pada runbook pemicu 12 September. Blok ini tidak mengambil, mencetak, merotasi, atau mengubah binding secret. Jangan menjalankan dengan shell tracing.

```bash
set -euo pipefail
PROJECT_ID=solamax
REGION=asia-southeast2
SERVICE=solamax-ingest-staging
URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)')"
test -n "$URL"
test -n "${SNAPSHOT_SECRET:?siapkan lewat prosedur tepercaya yang sudah ada}"
while IFS='|' read -r UNIT_ID UNIT_NAME SCHEDULE; do
  gcloud scheduler jobs create http "solamax-snapshot-unit-${UNIT_ID}" \
    --project="$PROJECT_ID" --location="$REGION" \
    --description="Snapshot saldo pelanggan ${UNIT_NAME}; backfill terbatas" \
    --schedule="$SCHEDULE" --time-zone=Asia/Pontianak \
    --uri="$URL/snapshot-worker" --http-method=POST \
    --headers="Content-Type=application/json,x-snapshot-secret=${SNAPSHOT_SECRET}" \
    --message-body="{\"unit_id\":${UNIT_ID},\"backfill_days\":7,\"max_items\":8}" \
    --attempt-deadline=1200s --max-retry-attempts=0 --format='value(name)'
done <<'JOBS'
2|Bakau|25 2 * * *
3|Adisucipto|45 2 * * *
4|Bundaran Kotabaru|5 3 * * *
5|Batu Layang|25 3 * * *
6|Korek|45 3 * * *
7|28 Oktober|5 4 * * *
JOBS
unset SNAPSHOT_SECRET
```

Untuk tier TEST, gunakan service `solamax-ingest-rlsstg` dan nama job terpisah yang disetujui operator; jangan arahkan job pilot ke TEST tanpa keputusan. Setelah kanari diterima, update body job yang dipilih dengan `backfill_days:31`, tetap `max_items:8`; jadwal dan jendela tidak dilebarkan. Jangan mencetak `jobs describe` mentah karena nilai header tersimpan di resource.


Sesudah Dion menerima hasil kanari, perintah berikut menaikkan rentang IB menjadi 31 hari sebelumnya. Default kode tetap 7 agar request lama tidak mendadak menyemai 31 hari. Nilai 0 tidak menambah rentang historis baru; work yang sudah antre dan pointer stale tetap dapat diproses. Batas kerasnya 31 hari dan delapan item per request.

```bash
gcloud scheduler jobs update http solamax-snapshot-unit-1 \
  --project=solamax --location=asia-southeast2 \
  --message-body='{"unit_id":1,"backfill_days":31,"max_items":8}' --format='value(name)'
```

Untuk unit 2–7, jalankan hanya sesudah job masing-masing sudah dibuat dan kanarinya diterima:

```bash
for UNIT_ID in 2 3 4 5 6 7; do
  gcloud scheduler jobs update http "solamax-snapshot-unit-${UNIT_ID}" \
    --project=solamax --location=asia-southeast2 \
    --message-body="{\"unit_id\":${UNIT_ID},\"backfill_days\":31,\"max_items\":8}" --format='value(name)'
done
```

Verifikasi metadata yang aman dibaca, tanpa header/body secret:

```bash
gcloud scheduler jobs list --project=solamax --location=asia-southeast2 \
  --filter='name:solamax-snapshot-unit-' \
  --format='table(name,state,schedule,timeZone,attemptDeadline,httpTarget.uri)'
```

## Urutan rollback kanari

Rollback Scheduler menghentikan pemicu lebih dahulu dan tidak menghapus work, pointer, manifest, atau source cut. Jalankan hanya oleh Dion bila kanari harus dihentikan:

1. Pause job unit 1 yang pasti ada, lalu ambil daftar nama job yang tersedia dan pause job unit 7→2 yang benar-benar ada. Dengan demikian, unit 1 tetap berhenti bila sebagian job tambahan belum dibuat; lease yang sedang berjalan tetap diselesaikan atau kedaluwarsa melalui mekanisme database.
2. Periksa antrean, lease, pointer, log, dan ukuran database secara read-only. Jangan menghapus antrean atau generasi.
3. Jika unit 1 dinyatakan aman untuk berjalan terbatas, ubah body-nya ke `backfill_days:0`, `max_items:1`, lalu resume unit 1. Ini menyemai hari ini dan membatasi satu item per request, tetapi work historis `queued`/`retry_wait` yang sudah ada tetap memenuhi syarat. Biarkan unit 1 pause bila work historis belum boleh berjalan. Unit 2–7 tetap pause sampai Dion menyetujui percobaan ulang.
4. Bila migrasi `0039` sudah terpasang, jangan rollback aplikasi ke reader/writer v1. Schema v2 memerlukan perbaikan maju lewat PR. Sebelum migrasi terpasang, batalkan deployment lewat pipeline tanpa menjalankan SQL manual.
5. Selama unit 1 pause, ukur `pg_database_size(current_database())` setelah setiap source-capture cycle yang teramati. Pause tidak boleh dibiarkan tanpa pemantauan karena retirement oleh snapshot worker juga berhenti; bila proyeksi pertumbuhan mencapai gerbang 9.000.000.000 B sebelum pemeriksaan berikutnya, Dion harus memilih resume jalur retirement atau keputusan retensi terotorisasi.
6. Sesudah Dion menerima percobaan ulang, kembalikan body unit 1 ke kanari `backfill_days:7`, `max_items:8` dengan perintah kanari di atas. Verifikasi tanggal pointer yang tersisa; jangan menyimpulkan pulih hanya dari HTTP 200. Resume unit 2–7 tetap keputusan terpisah.

Perintah disiapkan berikut; tidak dijalankan dalam tugas ini:

```bash
set -euo pipefail
gcloud scheduler jobs pause solamax-snapshot-unit-1 \
  --project=solamax --location=asia-southeast2 --format='value(name)'

EXISTING_JOBS="$(gcloud scheduler jobs list \
  --project=solamax --location=asia-southeast2 \
  --filter='name:solamax-snapshot-unit-' --format='value(name)')"
for UNIT_ID in 7 6 5 4 3 2; do
  if printf '%s\n' "$EXISTING_JOBS" | grep -Eq "(^|/)solamax-snapshot-unit-${UNIT_ID}$"; then
    gcloud scheduler jobs pause "solamax-snapshot-unit-${UNIT_ID}" \
      --project=solamax --location=asia-southeast2 --format='value(name)'
  fi
done
```

Sesudah blok penghentian selesai, lakukan pemeriksaan read-only pada langkah 2. Blok berikut merupakan tindakan terpisah dan hanya dijalankan bila hasilnya menyatakan unit 1 aman untuk memproses paling banyak satu work yang memenuhi syarat per request:

```bash
set -euo pipefail
gcloud scheduler jobs update http solamax-snapshot-unit-1 \
  --project=solamax --location=asia-southeast2 \
  --message-body='{"unit_id":1,"backfill_days":0,"max_items":1}' \
  --format='value(name)'
gcloud scheduler jobs resume solamax-snapshot-unit-1 \
  --project=solamax --location=asia-southeast2 --format='value(name)'
```

Pantau `processed_count`, `completed_count`, `superseded_count`, durasi dan status log pemicu. HTTP 200 menyatakan item yang sempat dikerjakan selesai, bukan seluruh rentang sudah terisi; ukur tanggal pointer yang tersisa. Kegagalan setelah beberapa item tetap mengembalikan status gagal dengan jumlah hasil parsial. Antrean idempotent, pekerjaan dead-letter pada cut yang sama tidak dihidupkan ulang; cut baru dapat menggantikan pekerjaan lama yang belum selesai. Hari ini didahulukan, lalu tanggal historis tertua. Bila waktu request habis atau jam melewati batas lease, item berikutnya menunggu pemicu berikutnya. Jangan menghapus antrean, memalsukan pointer, atau menaikkan gerbang untuk mengejar kelengkapan.

Anggaran cadangan snapshot di atas belum memasukkan metadata manifest/work/dirty dan pertumbuhan aplikasi lain. Query ukuran berikut melengkapi pengukuran sebelum aktivasi dan sesudah kanari, di dalam transaksi read-only dengan scope serta kontrol positif di atas:

```sql
SELECT relname, pg_total_relation_size(oid) AS bytes
FROM pg_class
WHERE relnamespace = 'app'::regnamespace AND relkind = 'r'
  AND relname IN ('saldo_pelanggan_snapshot_row', 'saldo_pelanggan_snapshot_manifest',
    'saldo_pelanggan_snapshot_pointer', 'saldo_pelanggan_build_work', 'saldo_pelanggan_dirty')
ORDER BY relname;
```

Sintaks parameter disandingkan dengan dokumentasi resmi [update HTTP job](https://docs.cloud.google.com/sdk/gcloud/reference/scheduler/jobs/update/http) dan [create HTTP job](https://docs.cloud.google.com/sdk/gcloud/reference/scheduler/jobs/create/http). Perintah di dokumen ini diserahkan, tidak dieksekusi oleh pembuat PR.
