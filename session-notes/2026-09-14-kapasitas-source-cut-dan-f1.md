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
