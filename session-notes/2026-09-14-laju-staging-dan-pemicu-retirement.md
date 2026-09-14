# Laju staging — rancangan pemicu pemensiunan, dengan tenggat nyata

Tanggal: 2026-09-14 · Worker: Claude Opus 5 · Branch `codex/piutang-0039-p3009`

---

## 0 · Dua ralat yang saya terima, dan apa yang berubah karenanya

**Ralat 1 — saya menyalahkan cycle yang salah.** Saya menulis risiko bahwa
`VACUUM FULL` akan menulis ulang baris milik 84 cycle `failed`. Diukur langsung:
cycle `failed` memegang **NOL baris**. Pemensiunannya bekerja. Yang menumpuk
adalah **`staging`** — 17.674.653 dari 18.082.443 baris `source_bppiut`
(**97,7%**), tersebar di **22 cut** berumur ±27 jam.

Itu memindahkan titik serangnya. Masalahnya bukan membersihkan sisa cycle mati;
masalahnya **cut ditangkap terus-menerus sementara penandaan `staging` →
`failed` hanya terjadi saat snapshot worker berjalan** — sekali sehari, terikat
pada cron build 02:05. Obatnya tetap "pemensiunan lebih sering", tetapi
alasannya berbeda, dan alasan yang salah akan menyesatkan orang berikutnya.

**Ralat 2 — `VACUUM FULL` yang saya lihat 01:29 bukan yang asli.** Yang asli
mati bersama koneksi psql; `bppiut` sempat commit, `bphut` tidak pernah
tersentuh. Yang saya baca adalah jalanan ulang 11,7 detik. Prediksi saya
"≈8 GB, kepala ruang ~1 GB" meleset **ke arah lebih baik** (hasil nyata
**6.171.892.759 B = 5.886 MB**), tetapi lewat cabang yang salah: 18,08 juta
baris itu nyata — hanya saja 97,7%-nya `staging`, bukan `failed`.

Pelajaran yang saya bawa: saya menebak **komposisi** dari angka `n_live_tup`
agregat, padahal `01-ukur.sql` yang saya tulis sendiri ada justru untuk
memisahkannya. Saya menulis alatnya lalu menalar tanpa menunggunya.

---

## 1 · Tenggat

```
laju          3,38 GB/hari      (3,83 GB per 27 jam, dua tabel source)
kepala ruang  2,83 GB           (9 GB − 6,17 GB)
⇒ gerbang menutup lagi ±20 jam lagi, sekitar 21:00 WIB
```

**Kepala ruang yang dimenangkan semalam lebih kecil daripada satu hari
akumulasi.** Tanpa pemicu pemensiunan, malam berikutnya hilang lagi.

---

## 2 · ⚠️ Yang memaksa rancangannya jadi DUA LANGKAH

**PR ini tidak dapat mencapai produksi sebelum tenggat.** Promosi ke `main`
beku, jadi endpoint baru apa pun yang saya tulis malam ini belum ada di layanan
pilot pukul 21:00. Maka:

> **Langkah 1 harus berjalan di atas kode yang SUDAH ter-deploy.**

Untungnya bisa: `collectRetiredSources` dipanggil **sebelum** gerbang
(`snapshot-worker.service.ts:240-252`), dan build sendiri dibatasi jendela jam.
Jadi memanggil `/snapshot-worker` di luar 02:00–05:00 **memensiunkan tanpa
membangun**, dengan kode hari ini, tanpa deploy.

Biaya yang harus diterima sadar: endpoint itu memulangkan **425** di luar
jendela build, sehingga job-nya tercatat **gagal ~20×/hari**. Itu persis
antipola "alarm yang selalu menyala". Langkah 2 menghapusnya.

### Langkah 1 — malam ini, tanpa deploy (perintah Dion; saya tidak menjalankan)

⚠️ **Koreksi bentuk.** Versi pertama yang saya sodorkan di percakapan hanya
memuat potongan `gcloud scheduler jobs create` dengan `$URL` dan
`$SNAPSHOT_SECRET` **tidak terisi** — dijalankan apa adanya ia membuat job
rusak. Blok di catatan ini memang lengkap, tetapi **yang disalin orang adalah
blok yang disodorkan**, bukan yang diarsipkan. Aturan yang saya ambil dari itu:
*perintah operator harus berdiri sendiri di dalam blok yang ditampilkan* —
tidak ada variabel yang tidak didefinisikan di blok yang sama.

```bash
set -euo pipefail                      # JANGAN tambahkan -x: ia akan mencetak nilai secret
PROJECT_ID=solamax
REGION=asia-southeast2
SERVICE=solamax-ingest-staging

URL="$(gcloud run services describe "$SERVICE" \
       --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)')"
test -n "$URL"

gcloud scheduler jobs create http solamax-snapshot-retire-unit-1 \
  --project="$PROJECT_ID" --location="$REGION" \
  --description="Pemensiunan source cut per jam (SEMENTARA: lewat /snapshot-worker; 425 = normal)" \
  --schedule='20 0,1,5-23 * * *' --time-zone=Asia/Pontianak \
  --uri="$URL/snapshot-worker" --http-method=POST \
  --headers="Content-Type=application/json,x-snapshot-secret=$(gcloud secrets versions access latest \
      --secret=solamax-warm-board-secret --project="$PROJECT_ID")" \
  --message-body='{"unit_id":1}' \
  --attempt-deadline=300s --max-retry-attempts=0 --format='value(name)'
```

Nilai secret ditarik **inline** dari Secret Manager: ia tidak pernah melewati
variabel shell yang bisa tercetak, tidak pernah muncul di riwayat, dan tidak
pernah masuk transkrip. Secret ini sudah dirotasi 14-09 (versi 2 aktif), jadi
nilai lama apa pun yang tersimpan di tempat lain memang tidak akan bekerja.

- **Jam 2–4 sengaja dilewati**: itu jendela build; cron 02:05 sudah
  memensiunkan lebih dulu, dan invokasi bersamaan hanya memperebutkan lease.
- **425 adalah hasil yang DIHARAPKAN.** Yang layak dibaca: apa pun selain 425
  — terutama **507** sesudah langkah 2 mendarat (gerbang kapasitas tertutup).
- `attempt-deadline=300s`: pemensiunan satu cut ±711 ribu baris memakan
  beberapa detik; 300 s sudah sangat longgar dan tidak menahan slot 20 menit.

### Langkah 2 — sesudah promosi dibuka (ada di PR ini)

`POST /snapshot-worker/retire`: memensiunkan **tanpa** membangun, selalu
memulangkan **200**, dan menulis angkanya ke log. Sesudahnya:

```bash
gcloud scheduler jobs update http solamax-snapshot-retire-unit-1 \
  --project=solamax --location=asia-southeast2 \
  --uri="$URL/snapshot-worker/retire" \
  --description="Pemensiunan source cut per jam" --format='value(name)'
```

Jadwalnya tidak berubah; hanya URI dan deskripsi. Job berhenti tercatat gagal.

---

## 3 · Jawaban atas tiga pertanyaan rancangan

### (a) Berapa cycle staging yang wajar hidup bersamaan?

**Satu.** Hanya cut ber-sequence tertinggi yang masih bisa menang — itu sudah
ditulis di `READ_LATEST_SOURCE_SEQUENCE_SQL`: apa pun di bawah alokasi terbaru
**sudah kalah**, entah ada pemenang atau tidak. **Dua** ketika satu cut sedang
diunggah (domain piutang dan hutang tiba sebagai beberapa `/ingest` ke cycle
yang sama).

Ambang "sesuatu tidak beres" saya pasang di **4** (`stagingReviewCount`) —
kelonggaran dua kali lipat keadaan sehat: cukup longgar untuk tidak jadi alarm
yang selalu menyala, cukup ketat untuk berbunyi jauh sebelum 22.

Keadaan tunak yang diharapkan dengan pemensiunan per jam:

| | sekarang | dengan pemicu per jam |
|---|---:|---:|
| cut staging hidup | 22 | 1–2 |
| baris `source_*` | 18,08 jt | ~1,4 jt |
| ukuran dua tabel | 3.926 MB | **~300–430 MB** |

(1 cut = 407.790 + 300.257 + 2.973 = **711.020 baris** ≈ 136–144 MB, konsisten
dari dua arah: 3,38 GB/hari ÷ 24 cut, dan 3.472 MB ÷ 18,08 jt baris ≈ 192 B.)

### (b) Apa yang terjadi bila pemensiunan berjalan saat capture sedang menulis?

1. **Keduanya berbagi advisory lock yang sama**
   (`pg_advisory_xact_lock('saldo-pelanggan-source:'||unit)`), jadi pemensiunan
   tidak pernah berjalan **di dalam** transaksi capture.
2. **Penandaan hanya menjatuhkan staging yang sequence-nya DI BAWAH alokasi
   terbaru.** Cut yang sedang diunggah adalah yang terbaru ⇒ tidak pernah
   ditandai. Cut di bawahnya sudah ditinggalkan agent ⇒ aman dipensiunkan.
3. **Pengurasan hanya menghapus baris milik cycle `failed`** — tidak ada yang
   menulis ke sana.
4. Dengan pengurasan berbatas, capture dapat menyelip **di antara** batch.
   Predikatnya dievaluasi ulang tiap batch, jadi cut yang menjadi terbaru
   di tengah pengurasan tidak pernah tersentuh. Menyelip membuatnya **lebih**
   benar, bukan kurang.

**Risiko sisa yang saya sebutkan, bukan sembunyikan**: bila agent mengalokasi
cut N+1 sementara N masih mengunggah, baris N yang sudah mendarat akan dibuang.
Dengan satu agent per unit dan satu cycle per putaran sync itu tidak terjadi —
dan bila terjadi, yang dibuang adalah cut tak lengkap yang memang tak akan
pernah difinalisasi.

### (c) Bagaimana operator melihat lajunya tanpa membuka psql?

**Sesudah langkah 2** — baris log tiap jam:

```json
{"msg":"snapshot-retire finished","unit_id":1,"staging_before":3,
 "staging_after":1,"rows_deleted":711020,"staging_review":false,"ms":...}
```

`staging_after` **adalah** ukuran lajunya. Melewati ambang ⇒ ditulis
`logger.warn`, sehingga penyaring severity Cloud Logging melihatnya.

```bash
gcloud logging read 'resource.labels.service_name="solamax-ingest-staging"
  AND textPayload:"snapshot-retire finished"' --project=solamax --limit=24 \
  --format='value(timestamp,textPayload)'
```

**Malam ini (sebelum langkah 2), jujurnya: belum bisa.** `/snapshot-worker`
tidak mencetak jumlah staging. Yang tersedia tanpa psql hanyalah grafik
**Storage** pada halaman instance Cloud SQL di Console — cukup untuk melihat
kurva naik/mendatar, tidak cukup untuk melihat sebabnya.

**Usul terpisah (infra, milik Dion)**: alert policy Cloud Monitoring atas
`cloudsql.googleapis.com/database/disk/bytes_used` pada ~8 GB. Itu memberi
peringatan **sebelum** gerbang 9 GB menutup, alih-alih sesudah. Saya tidak
membuatnya — §6.3.

---

## 4 · Kenapa endpoint terpisah, bukan menjadwalkan `/snapshot-worker` selamanya

Menjadwalkan endpoint build per jam memang ikut memensiunkan, tetapi ia
memulangkan **425 dua puluh kali sehari**. Job yang selalu merah berhenti
dibaca — dan ketidakmampuan membedakan "wajar" dari "gawat" adalah **persis**
kelas kegagalan yang menyembunyikan insiden 12–14 September berhari-hari.
Memperbaiki kapasitas dengan cara yang melahirkan kebutaan baru bukan
perbaikan. Karena itu langkah 1 sengaja ditandai **SEMENTARA** di deskripsi
job-nya.

---

## 5 · Keputusan yang saya ambil sendiri

| Keputusan | Alasan |
|---|---|
| Rancangan dipecah dua langkah | PR tidak dapat mencapai produksi sebelum tenggat ~21:00; langkah 1 harus jalan di atas kode ter-deploy. |
| Langkah 1 melewati jam 2–4 | Jendela build; cron 02:05 sudah memensiunkan, invokasi bersamaan hanya memperebutkan lease. |
| Endpoint `retire` dipisah dari `runBatch` | Menghindari job yang tercatat gagal 20×/hari — antipola yang menyebabkan insiden ini tak terlihat. |
| `stagingReviewCount = 4` | Dua kali keadaan sehat (1–2). Longgar supaya tidak jadi alarm permanen, ketat supaya berbunyi jauh sebelum 22. |
| Tuning autovacuum **tidak** dimasukkan | Belum ada angka yang menunjukkan autovacuum tertinggal; dengan baris hidup turun ke ~1,4 jt, ambang default sudah agresif secara relatif. Menambah migrasi tanpa pengukuran adalah kesalahan yang baru saja saya buat di tempat lain. |

---

## 6 · Yang butuh Dion

1. **Jalankan langkah 1 (§2) sebelum ~21:00 WIB.** Itu yang mengejar tenggat.
2. **Batas disk** — perintah dan tarikannya ada di
   `scripts/piutang-kapasitas/README.md`. Ingat: batas terlalu ketat mengubah
   masalah biaya jadi masalah **ketersediaan**, karena puncak `VACUUM FULL` =
   lama + baru (terpantau 13,97 → 16 GB).
3. **Alert policy disk 8 GB** (§3c) — setuju/tidak?
4. Sesudah promosi dibuka: perbarui URI job ke `/snapshot-worker/retire`.

---

# Adendum — menutup kebutaan yang dilahirkan job sementara

## 7 · Keberatan yang saya terima

Saya menolak menjadwalkan endpoint build per jam karena "job yang selalu merah
berhenti dibaca", lalu mengusulkan job yang menjawab **425 dua puluh kali
sehari** — merah permanen di console. Menandainya `SEMENTARA` di deskripsi
**tidak menutup apa pun**: label tidak mencabut apa pun, dan hal sementara
adalah hal yang paling sering menjadi permanen. Keberatan itu benar, dan
jawabannya harus mekanis, bukan ingatan.

Saya membangun **keduanya** — gerbang DAN langkah runbook — karena masing-masing
sendirian berlubang: gerbangnya tidak dapat menghapus job apa pun, dan langkah
runbook sendirian bersandar pada seseorang membacanya.

## 8 · Pemicu 1 — gerbang yang MERAH saat promosi

`scripts/ci/check-temporary-retire-job.sh`, dipanggil dari langkah baru di
`deploy-backend.yml` **tier pilot**, sesudah deploy dan health check.

Keputusannya:

| job | endpoint `/retire` di revisi | hasil |
|---|---|---|
| tidak ada | apa pun | HIJAU — tak ada yang sementara |
| menunjuk `/snapshot-worker` | belum ada | HIJAU — job sementara masih satu-satunya cara |
| menunjuk `/snapshot-worker` | **sudah ada** | **MERAH** |
| menunjuk `/snapshot-worker/retire` | sudah ada | HIJAU |
| bentuk lain | sudah ada | MERAH — gerbang tidak boleh lulus atas bentuk yang tak dipahaminya |

⇒ Deploy pilot yang membawa `/retire` **menolak diam** selama job masih
menunjuk endpoint build, dan pesan gagalnya memuat perintah perbaikannya.
Gerbang ini tidak menghapus apa pun; ia menahan giliran orang yang sedang
melakukan promosi, tepat ketika ia sedang memperhatikan.

Perbandingannya pada **path**, bukan host — Cloud Run punya beberapa bentuk URL
yang sama-sama sah (`…-wn6i64kvza-et.a.run.app` dan
`…-113869564052.asia-southeast2.run.app`), dan gerbang yang membandingkan host
akan merah pada job yang sudah benar. Self-test kasus 4 sengaja memakai host
yang berbeda dari kasus 3 supaya kesalahan itu tertangkap.

`check-temporary-retire-job.selftest.sh` menguji **lima keadaan termasuk kedua
jalur hijau**, berjalan di CI tiap commit, dan **tidak menyentuh GCP**.

⚠️ Langkah deploy-nya memakai `--format='value(httpTarget.uri)'` — **URI saja**.
`httpTarget.headers` tidak boleh disebut di sana: format itu mencetak NILAI
header, dan pada 14-09-2026 ia membocorkan `x-snapshot-secret` ke transkrip.

## 9 · Pemicu 2 — langkah runbook promosi #359

Dijalankan Dion **sebagai bagian dari promosi**, sesudah deploy pilot berhasil:

```bash
set -euo pipefail
PROJECT_ID=solamax
REGION=asia-southeast2
URL="$(gcloud run services describe solamax-ingest-staging \
       --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)')"
test -n "$URL"

gcloud scheduler jobs update http solamax-snapshot-retire-unit-1 \
  --project="$PROJECT_ID" --location="$REGION" \
  --uri="$URL/snapshot-worker/retire" \
  --description='Pemensiunan source cut per jam' \
  --format='value(name)'
```

Perintah itu **tidak** menyebut `--update-headers`, jadi header *seharusnya*
terpelihara — tetapi **itu klaim yang belum diuji pada job ini**, dan kelas
klaim yang sama baru saja menghabiskan satu malam build (§17). **Verifikasi
sesudah menjalankannya**:

```bash
gcloud scheduler jobs describe solamax-snapshot-retire-unit-1 \
  --project=solamax --location=asia-southeast2 --format=json \
  | python3 scripts/ci/scheduler-job-facts.py
```

Harus memulangkan `JOB_CONTENT_TYPE=application/json` dan `JOB_HEADER_KEYS`
yang memuat `x-snapshot-secret`. Bila salah satu hilang, pasang ulang
**SELURUH** header sekaligus (§17). Sesudah benar, job memulangkan **200** dan
gerbang §8 menjadi hijau.

## 10 · LUBANG BERNAMA — hal yang TIDAK saya ketahui

Kredensial Google kedaluwarsa dua lapis (gcloud CLI dan ADC), jadi sejak
pemberitahuan itu saya **tidak dapat membaca** Cloud Logging, Secret Manager,
maupun DB produksi. Yang berikut ini **tidak diketahui**, dan tidak saya isi
dengan perkiraan:

| Lubang | Kenapa penting |
|---|---|
| **Hasil build 02:05 14-09** | Apakah gerbang byte sudah terbuka dan publikasi snapshot kembali berjalan sesudah `VACUUM FULL`. |
| **Ukuran DB sekarang** | Menentukan berapa jam tersisa sebelum gerbang 9 GB menutup lagi. Angka terakhir yang SAH adalah 6.171.892.759 B pada ~01:40 WIB. |
| **Apakah job §2 sudah dibuat** | Bila belum, tenggat ~21:00 masih berjalan. Gerbang §8 sengaja memperlakukan "job tidak ada" sebagai HIJAU, jadi ia benar di kedua keadaan. |

Semua angka laju di catatan ini (3,38 GB/hari, kepala ruang 2,83 GB, ±20 jam)
berasal dari pengukuran ~01:40 WIB dan **tidak diperbarui sesudahnya**.

## 11 · Yang butuh Dion (diperbarui)

1. `gcloud auth login` **dan** `gcloud auth application-default login` — tanpa
   itu tidak ada verifikasi yang bisa dijalankan siapa pun.
2. Job §2 bila belum dibuat (tenggat ~21:00 WIB).
3. Batas disk — `scripts/piutang-kapasitas/README.md`.
4. Alert policy `disk/bytes_used` ~8 GB — setuju/tidak?
5. Saat promosi #359: jalankan §9. Gerbang §8 akan mengingatkan bila terlewat.

---

# Adendum 2 — 14-09-2026 15:20 WIB · tiga lubang §10 DITUTUP

Kredensial pulih, jadi ketiganya terjawab. Dua jawabannya buruk.

## 12 · Build 02:05 14-Sep TIDAK PERNAH BERJALAN — ditolak 404

```
2026-09-13T19:05:00Z  (= 02:05:00 WIB 14-09)  404  Google-Cloud-Scheduler
2026-09-14T06:28:53Z  (= 13:28 WIB)           425  curl/8.7.1
2026-09-14T06:30:57Z  (= 13:30 WIB)           404  Google-Cloud-Scheduler
2026-09-14T06:39:47Z  (= 13:39 WIB)           425  Google-Cloud-Scheduler
```

404 datang dari `rejectWithoutOracle()` — **permintaan ditolak di pintu, sebelum
pekerjaan apa pun**. Artinya pada 02:05 WIB:

- **tidak ada snapshot yang dibangun untuk 14-09.** Layar masih menyajikan
  generasi 13-09.
- **pemensiunan pun tidak berjalan**, karena ia berada di belakang pemeriksaan
  secret. Staging menumpuk tanpa henti dari 02:48 sampai 13:28 WIB.

Sebabnya: rotasi secret semalam meninggalkan header job Scheduler tidak
sinkron. Bukti bahwa itu memang sudah diperbaiki: permintaan Scheduler 13:39
memulangkan **425**, bukan 404 — jadi cron malam ini akan lolos autentikasi.

⚠️ **Kelas kegagalan yang wajib dicatat.** `rejectWithoutOracle()` sengaja
membuat secret salah dan unit tak dikenal **tidak dapat dibedakan** — itu
desain keamanan yang benar. Akibat sampingannya: header yang basi sesudah
rotasi terlihat persis seperti unit yang tidak ada, **dan tidak ada yang
berbunyi**. Satu malam build hilang tanpa satu pun alarm. Usul (murah):
sesudah setiap rotasi, jalankan satu permintaan uji ke endpoint dan pastikan
jawabannya **bukan** 404; atau pasang alert atas kegagalan job Scheduler.

## 13 · Job pemensiunan per jam BELUM ADA

`gcloud scheduler jobs list` hanya memulangkan `solamax-snapshot-unit-1` dan
`solamax-warm-board`. **Tenggat §1 masih berjalan, dan sekarang lebih mendesak**
karena satu malam pemensiunan sudah hilang.

## 14 · Laju terukur — dan bukti langsung bahwa pemensiunan adalah tuas yang benar

Kurva `cloudsql.googleapis.com/database/disk/bytes_used`, 26 jam (bukti di
`evidence/2026-09-14-kapasitas-pasca-vacuum/`):

| Titik | Nilai |
|---|---:|
| puncak `VACUUM FULL` 01:18 WIB | **16,638 GB** |
| lantai pasca-vacuum 02:48 WIB | **7,667 GB** |
| 02:48 → 13:48 WIB, **nol pemensiunan** | **+6,761 GB / 11 jam = 615 MB/jam = 14,8 GB/hari** |
| 13:48 → 15:18 WIB, **sesudah pemensiunan manual** | −14, −16, −48 MB — **mendatar, lalu turun** |

Tiga bucket terakhir itu adalah bukti paling langsung yang kita punya bahwa
pemensiunan **adalah** tuas yang benar: begitu ia berjalan sekali, kurvanya
berhenti naik.

⚠️ **Jangan campur dua angka ini.** 615 MB/jam adalah **disk keseluruhan** —
termasuk WAL, churn tabel mirror, dan bloat indeks. Gerbang membaca
`pg_database_size`, yang **tidak** memuat WAL. Angka 3,38 GB/hari (tabel
`source_*` saja) dan 14,8 GB/hari (disk) mengukur hal berbeda; memakai yang
satu untuk meramalkan yang lain adalah kesalahan yang sama dengan "model aliran
tidak dapat meramalkan angka stok", dalam baju baru.

## 15 · Yang MASIH tidak saya ketahui — dan batas yang bisa saya berikan

**`pg_database_size` sekarang: TIDAK DIKETAHUI.** Ia hanya terbaca lewat psql,
yang masih diblokir classifier untuk sesi ini. Yang dapat saya berikan adalah
batasnya, bukan angkanya:

- Angka terakhir yang **sah**: **6.171.892.759 B (6,17 GB)** pada ~01:40 WIB.
- Sejak 02:48 sampai 13:28 WIB tidak ada pemensiunan sama sekali ⇒ ~10–11 cut
  staging bertambah ≈ **1,5–1,6 GB** pada tabel `source_*`.
- Pemensiunan 13:28/13:39 menghapus baris, tetapi `DELETE` **tidak**
  menurunkan `pg_database_size`.
- Selisih disk-vs-database pada lantai 02:48 ≈ 1,5 GB (7,667 − 6,17).

⇒ `pg_database_size` sekarang berada **di suatu tempat antara ~8 GB dan
~12,9 GB**. Batas bawahnya sudah menyentuh gerbang 9 GB, batas atasnya jauh
melewatinya. **Saya tidak dapat mengatakan gerbangnya terbuka atau tertutup**,
dan kalau tertutup, cron 02:05 nanti malam akan hilang lagi.

Satu baris yang menyelesaikannya (Dion, lewat cloud-sql-proxy):

```bash
psql "$DATABASE_URL_PILOT" -X -At -c \
  "SELECT pg_size_pretty(pg_database_size(current_database())),
          pg_database_size(current_database()) < 9000000000 AS gerbang_terbuka;"
```

## 16 · Urutan tindakan malam ini (Dion)

1. **Buat job pemensiunan per jam** (§2) — sekarang, bukan nanti. Ia berjalan
   di atas kode ter-deploy dan tidak menunggu promosi.
2. **Ukur `pg_database_size`** (§15). Bila ≥ 9 GB, cron 02:05 akan di-skip lagi
   dan malam kedua hilang — maka perlu `VACUUM FULL` kedua **di luar** jendela
   02:00–05:00, dengan peringatan lock yang sama seperti semalam.
3. Bila < 9 GB: tidak perlu tindakan DB; job §2 yang menjaganya tetap di bawah.

Langkah 1 dan 2 **tidak saling menunggu**.

---

# Adendum 3 — jebakan header, dan premis plateau yang belum saya buktikan

## 17 · `--update-headers` MENGGANTI set header, bukan menambah

Terbukti dua arah di job produksi 14-09-2026:

| Tindakan | Akibat |
|---|---|
| pasang `x-snapshot-secret` saja | `Content-Type` kembali ke default `application/octet-stream` → NestJS berhenti mem-parse body → `unit_id` tak terbaca → **404 dalam 3 ms** |
| lalu perbaiki `Content-Type` saja | **`x-snapshot-secret` terhapus** |

Itulah mekanisme yang menghabiskan build 02:05 WIB — bukan "header tidak
sinkron" secara umum. Dan ia **senyap**: `rejectWithoutOracle()` sengaja membuat
secret salah tak terbedakan dari unit tak dikenal (desain keamanan yang benar),
sehingga header rusak tampak persis seperti unit yang tidak ada.

**Aturan**: setiap `jobs update http` yang menyentuh header wajib menyebut
**SELURUH** header sekaligus, lalu **diverifikasi**. Seluruh catatan sudah
disisir — tidak ada `--update-headers` yang tersisa, dan tiga klaim
"mempertahankan header yang sudah ada" (dua di runbook backfill 13-09, satu
milik saya) sudah diubah jadi instruksi verifikasi.

**Gerbangnya**: `scripts/ci/check-snapshot-scheduler-jobs.sh` kini menolak job
yang `Content-Type`-nya bukan `application/json` **atau** yang kehilangan
`x-snapshot-secret`, untuk `solamax-snapshot-unit-1` **dan**
`solamax-snapshot-retire-unit-1`, di setiap deploy pilot. Delapan keadaan
di-self-test tanpa menyentuh GCP, dan dijalankan **end-to-end terhadap job
produksi nyata** hari ini: `Content-Type=application/json`, kunci memuat
`x-snapshot-secret`, uri `/snapshot-worker`, `ENDPOINT_ADA=false` → HIJAU.

Pembacaan headernya lewat `scripts/ci/scheduler-job-facts.py`: `--format=json`
masuk pipa, dan **hanya** uri + Content-Type + daftar kunci yang keluar.
Dikontrol dengan nilai umpan `RAHASIA-TIDAK-BOLEH-TERCETAK` — ia tidak muncul.

⚠️ Koreksi atas nasihat saya sendiri: `--format='value(httpTarget.headers.keys().list())'`
yang sempat saya rekomendasikan **tidak sah** — `keys` bukan transform gcloud.
Saya menuliskannya tanpa menjalankannya, di catatan tentang bahaya. Sudah
diuji dan dikoreksi.

## 18 · Premis plateau: keberatan diterima, tetapi atribusi hari ini perlu diluruskan

Premis saya — *"sesudah aliran benar, ruang mati dipakai ulang INSERT
berikutnya, jadi berkasnya berhenti tumbuh pada tanda-airnya"* — **belum
terbukti**, dan ia menopang klaim besar ("VACUUM FULL berhenti jadi kebutuhan
rutin"). Keberatan itu saya terima.

Satu hal perlu diluruskan supaya diagnosisnya tidak salah arah: pertumbuhan
**+6,76 GB pada 02:48 → 13:48 WIB terjadi di jendela dengan NOL pemensiunan**.
Cron 02:05 ditolak 404 (§12), dan tidak ada invokasi lain yang lolos sampai
13:28. Penandaan `failed` 84 → 107 terjadi pada 13:28/13:39 — di **ujung**
jendela itu, bukan sepanjangnya. Jadi angka 6 GB itu **belum** menunjukkan lag
autovacuum; ia menunjukkan pemensiunan yang absen.

Bukti positifnya juga masih lemah ke arah sebaliknya: tiga bucket sesudah
pemensiunan (−14, −16, −48 MB) konsisten dengan ruang yang dipakai ulang,
tetapi **1,5 jam terlalu pendek untuk menyebutnya plateau**.

⇒ Kedua arah belum terbukti. Yang benar bukan memilih salah satunya, melainkan
mengukur.

### Prediksi yang DIKUNCI sebelum pengukuran

> Dengan pemensiunan berjalan tiap jam,
> `pg_relation_size('app.saldo_pelanggan_source_bppiut')` **mendatar dalam ≤ 6
> jam, pada tingkat ≤ ~1 GB**.
>
> Bila ia **naik monoton selama 24 jam**, prediksi ini SALAH, lag autovacuum
> nyata, dan tuning autovacuum berhenti menjadi "migrasi tanpa pengukuran" —
> ia menjadi bagian dari perbaikan aliran.

Alatnya: `scripts/piutang-kapasitas/04-autovacuum-lag.sql` — read-only,
diverifikasi berjalan di PostgreSQL 16. Ia memulangkan per tabel: ukuran heap,
`n_live_tup`/`n_dead_tup`, persen mati, `autovacuum_count`, **jarak sejak
autovacuum terakhir**, ambang picu efektif, dan apakah ambang itu sudah
terlewat — plus `pg_stat_progress_vacuum` (untuk membedakan "terlambat dipicu"
dari "sedang berjuang") dan jumlah cut staging hidup.

**Satu jalanan tunggal tidak menjawab apa pun**; yang dibaca adalah deretnya.
Jalankan tiap jam sesudah job pemensiunan hidup, simpan berurutan.

---

# Adendum 4 — 16:05 WIB · disk auto-resize 25 → 31 GB, dan apa yang berubah karenanya

## 19 · `VACUUM FULL` menaikkan biaya PERMANEN — naik jadi argumen utama

| | |
|---|---:|
| disk ter-provision sebelum | 25 GB |
| puncak terpakai (16:05 WIB, **masih naik**) | **22,146 GB** |
| disk ter-provision sesudah | **31 GB** |

Auto-resize terpicu **lebih cepat** dari perkiraan saya (~1,5 jam) — kenyataannya
kurang dari 30 menit sesudah saya menuliskannya. Cloud SQL **tidak pernah**
mengecilkan disk, jadi +6 GB itu **permanen**: pada orde US$0,20–0,30/GB/bulan,
**≈ +US$1,2–1,8 per bulan selamanya, per kejadian vacuum**.

⇒ **Pemensiunan per jam bukan optimasi; ia satu-satunya jalan yang tidak
meninggalkan jejak biaya.** Setiap kali kita memilih "bersihkan nanti dengan
`VACUUM FULL`", kita memilih menaikkan tagihan bulanan secara permanen —
di samping kunci ACCESS EXCLUSIVE yang menahan agent 9–14 menit.

Argumen ini sudah dipindahkan dari catatan kaki ke bagian paling atas
`scripts/piutang-kapasitas/README.md`.

## 20 · Batas disk — perhitungan puncaknya, bukan seleranya

- Puncak nyata hari ini **22,15 GB** terpakai, memvakum database yang sebelumnya
  **~13,1 GB** (15:25 WIB) ⇒ puncak ≈ **1,7×** ukuran database + WAL/temp.
- Dengan pemensiunan per jam menjaga database di **6–7 GB** (ukuran bersih
  terukur sesudah vacuum pertama: **6,17 GB**), vacuum masa depan memuncak di
  **~11–13 GB**.
- Rekomendasi peninjau **~50 GB** konsisten: memuat puncak terburuk hari ini
  dengan margin >2×, dan tetap menghentikan pertumbuhan diam-diam. **Angkanya
  keputusan Dion**; perintah `patch` berdiri sendiri ada di README §batas disk,
  lengkap dengan langkah verifikasi (`--storage-auto-increase-limit` wajib
  disertai `--storage-auto-increase`).

## 21 · Job per jam sudah hidup — dan gerbang saya mengujinya

`solamax-snapshot-retire-unit-1`, `20 0,1,5-23 * * *`, dibuat 15:37 WIB.
Diperiksa dengan gerbang §17 terhadap job **nyata**, dua keadaan:

- **sekarang** (`/retire` belum ter-deploy) → **HIJAU**: `Content-Type=application/json`,
  kunci memuat `x-snapshot-secret`, uri `/snapshot-worker`.
- **seandainya `/retire` sudah ter-deploy** → **MERAH**, dengan perintah
  perbaikannya.

Nyala pertamanya 16:20 WIB. ⚠️ **Bila tembakan pertama gagal karena lock
`VACUUM FULL`, itu BUKAN konfigurasi rusak** — yang menentukan tembakan 17:20.

## 22 · Prioritas (a) dan (b): alatnya siap, kurvanya belum ada

`05-kurva.sql` + `05-kurva.sh` — satu titik per jam, ber-tag supaya deretnya
terbaca sebagai kurva, dengan pembaca `--baca`. Diverifikasi berjalan di
PostgreSQL 16, termasuk perbaikan agar `set_config` tidak ikut mencetak baris
liar ke dalam kurva.

```bash
export DATABASE_URL_PILOT=...                              # lewat cloud-sql-proxy
scripts/piutang-kapasitas/05-kurva.sh 12 > kurva.log &     # 12 jam
scripts/piutang-kapasitas/05-kurva.sh --baca kurva.log
```

⚠️ **Jalankan SESUDAH `VACUUM FULL` selesai.** Titik yang diambil saat vacuum
berjalan mengukur puncak rewrite, bukan keadaan tunak, dan akan mengotori
kurvanya.

**Prediksi tetap seperti dikunci**: `pg_relation_size` `source_bppiut` mendatar
dalam ≤ 6 jam pada ≤ ~1 GB. Naik monoton 24 jam ⇒ prediksi SALAH, lag
autovacuum nyata, tuning jadi bagian perbaikan aliran.

Sampai deret itu ada, **saya tidak punya kurva untuk dilaporkan** — hanya alat
dan prediksi. Itu keadaan yang jujur, bukan hasil.

## 23 · (c) Pra-promosi #359 + #358 — belum dibuka, tetapi satu syaratnya sudah pasti

Belum saya siapkan: ia menunggu (b) stabil. Satu hal sudah pasti dan saya catat
sekarang supaya tidak hilang: **gerbang 0039 wajib dijalankan ULANG** dengan
`app.unit_ids` ber-scope **SEMUA** unit dan **di luar 02:00–05:00 WIB**. Bukti
13-09 memakai scope `'1'` saja terhadap DB yang salah; itu kesalahan yang sudah
dibayar sekali.

Preflight otomatisnya sudah ada — `scripts/ci/check-snapshot-quiescent.sh`
berjalan **sebelum** `prisma migrate deploy` dan sudah men-scope seluruh unit —
tetapi ia tidak menggantikan pemeriksaan berjadwal oleh manusia di jendela yang
benar.
