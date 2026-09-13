# Piutang Fase 2 — keputusan, verifikasi, dan usulan Fase 3

Status: implementasi D → C → B selesai, masing-masing telah di-commit dan memiliki PR ke `staging` dengan CI hijau. Dion yang merge berurutan D → C → B. H1 tetap menunggu laporan EasyMax 12 September; tidak ada deployment, migrasi manual, atau perubahan Scheduler yang dijalankan dalam tugas ini.

## H1 dan diagnosis

H1 masih menunggu laporan EasyMax IB per 12-09-2026. Ekspektasi total dan per pelanggan sudah dikunci di ralat Gerbang A. Tidak ada laporan yang dicetak/dicetak ulang oleh worker. Bukti diagnosis yatim ditulis dalam `2026-09-13-piutang-fase2-diagnosis-yatim.md` beserta SQL dan hasil mentah.

Diagnosis read-only menemukan 747 kode yatim unik; tidak satu pun beririsan dengan 328 kode EasyMax. Semua 14.479 baris adalah debet `sjnsbp=1`, tanpa kredit dan tanpa nominal NULL; seluruh kode hadir di master dengan `sjenis=4`. Total debet 6.411.357.535. Key berawalan PP, sedangkan sampel 20 baris terbesar pada mirror yang lebih baru berlabel VCREF JP / Penjualan Pelanggan Tunai. Hipotesis SALDO AWAL tidak didukung sampel tersebut; mirror dipakai hanya untuk nama kelas, bukan bukti nominal cut. Di hutang, 44.683 baris/188 pelanggan master nonlokal tanpa titik tetap termasuk formula. Formula tidak diubah. Himpunan nonnol identik membuktikan konsistensi kedua sistem, belum membuktikan keduanya benar.

H1 belum dicentang: laporan EasyMax 12 September harus cocok dengan piutang lokal 13.052.684.187,50, online 900.000, hutang lokal −673.010.538, dan seluruh pelanggan CSV snapshot. Snapshot 13 September efektif posisi tutup 12 September: semua 2.973 row AWAL=AKHIR, tidak ada posting tanggal 13 di dalam cut.

## Default Dion dan keputusan pelaksanaan

| Keputusan | Pelaksanaan |
|---|---|
| Nol: seksi keempat collapsed | Dipakai; tetap hadir dan diekspor tanpa filter. Pencarian dan pagination nol membuka seksi agar hasil bisa ditemukan. |
| Pagination per-seksi 50 | Dipakai; filter dan sort global, halaman seksi independen. |
| Pelanggan dua buku | Dipakai; keanggotaan dari AWAL atau AKHIR nonnol, label “satu pelanggan, dua buku”. |
| C rebuild, v2 | Diterapkan: 12+12 NUMERIC, CHECK, checksum 18 angka, rebuild dari cut asli dan verifikasi enam saldo tetap; rancangan mendahului kode. |
| B31hari / kanari7 | Diterapkan: default request 7, batas konfigurasi 31, tanpa menaikkan gerbang 9 GB. |
| Unit2–7 tanpa job | Tidak membuat job; perintah persis untuk Dion sudah tersedia di runbook backfill. |

CSV D dipilih berbentuk satu pasangan Awal/Akhir per kemunculan buku, dengan penanda seksi/buku dan label lintas buku. Mengulang keenam saldo lengkap pada setiap kemunculan ditolak karena berisiko menghitung nominal buku lain dua kali. Seksi nol D memiliki satu kemunculan per pelanggan, pasangan0/0 berarti ketiga buku bersaldo nol. C memperluas rincian nol untuk tetap mengungkap debet/kredit kumulatif riil pada buku yang saldonya telah lunas. Ini perubahan bentuk ekspor yang diminta, tanpa mengubah nilai buku.

## Usulan Fase 3 — tidak dibangun pada branch ini

**Tiga slot terhalang di sumber yang saat ini dicerminkan:** Tagihan, Pembayaran yang dialokasikan ke faktur, dan Belum dibayar & Aging. Agent hanya SELECT delapan kolom (`apps/agent/src/domains.ts:476,507`): primary key ledger, DTGL, CKDPLG, VCREF, VCKET, NJUMLAH, SJNSBP, SBATAL. Vonis yang sah adalah **balance-forward sejauh delapan kolom yang dicerminkan**. Ini tidak membuktikan EasyMax tidak memiliki faktur atau jatuh tempo.

**Tahap pertama: probe read-only mesin IB.** Driver sumber MySQL/classic MySQL ada pada `apps/agent/src/db/mysql.ts:1–14`. Jalankan `SHOW COLUMNS FROM tr_bppiut`, `SHOW COLUMNS FROM tr_bphut`, dan `SHOW INDEX` kedua tabel melalui koneksi baca-saja yang disetujui. Rekam nama/tipe/nullability/key dan versi server. Bila INFORMATION_SCHEMA didukung, hasil COLUMNS untuk kedua tabel dapat menjadi tabulasi; jangan mengasumsikan versi server modern. Probe ini **belum dijalankan pada sesi Fase2**, sehingga belum ada daftar kolom tambahan yang dapat dinyatakan benar-benar tersedia.

Yang dicari secara semantik: identitas faktur, identitas dokumen pembayaran, relasi pembayaran→faktur, tanggal faktur, jatuh tempo, dan status posting/reversal. Nama kolom harus berasal dari probe, lalu diuji dengan pasangan transaksi yang diketahui operator. Sebuah kolom tanggal saja tidak membuka aging: perlu jatuh tempo bermakna dan alokasi pembayaran/sisa tagihan yang dapat direkonstruksi. VCREF/VCKET sendiri tidak boleh dianggap penaut faktur tanpa pembuktian relasi.

**Tahap kedua: ukur biaya full-sync.** Kedua domain ber-mode full dan mengurutkan DTGL/key (`domains.ts:471–478,502–509`). Ingest menerima delapan kolom dan melewati row yang tidak berubah (`apps/backend/src/ingest/table-config.ts:257–270`). Angka ledger piutang **2.134 MB** adalah baseline brief, juga tercatat pada komentar `table-config.ts:262`; bukan ukuran sumber terbaru yang diukur dalam sesi ini. Penambahan kolom dapat membuat fingerprint lama berubah pada hampir seluruh baris meskipun saldo tidak berubah, sehingga biaya putaran pertama harus dipisahkan dari steady state.

Praregistrasikan pengukuran: jumlah baris seluruh ledger dan aktif, rata-rata/p95 byte kolom tambahan pada sampel lama/baru, ukuran payload sebelum/sesudah kompresi, waktu SELECT, memori agent, durasi unggah, row yang benar-benar di-upsert, WAL serta pertumbuhan relation/index mirror. Estimasi `baris × rata-rata tambahan byte` bukan pengganti pengukuran payload dan latency. Ukur satu full-sync baseline dan satu kandidat di lingkungan uji atau kanari IB yang disetujui; jangan memperlebar SELECT produksi atau jadwal di Fase2. Proyeksikan tujuh unit sesudah kanari, dengan ruang untuk source cut bila kolom juga dipertahankan di sana.

**Urutan produk: riwayat transaksi pelanggan dahulu.** Pilihan sumber awal adalah mirror `public.bppiut`/`public.bphut`: VCREF/VCKET sudah ada (`table-config.ts:259,267`) dan dibuang source cut (`apps/backend/prisma/migrations/0037_saldo_pelanggan_snapshot/migration.sql:114–151`). Riwayat menampilkan waktu sinkronisasi/freshness dan menyatakan bahwa isinya dapat lebih baru daripada saldo snapshot. Ia tidak boleh menyamar sebagai drilldown yang menjumlah tepat ke generasi snapshot. Total saldo tetap berasal dari snapshot; riwayat memakai pagination/indeks per unit+pelanggan+tanggal. Bila produk membutuhkan penjelasan exact-generation, perlu arc memperluas source cut dengan referensi/label dan pengukuran storage tersendiri sebelum fitur dijanjikan.

Nama transaksi berasal dari bukti VCREF/VCKET dan taksonomi terverifikasi; key ledger tidak otomatis nomor faktur. Baris SBATAL=1 tidak dilabeli otomatis “dibatalkan”: kontrak Fase1 mencatat koreksi/pembalik/penulisan ulang (`2026-09-08-piutang-butir1-rancangan-layar.md`, §3).

Sesudah skema dan biaya lulus, bangun penautan faktur/pembayaran, baru sisa tagihan dan aging. Kebijakan kredit memerlukan sumber limit, masa berlaku dan hak perubahan tersendiri. **Tidak dibangun sekarang:** faktur tebakan, alokasi pembayaran heuristik, aging tanpa jatuh tempo tervalidasi, limit/blokir pelanggan, perluasan SELECT agent, perubahan schema sumber SPBU, atau tulis EasyMax.

## Bukti pengiriman

Bukti setiap tahap dicatat setelah eksekusi. Tidak ada deployment yang dijalankan oleh pembuat PR.

### D selesai secara lokal dan CI

Commit diagnosis/desain `d78b4e9`; commit D `dd56b16`. PR D [#356](https://github.com/ddsalam/solamax/pull/356) menuju staging. `pnpm check` lokal lulus; setelah tiga penyederhanaan kecil, typecheck dashboard dan 62 tes terkait lulus lagi. CI `check` push dan PR serta `arsip` semuanya SUCCESS pada head `dd56b16` (run PR34744848450, arsip34744917528). Review `ce-code-review` selesai, run `20260913-piutang-d-ea96aa94`, nol actionable. Enam persona independen; keamanan ditelusuri reviewer utama. Model eksternal tidak dipakai karena jalurnya tidak dapat dibatasi pada diff D tanpa akses berkas lain; fallback adversarial lokal selesai.

Penyederhanaan D menerapkan satu sumber ID buku, konstanta halaman bersama, dan satu perhitungan label per row. Usulan membuang rowset unik/bookCount atau mengganti pengelompokan menjadi satu loop tidak diambil: tidak ada masalah terukur pada 2.973 row, dan kontrak unik memudahkan rincian C. Tidak ada bukti browser langsung yang diklaim; PDF benar-benar dibuat dan teksnya diperiksa oleh tes.

G4 awalnya merah karena label arsip belum terpasang. Label diterapkan dengan alasan tertulis pada PR: audit awal telah diterima setelah pemeriksaan independen Dion, catatan merekam keputusan yang sudah ditetapkan, dan instruksi lanjutan §6 mengotorisasi penyelesaian tanpa gerbang tambahan. Diagnosis baru tetap dibatasi oleh bukti dan H1 belum lulus. Dion tetap pemilik keputusan merge.

### Penajaman C saat menelusuri tampilan

Keanggotaan seksi tetap memakai enam saldo. Bila pelanggan bersaldo lokal tetapi hutangnya sudah nol dengan debet=kredit nonnol, volume hutangnya tetap harus terlihat. Helper bersama menambahkan buku bersaldo nol yang mempunyai volume pada kemunculan pertama pelanggan tersebut; ia tampil sekali dalam layar/CSV/PDF, ditandai “buku bersaldo nol”. Seksi nol tetap menampilkan tiga buku untuk setiap pelanggan. Dengan demikian setiap angka debet/kredit diekspor sekali tanpa menambahkan atau meniadakan saldo lintas buku.

C lulus `pnpm check` lokal sebelum penyederhanaan akhir. Penyederhanaan menerapkan helper total buku yang sama untuk layar/CSV/PDF dan membuang proyeksi saldo row yang tak lagi dipanggil; typecheck serta tes tampilan/ekspor diulang. Dua usulan efisiensi tidak diterapkan: penggabungan assert source belum memiliki bukti biaya yang mengalahkan kejelasan urutan kegagalan, sedangkan pengelompokan tiga buku sudah dinilai memadai di D. Semua penjaga sumber dan integritas tetap ada.

Catatan rollout C: migration dan aplikasi baru harus diselesaikan melalui pipeline yang sama. Selama sela waktu antara upgrade checksum dan penggantian revision dashboard, pembaca lama dapat menampilkan `not_ready` (tidak mengarang nol). Workflow dashboard memiliki SQLCHECK sebelum deployment; K1 kini menunggu maksimal10menit sampai kolom NUMERIC NOTNULL unik0039 terlihat, baru menguji seluruh query. Karena migrasi atomik, kolom ini tidak terlihat sebelum rebuild dan perpindahan referensi commit. Ini memperbaiki perlombaan pipeline yang ditemukan review; koneksi/izin gagal tetap gagal langsung. Jika migrasi tidak selesai dalam batas itu, pipeline berhenti dengan alasan eksplisit. Tidak menjalankan SQL migrasi manual. Revert aplikasi ke v1 sesudah migrasi bukan rollback yang memulihkan pembacaan; kegagalan aplikasi v2 perlu perbaikan maju melalui PR.

Selesaikan merge/deployment C di luar jendela worker02.00–05.00WIB. Jangan memicu worker sampai revision backendv2 melayani; writer v1 tidak dapat memenuhi NOTNULL kolom baru. Migrasi menolak builder/lease aktif secara atomik. Jeda pembacaan menjadi not_ready adalah konsekuensi pilihan checksumtunggal+rebuildatomik, bukan angka nol atau saldo baru.

Promosi pilot adalah keputusan Dion di luar tugas ini. Bila kelak diotorisasi, selesaikan approval dan job backend `migrate-pilot` lalu `deploy-pilot` terlebih dahulu, baru approve `deploy-pilot` dashboard. K1 dashboard memakai DB TEST rlsstg bahkan pada alur promosi; keberhasilan K1 bukan bukti schema pilot sudah0039. Penantian skema baru menyelesaikan perlombaan tier TEST yang diotorisasi sekarang; tidak ada promosi main yang dijalankan.


### C selesai dan CI PostgreSQL 14 lulus

Commit `53f4411`, PR [#357](https://github.com/ddsalam/solamax/pull/357) ke staging. Review `ce-code-review` selesai dengan tujuh persona independen, nol temuan terbuka; receipt `20260913-C-142556`. Dua run CI 34745716685 dan 34745728295 lulus `check` serta `snapshot-postgres-14`; G4 juga hijau. Semua 15 tes database benar-benar dieksekusi pada PostgreSQL 14 terisolasi, bukan Cloud SQL dan bukan Docker lokal.

Fixture v1/v2 yang sama mempunyai 10 row: payload 757 B → 1.201 B (1,5865×), relation tetap 32.768 B karena masih dalam alokasi halaman awal. Bukti ini melengkapi ukuran produksi read-only, tidak menggantikannya. Rebuild mengganti generation dan waktu komputasi/publikasi, mempertahankan waktu source cut asli. Enam saldo lama tidak berubah.

### B: pelaksanaan dan batasnya

Kode menerima `backfill_days` 0–31, default 7 untuk kanari, serta `max_items` 1–8, default 8. Nilai 31 berarti 31 hari sebelum hari ini, ditambah hari ini bila tanggal cut mencukupi. Enqueue juga memperbaiki pointer stale di luar rentang tersebut. Hari ini diprioritaskan, kemudian tanggal lama tertua. Satu request menyemai dari cut lengkap terbaru walaupun tidak ada finalisasi baru; pointer sehat dan dead-letter cut yang sama tidak dibuat ulang.

Batas global satu lease, 02.00–05.00 WIB, lease terakhir sebelum 04.45, gerbang 9 GB, serta collector sebelum gate tetap dipertahankan. Deadline request 18 menit diuji lagi saat SQL lease dijalankan, sehingga menunggu koneksi tidak menjadi jalan melampaui batas. Tiap build tetap paling lama 15 menit. Beberapa hasil sukses lalu gagal tetap menghasilkan HTTP gagal dengan hitungan parsial; status sukses tidak menyatakan seluruh 31 tanggal sudah terisi.

Semua jalur daftar/detail/CSV/PDF tetap memakai snapshot yang sama. Catatan historis memakai tanggal WIB source cut: posisi 10 September dari sumber 13 September memuat koreksi bertanggal mundur sampai sumber itu, sehingga tidak identik dengan cetakan EasyMax pada tanggal lama. Uji menegaskan pergantian tanggal UTC→WIB dan bahwa nilai saldo tetap. Fixture browser diperiksa pada 390 dan 1440 px; tidak ada luapan horizontal, catatan terlihat di atas angka. Ekspor PDF benar-benar dirender dan teks catatannya diperiksa.

Penyederhanaan B menjalankan tiga persona terpisah (serial karena batas slot). Satu temuan kualitas diterapkan: pesan validasi memakai konstanta batas yang sama dengan pemeriksaan. Pemisahan tambahan metode persiapan tidak dipakai karena menambah perpindahan kontrol gate/deadline tanpa mengurangi cacat yang terukur. Tiga saran efisiensi tidak diambil: reap per item tetap mengantisipasi kerja antar-request; pemeriksaan jumlah source dipertahankan sebagai penjaga; pembacaan gate sesudah lease kosong sengaja menangkap gerbang yang baru menutup. Tidak ada penjaga dikurangi demi efisiensi.

Peninjau reuse menemukan argumen SQL salah tempat pada finalisasi. Root membuktikan tes parameter finalisasi merah, memperbaiki argumennya, lalu memastikan tes hijau. Ini diperbaiki sebelum commit B. Unit test backend 100 lulus sebelum perbaikan ini, menunjukkan mengapa penelusuran komposisi diperlukan; tes regresi kini memeriksa kontrak panggilan yang sebelumnya tidak teramati.

Runbook `2026-09-13-piutang-fase2-backfill-runbook.md` memuat ukuran produksi, cadangan snapshot 444.530.688 B (termasuk tanggal kini/baseline, tidak termasuk source baru enam unit atau metadata), ukuran fixture CI, kontrol positif SQL read-only, empat blok perintah Scheduler untuk Dion dan batas monitoring. Sintaks empat blok shell serta dua blok SQL diperiksa tanpa eksekusi. Tidak ada job dibuat/diubah. H1 tetap satu-satunya bukti bisnis yang menunggu laporan.

Review B `ce-code-review` selesai tanpa temuan terbuka, receipt `20260913-piutang-b-53f4411`. Sembilan sudut tinjau dijalankan oleh reviewer utama karena host menolak child tambahan pada batas slot; tidak diklaim sebagai sembilan peninjau independen atau corroboration lintas model. `pnpm check` dan `pnpm lint` lulus. Tiga skenario PostgreSQL tambahan benar-benar dieksekusi bersama 15 tes C; bukti CI dicatat di bawah.

B di-commit sebagai `e97c793` dan dibuka pada PR [#358](https://github.com/ddsalam/solamax/pull/358) menuju staging. Dua eksekusi awal PostgreSQL masing-masing lulus 17/18 tes: fixture terakhir melanggar kelengkapan status stale, kemudian keunikan satu pending per tanggal. Commit `b1cdeab` melengkapi metadata stale serta memakai ID kerja eksplisit agar tidak bertabrakan dengan fixture bertanggal hari ini; `18cdffd` menyesuaikan urutan fixture dengan service: supersede dahulu, baru enqueue. Penjaga database dan kode aplikasi tidak dilonggarkan. Reviewer memeriksa ulang seluruh constraint kerja dan menerbitkan addendum; celah fixture yang terlewat pada review awal dicatat apa adanya.

Pada head `18cdffd`, run push [34746583720](https://github.com/ddsalam/solamax/actions/runs/34746583720) dan PR [34746586297](https://github.com/ddsalam/solamax/actions/runs/34746586297) lulus `check` serta `snapshot-postgres-14`; seluruh **18/18 tes database** lulus. Arsip [34746586293](https://github.com/ddsalam/solamax/actions/runs/34746586293) juga lulus. Docker lokal tidak dijalankan; PostgreSQL 14 terisolasi di CI adalah bukti eksekusinya. Ketiga PR tetap terbuka menuju `staging`: D [#356](https://github.com/ddsalam/solamax/pull/356), C [#357](https://github.com/ddsalam/solamax/pull/357), lalu B [#358](https://github.com/ddsalam/solamax/pull/358). Commit penutupan ini hanya memperbarui dokumentasi hasil; CI pada head akhirnya diperiksa lagi sesudah push.
