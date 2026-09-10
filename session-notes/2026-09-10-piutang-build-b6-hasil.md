# Hasil B6 — layar Saldo Piutang per Pelanggan

Tanggal: 10 September 2026 WIB

Branch: `codex/piutang-build-b6`

Target PR: `staging`
Status rollout: tidak dilakukan

## Hasil

B6 membangun layar daftar
`/keuangan/unit/[code]/piutang/[date]`, detail
`/keuangan/unit/[code]/piutang/[date]/pelanggan/[customerCode]`, serta ekspor
CSV/PDF penuh. Jalur ini hanya menerima `getSaldoSnapshot`; tidak ada fallback
ledger per pelanggan.

- Piutang Lokal, Piutang Online, dan Hutang Lokal tetap tiga bucket terpisah;
  tidak ada netting atau grand total gabungan.
- Awal berarti `dtgl < D` sampai D−1; Akhir berarti `dtgl <= D` sampai D.
- Pelanggan dengan enam nilai nol tetap hadir. Urutan default menempatkan yang
  bersaldo lebih dahulu.
- `q`, `filter`, `sort`, dan `page` hidup di URL. Ukuran halaman tetap 50;
  ekspor memakai seluruh hasil filter, bukan halaman aktif.
- Seksi Online hanya hadir bila snapshot menandai keberadaan pelanggan berkode
  titik.
- Detail memakai `(unit_id, ckdplg)`, termasuk kode yang mengandung `/` atau `%`.
- Snapshot yang belum siap menjadi keadaan utama tanpa angka, tabel, atau
  ekspor numerik; satu unit tidak mewarisi readiness unit lain.
- Peran `keuangan`, `direksi`, `admin_perusahaan`, dan `super_admin` dapat masuk.
  `pengawas` ditolak oleh pemeriksaan server, bukan hanya menu.
- CSV dilindungi dari formula injection. PDF memakai font server yang sama
  dengan client sehingga ligatur `fi`/`fl` tetap dapat diekstrak.
- Detail menyediakan slot Aktivitas pelanggan tanpa berpura-pura bahwa
  Tagihan, Pembayaran, Aging, atau Kebijakan kredit sudah dibangun.

## Bukti visual

Indeks tujuh screenshot aktual berada di
[`verification-queries-results/piutang-b6/README.md`](../verification-queries-results/piutang-b6/README.md).
Fixture hanya sintetis di `solamax:asia-southeast2:solamax-pg-rlsstg`; tidak ada
data produksi yang disalin. Setelah screenshot, cleanup terjaga identitas cluster
menghasilkan `pointer=0`, `rows=0`, `manifest=0`, `cycle=0`, dan `customers=0`.

## Gerbang dan kontrol

- Gerbang final `pnpm check` lulus: 38 migrasi lolos parser SQL, self-test
  mutasi 9/9, seluruh typecheck workspace lulus, dan 1.583 tes lulus
  (dashboard 1.414, backend 87, agent 68, shared 14). Tes integrasi yang memang
  membutuhkan environment tetap dilaporkan sebagai skip, bukan diubah menjadi
  pass palsu.
- Parser/workflow B5a lulus 34/34 tes Python. Production build Next.js lulus
  dan memuat rute daftar, detail, CSV, serta PDF B6.
- Kontrol merah readiness dijalankan dengan sengaja menghapus perlindungan
  not-ready: tes yang mensyaratkan tidak adanya `Rp0` gagal. Perlindungan
  dipulihkan dan suite kembali hijau 7/7.
- Rehearsal B3 di `solamax:asia-southeast2:solamax-pg-rlsstg`: 12/12 lulus,
  53 pasangan hasil tanpa key/row mismatch, sepuluh fault stage lulus, kontrol
  merah lulus, dan cleanup root tersisa nol.
- Reader ketat B4 pada instance yang sama: 6/6 lulus; kesetaraan 15 kasus tanpa
  mismatch; kontrol readiness, no-GUC, lintas-unit, write-denied, dan presence
  gate lulus; cleanup nol.
- Runtime representatif belum diputuskan. Sampel fungsional n=30 pada
  `solamax:asia-southeast2:solamax-pg-rlsstg` menghasilkan p50 136,31 ms dan
  p95 144,646 ms; ini bukan vonis SLO produksi.
- Ekspor aktual dari fixture menghasilkan CSV 64 baris/54 data dan PDF 30.132
  byte berawal `%PDF-1.3`; tes route juga membuktikan 409 tanpa angka pada
  not-ready, attachment `no-store` pada ready, serta penolakan role/scope.

## Penguatan dari review

Review terstruktur menemukan delapan masalah yang kemudian ditutup:

1. fixture dan cleanup kini fail-closed pada nama database serta
   `pg_control_system().system_identifier`;
2. parser oracle menolak formula XLSX tanpa cached value;
3. reader mengulang pointer sekali bila generasi berubah di tengah pembacaan;
4. query parameter duplikat memakai nilai pertama secara deterministik;
5. copy not-ready tidak mengklaim status source cut yang tidak dibaca;
6. cleanup hanya menghapus key fixture eksplisit, bukan wildcard;
7. source cut lengkap pertama dapat mengungguli work queued/retry walau belum
   ada pointer;
8. PDF server memakai default font yang sama dan dapat diuji.

Tes perilaku route CSV/PDF ditambahkan untuk tanggal/filter invalid, not-ready,
ready, role terlarang, dan unit di luar scope.

## Operasi berikutnya — belum dijalankan

Panduan tiga tahap untuk Dion berada di
[`2026-09-10-piutang-build-b6-panduan-dion.md`](2026-09-10-piutang-build-b6-panduan-dion.md).
Kanari yang diusulkan tetap Imam Bonjol (`64.781.11` / `6478111`) setelah B2/B3
dipromosikan dan bundle yang disetujui benar-benar ditukar pada satu mesin.
Enam unit lain tidak ikut ditukar. B5b baru boleh berjalan setelah cut nyata.

B5a masih menunggu berkas EasyMax `DAFTAR SALDO HUTANG PIUTANG` dari Dion;
ketiadaan berkas tersebut bukan pemblokir B6. Pada pembandingan September,
entri terlambat setelah tutup hari 9 September dapat membuat hasil H−1 berubah;
hipotesis itu telah dipraregistrasikan dan tidak boleh dipakai untuk mengubah
prediksi setelah melihat oracle.

Tidak ada promosi ke `main`, deployment, migrasi, rollout, penukaran agent,
atau perubahan pada `apps/agent/solamax-agent-bundle/`. Migrasi `0037` tetap
beku dengan SHA-256
`54d22821b1338a5ce5c9dfcac440d159e646277a11182e7039fce6ab8ed4bfbd`.
