# Gerbang pra-merge migrasi 0039 — hasil read-only produksi

Pengamatan dilakukan 13-09-2026 pukul 16:14 WIB pada unit 1 (Imam Bonjol), memakai role `dashboard_app` dalam transaksi `REPEATABLE READ READ ONLY`, scope `app.unit_ids='1'`, lalu `ROLLBACK`.

Pada waktu pengamatan, predikat `snapshot_v2_source_cut_incomplete` dari migrasi `0039` lulus untuk kedua manifest unit 1 yang terlihat dalam scope:

| Tanggal manifest | Formula | Pelanggan | bppiut | bphut | Predikat persis |
|---|---|---:|---:|---:|---|
| 31-08-2026 | saldo-pelanggan-v1 | 2.973 = 2.973 | 407.790 = 407.790 | 300.257 = 300.257 | lulus |
| 13-09-2026 | saldo-pelanggan-v1 | 2.973 = 2.973 | 407.790 = 407.790 | 300.257 = 300.257 | lulus |

Keduanya menunjuk cut lengkap yang sama; status cycle `complete`, waktu `source_completed_at` sama persis dengan manifest, dan tiga checksum tersedia. Terdapat nol manifest `building`, nol work `leased`, dan nol formula selain `saldo-pelanggan-v1`. Satu work yang ada berstatus `done`.

Ini adalah bukti keadaan unit 1 pada pukul 16:14 WIB, bukan jaminan keadaan pada waktu deployment mendatang. Unit 1 adalah satu-satunya unit rollout snapshot saat bukti diambil, tetapi migrasi memindai seluruh `public.unit`; pemeriksaan deployment harus mencakup semua unit yang sudah mempunyai snapshot/work. Dion perlu mengulang pemeriksaan builder/work serta lock penulis collector tepat sebelum deployment dan menjalankan merge/deploy C dalam jendela 05:15–01:30 WIB; cron unit 1 dimulai 02:05 WIB.

Pada sesi awal, O2 sempat memicu aturan berhenti sehingga hasil gerbang belum ditulis ke badan PR #357. Setelah H1′ dirumuskan dan diterima, tindak lanjut ini menambahkan hasil gerbang beserta batas waktu pengamatannya ke badan PR. Tidak ada migrasi atau tindakan produksi yang dijalankan.

Bukti lengkap: `02-migration-0039-gate.sql` dan hasil mentah `02-migration-0039-gate.txt`.
