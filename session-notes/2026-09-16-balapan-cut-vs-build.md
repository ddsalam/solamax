# Balapan cut-vs-build — mekanisme, empat pilihan, dan alarm yang menutupinya

Tanggal: 2026-09-16 · Worker: Claude Opus 5

---

## 1 · Mekanismenya, dibuktikan dari kode (bukan disimpulkan dari gejala)

`runOnce` menjalankan tiga hal **berurutan dalam satu invokasi**:

| Urutan | Apa | Berkas |
|---|---|---|
| 1 | `collectRetiredSources` | `snapshot-worker.service.ts:346` |
| 2 | gerbang operasional | `:354` |
| 3 | `finalizeReady` | `:366` |

- Langkah 1 memakai `FAIL_SUPERSEDED_STAGING_CYCLES_SQL`, yang menjatuhkan
  **setiap** cut `staging` ber-sequence **di bawah alokasi terbaru** —
  kesiapannya tidak diperiksa sama sekali.
- Langkah 3 memakai `READ_READY_SOURCE_CYCLE_SQL`, yang hanya mau memfinalisasi
  cut staging yang **siap** (ketiga domain + ketiga checksum ada).

⇒ Bila alokasi terbaru sedang diunggah saat build berjalan, **seluruh cut ready
yang lebih tua baru saja dijatuhkan pada langkah 1, di invokasi yang sama**.
Tidak ada yang bisa difinalisasi. Worker memulangkan `idle` — sah, tenang, dan
tak terlihat.

Jendela sukses sebuah unit karena itu = selang antara "cut terbaru menjadi siap"
dan "cut berikutnya dialokasikan" — paling lama satu cadence agent (1 jam) — dan
**build menyicipnya pada SATU menit tetap, sekali sehari.**

Batu Layang 16-09: cut seq 7 mulai 02:33:31, build 02:35 saat masih mengunggah,
cut berikutnya menggusurnya. Nol cut `complete`, nol manifest, nol work.
Kotabaru dua hari sebelumnya: balapan yang sama, kalah berulang.

### Yang WAJIB saya luruskan: ini bukan regresi dari pemensiunan per jam saya

Karena langkah 1 berjalan **tepat sebelum** langkah 3 di invokasi yang sama,
himpunan cut yang dijatuhkan pada saat build **identik** baik pemensiunan
berjalan per jam maupun sekali sehari. Perubahan saya mempercepat penghapusan
BARISnya, bukan mengubah keadaan pada saat build. **Balapan ini struktural dan
mendahului perubahan itu.** Saya memeriksanya sebelum menulis kalimat ini,
karena godaannya besar untuk menyalahkan perubahan yang paling baru.

## 2 · Empat pilihan, dengan biayanya

| | Pendekatan | Yang didapat | Yang dibayar |
|---|---|---|---|
| **(a)** | **Build menunggu** cut terbaru selesai diunggah, dalam invokasi | kecil, tanpa perubahan jadwal | memakan anggaran build; tak menolong bila unggahan lebih lama dari tunggunya; **tidak menyentuh** aturan "hanya yang terbaru bertahan" — hanya memperlebar peluang |
| **(b)** | **Finalisasi dipisah** dari build, dijalankan endpoint retire per jam | cut mencapai `complete` dalam ±1 jam sejak siap, lepas dari menit build | `finalizeReady` melakukan diff cut-penuh + propagasi dirty + fan-out antrean, dan komentarnya sendiri menyebut itu **sengaja** di dalam jendela operasional *"so HTTP ingest never waits for full-cut diff"*. Memindahkannya ke tiap jam memindahkan beban itu ke jam kerja. **Belum diukur** |
| **(c)** | **Slot build dijauhkan** dari siklus cut | tanpa perubahan kode | cadence agent tidak terpaku jam dinding dan bergeser; offset tetap hanya **menurunkan** peluang tabrakan, tak menghapusnya. Menuntut penyetelan per unit yang akan basi |
| **(d)** | **Pemensiunan berhenti membunuh cut READY terbaru** — predikatnya mempertahankan cut staging ber-sequence tertinggi yang sudah siap, di samping alokasi terbaru | menyerang mekanismenya langsung: selalu ada kandidat untuk difinalisasi, walau alokasi terbaru sedang diunggah | satu cut tambahan tertahan (**±144 MB**), dan hanya selama ada unggahan berjalan |

**Rekomendasi saya: (d) utama, (a) sebagai sabuk, (b) hanya bila pengukuran
menunjukkan finalisasi cukup ringan, (c) ditolak.**

Alasan (d) di atas yang lain: ia tidak memindahkan beban ke jam kerja, tidak
bergantung pada penyetelan waktu yang akan basi, dan memfinalisasi cut ready
yang sedikit lebih tua tetap **potret yang konsisten** dari momen lebih awal —
jauh lebih baik daripada tidak ada snapshot sama sekali.

**Batas (d) yang harus ikut**: bila agent mengunggah terus-menerus dan **tidak
ada** cut yang pernah mencapai siap, (d) tetap gagal. Itu masalah berbeda dan
lebih keras — dan alarm §3 yang akan menyebutnya.

**Tidak saya kerjakan sendiri.** (d) mengubah semantik pemensiunan, yang
dirancang sengaja (*"Retirement must not depend on a cut ever reaching
complete"*). Permintaannya berbunyi **rancang**; ini rancangannya.

## 3 · Alarm yang menutupi kebutaannya — DIBANGUN

Gerbang cakupan menangkap **"unit TANPA job"**. Ia buta terhadap **"unit PUNYA
job tetapi selalu `idle`"** — dan itulah bentuk Batu Layang.

Endpoint pemensiunan per jam kini memulangkan dan mencatat, per unit:

```json
{"unit_id":5,"oldest_cut_hours":48,"complete_age_hours":null,"stale_cut":true}
```

`stale_cut` menyala ketika unit **sudah lama mengirim cut** (`oldest_cut_hours >
26`) **DAN** tidak punya cut `complete` yang segar. Ambangnya menuntut **kedua**
syarat dengan sengaja: unit yang bundle-nya baru ditukar beberapa jam lalu memang
belum punya cut complete, dan berbunyi untuknya akan membuat **setiap hari
penukaran jadi alarm palsu**. 26 jam = satu siklus build penuh plus margin.

`stale_cut` ikut menyalakan `staging_review`, sehingga barisnya ditulis
`logger.warn` dan terlihat oleh penyaring severity Cloud Logging — **tanpa
siapa pun membuka psql**.

Dibuktikan dua arah: unit 5 (48 jam mengirim, nol complete) → `staging_review`
true, satu `warn`; unit 6 (3 jam, nol complete, baru ditukar) → **diam**.
Melepas `staleCut` dari penentu review menjatuhkan uji itu.

## 4 · Unit 1 — dua pointer `pending_replacement`, `stale_invalid_from` 2023-03-27

Bukan kerusakan: ada baris ledger bertanggal Maret 2023 yang berubah, dan mesin
invalidasi menandainya **dengan benar**. Dua pelanggaran kontinuitas adalah
konsekuensinya, bukan penyebab terpisah.

Ia **tidak akan sembuh sendiri**: koreksi sejauh itu berada di luar jendela
backfill, dan `maxDays 31` pun tidak menjangkau 2023.

⚠️ Satu akibat yang belum disebut dan layak masuk pertimbangan: `pending_replacement`
adalah **yang menyalakan banner "Data sedang diperbarui"**. Dua tanggal itu akan
menampilkan banner itu **selamanya** sampai flagnya hilang — alarm yang selalu
menyala, di layar pengguna, bukan di log.

| | Pilihan | Yang didapat | Yang dibayar |
|---|---|---|---|
| **A** | biarkan | nol pekerjaan, nol risiko | dua tanggal menampilkan "sedang diperbarui" tanpa akhir; kontinuitas tetap melanggar; setiap pemeriksaan berikutnya harus mengingat pengecualian ini |
| **B** | lebarkan `maxDays` sampai menjangkau 2023 | koreksinya masuk; flag bersih | backfill ±1.270 hari per unit; beban besar; **dan ini bagian dari pertanyaan beku/tidak-beku yang sama**, bukan keputusan teknis terpisah |
| **C** | rebuild terarah hanya dua tanggal itu, sekali | murah, tepat sasaran | butuh jalur manual di luar jendela yang teraudit — persis kelas tindakan yang arc ini batasi |
| **D** | bersihkan flag tanpa rebuild | banner berhenti | **angka tetap basi sementara layar berhenti mengatakannya** — menukar alarm yang selalu menyala dengan kebohongan diam. Saya sebut supaya lengkap, bukan sebagai kandidat |

**Saya tidak memilih.** Ini satu paket dengan pertanyaan beku/tidak-beku yang
sudah menunggu.
