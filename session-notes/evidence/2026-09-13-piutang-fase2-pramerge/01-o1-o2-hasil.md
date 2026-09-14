# O1/O2 — hasil read-only produksi

Pengamatan dilakukan 13-09-2026 pukul 16:15 WIB pada unit 1 (Imam Bonjol), memakai role `dashboard_app` dalam transaksi `REPEATABLE READ READ ONLY`, scope `app.unit_ids='1'`, lalu `ROLLBACK`. Source cut `c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff` berstatus `complete` dan selesai 13-09-2026 pukul 02:05:15 WIB.

Prediksi O1 ditolak dan **O2 terbukti**. Setelah membatasi pada baris aktif (`COALESCE(sbatal,0)=0`), baris mirror bagi tujuh pelanggan yang tidak ada di cut mencakup baris bertanggal 12-09-2026 berikut:

| Ledger | Pelanggan | Nominal D−K | `ingested_at` WIB |
|---|---|---:|---|
| bppiut | PLG0032 | 25.000 | 13-09 08:34:10 |
| bppiut | PLG0036 | 1.240.800 | 13-09 08:34:10 |
| bppiut | PLG2234 | 1.210.000 | 13-09 08:34:10 |
| bppiut | PLG2707 | 65.200 | 13-09 08:34:10 |
| bppiut | PLG2952 | 33.386.562 | 13-09 08:34:10 |
| bppiut | PLG2960 | 51.800 | 13-09 08:34:10 |
| bphut | PLG2641 | 1.405.000 | 13-09 08:38:05 |

Enam baris piutang bertanggal 12 September berjumlah tepat **Rp35.979.362**; satu baris hutang bertanggal 12 September berjumlah tepat **Rp1.405.000**. Semuanya `sjnsbp=1`, aktif, dan masuk mirror lebih dari enam jam sesudah cut selesai. Baris aktif bertanggal 13 September juga ada, tetapi terpisah dari dua jumlah pembeda tersebut.

`ingested_at` adalah waktu perubahan baris pada mirror, bukan waktu penulisan asli di EasyMax. Mirror memang lebih baru daripada cut. Hasil ini membuktikan penanggalan entri mundur dan ketidakhadirannya dari cut; hasil ini bukan bukti nominal cut yang dibuat ulang.

Konsekuensi sesuai instruksi: ekspektasi H1 lama tidak lagi sah sebagai oracle tutup 12 September. H1 tetap terbuka dan perlu dirumuskan ulang oleh Dion. Pekerjaan berhenti pada aturan §3.1; tidak ada perubahan formula, aplikasi, label, workflow, Scheduler, grant, secret, migrasi, atau `main`.

Bukti lengkap: `01-o1-o2.sql` dan hasil mentah `01-o1-o2.txt`.
