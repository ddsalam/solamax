# Piutang pelanggan Fase 1 — rancangan layar butir #1

Tanggal: 2026-09-08 (WIB). Branch: `codex/piutang-fase1-probe`.

Dokumen ini hanya merancang butir #1, **saldo hutang piutang setiap pelanggan**.
Tidak ada kode produk, migrasi, tabel, job, atau komponen yang dibangun pada
gerbang ini. Vonis yang sudah diterima: jalur render harus membaca snapshot;
query saldo per-pelanggan tetap menjadi pembangun snapshot dan oracle teknis,
bukan fallback di request pengguna.

## Pra-registrasi pengukuran snapshot bulanan + delta

Bagian ini ditulis dan di-commit **sebelum** query hitung baris dijalankan.
Benchmark kandidat saldo tidak diulang dan tidak dicari bentuk pengganti.
Pengukuran baru hanya menghitung baris mirror secara read-only.

Populasi yang akan dihitung untuk setiap unit adalah gabungan `bppiut` dan
`bphut` dengan `COALESCE(sbatal,0)=0`, sampai 2026-08-31. Pembilang bulan adalah
baris 2026-08-01…2026-08-31; penyebutnya seluruh riwayat sampai batas yang sama.
Selain itu, hitung distribusi per bulan selama 12 bulan terakhir untuk
mengetahui bulan tipikal dan terberat. Master pelanggan dicatat terpisah karena
ia tetap dibaca sekali, bukan tumbuh mengikuti panjang histori ledger.

Prediksi sebelum hasil terlihat:

- rasio baris satu bulan terhadap seluruh histori, tertimbang se-armada,
  diperkirakan `≤5%`;
- rasio Kotabaru sebagai unit ledger terberat diperkirakan `≤10%`;
- unit baru atau kecil boleh mempunyai rasio deskriptif lebih tinggi karena
  penyebut historinya pendek; fakta itu tidak disembunyikan.

Definisi **memotong biaya secara berarti** yang didaftarkan sebelum query:
rasio tertimbang se-armada **dan** rasio Kotabaru masing-masing harus `≤25%`
(sedikitnya 4× lebih sedikit baris ledger). Jika salah satu `>25%`, kondisi
berhenti §4-(2) terpicu dan rancangan snapshot tidak dilanjutkan. Hitungan baris
bukan janji runtime linear; ia hanya menguji apakah batas bawah kalender
menghapus sumber pertumbuhan struktural berupa pemindaian seluruh riwayat.

Hasil, SQL hitung, dan rancangan lengkap akan ditambahkan hanya bila kedua
ambang utama lulus.
