# Piutang Fase 2 — keputusan, verifikasi, dan usulan Fase 3

Status: pelaksanaan D → C → B berjalan. Berkas ini diperbarui per commit, bukan klaim bahwa seluruh fase selesai.

## H1 dan diagnosis

H1 masih menunggu laporan EasyMax IB per 12-09-2026. Ekspektasi total dan per pelanggan sudah dikunci di ralat Gerbang A. Tidak ada laporan yang dicetak/dicetak ulang oleh worker. Bukti diagnosis yatim ditulis dalam `2026-09-13-piutang-fase2-diagnosis-yatim.md` beserta SQL dan hasil mentah.

## Default Dion dan keputusan pelaksanaan

| Keputusan | Pelaksanaan |
|---|---|
| Nol: seksi keempat collapsed | Dipakai; tetap hadir dan diekspor tanpa filter. Pencarian dan pagination nol membuka seksi agar hasil bisa ditemukan. |
| Pagination per-seksi 50 | Dipakai; filter dan sort global, halaman seksi independen. |
| Pelanggan dua buku | Dipakai; keanggotaan dari AWAL atau AKHIR nonnol, label “satu pelanggan, dua buku”. |
| C rebuild, v2 | Rancangan ditulis sebelum kode: 12+12 NUMERIC, CHECK, checksum18angka, rebuild dari cut asli dan verifikasi enam saldo tetap. |
| B31hari / kanari7 | Rancangan memakai default request7, batas konfigurasi31, tanpa menaikkan gerbang9GB. |
| Unit2–7 tanpa job | Tidak membuat job; perintah akan diserahkan lewat runbook. |

CSV D dipilih berbentuk satu pasangan Awal/Akhir per kemunculan buku, dengan penanda seksi/buku dan label lintas buku. Mengulang keenam saldo lengkap pada setiap kemunculan ditolak karena berisiko menghitung nominal buku lain dua kali. Seksi nol D memiliki satu kemunculan per pelanggan, pasangan0/0 berarti ketiga buku bersaldo nol. C harus memperluas rincian nol untuk tetap mengungkap debet/kredit kumulatif riil pada buku yang saldonya telah lunas. Ini perubahan bentuk ekspor yang diminta, tanpa mengubah nilai buku.

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

Diisi setelah review, commit, dan CI tiap PR. Belum ada klaim CI atau deployment berhasil.
