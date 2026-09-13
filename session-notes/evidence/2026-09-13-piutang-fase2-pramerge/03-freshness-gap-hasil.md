# Diagnosis kesegaran F1 — hasil read-only produksi

Pengamatan dilakukan 13-09-2026 pukul 16:28 WIB pada unit 1 (Imam Bonjol), memakai role `dashboard_app` dalam transaksi `REPEATABLE READ READ ONLY`, scope `app.unit_ids='1'`, lalu `ROLLBACK`.

## Source cycle

Seluruh **41 cycle gagal** (sequence 1–41) mempunyai satu `failure_summary` yang sama: `superseded by a newer complete-input source cycle`. Tidak ada kelas kegagalan formula atau checksum lain di himpunan tersebut. Cycle tertua berumur sekitar 41 jam 32 menit dan termuda sekitar 15 jam 20 menit saat diamati.

Jumlah `staging` telah bertambah dari 18 pada audit sebelumnya menjadi **24** (sequence 43–66):

- 23 cycle sequence 43–65 berada di bawah alokasi terbaru dan, menurut kontrak collector, sudah kalah serta menunggu retirement. Semua kecuali sequence 65 mempunyai klaim lengkap tiga domain; sequence 65 belum mempunyai klaim bphut.
- Sequence 66 adalah alokasi terbaru, baru berumur sekitar dua menit, dan belum mempunyai klaim bphut. Ia masih mungkin merupakan capture aktif.
- Source cycle tidak mempunyai kolom lease, heartbeat, atau owner. Karena itu tidak ada “lease hidup” yang bisa dibuktikan untuk staging; klasifikasi memakai sequence, umur, dan kelengkapan klaim domain. Lease yang ada di schema adalah lease `saldo_pelanggan_build_work`, tahap setelah sebuah cut complete.

Collector memang dirancang menandai semua staging di bawah sequence terbaru sebagai gagal, tetapi dijalankan oleh snapshot worker. Dengan worker sekali sehari, staging baru dapat menumpuk lagi setelah jendela worker berakhir.

## Invalidation dan pointer

`saldo_pelanggan_source_change` mempunyai **0 row**, termasuk 0 perubahan ber-`invalid_from_date`. `saldo_pelanggan_dirty` juga mempunyai **0 row**. Pointer 31-08 dan 13-09 tetap `pending_replacement=false`, dengan `stale_invalid_from` dan `pending_since` NULL.

Di jalur aplikasi, `MARK_STALE_POINTERS_SQL` hanya berjalan saat cycle baru berhasil difinalisasi dan diff terhadap cut sebelumnya sudah dibuat. Sejak pointer dibuat dari cycle 42, tidak ada cycle lebih baru yang berstatus complete; jadi jalur otomatis belum pernah mendapat kesempatan menyalakan banner. Schema pointer tidak menyimpan riwayat flag, sehingga database kini tidak dapat membuktikan secara absolut bahwa tidak pernah ada perubahan manual; tidak ada bukti perubahan manual dan tindakan semacam itu bukan bagian sesi ini.

## Baris tanggal 13 dan waktu laporan

Di antara tujuh pelanggan pembeda terdapat lima baris piutang aktif bertanggal 13 September, total D−K Rp69.044.338, dan satu baris hutang aktif Rp1.436.300. Semuanya masuk mirror pukul 15:20–15:25 WIB. Jumlah row dengan `ingested_at <= 12:45 WIB` adalah **nol** pada kedua ledger.

Untuk himpunan pembeda ini, laporan EasyMax 13 September pukul 12:45 tetap konsisten dengan semantik tanggal `dtgl <= D`: tidak ada baris tanggal 13 yang seharusnya sudah terlihat di mirror pada waktu laporan namun hilang dari laporan.

`ingested_at` tetap hanya waktu perubahan mirror, bukan waktu tulis EasyMax. Hasil mentah membuktikan urutan yang terlihat di cloud, bukan timestamp transaksi asli pada mesin sumber.

## Opsi F1 untuk keputusan Dion

1. **Cut dan build lebih sering dalam jendela yang disetujui.** Kelebihannya, diff/source-change, dirty watermark, pointer pending, dan snapshot pengganti memakai mekanisme yang sudah ada. Biayanya paling besar: full source capture dan diff berulang, pertumbuhan source cut/work/snapshot, tekanan gerbang 9 GB, serta persaingan waktu dalam jendela 02:00–05:00 WIB. Ini juga tidak menutup kesenjangan di luar jendela.
2. **Probe kesegaran murah pada jalur baca.** Nyalakan `pendingBanner()` sebagai “ada koreksi masuk sesudah snapshot; angka akan berubah besok” hanya bila perubahan pasca-cut dapat memengaruhi tanggal snapshot. Metadata ingest perlu mencatat perubahan key ledger—insert, update, pembatalan/delete, atau perpindahan tanggal—beserta tanggal lama dan baru; perubahan material bila tanggal paling awal yang terdampak `<= as_of_date`. Ini menangkap row yang sekarang tidak aktif tetapi masih aktif di source cut. Perbandingan watermark semua ingest akan menyala hampir sepanjang hari karena sinkronisasi mirror berjalan berkala, termasuk untuk transaksi masa depan yang belum mengubah saldo tanggal snapshot. Implementasi perlu materiality watermark kecil atau indeks/join key yang terukur; `max(ingested_at)` lewat full scan atas ledger besar bukan probe murah. Versi awal hanya mendeteksi perubahan ledger bppiut/bphut; perubahan klasifikasi master memerlukan watermark sumber tersendiri karena `pelanggan_master` belum mempunyai `ingested_at`.
3. **Kontrak posisi 02:05 di layar.** Hampir tanpa biaya komputasi dan paling sederhana dioperasikan, tetapi pengguna tetap menerima angka yang diketahui tertinggal tanpa indikator perubahan aktual. Copy tanggal cut membantu interpretasi, namun tidak mengungkap bahwa koreksi sudah masuk.

**Rekomendasi: opsi 2**, dengan materiality watermark atau indeks untuk predikat unit/tanggal/ingest yang diukur lebih dulu. Ia menutup kegagalan komunikasi yang terbukti dengan biaya jauh lebih kecil daripada full cut/build tambahan, memakai banner yang sudah tersedia, dan tidak mengubah angka snapshot. Opsi 3 dapat menjadi fallback copy sementara; opsi 1 layak bila Dion kemudian menetapkan kebutuhan SLA angka intrahari dan kapasitasnya terukur.

Bukti lengkap: preregistrasi `03-freshness-prereg.md`, kueri `03-freshness-gap.sql`, dan hasil mentah `03-freshness-gap.txt`.
