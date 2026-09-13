# Kapasitas source cut (insiden) · keputusan indeks F1 · pemisahan secret

Tanggal: 2026-09-14 · Worker: Claude Opus 5 · Branch `codex/piutang-0039-p3009`

---

## 1 · INSIDEN: build snapshot BEKU, bukan sekadar lambat

Produksi 14-09 ~01:00 WIB: `pg_database_size` = **13.968.694.295 B (13,97 GB)**
melawan `databaseReviewBytes` = **9.000.000.000 B**.

Yang belum tertulis di tempat lain, dan yang mengubah derajatnya:
`evaluateOperationalGate` memeriksa batas byte **PALING AWAL**
(`snapshot-builder.service.ts:192-194`), **sebelum** jendela jam. Jadi
`disk_review_required` memulangkan skip pada **setiap** invokasi, pada jam
berapa pun. ⇒ **Tidak ada snapshot baru yang dapat dipublikasikan sejak DB
melewati 9 GB.** Ini insiden berjalan, bukan utang teknis.

Terkonfirmasi di log Cloud Run: invokasi 12–13 September berakhir
`status:"skipped"` berulang kali. Tetapi **sebabnya tidak pernah tercetak** —
baris lognya hanya memuat `status`. `disk_review_required` (pipeline beku) dan
`outside_build_window` (normal, 21 dari 24 jam) **tidak dapat dibedakan dari
log**. Itu diperbaiki di commit ini.

### 1.1 · Prediksi saya yang MELESET

Sesi sebelumnya saya menulis "puncak ≈ 7,4 GB". Salah, dan cara salahnya
penting: saya memodelkan **aliran** (24 cut/hari × ~310 MB) dan mengabaikan
**stok**. `DELETE` tidak pernah mengecilkan berkas; ia hanya menandai tuple
mati. Jadi bahkan pemensiunan yang bekerja sempurna pun **tidak menurunkan
`pg_database_size`** — dan itulah angka yang dibaca gerbang. Model aliran tidak
dapat meramalkan angka stok, berapa pun telitinya.

Saya juga menurunkan ~310 MB/cut dari kalimat "7,2 GB" di komentar kode dan
menandainya sebagai turunan. Ia tetap turunan yang salah arah.

### 1.2 · Dua masalah terpisah, dua obat terpisah

| | Masalah | Obat | Siapa |
|---|---|---|---|
| **Aliran** | pemensiunan 1×/hari melawan alokasi ~1×/jam | pemicu retirement per jam | Dion (Scheduler) |
| **Stok** | 11 GB berkas yang mayoritas tuple mati | `VACUUM FULL` **sekali** | Dion (DB) |
| **Tebing** | prune tak berbatas di transaksi ber-budget | batch + commit per batch | ✅ commit ini |
| **Kebutaan** | sebab skip tak terlihat | `reason` masuk log | ✅ commit ini |

**Kenapa ini BUKAN "VACUUM FULL tiap beberapa hari".** Sesudah aliran
diperbaiki, baris hidup mengendap di ~1–2 cut. Ruang mati yang ditinggalkan
DELETE **dipakai ulang** oleh INSERT berikutnya di tabel yang sama, jadi berkas
itu berhenti tumbuh pada tanda-air barunya. Satu kali reclaim menurunkan
tanda-air itu; aliran yang benar menjaganya tidak naik lagi. Yang membuat 11 GB
terjadi adalah tanda-air yang dibiarkan naik selama berminggu-minggu, bukan
sifat DELETE.

### 1.3 · Urutan yang MENGIKAT

1. **Pemicu retirement per jam** — supaya tumpukan tidak tumbuh lagi selama
   pemulihan. Berjalan dengan kode yang SUDAH ter-deploy: pemensiunan berjalan
   **sebelum** gerbang (`snapshot-worker.service.ts:240-252`), dan build sendiri
   dibatasi jendela jam, jadi invokasi tambahan **memensiunkan tanpa membangun**.
2. **`scripts/piutang-kapasitas/01-ukur.sql`** — read-only. Ia memisahkan
   `n_live_tup` (PERKIRAAN) dari `count(*)` per status cycle (SEBENARNYA).
   Angka "17,6jt hidup" berasal dari perkiraan; kalau yang sebenarnya ~8jt,
   pengurasan saja sudah cukup dan reclaim-nya jauh lebih murah.
3. **`02-prune-bertahap.sql`** — menghapus baris cycle `failed` saja, bertahap,
   commit per batch. Aman diulang, aman di-Ctrl-C.
4. **`03-reclaim.sql`** — `VACUUM FULL` ketiga tabel, SESUDAH langkah 3.
   Terbalik berarti menulis ulang seluruh bangkai dan mengunci jauh lebih lama
   tanpa hasil.

**Biaya & kunci.** `VACUUM FULL` mengambil **ACCESS EXCLUSIVE**: `/ingest`
piutang/hutang MEMBLOKIR selama ia jalan. Karena langkah 3 sudah membuang baris
mati, yang ditulis ulang hanya baris hidup. Disk instance **25 GB** (sudah
auto-resize dari 10 GB) dengan database ~14 GB ⇒ kepala ruang cukup.

**Kenapa hanya `failed` di skrip operator**: cabang `complete` punya tiga
`NOT EXISTS` yang halus (manifest building, work aktif, dirty). Menyalinnya ke
skrip operator berarti dua definisi yang bisa menyimpang diam-diam. Tumpukannya
ada di `failed`, dan `failed` tidak ambigu.

### 1.4 · Diverifikasi, bukan dijanjikan

Dijalankan atas PostgreSQL 16.15 lokal dengan fixture 7 cycle (5 `failed`,
1 `complete`, 1 `staging`):

```
sebelum : complete=12.000  failed=60.000  staging=12.000   bppiut 18 MB
02-kuras: failed 60.000 bppiut + 15.000 bphut dihapus; complete & staging UTUH
sesudah : complete=12.000  staging=12.000                  bppiut 18 MB   ← DELETE tidak mengembalikan ruang
03-vacuum: bppiut 18 MB -> 4.344 kB · bphut 4.616 kB -> 1.120 kB
           database 33 MB -> 16 MB
```

Baris "tetap 18 MB sesudah DELETE" itu justru bukti klaim inti §1.1.

### 1.5 · Temuan sampingan: disk hanya bisa membesar

`settings.storageAutoResize = True`, `storageAutoResizeLimit = 0` (**tanpa
batas**), `dataDiskSizeGb = 25`. Disk sudah tumbuh dari 10 GB. Cloud SQL
**tidak pernah mengecilkan** disk: `VACUUM FULL` mengembalikan ruang ke dalam
database, tetapi 25 GB tetap ter-provision dan tetap ditagih. Dan tanpa batas,
tidak ada yang menghentikan pertumbuhan berikutnya — biayanya naik diam-diam,
bukan gagal terlihat. **Usul (Dion): pasang `storageAutoResizeLimit`** pada
angka yang disepakati, supaya pertumbuhan tak terduga berbunyi alih-alih
menagih.

---

## 2 · Keputusan indeks F1 — di atas angka Anda

Terukur (produksi, `dashboard_app`, READ ONLY):

```
bppiut 572 MB / 2.793.048 baris   ·   bphut 108 MB / 544.419 baris
probe  1,69 s                     ·   0,91 s            = 2,6 s per unit
Parallel Bitmap Heap Scan lewat *_unit_id_dtgl_idx; ingested_at hanya Filter
Rows Removed by Filter 135.930 / 100.086
berubah sejak cut: 206 / 69 — SELURUHNYA material
pg_stats untuk ingested_at: 0 BARIS      nol indeks pada ingested_at
```

**Keputusan: TIDAK menambah indeks sekarang.** Tiga alasan, berurutan:

1. **`pg_stats` nol baris berarti keputusannya belum bisa diambil.** Tanpa
   statistik, planner memakai selektivitas default untuk `ingested_at > k`.
   Lebih menentukan lagi: **viabilitas BRIN bergantung pada `correlation` — dan
   `correlation` justru statistik yang tidak ada.** Mengusulkan DDL sekarang
   berarti memilih antara BRIN dan btree tanpa angka yang membedakannya.
   `ANALYZE` murah dan tidak mengunci; ia sudah saya selipkan ke
   `03-reclaim.sql` supaya ikut jalan tanpa putaran tambahan.
2. **Gerbang kapasitasnya sedang tertutup.** Menambah ~80–107 MB btree
   (perkiraan aritmetika untuk 2,79jt + 544rb baris) ke database yang sedang
   5 GB di atas gerbangnya adalah urutan yang salah, sekecil apa pun angkanya.
3. **Probenya sudah cukup cepat untuk pemakaian yang dimaksud.** 2,6 s per unit
   terlalu mahal untuk tiap render — dan memang tidak akan dipasang begitu.

**Bentuk pemasangan yang saya usulkan** (belum dibangun): probe dijalankan
**di luar jalur render**, hasilnya di-cache pendek per (unit, tanggal), dan
banner membaca cache. Dengan itu F1 bisa hidup **tanpa DDL sama sekali**.

Angka yang akan membalikkan keputusan ini: kalau sesudah `ANALYZE`
`correlation` untuk `ingested_at` tinggi, **BRIN** memberi hampir seluruh
manfaatnya dengan ukuran puluhan KB dan beban tulis ~nol — itu layak dipasang
bahkan tanpa kebutuhan mendesak. btree ~100 MB hanya layak kalau probe harus
sub-detik di jalur render, dan itu bukan rancangan yang saya usulkan.

⚠️ **Koreksi dokumen**: angka "2.134 MB" (`table-config.ts:47`) BASI untuk
`bppiut`; per 14-09 ia 572 MB dengan baris hidup nyaris sama seperti 5 Agustus
(2.786.477 → 2.793.048). Yang hilang bangkainya, bukan datanya — bukti
`skipUnchanged` bekerja. Ditandai di sumbernya; sesi ini **nyaris merancang
probe di atas ledger 2.134 MB yang sudah tidak ada**.

---

## 3 · Satu rahasia untuk dua batas kepercayaan (usul pemisahan)

Rotasi sudah Anda selesaikan. Yang tersisa sebagai **temuan desain**: secret
`solamax-warm-board-secret` mengikat **dua peran berbeda**:

- `SNAPSHOT_TRIGGER_SECRET` pada backend — mengizinkan **menjalankan pekerjaan
  membangun snapshot** (menulis, mahal, memegang lease global);
- `WARM_BOARD_SECRET` pada dashboard — mengizinkan **memanaskan cache papan**
  (baca, murah).

Konsekuensinya nyata dan sudah terasa di rotasi ini: satu kebocoran memaksa
**dua service** diputar, dan pemegang kredensial "hanya untuk warm cache"
sesungguhnya memegang pemicu builder. Kewenangannya tidak sebanding dengan
namanya.

**Usul**: pisahkan menjadi dua secret dengan siklus rotasi sendiri. Biayanya
satu secret baru + satu binding + satu pembaruan header job; imbalannya
kebocoran salah satu berhenti menjadi kejadian dua-service, dan ruang
lingkupnya kembali sesuai namanya. Bukan pekerjaan sesi ini — butir tersendiri.

---

## 4 · Gerbang Postgres 14 → 16 (keputusan Anda, dijalankan)

`snapshot-postgres-14` → **`snapshot-postgres-16`**, `image: postgres:16`, dan
asersi versi di `snapshot-v2.postgres.test.ts` dipatok `160000 ≤ v < 170000`.

**Dijalankan terhadap PostgreSQL 16.15 lokal sebelum di-commit: 18/18 lulus.**
Tidak ada satu pun uji yang bergantung pada perilaku 14. Tidak ada yang
ditambal.

---

## 5 · Keputusan yang saya ambil sendiri

| Keputusan | Alasan |
|---|---|
| Pemensiunan dibuat berbatas + bertahap **sekarang**, bukan diusulkan | Mode kegagalannya senyap DAN total; produksi sudah berjalan di 83–95% budget. Yang hilang bukan kecepatan, melainkan seluruh kemajuan. |
| Skrip operator hanya menyentuh cycle `failed` | Menghindari dua definisi pemensiunan yang bisa menyimpang. Tumpukannya memang di sana. |
| Indeks `ingested_at` **tidak** diusulkan | `pg_stats` nol baris ⇒ BRIN vs btree belum dapat dibedakan; `ANALYZE` diselipkan ke skrip reclaim supaya angkanya ada tanpa putaran tambahan. |
| Komentar `table-config.ts` dikoreksi, angka lama **dibiarkan berdiri** | Angka 2.134 MB adalah SEBAB keputusan `skipUnchanged`; yang salah adalah memakainya sebagai ukuran hari ini. |
| Partisi tabel source **tidak** diusulkan | `DROP PARTITION` memang mengembalikan ruang tanpa VACUUM, tetapi satu kali reclaim + aliran yang benar sudah menyelesaikan masalahnya. Mengonversi tiga tabel ber-RLS FORCE adalah risiko yang tidak dibeli manfaat tambahan. |

---

## 6 · Yang butuh Dion

1. **Jalankan pemulihan kapasitas**, berurutan: pemicu retirement per jam →
   `01-ukur.sql` → `02-prune-bertahap.sql` → `03-reclaim.sql`. Kirim keluaran
   `01` dan `03`; `01` juga menyelesaikan pertanyaan "17,6jt hidup itu
   perkiraan atau sebenarnya", dan `03` memulangkan `correlation` yang
   memutuskan BRIN vs btree.
2. **`storageAutoResizeLimit`** (§1.5) — angka berapa?
3. **Pemisahan secret** (§3) — butir tersendiri, silakan dijadwalkan.
4. Promosi ke `main` tetap beku sampai §1 pulih. Tidak diusulkan.

---

# Adendum 14-09-2026 ~01:30 WIB — keadaan berubah saat sesi berjalan

## A · `VACUUM FULL` sedang berjalan, dan ia SEHAT

Log Cloud SQL pid `1583585`, 01:29 WIB: `VACUUM FULL VERBOSE
app.saldo_pelanggan_source_bphut` sedang pada fase membangun ulang indeks —
pesan yang menyertainya `LOG: temporary file … size 53100544` (≈50–64 MB per
berkas) adalah luberan sort untuk indeks, **bukan galat**. Empat baris
`STATEMENT:` yang menyertainya sempat terlihat seperti kegagalan; ternyata
lampiran biasa dari pesan `LOG`. Tidak ada ERROR pada sesi itu.

## B · ⚠️ Risiko yang harus dibaca SEBELUM 02:05 WIB

**`VACUUM FULL` hanya membuang tuple MATI. Ia tidak membuang baris cycle
`failed` yang belum pernah di-`DELETE` — baris itu HIDUP, dan ia akan
menulisnya ulang, bukan melepasnya.**

Angka Anda: `source_bppiut` 17,6jt hidup / 15,1jt mati; `source_bphut` 2,3jt /
11,1jt. Kalau angka "hidup" itu benar, sebagian besarnya justru baris milik 84
cycle `failed` yang belum terkuras. Perkiraan hasilnya:

| | sebelum | ditulis ulang (baris hidup) |
|---|---:|---:|
| `source_bppiut` | 8.074 MB | ~4.400 MB |
| `source_bphut` | 3.285 MB | ~600 MB |
| **database** | **13,97 GB** | **~8 GB** |

⇒ **~8 GB melawan gerbang 9 GB: lolos, tetapi dengan kepala ruang ~1 GB.**
Dengan ~24 cut/hari, satu sampai dua hari sudah cukup untuk menutupnya lagi.

Bila sebaliknya "17,6jt hidup" ternyata `n_live_tup` yang meleset dan yang
sebenarnya ~8jt, hasilnya ~6 GB dan kepala ruangnya nyaman. **`01-ukur.sql`
yang memutuskan mana dari keduanya**, dan ia read-only.

**Akibat urutan yang terpakai.** Runbook menuntut `02-prune-bertahap` DULU baru
`03-reclaim`; malam ini urutannya terbalik. Konsekuensinya bukan kerusakan,
melainkan ongkos: bila baris `failed` memang masih hidup, ia baru bisa dibuang
sesudah ini, dan pelepasan ruangnya menuntut reclaim **kedua**. Itu bukan
alasan menjalankan reclaim kedua malam ini — lihat peringatan lock.

## C · Yang saya sarankan untuk malam ini

1. **Jangan menjalankan reclaim kedua menjelang 02:05.** Kunci ACCESS EXCLUSIVE
   dipegang sampai vacuum commit; malam ini ia sudah menahan lima backend agent
   9–14 menit. Cron 02:05 yang menabraknya akan menghabiskan timeout Cloud Run
   20 menit. Kehilangan satu malam build jauh lebih murah daripada menahan
   agent lagi.
2. **Biarkan cron 02:05 berjalan.** Bila §B benar, gerbang byte kini TERBUKA
   dan ini menjadi build pertama sejak pembekuan. Sebabnya akan terbaca:
   dengan perubahan di PR #359 belum ter-deploy, lognya masih hanya menulis
   `status`, jadi periksa **status HTTP**-nya — 425 berarti gerbang jam
   (normal), apa pun selain 2xx/425 layak dibaca.
3. **Sesudah itu**, pada jam sepi: `01-ukur.sql` → bila baris `failed` masih
   hidup, `02-prune-bertahap.sql` → baru pertimbangkan reclaim kedua.

## D · Posisi skrip diperbarui

`scripts/piutang-kapasitas/README.md` menuliskan peran barunya: **mekanisme
berjalan, bukan obat sekali pakai**, dengan dua sumbu yang eksplisit tidak
saling menggantikan — pemicu per jam menahan **LAJU** dan tidak mengembalikan
satu byte pun; `VACUUM FULL` memulihkan **STOK** dan tidak menahan laju apa pun.

## E · Batas disk — perintah siap, angkanya milik Dion

Ada di `README.md`. Dua batas yang saling menarik, dan yang satu mudah
terlupakan: **batas yang terlalu ketat mengubah masalah biaya menjadi masalah
ketersediaan**, karena puncak `VACUUM FULL` = lama + baru (terpantau 13,97 →
16 GB). Batas di bawah ~2× tabel terbesar berisiko membuat auto-resize mentok
di tengah vacuum. Biaya PD_SSD ditulis sebagai **orde US$0,20–0,30/GB/bulan —
perkiraan, bukan kutipan**, dengan tautan halaman harga untuk dikonfirmasi.

## F · Observabilitas gerbang (§4) — selesai

- `reason` masuk baris log (putaran sebelumnya).
- **HTTP dibedakan**: `disk_review_required` → **507**, `operational_gate_unavailable`
  → 503, sebab normal tetap **425** supaya arti lamanya tidak bergeser.
- **Severity dibedakan**: skip insiden ditulis `logger.warn`, sehingga penyaring
  severity Cloud Logging melihatnya.
- **Sebab tak dikenal = insiden (500)**, bukan normal.
- Ujinya **membaca literal `reason:` dari sumber**, jadi sebab baru yang lupa
  diklasifikasikan menjatuhkan CI — bukan daftar salinan tangan. Ia juga membawa
  kontrol atas dirinya sendiri, supaya regex yang berhenti cocok tidak membuat
  seluruh pemeriksaan lulus hampa.
- Dibuktikan MERAH dua arah (disk dikembalikan ke 425 → 2 uji jatuh; sebab baru
  tanpa klasifikasi → 1 uji jatuh), hijau lagi sesudah dipulihkan.
