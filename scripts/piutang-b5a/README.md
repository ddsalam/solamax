# Piutang B5a — gold-check legacy per pelanggan

Tool ini membandingkan jalur ledger lama di
`solamax:asia-southeast2:solamax-pg` dengan ekspor EasyMax **DAFTAR SALDO
HUTANG PIUTANG**. Ia sengaja dipisah menjadi tiga langkah supaya prediksi tidak
bisa dipengaruhi oleh oracle.

## Kontrak keselamatan

- Koneksi wajib role `dashboard_ro`, non-superuser, tanpa `BYPASSRLS`, dan tanpa
  hak `INSERT`/`UPDATE`/`DELETE` pada ledger maupun tabel sumber pendukung.
- Setiap query dibungkus `BEGIN TRANSACTION READ ONLY` dan diakhiri `ROLLBACK`.
- Target yang diterima hanya `solamax:asia-southeast2:solamax-pg`. Guard membaca
  `pg_control_system().system_identifier` dan mencocokkannya dengan identitas
  produksi yang dipin di `cases.json`; nama database atau label konfigurasi tidak
  dianggap bukti target.
- Tool menolak kata kerja SQL mutasi sebelum memanggil `psql`.
- Nilai produksi hanya masuk ke ledger lokal pada path tetap yang gitignored,
  `verification-queries-results/piutang-b5a/`; path lain ditolak meskipun perintah
  dijalankan dari luar repo. Ledger tidak boleh di-commit atau disalin ke testing.
- Oracle dibuka dengan `openpyxl` dalam mode `read_only=True, data_only=True`.
  Berkas berjudul **LAPORAN PENJUALAN HARIAN** ditolak keras.

## Urutan yang tidak boleh dibalik

Gunakan Python dengan `openpyxl` (lihat `requirements.txt`) dan sediakan
`DATABASE_URL` milik role baca-saja. Bila Cloud SQL Proxy lokal memakai TCP,
set `B5A_PROXY_HOST=127.0.0.1` dan `B5A_PROXY_PORT` sesuai port proxy.

```bash
python3 scripts/piutang-b5a/goldcheck.py \
  --ledger verification-queries-results/piutang-b5a/2026-09-10-goldcheck-v2.jsonl \
  observe-sync
```

Tunggu minimal 180 detik. Langkah berikut mengambil pembacaan kedua dan prediksi
per pelanggan dalam transaksi read-only yang sama. Ia hanya menyegel bila semua
domain sumber B5a (`masters`, `piutang`, `hutang`) mempunyai `last_run_at` dan
sidik keadaan kedua pembacaan identik. Bila keadaan bergerak, observasi baru
di-append dan perintah berhenti; tunggu lalu jalankan lagi.

```bash
python3 scripts/piutang-b5a/goldcheck.py \
  --ledger verification-queries-results/piutang-b5a/2026-09-10-goldcheck-v2.jsonl \
  seal-predictions
```

Ledger JSONL menggunakan rantai SHA-256. Prediksi hanya boleh mempunyai satu
`prediction_seal`; semua observasi dan hasil berikutnya ditambahkan di akhir,
tidak pernah menyunting baris lama. Transisi baca-periksa-append diserialkan
dengan lock per-ledger. Tool otomatis menyegel sedikitnya satu
pelanggan yang saldo akhirnya nol (memprioritaskan yang punya aktivitas), serta
ketiadaan seksi Online Adisucipto.

**Baru setelah seal ada**, terima enam ekspor `.xlsx` dan petakan masing-masing
ke kasus yang tepat:

```bash
python3 scripts/piutang-b5a/goldcheck.py \
  --ledger verification-queries-results/piutang-b5a/2026-09-10-goldcheck-v2.jsonl \
  compare \
  --expect-seal-hash '<SHA256_YANG_DICATAT_DI_CATATAN_SESI>' \
  --oracle '6478101@2026-09-01=/path/adis-2026-09-01.xlsx' \
  --oracle '6478101@2026-09-04=/path/adis-2026-09-04.xlsx' \
  --oracle '6478101@2026-09-09=/path/adis-2026-09-09.xlsx' \
  --oracle '63781002@2026-09-01=/path/28okt-2026-09-01.xlsx' \
  --oracle '63781002@2026-09-04=/path/28okt-2026-09-04.xlsx' \
  --oracle '63781002@2026-09-09=/path/28okt-2026-09-09.xlsx'
```

Parser memeriksa per baris dan per seksi bahwa `SALDO = DEBET - KREDIT`, lalu
membandingkan DEBET, KREDIT, dan SALDO setiap pelanggan dengan toleransi historis
`0,001` rupiah. Setiap seksi wajib mempunyai tepat satu total tercetak. Unit dan
tanggal di header wajib cocok dengan `case_id`, dan satu hash workbook tidak boleh
dipakai untuk dua kasus. Pelanggan/seksi/kasus yang tidak diprediksi adalah hard stop.
Perbedaan biasa juga dicatat append-only lalu menghentikan batch. Arah selisih
yang seluruhnya membuat SolaMax lebih rendah wajib dicurigai sebagai sidik
backfill yang belum selesai, bukan langsung dianggap cacat formula.

Kasus yang pernah gagal tidak boleh dicoba ulang diam-diam. Setelah penyebabnya
dipastikan sebagai kerusakan alat atau berkas dan diperbaiki, ulangi dengan
`--acknowledge-failed UNIT_CODE@YYYY-MM-DD`; status tetap menampilkan seluruh
percobaan gagal agar hasil hijau tidak menutupi workbook-shopping.

Status tanpa membuka oracle:

```bash
python3 scripts/piutang-b5a/goldcheck.py \
  --ledger verification-queries-results/piutang-b5a/2026-09-10-goldcheck-v2.jsonl \
  status
```

## Yang sengaja tidak dilakukan

- Tidak membangun atau membaca snapshot produksi; ini B5a jalur legacy.
- Tidak memulai B5b. B5b baru sah setelah B2/B3 dan bundle benar-benar dipotong
  ke sebagian unit produksi.
- Tidak membangun layar `/keuangan/piutang`; desainnya tetap di `dd69fea` §2.
- Angka runtime dari `solamax:asia-southeast2:solamax-pg-rlsstg` tetap bukti
  fungsional, bukan vonis SLO. Vonis representatif perlu jalur nyata dengan
  `n >= 20`.

## Self-test sintetis

```bash
python3 -m unittest -v scripts/piutang-b5a/test_goldcheck.py
```

Fixture sintetis mencakup seksi Online yang tidak dicetak, pelanggan saldo nol,
judul laporan yang salah, identitas aritmetika yang salah, binding unit/tanggal,
total hilang/duplikat, frase seksi berulang di blok Summary, pelanggan/seksi tak
diprediksi, toleransi, SQL mutasi, identitas target, timeout proses, lock lintas
proses, gerbang seal, anchor seal eksternal, dan integritas rantai append-only.
