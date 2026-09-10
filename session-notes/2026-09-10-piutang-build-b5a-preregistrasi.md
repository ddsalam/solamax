# SolaMax Piutang — B5a preregistrasi gold-check legacy per pelanggan

Tanggal kerja: 2026-09-10 WIB
Cabang: `codex/piutang-build-b5a` (ditumpuk di atas B4 `5503b83`)
Database: `solamax:asia-southeast2:solamax-pg`
Mode: mutlak read-only; role `dashboard_ro`; nol migrasi dan nol penulisan DB

## Permintaan ekspor untuk Dion

Mohon ekspor **DAFTAR SALDO HUTANG PIUTANG** EasyMax—bukan **Laporan
Penjualan Harian**—dengan batas **saldo akhir hari (`<=`)**, satu berkas `.xlsx`
asli per unit dan tanggal berikut:

| Unit | Kode | Tanggal ekspor |
|---|---|---|
| Adisucipto | `64.781.01` / `6478101` | 1, 4, dan 9 September 2026 |
| 28 Oktober | `63.781.002` / `63781002` | 1, 4, dan 9 September 2026 |

Alasan pemilihan:

- **1 September** adalah batas awal bulan dan punya posting piutang serta hutang
  pada hari itu di kedua unit; ia paling peka terhadap salah `<` versus `<=`.
- **4 September** adalah titik tengah yang terpisah dari batas bulan dan juga
  punya posting kedua ledger pada kedua unit; ia mencegah satu tanggal kebetulan
  menjadi seluruh bukti.
- **9 September** adalah hari penuh terbaru saat pra-registrasi 10 September,
  tetap punya posting kedua ledger, dan sengaja tidak memakai 10 September yang
  masih berjalan.
- **Adisucipto** dipilih sebagai kontrol negatif: prediksi tersegel menuntut seksi
  Piutang Online **tidak dicetak**.
- **28 Oktober** dipilih sebagai kontrol positif lintas-seksi: unit ini mempunyai
  pelanggan berkode bertitik/Online yang nyata.

### Kewaspadaan sebelum oracle dibuka

Tanggal **9 September 2026 adalah hari-ini−1** saat prediksi disegel. Full-sync
akan menarik koreksi back-dated, tetapi entri POS untuk tanggal itu masih dapat
bertambah setelah seal. Jika kelak **hanya 9 September yang menyimpang** sementara
1 dan 4 September cocok, hipotesis pertama adalah entri yang menyusul—bukan cacat
formula atau reader. Prediksi tetap tidak boleh disunting; keadaan sumber harus
dibaca ulang dan temuan dilaporkan sebagai bukti baru yang di-append.

Mohon jangan mengubah angka, formula, tata letak, atau menggabungkan keenam
ekspor. Nama berkas bebas; pemetaan unit/tanggal akan diberikan eksplisit ke alat.

## Kontrak bukti sebelum oracle

1. `sync_state.last_run_at` untuk **seluruh tiga domain sumber saldo B5a**—
   `masters`, `piutang`, `hutang`—harus hadir dan identik pada dua pembacaan
   berjarak minimal 180 detik. Sidik juga mencakup `last_row_count` dan
   `last_watermark`.
2. Pembacaan kedua dan prediksi per-pelanggan diambil dalam transaksi read-only
   yang sama. Perubahan sidik membuat alat meng-append observasi baru lalu STOP;
   prediksi tidak disegel.
3. Prediksi, kontrol nol, dan kontrol seksi absent ditulis ke ledger JSONL privat
   yang gitignored dan dirantai SHA-256. Satu `prediction_seal` saja; hasil oracle
   kelak hanya boleh di-append.
4. Oracle baru boleh dibuka sesudah seal. Parser independen memakai `openpyxl`,
   memeriksa tiap baris dan total seksi: `SALDO = DEBET - KREDIT`.
5. Perbandingan adalah per pelanggan untuk DEBET, KREDIT, dan SALDO—bukan hanya
   total. Toleransi `0,001` rupiah mengikuti gold-check per-pelanggan historis dan
   tetap menangkap selisih setengah rupiah.
6. Pelanggan, seksi, atau kasus yang dikembalikan oracle tetapi tidak ada dalam
   prediksi adalah hard stop. Bila semua delta hanya membuat prediksi SolaMax
   **lebih rendah dan tak pernah lebih**, diagnosa pertama adalah backfill belum
   selesai—sidik kegagalan sesi 28 Oktober—bukan penyesuaian formula.

Implementasi: `scripts/piutang-b5a/`; ledger privat:
`verification-queries-results/piutang-b5a/2026-09-10-goldcheck-v2.jsonl`.

## Status batas fase

- B5a: preregistrasi v2 selesai; menunggu enam ekspor Dion.
- B5b: **belum dimulai**; menunggu cut nyata B2/B3 + penggantian bundle di
  sebagian unit produksi.
- Layar `/keuangan/piutang`: **belum dibangun**; B4 hanya membangun jalur baca.
  Rancangan tetap `dd69fea` §2.
- Runtime `solamax:asia-southeast2:solamax-pg-rlsstg`: bukti fungsional saja;
  bukan SLO. Vonis representatif menunggu jalur nyata `n >= 20`.

## Hasil seal awal — dipertahankan sebagai riwayat, tidak dipakai membandingkan

Prediksi berhasil disegel tanpa membuka satu pun oracle:

- observasi `sync_state` sequence 1 dan 2 berjarak **352,136797 detik**;
- sidik `last_run_at` + `last_row_count` + `last_watermark` ketiga domain pada
  kedua unit **identik**;
- role aktual `dashboard_ro`, `transaction_read_only=on`, bukan superuser, tanpa
  `BYPASSRLS`, tanpa hak mutasi ledger;
- 300 baris prediksi per-pelanggan tersegel dalam enam kasus;
- seal sequence 3:
  `3821fee539908e47431e93cc30f00f814eb55df64337255171388ea46a8c14d3`.

Grain yang akan dicocokkan:

| Unit/tanggal | Lokal | Online | Hutang |
|---|---:|---:|---:|
| 28 Oktober · 01-09 | 49 | 13 | 33 |
| 28 Oktober · 04-09 | 49 | 13 | 33 |
| 28 Oktober · 09-09 | 49 | 13 | 33 |
| Adisucipto · 01-09 | 3 | **absent** | 2 |
| Adisucipto · 04-09 | 3 | **absent** | 2 |
| Adisucipto · 09-09 | 3 | **absent** | 2 |

Kontrol negatif tersegel:

- `PLG0458`, Hutang Lokal 28 Oktober: punya aktivitas DEBET/KREDIT tetapi saldo
  akhir **nol** pada ketiga tanggal;
- Piutang Online Adisucipto: **tidak dicetak** pada ketiga tanggal.

Ledger privat tetap gitignored; tabel ini hanya memuat jumlah baris dan identitas
kontrol, bukan nilai saldo produksi. Langkah berikutnya hanya menerima enam
berkas EasyMax dari Dion lalu menjalankan `compare`. Prediksi tidak boleh diubah.

## Seal v2 — ditambahkan sesudah hardening review

Review adversarial menemukan guard target lama hanya memulangkan label produksi
yang ditulis sendiri oleh query. Ledger awal tetap utuh dan tidak pernah membuka
oracle, tetapi tidak dipakai untuk perbandingan karena kontrak konfigurasi telah
diperkuat. Tidak ada baris lama yang disunting atau disegel ulang.

Ledger v2 baru membuktikan identitas koneksi dari PostgreSQL sendiri:

- instance lengkap: `solamax:asia-southeast2:solamax-pg`;
- `pg_control_system().system_identifier` aktual dan yang dipin:
  `7650126488674766864`;
- role aktual `dashboard_ro`, `transaction_read_only=on`, bukan superuser, tanpa
  `BYPASSRLS`, dan tanpa hak `INSERT`/`UPDATE`/`DELETE` pada `bppiut`, `bphut`,
  `pelanggan_master`, maupun `sync_state`;
- observasi sequence 1 dan 2 berjarak **206,599298 detik** dengan fingerprint
  identik `dcbf776de44c1de1f5ab6199caffea1b1fa490767378ce7b2339c9335fdd831c`;
- 300 baris prediksi untuk enam kasus, kontrol nol `PLG0458` Hutang Lokal
  28 Oktober, dan kontrol absent Piutang Online Adisucipto;
- seal v2 sequence 3, yang menjadi anchor wajib saat `compare`:
  `51f40bc4bdfd66cc09c4715d140b98e125039152b8be2ed634041c14c5ced6ea`.

Status v2 saat catatan ini ditambahkan: `oracle compared: 0/6`, nol percobaan
gagal, dan keenam kasus masih pending. Parser belum membuka satu pun berkas
EasyMax.
