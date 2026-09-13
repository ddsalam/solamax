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

```bash
set -euo pipefail
PROJECT_ID=solamax; REGION=asia-southeast2; SERVICE=solamax-ingest-staging
URL="$(gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)')"
test -n "$URL"
test -n "${SNAPSHOT_SECRET:?siapkan lewat prosedur tepercaya yang sudah ada}"

gcloud scheduler jobs create http solamax-snapshot-retire-unit-1 \
  --project="$PROJECT_ID" --location="$REGION" \
  --description="Pemensiunan source cut per jam (SEMENTARA: lewat /snapshot-worker; 425 = normal)" \
  --schedule='20 0,1,5-23 * * *' --time-zone=Asia/Pontianak \
  --uri="$URL/snapshot-worker" --http-method=POST \
  --headers="Content-Type=application/json,x-snapshot-secret=${SNAPSHOT_SECRET}" \
  --message-body='{"unit_id":1}' \
  --attempt-deadline=300s --max-retry-attempts=0 --format='value(name)'
```

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
