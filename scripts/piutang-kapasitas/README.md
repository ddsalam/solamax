# Kapasitas source cut — MEKANISME BERJALAN, bukan obat sekali pakai

Berkas di direktori ini awalnya ditulis sebagai pemulihan darurat. **Statusnya
berubah 14-09-2026**: pemulihan stok pertama sudah dijalankan Dion lewat
`VACUUM FULL` langsung. Yang tersisa di sini adalah perkakas yang dipakai
**berulang**, dan dokumen ini menjelaskan kapan masing-masing dipakai.

---

## Dua sumbu yang TIDAK saling menggantikan

| | Menahan **LAJU** | Memulihkan **STOK** |
|---|---|---|
| Apa | tumpukan berhenti bertambah | berkas mengecil, ruang kembali ke OS |
| Alat | pemicu retirement per jam (Cloud Scheduler) | `03-reclaim.sql` (`VACUUM FULL`) |
| Tanpa yang satunya | berkas tetap besar selamanya; gerbang 9 GB tetap tertutup | tumpukan naik lagi, dan gerbang tertutup lagi beberapa minggu kemudian |

## 🔴 `VACUUM FULL` MENINGGALKAN JEJAK BIAYA PERMANEN — argumen utama, bukan catatan kaki

Puncak `VACUUM FULL` = **lama + baru**. Puncak itu memicu **auto-resize**, dan
**Cloud SQL tidak pernah mengecilkan disk**. Terjadi hari ini, terukur:

| | |
|---|---:|
| disk ter-provision sebelum | 25 GB |
| puncak terpakai saat vacuum kedua (16:05 WIB, masih naik) | **22,15 GB** |
| disk ter-provision **sesudah** | **31 GB** |

⇒ Satu `VACUUM FULL` menaikkan biaya penyimpanan **selamanya**, sekitar
**+6 GB** kali ini. Pada orde US$0,20–0,30/GB/bulan itu **≈ +US$1,2–1,8 per
bulan, permanen, per kejadian** — dan itu belum menghitung kunci ACCESS
EXCLUSIVE yang menahan agent 9–14 menit.

**Karena itu pemensiunan per jam bukan optimasi.** Ia satu-satunya jalan yang
**tidak meninggalkan jejak biaya**: ia menahan tanda-air sebelum naik, sehingga
`VACUUM FULL` tidak pernah perlu dijalankan lagi. Setiap kali kita memilih
"bersihkan nanti dengan vacuum", kita sedang memilih menaikkan tagihan bulanan
secara permanen.

**Ini harus dibaca eksplisit**: pemicu per jam **tidak mengembalikan satu byte
pun** ke OS. `DELETE` hanya menandai tuple mati; `pg_database_size` — persis
angka yang dibaca `databaseReviewBytes` — tidak turun karenanya. Dan sebaliknya,
`VACUUM FULL` tidak menahan laju apa pun: ia hanya menurunkan tanda-air sekali.

Yang membuat 11 GB terjadi adalah tanda-air yang dibiarkan naik berminggu-minggu.
Sesudah lajunya benar, ruang mati dipakai ulang INSERT berikutnya di tabel yang
sama, sehingga berkasnya mengendap di tanda-air barunya dan `VACUUM FULL`
berhenti jadi kebutuhan rutin.

---

## ⚠️ Koreksi 14-09-2026 01:40 — yang menumpuk adalah STAGING, bukan `failed`

Diukur langsung ke produksi: 84 cycle `failed` memegang **NOL baris**.
Pemensiunannya bekerja. Yang menumpuk adalah **`staging`** — 17.674.653 dari
18.082.443 baris `source_bppiut` (**97,7%**), tersebar di 22 cut berumur ±27
jam.

Akibatnya untuk direktori ini: **`02-prune-bertahap.sql` bukan alat utamanya.**
Ia hanya menyentuh cycle `failed`, dan itu memang sudah bersih. Alat utamanya
adalah **pemicu pemensiunan per jam**, yang menandai `staging` → `failed`
sesering cut ditangkap. Rancangannya di
`session-notes/2026-09-14-laju-staging-dan-pemicu-retirement.md`.

`02` tetap berguna sebagai jaring: bila pemensiunan mati beberapa hari lalu
menandai banyak cycle sekaligus, baris `failed`-nya dapat dikuras bertahap
tanpa menabrak budget transaksi aplikasi.

## Kapan menjalankan apa

**`01-ukur.sql` — read-only, jalankan kapan saja, terutama sebelum memutuskan.**
Ia memisahkan `n_live_tup` (PERKIRAAN, di-update autovacuum) dari `count(*)` per
status cycle (SEBENARNYA). Angka "17,6 juta hidup" berasal dari perkiraan; kalau
yang sebenarnya jauh lebih kecil, tidak ada yang perlu dikerjakan.

**`02-prune-bertahap.sql` — ketika tumpukan `failed` menumpuk** (mis. sesudah
pemicu retirement mati, atau sesudah jeda panjang). Ia hanya menyentuh baris
milik cycle `failed`; `complete` dan `staging` tidak tersentuh. Bertahap dan
commit per batch, jadi aman diulang dan aman dihentikan Ctrl-C.

**`04-autovacuum-lag.sql` — tiap jam, sesudah job pemensiunan hidup.**
Read-only. Ia menguji prediksi yang dikunci: apakah berkas benar-benar MENDATAR
sesudah aliran diperbaiki, atau autovacuum tertinggal. Selama deret itu belum
ada, klaim "VACUUM FULL berhenti jadi kebutuhan rutin" adalah dugaan berbaju
kesimpulan. Satu jalanan tunggal tidak menjawab apa pun.

**`03-reclaim.sql` — JARANG.** Hanya bila `01` menunjukkan berkasnya jauh lebih
besar daripada baris hidupnya DAN gerbang 9 GB tertutup. Dalam keadaan sehat,
ini tidak perlu dijalankan lagi.

> ⛔ **JANGAN mendekati 02:00 WIB.** `VACUUM FULL` mengambil ACCESS EXCLUSIVE
> pada tabel yang sedang menerima cut. Pada 14-09-2026 01:02 WIB ia menahan
> **tujuh sesi**, termasuk **lima backend agent di `pg_advisory_xact_lock`
> selama 9-14 menit**. Cron unit 1 mulai 02:05.
>
> ⚠️ **Puncak ruangnya = lama + baru.** `VACUUM FULL` menulis salinan baru
> sebelum melepas yang lama; terpantau 13,97 GB → **16 GB** saat berjalan.
> Kepala ruang harus memuat itu — lihat catatan batas disk di bawah.

**Urutan mengikat**: `02` dulu, baru `03`. Terbalik berarti menulis ulang
seluruh bangkai ke berkas baru, mengunci jauh lebih lama, tanpa hasil tambahan.

---

## Batas pertumbuhan disk — perintah siap-jalan, ANGKANYA MILIK DION

Keadaan sekarang: `dataDiskSizeGb = 25`, `storageAutoResize = True`,
`storageAutoResizeLimit = **0** (tanpa batas)`, `PD_SSD`, `db-g1-small`.

Cloud SQL **tidak pernah mengecilkan** disk. `VACUUM FULL` mengembalikan ruang
ke dalam database, tetapi 25 GB tetap ter-provision dan tetap ditagih. Tanpa
batas, pertumbuhan berikutnya menaikkan tagihan **diam-diam** alih-alih
berbunyi.

```bash
set -euo pipefail
PROJECT_ID=solamax
INSTANCE=solamax-pg
BATAS_GB=50                      # <-- GANTI dengan angka yang Anda putuskan

# Keadaan sebelum, supaya perubahannya dapat dibaca.
gcloud sql instances describe "$INSTANCE" --project="$PROJECT_ID" \
  --format='value(settings.dataDiskSizeGb,settings.storageAutoResize,settings.storageAutoResizeLimit)'

gcloud sql instances patch "$INSTANCE" \
  --project="$PROJECT_ID" \
  --storage-auto-increase \
  --storage-auto-increase-limit="$BATAS_GB"

# VERIFIKASI — jangan percaya bahwa patch memelihara sisanya.
gcloud sql instances describe "$INSTANCE" --project="$PROJECT_ID" \
  --format='value(settings.dataDiskSizeGb,settings.storageAutoResize,settings.storageAutoResizeLimit)'
```

⚠️ `--storage-auto-increase-limit` **harus** disertai `--storage-auto-increase`;
batas tanpa auto-increase yang menyala tidak berarti apa-apa. Dan seperti
pelajaran `--update-headers`: **verifikasi sesudahnya**, jangan andaikan flag
lain terpelihara.

Memilih angkanya — **dengan puncak yang sudah terukur, bukan dikira**:

- **Puncak nyata hari ini: 22,15 GB terpakai** saat memvakum database yang
  sebelum vacuum berukuran ~13,1 GB (`pg_database_size` 15:25 WIB). Jadi puncak
  ≈ **1,7×** ukuran database, ditambah WAL dan temp.
- Dengan pemensiunan per jam menjaga database di sekitar **6–7 GB** (ukuran
  bersih terukur sesudah vacuum pertama: **6,17 GB**), `VACUUM FULL` masa depan
  akan memuncak di sekitar **11–13 GB** terpakai.
- Auto-resize sudah memicu sekali pada 25 GB; disk kini **31 GB**.

Rekomendasi peninjau **~50 GB** konsisten dengan angka itu: ia memuat puncak
terburuk hari ini (22 GB) dengan margin lebih dari dua kali, dan tetap
menghentikan pertumbuhan diam-diam jauh sebelum tagihannya berlipat. **Angkanya
tetap keputusan Dion.**

Dua batas yang saling menarik:

- **Batas bawah yang aman.** Harus memuat puncak `VACUUM FULL` = ukuran lama +
  salinan baru. Terpantau 16 GB saat memvakum tabel terbesar. Batas di bawah
  ~2× tabel terbesar berisiko membuat auto-resize mentok **di tengah** vacuum,
  dan vacuum-nya gagal. Batas yang terlalu ketat mengubah masalah biaya menjadi
  masalah ketersediaan.
- **Biaya.** PD_SSD Cloud SQL di `asia-southeast2` berada pada orde
  **US$0,20–0,30 per GB per bulan** — ⚠️ **perkiraan, bukan kutipan**; konfirmasi
  di <https://cloud.google.com/sql/pricing#asia-southeast2>. Pada orde itu,
  25 GB ≈ US$5–7,50/bulan, dan setiap +10 GB ≈ **US$2–3/bulan**. Selisih antara
  batas 40 GB dan 100 GB karena itu berada di orde belasan dolar per bulan —
  kecil, tetapi ia berulang dan tidak pernah turun sendiri.

Batas ini bukan pengganti perbaikan laju; ia alarm, bukan rem.
