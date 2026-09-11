# Runbook pemicu snapshot saldo pelanggan

Status: **siap dijalankan Dion sesudah promosi; tidak dijalankan dalam PR ini**.

Endpoint berada pada backend, bukan dashboard:

```text
POST /snapshot-worker
x-snapshot-secret: <nilai solamax-warm-board-secret>
content-type: application/json

{"unit_id": 1}
```

Satu request hanya membawa satu `unit_id`. Secret dibandingkan constant-time.
Secret salah, secret absen, `unit_id` invalid, dan unit yang tidak aktif/tidak
ada semuanya mendapat HTTP 404 dengan respons identik. Endpoint tidak memberi
oracle untuk membedakan kegagalan autentikasi dari keberadaan unit.

## Kontrak status

| HTTP | Hasil worker | Arti operasional |
|---:|---|---|
| 200 | `done` | snapshot selesai dan respons memuat `workId` serta `generationId` |
| 204 | `idle` | tidak ada work yang dapat diambil untuk unit tersebut |
| 208 | `superseded` | work selesai tanpa publikasi karena generasi lebih baru menang |
| 409 | `busy` | unique lease global sedang dipegang; builder kedua tidak dijalankan |
| 425 | `skipped` | pagar waktu atau kapasitas menolak build |
| 503 | `retry_wait` | percobaan gagal retryable; invocation berikutnya diperlukan |
| 500 | `dead_letter` atau galat internal | kegagalan terminal atau endpoint gagal |
| 404 | penolakan generik | secret/unit tidak diterima; penyebab sengaja tidak dibedakan |

Cloud Scheduler memperlakukan 409/425/500/503 sebagai percobaan gagal yang
terlihat di riwayat job. Log backend mencatat `unit_id`, status, durasi, dan ID
work/generasi bila tersedia, tanpa mencatat secret.

## Batas waktu yang dipasang bersama kode

Pipeline backend mengikat `SNAPSHOT_TRIGGER_SECRET` ke Secret Manager
`solamax-warm-board-secret:latest` dan memasang timeout request Cloud Run 20
menit pada kedua service berikut:

- testing: `solamax-ingest-rlsstg`, terhubung ke instance lengkap
  `solamax:asia-southeast2:solamax-pg-rlsstg`;
- pilot LIVE: `solamax-ingest-staging`, terhubung ke instance lengkap
  `solamax:asia-southeast2:solamax-pg`.

Endpoint memberi worker deadline absolut 18 menit. Builder tetap mempunyai
batas attempt 15 menit; deadline endpoint hanya memperpendek sisa waktu bila
finalisasi source cut memakai sebagian anggaran. Dua menit terakhir disisakan
agar kegagalan dapat disimpan dan respons HTTP dapat keluar sebelum gateway
Cloud Run memutus request.

## Gerbang sebelum kanari

Jangan jalankan bagian ini sebelum perubahan endpoint sudah dipromosikan melalui
pipeline normal ke `main`, job `pilot` disetujui Dion, dan revisi baru benar-benar
menyajikan 100% traffic pada `solamax-ingest-staging`.

Pemeriksaan berikut hanya membaca konfigurasi control plane; ia tidak membaca
nilai secret. Konfigurasi timeout dan secret dibaca dari revisi yang benar-benar
menyajikan traffic, bukan hanya template service untuk revisi berikutnya:

```bash
set -euo pipefail

PROJECT_ID=solamax
REGION=asia-southeast2
SERVICE=solamax-ingest-staging

read -r LATEST READY SERVING PERCENT <<<"$(
  gcloud run services describe "$SERVICE" \
    --project="$PROJECT_ID" --region="$REGION" \
    --format='value(status.latestCreatedRevisionName,status.latestReadyRevisionName,status.traffic[0].revisionName,status.traffic[0].percent)'
)"
test -n "$LATEST" && test -n "$READY" && test -n "$SERVING"
test "$LATEST" = "$READY"
test "$READY" = "$SERVING"
test "$PERCENT" = 100

gcloud run revisions describe "$SERVING" \
  --project="$PROJECT_ID" --region="$REGION" --format=json \
  | jq -e '
      (.spec.timeoutSeconds == 1200) and
      any(.spec.containers[0].env[]?;
        .name == "SNAPSHOT_TRIGGER_SECRET" and
        ((.valueFrom.secretKeyRef.name // .valueFrom.secretKeyRef.secret) ==
          "solamax-warm-board-secret"))
    '
```

Berhenti bila hasilnya bukan `true`. Jangan menjalankan kanari pada revisi lama,
traffic terbelah, timeout 300 detik, atau binding secret yang berbeda.

## Kanari satu kali: Imam Bonjol saja

Perintah ini mengambil secret dari Secret Manager ke variabel shell. Nilainya
tidak ditulis di runbook, tidak dicetak, dan tidak diletakkan pada argumen proses
`curl`; header dibaca `curl` dari file sementara berizin 600.

```bash
set -euo pipefail

PROJECT_ID=solamax
REGION=asia-southeast2
SERVICE=solamax-ingest-staging
UNIT_ID=1
UNIT_CODE=6478111
INSTANCE=solamax:asia-southeast2:solamax-pg

URL="$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" --region="$REGION" \
  --format='value(status.url)')"
test -n "$URL"

HEADER_FILE="$(mktemp)"
BODY_FILE="$(mktemp)"
chmod 600 "$HEADER_FILE" "$BODY_FILE"
cleanup() {
  rm -f "$HEADER_FILE" "$BODY_FILE"
  unset SNAPSHOT_SECRET
}
trap cleanup EXIT

SNAPSHOT_SECRET="$(gcloud secrets versions access latest \
  --secret=solamax-warm-board-secret --project="$PROJECT_ID")"
test -n "$SNAPSHOT_SECRET"
printf 'x-snapshot-secret: %s\n' "$SNAPSHOT_SECRET" >"$HEADER_FILE"

HTTP_STATUS="$(curl --silent --show-error \
  --request POST \
  --max-time 1140 \
  --header @"$HEADER_FILE" \
  --header 'content-type: application/json' \
  --data "{\"unit_id\":${UNIT_ID}}" \
  --output "$BODY_FILE" \
  --write-out '%{http_code}' \
  "$URL/snapshot-worker")"
unset SNAPSHOT_SECRET

printf 'HTTP %s\n' "$HTTP_STATUS"
test "$HTTP_STATUS" = 200
jq -e '
  .status == "done" and
  (.workId | type == "string" and length > 0) and
  (.generationId | type == "string" and length > 0)
' "$BODY_FILE"

WORK_ID="$(jq -r .workId "$BODY_FILE")"
GENERATION_ID="$(jq -r .generationId "$BODY_FILE")"
printf 'workId=%s\ngenerationId=%s\n' "$WORK_ID" "$GENERATION_ID"
```

Hanya HTTP 200 dengan JSON `done`, `workId`, dan `generationId` yang lulus.
HTTP 204/208 bukan keberhasilan kanari. HTTP 409/425/500/503 menghentikan
langkah ini dan harus dibaca bersama log `solamax-ingest-staging`; jangan picu
unit lain.

## Bukti database setelah `done`

Gunakan kanal read-only yang sudah disetujui Dion. Jangan memakai atau meminta
`DATABASE_URL` role `ingest`. Sebelum percaya hasilnya, verifikasi target adalah
instance lengkap `solamax:asia-southeast2:solamax-pg`, transaksi read-only,
scope `1`, dan unit `1` benar-benar Imam Bonjol (`6478111`).

Jalankan query berikut dengan `GENERATION_ID` dari respons endpoint:

```sql
BEGIN READ ONLY;
SELECT set_config('app.unit_ids', '1', true);

SELECT current_setting('app.unit_ids', true) AS scope;
SELECT unit_id, code, name
FROM public.unit
WHERE unit_id = 1 AND code = '6478111';

SELECT unit_id, as_of_date, generation_id, status, published,
       validation_passed, row_count, customer_key_count,
       awal_piutang_lokal_total, akhir_piutang_lokal_total,
       awal_piutang_online_total, akhir_piutang_online_total,
       awal_hutang_lokal_total, akhir_hutang_lokal_total
FROM app.saldo_pelanggan_snapshot_manifest
WHERE unit_id = 1
  AND generation_id = :'generation_id'::uuid;

SELECT p.unit_id, p.as_of_date, p.generation_id,
       p.generation_status, p.generation_published,
       p.generation_validation_passed,
       count(r.customer_code)::bigint AS actual_row_count
FROM app.saldo_pelanggan_snapshot_pointer p
JOIN app.saldo_pelanggan_snapshot_row r
  ON r.unit_id = p.unit_id
 AND r.as_of_date = p.as_of_date
 AND r.generation_id = p.generation_id
WHERE p.unit_id = 1
  AND p.generation_id = :'generation_id'::uuid
GROUP BY p.unit_id, p.as_of_date, p.generation_id,
         p.generation_status, p.generation_published,
         p.generation_validation_passed;

COMMIT;
```

Hasil wajib menunjukkan tepat satu manifest `complete`, `published=true`,
`validation_passed=true`; pointer menunjuk `generationId` yang sama; dan
`actual_row_count = manifest.row_count = manifest.customer_key_count`. Catat
`as_of_date` manifest. Bandingkan snapshot dengan ledger/source cut independen
pada **tanggal manifest itu**, bukan memaksa tanggal 9 September bila generasi
memakai tanggal lain.

Sebagai kontrol regresi tambahan, enam angka RECAP Imam Bonjol tanggal
9 September 2026 harus tetap persis:

| Baris | Awal hari | Akhir hari |
|---|---:|---:|
| Piutang Pelanggan Lokal | Rp 14.747.755.960 | Rp 13.850.356.389 |
| Piutang Pelanggan Online | Rp 900.000 | Rp 900.000 |
| Hutang Pelanggan Lokal | (Rp 768.511.557) | (Rp 703.204.678) |

Satu nilai bergeser berarti **berhenti**. Jangan picu enam unit lain dan jangan
buat Cloud Scheduler. Nilai 9 September yang cocok saja tidak membuktikan
snapshot dipakai bila `as_of_date` manifest berbeda.

## Pembatalan dan keadaan salah

`Ctrl-C` pada `curl` hanya memutus klien; itu **bukan** bukti worker berhenti.
Endpoint sengaja tidak menyediakan cancel yang dapat meninggalkan transaksi
atau lease dalam keadaan ambigu. Deadline internal membatasi worker, dan lease
yatim kedaluwarsa sekitar dua menit lalu direap oleh invocation unit yang sama.
Karena lease unik bersifat global sedangkan reap bersifat per-unit, lease yatim
satu unit dapat membuat enam unit lain terus mendapat `busy` sampai unit pemilik
lease dipanggil lagi.

Bila respons bukan `done`, parity berbeda, atau salah satu angka RECAP berubah:

1. hentikan rollout—jangan panggil unit 2–7;
2. jangan buat job Scheduler;
3. simpan `workId`, `generationId`, status HTTP, dan log revisi sebagai bukti;
4. jangan `DELETE` manifest/pointer/row secara manual. Publikasi pointer atomik;
   bila pointer sudah terbit, pembatalan request tidak menggulung transaksi yang
   sudah commit;
5. minta Dion memilih remediasi data atau rollback pembaca berdasarkan bukti.

Sesudah lease kedaluwarsa, panggil endpoint sekali lagi untuk **unit pemilik
lease** setelah 04.45 WIB. `runOnce` mereap lebih dulu, lalu pagar waktu menolak
lease/build baru. Jangan membersihkan row secara manual.

Sebelum membuat atau mengaktifkan job Scheduler, verifikasi dengan kanal
read-only khusus yang dapat membaca work queue bahwa query ini menghasilkan nol
baris. Scope tujuh unit dan kontrol positif `public.unit` wajib ada agar hasil
nol tidak berasal dari RLS yang fail-closed:

```sql
BEGIN READ ONLY;
SELECT set_config('app.unit_ids', '1,2,3,4,5,6,7', true);

SELECT current_setting('app.unit_ids', true) AS scope;
SELECT count(*) AS scoped_units
FROM public.unit
WHERE active AND unit_id BETWEEN 1 AND 7;

SELECT unit_id, work_id, lease_owner, lease_expires_at
FROM app.saldo_pelanggan_build_work
WHERE state = 'leased'
ORDER BY unit_id, work_id;

COMMIT;
```

`scoped_units` harus `7` dan query `state='leased'` harus nol baris. Jika masih
ada row, jangan buat job; tunggu expiry, picu unit pemilik sesudah cutoff untuk
reap, lalu ulangi pemeriksaan.

## Membuat tujuh job Scheduler—hanya setelah kanari diterima

Jadwal berjarak 20 menit. Batas worst case satu invocation adalah finalisasi
source cut 2 menit ditambah attempt builder 15 menit; jarak tersebut memberi
ruang sebelum unit berikutnya. Unique lease database tetap penjaga concurrency
global `1`; cron hanya mengurangi tabrakan dan tidak menggantikannya.

| Unit | Nama | Cron |
|---:|---|---|
| 1 | Imam Bonjol | `5 2 * * *` |
| 2 | Bakau | `25 2 * * *` |
| 3 | Adisucipto | `45 2 * * *` |
| 4 | Bundaran Kotabaru | `5 3 * * *` |
| 5 | Batu Layang | `25 3 * * *` |
| 6 | Korek | `45 3 * * *` |
| 7 | 28 Oktober | `5 4 * * *` |

Zona waktu seluruh job wajib `Asia/Pontianak`. Semua jadwal mulai di dalam
02.00–04.45 WIB; worker tetap memeriksa jam database dan kapasitas sebelum lease.

**Dion menjalankan blok ini; PR tidak membuat resource GCP:**

```bash
set -euo pipefail

PROJECT_ID=solamax
REGION=asia-southeast2
SERVICE=solamax-ingest-staging
URL="$(gcloud run services describe "$SERVICE" \
  --project="$PROJECT_ID" --region="$REGION" \
  --format='value(status.url)')"
test -n "$URL"

SNAPSHOT_SECRET="$(gcloud secrets versions access latest \
  --secret=solamax-warm-board-secret --project="$PROJECT_ID")"
test -n "$SNAPSHOT_SECRET"

while IFS='|' read -r UNIT_ID UNIT_NAME SCHEDULE; do
  JOB="solamax-snapshot-unit-${UNIT_ID}"
  printf 'membuat %s untuk %s pada %s WIB\n' "$JOB" "$UNIT_NAME" "$SCHEDULE"
  gcloud scheduler jobs create http "$JOB" \
    --project="$PROJECT_ID" --location="$REGION" \
    --description="Snapshot saldo pelanggan ${UNIT_NAME}; satu unit per request" \
    --schedule="$SCHEDULE" --time-zone=Asia/Pontianak \
    --uri="$URL/snapshot-worker" --http-method=POST \
    --headers="Content-Type=application/json,x-snapshot-secret=${SNAPSHOT_SECRET}" \
    --message-body="{\"unit_id\":${UNIT_ID}}" \
    --attempt-deadline=1200s \
    --max-retry-attempts=0
done <<'JOBS'
1|Imam Bonjol|5 2 * * *
2|Bakau|25 2 * * *
3|Adisucipto|45 2 * * *
4|Bundaran Kotabaru|5 3 * * *
5|Batu Layang|25 3 * * *
6|Korek|45 3 * * *
7|28 Oktober|5 4 * * *
JOBS

unset SNAPSHOT_SECRET
```

Retry Scheduler sengaja nol. Queue database tetap durable; retry yang lebih
cepat daripada batas build 17 menit dapat menabrak lease yang sama dan menyeret
kegagalan satu unit ke slot unit berikutnya. Percobaan merah tetap terlihat di
riwayat job dan baru dicoba lagi pada jadwal harian berikutnya setelah operator
membaca statusnya.

Shared secret ini disimpan sebagai nilai header pada resource Scheduler; Secret
Manager hanya menjadi sumber saat job dibuat. Karena itu, jalankan blok hanya
dari terminal tepercaya, batasi pihak yang dapat membaca konfigurasi job, dan
jangan simpan output `describe` mentah. Rotasi secret memerlukan pembaruan
binding service **dan** ketujuh header job; `:latest` pada Cloud Run tidak
memperbarui resource Scheduler yang sudah ada.

Sesudah pembuatan, periksa schedule, zona, URI, body unit, attempt deadline,
dan **nama header saja** tanpa mencetak nilai `x-snapshot-secret`. Jangan gunakan
`gcloud scheduler jobs describe` tanpa format tersanitasi pada transkrip yang
dapat dibaca orang lain.

Job Scheduler yang 2xx hanya membuktikan endpoint menjawab sukses. Alarm harian
tetap perlu memeriksa bahwa setiap unit menghasilkan `done`; `idle` dan
`superseded` juga 2xx tetapi bukan bukti generasi baru. Kegagalan satu job tidak
menghentikan jadwal enam unit lain, sedangkan lease database memastikan mereka
tidak membangun paralel.

Sesudah jendela berakhir, pemeriksaan read-only berikut adalah dead-man check
minimum. Ia harus mengembalikan `done_today = 7`; nilai lebih kecil berarti
malam itu gagal walaupun tujuh job Scheduler tampak hijau:

```sql
BEGIN READ ONLY;
SELECT set_config('app.unit_ids', '1,2,3,4,5,6,7', true);

WITH done AS (
  SELECT DISTINCT unit_id
  FROM app.saldo_pelanggan_snapshot_manifest
  WHERE unit_id BETWEEN 1 AND 7
    AND status = 'complete'
    AND published
    AND validation_passed
    AND completed_at >= (
      date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Pontianak')
      AT TIME ZONE 'Asia/Pontianak'
    )
)
SELECT count(*) AS done_today FROM done;

COMMIT;
```

Ini baru aturan verifikasi siap-jalankan, belum alarm terpasang. Pemasangan
monitor terjadwal tetap keputusan Dion dan tidak dilakukan oleh PR ini.
