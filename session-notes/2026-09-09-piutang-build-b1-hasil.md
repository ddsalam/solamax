# SolaMax Piutang — hasil Build B1 dan gerbang kapasitas

Tanggal bukti: 2026-09-09 WIB. Branch: `codex/piutang-build-b1`.

## 1. Revisi dan batas eksekusi

- Basis branch: `origin/staging` pada `d77b50f`.
- Migrasi `0037_saldo_pelanggan_snapshot` dikomit lebih dahulu pada
  `2def6787d23ee8350bed8659c56552ff47f91aed`.
- SHA-256 berkas migrasi dan checksum `_prisma_migrations` sama:
  `54d22821b1338a5ce5c9dfcac440d159e646277a11182e7039fce6ab8ed4bfbd`.
- Berkas migrasi tidak disunting setelah diterapkan.
- DDL, fixture sintetis, dan uji akses hanya menyentuh instance uji lengkap
  `solamax:asia-southeast2:solamax-pg-rlsstg` (`db-f1-micro`, disk 10 GB,
  RAM sekitar 0,6 GB).
- Instance `solamax:asia-southeast2:solamax-pg` (pilot LIVE) hanya dibaca
  melalui role read-only untuk ukuran relasi agregat; tidak ada isi row yang
  diambil atau disalin.
- MySQL EasyMax tidak disentuh. `apps/agent/solamax-agent-bundle/` milik Dion
  tidak disentuh dan tidak masuk commit.

## 2. Bukti migrasi dan RLS

Sebelum penerapan, koneksi diverifikasi sebagai `current_user=ingest` pada
database `solamax`; seluruh 50 tabel lama di schema `public/app` dimiliki
`ingest`. Rehearsal `BEGIN ... ROLLBACK` berhasil sebelum penerapan permanen.

Sesudah penerapan pada `solamax-pg-rlsstg`:

| Pemeriksaan | Hasil |
|---|---:|
| Migrasi `0037` selesai dan tidak rolled back | 1 |
| Tabel baru milik `ingest` | 10/10 |
| Tabel baru dengan RLS `ENABLE` + `FORCE` | 10/10 |
| Policy `unit_scope` fail-closed | 10/10 |
| Hak efektif `dashboard_app` SELECT | 3 tabel snapshot |
| Hak efektif `dashboard_app` DML | 0 tabel |

Koreksi aditif `0038_snapshot_manifest_row_count` kemudian diterapkan sebagai
`ingest`. Constraint `sps_manifest_complete_row_count_required` tercatat satu
kali dan menolak manifest `complete` dengan `row_count=NULL`; migration `0037`
tetap byte-identik.

Tiga permukaan baca adalah `saldo_pelanggan_snapshot_manifest`,
`saldo_pelanggan_snapshot_pointer`, dan `saldo_pelanggan_snapshot_row`.

## 3. Metode pengukuran kapasitas

`solamax-pg-rlsstg` tidak membawa mirror unit 4. Pengukuran tidak menyalin data
produksi: 200.000 row sintetis dibuat di unit sintetis 1 dengan panjang key,
rentang tanggal, magnitudo/skala `NUMERIC`, distribusi `sbatal`, dan checksum
32-byte yang menyerupai bentuk row sumber. Setelah `ANALYZE`, ukuran
`pg_total_relation_size` (heap + TOAST + seluruh indeks) dikurangi baseline
relasi kosong, lalu dibagi 200.000.

| Permukaan | Baseline byte | Total 200.000 row | Byte tambahan | Byte/row terukur |
|---|---:|---:|---:|---:|
| Source ledger (`source_bppiut`; bentuk `source_bphut` identik) | 24.576 | 55.795.712 | 55.771.136 | **278,856** |
| Source pelanggan | 16.384 | 36.855.808 | 36.839.424 | **184,197** |
| Snapshot row | 16.384 | 38.264.832 | 38.248.448 | **191,242** |
| Snapshot manifest | 49.152 | 138.002.432 | 137.953.280 | **689,766** |

Pengali sumber memakai full key set termasuk `sbatal=1`: `bppiut=2.788.092`,
`bphut=542.129`, gabungan **3.330.221**. Master memakai 6.393 customer keys.
Retensi snapshot memakai 400 hari dan 179 penutup bulan, dengan 13 penutup
yang sudah berada di jendela 400 hari tidak dihitung dua kali: 566 tanggal
ekuivalen, **3.618.438 snapshot rows**, dan 3.962 manifest per generasi.

## 4. Ekstrapolasi kapasitas

| Komponen | Row ekuivalen | Ukuran desimal |
|---|---:|---:|
| Satu source cut: ledger + master | 3.336.614 | **929,8 MB** |
| Dua source cut saat promosi | 6.673.228 | **1.859,7 MB** |
| Snapshot steady: row + manifest | 3.622.400 | **694,7 MB** |
| Snapshot peak dua generasi | 7.244.800 | **1.389,5 MB** |
| Total nominal steady: satu cut + satu generasi | — | **1.624,6 MB** |
| Total saat overlap full-sync: dua cut + satu generasi | — | **2.554,4 MB** |
| Total puncak: dua cut + dua generasi | — | **3.249,1 MB** |

Ukuran seluruh tabel `public/app` pada `solamax-pg` saat pengukuran, dijumlahkan
read-only dengan `pg_total_relation_size`, adalah **2.013.380.608 byte
(2.013,4 MB)**; ukuran database adalah 2.028.592.151 byte. Proyeksi live pada
puncak menjadi sekitar **5.262,5 MB**, atau **35,1%** dari disk 15 GB. Proyeksi
ini menyisakan sekitar 9,74 GB sebelum batas disk, sebelum autogrow.

Perkiraan kertas source ledger ±230 B/row ternyata 21,3% lebih rendah daripada
hasil 278,856 B/row, terutama karena ukuran indeks nyata. Sebaliknya snapshot
steady terukur 694,7 MB, di bawah perkiraan 0,8–1,2 GB. Total puncak tambahan
3,249 GB sekitar 14,5% di bawah pembanding kasar 3,8 GB.

## 5. Vonis kapasitas

**`db-g1-small` dengan disk 15 GB cukup untuk melanjutkan Build B pada kapasitas
yang terukur; kenaikan tier atau pemangkasan retensi belum diperlukan.** Vonis
ini adalah vonis kapasitas, bukan bukti runtime B5.

Dua syarat operasional wajib:

1. Builder tetap global-concurrency-1 dan hanya dijalankan off-peak
   **02.00–05.00 WIB**, mengikuti preseden `deep-sweep`, agar build tidak
   menggusur working set dashboard pada RAM sekitar 1,7 GB.
2. Pemakaian disk **60% dari 15 GB (9 GB)** memicu peninjauan ulang kapasitas
   sebelum menambah retensi/concurrency. Disk Cloud SQL yang terlanjur tumbuh
   tidak menyusut otomatis.

## 6. Uji akses nyata `dashboard_app`

Fixture memakai tanggal valid `2099-03-31` untuk unit sintetis 1 dan 2.

| Skenario | Hasil |
|---|---|
| Scope unit 1 membaca manifest/pointer/row unit 1 | `1/1/1` |
| Scope unit 1 mencoba membaca row unit 2 | `0` |
| Scope unit 2 membaca manifest/pointer/row unit 2 | `1/1/1` |
| Scope unit 2 mencoba membaca row unit 1 | `0` |
| Koneksi tanpa `app.unit_ids` | `0/0/0` (fail-closed) |
| INSERT `dashboard_app` ke snapshot row | merah, `permission denied` |
| SELECT `dashboard_app` ke source-cycle internal | merah, `permission denied` |
| Assertion terbalik yang mengharapkan kebocoran unit 2 | merah, `division by zero` |

Uji merah terakhir membuktikan harness gagal ketika harapannya sengaja dibalik;
ia tidak sekadar melaporkan hijau tanpa kemampuan mendeteksi pelanggaran.

## 7. Pembersihan dan koreksi alat

- Salah ketik tanggal lama `2099-03-71` diperbaiki hanya pada fixture menjadi
  `2099-03-31`; migrasi tidak disentuh.
- Percobaan pertama generator kapasitas overflow pada perkalian `integer`;
  transaksi otomatis rollback dan count dibuktikan `0/0`, lalu generator
  diperbaiki memakai `bigint`.
- URL lokal `dashboard_app` dinormalisasi tanpa query parameter karena encoding
  `options` oleh alat pertama menghasilkan `+search_path`; query sistem belum
  berjalan pada percobaan gagal itu.
- Semua fixture kapasitas dan akses dihapus. Bukti final untuk source-cycle,
  source-pelanggan, source-ledger, manifest, snapshot row, pointer adalah nol;
  indeks cleanup sementara juga terbukti tidak tersisa.

## 8. Yang masih belum diketahui

- Runtime builder dan jalur baca pada tier live; `solamax-pg-rlsstg` sengaja
  tidak dipakai untuk benchmark karena RAM-nya tidak representatif. Ini milik B5.
- Volume change-manifest, WAL, temporary spill, bloat, dan headroom koneksi saat
  tujuh full-sync bersamaan; concurrency satu dan window off-peak menjadi pagar
  sampai load test B5.
- Ukuran row produksi dapat berbeda dari sintetis karena distribusi nilai dan
  fill/bloat; threshold disk 60% adalah gerbang untuk menguji ulang.
- SLA usia snapshot ketika agent/unit offline masih keputusan operasional.

## 9. Batas sistem

**SolaMax tidak bisa memblokir pelanggan di pompa.** Koneksi EasyMax `SELECT`-only
(aturan tak-bisa-dinegosiasi #1, `CLAUDE.md`), dan blokir kredit hidup di POS.
Yang bisa dibangun: peringatan + status di dalam SolaMax + daftar perintah untuk
pengawas. **Penegakannya tetap manusia.** Jangan pernah menulis kata
"pemblokiran otomatis" di UI, dokumen, atau laporan.

## 10. Koreksi pascareview

### Constraint manifest lengkap

Sebelum `0038`, fixture transaksional membuktikan manifest `complete` dengan
`row_count=NULL` diterima (`pre_0038_red_unexpectedly_accepted|1`), lalu
di-rollback. Penyebabnya: `row_count = customer_key_count` menghasilkan
`UNKNOWN` ketika `row_count` NULL, dan PostgreSQL menerima `CHECK` selama
hasilnya bukan `FALSE`.

`0038_snapshot_manifest_row_count` menambahkan constraint aditif
`status <> 'complete' OR row_count IS NOT NULL`. Sesudah diterapkan, fixture
yang sama merah pada `sps_manifest_complete_row_count_required`; transaksi
gagal dan count fixture kembali nol. Penjelasan permanen ada di
`0037_saldo_pelanggan_snapshot/CORRECTION.md`; `0037/migration.sql` tidak
disunting.

Sapuan kelas dilakukan atas seluruh operand constraint `0037` untuk operator
`=`, `<>`, `<`, `>`, `<=`, dan `>=`, lalu dicocokkan dengan nullability kolom
dan guard pada cabangnya. Operand nullable lain tertutup oleh:

- `IS NULL OR ...` / `IS NOT NULL` pada cabang yang sama (count, checksum,
  previous cycle, base snapshot, pointer stale, generation, dan lease);
- deklarasi kolom `NOT NULL`;
- constraint pasangan yang berlaku bersamaan: perubahan ledger wajib
  `invalid_from_date IS NOT NULL` lewat `sps_change_invalidation_valid` sebelum
  `sps_change_ledger_date_valid` membandingkannya dengan tanggal sumber.

Hasil lengkapnya: **`row_count` satu-satunya operand nullable yang dapat lolos
karena hasil `UNKNOWN`**.

### Bootstrap hak akses

`grants-bootstrap.sql` kini menegaskan ulang hak sepuluh tabel B1 setelah grant
borongan schema `app`: tiga permukaan snapshot tetap SELECT-only; tujuh tabel
internal kehilangan SELECT dan seluruh sepuluh tabel kehilangan DML.

Asersi penutup tetap membaca `information_schema.role_table_grants` untuk
grant langsung, lalu memeriksa hak efektif dengan `has_table_privilege` agar
grant lewat `PUBLIC` atau role turunan tidak lolos. Seluruh bootstrap kini
fail-fast dan atomik (`ON_ERROR_STOP` + `BEGIN`/`COMMIT`).

Bukti merah pertama memakai pemanggilan terdokumentasi `psql -f` tanpa
pembungkus transaksi dari luar, dengan satu REVOKE `snapshot_row` sengaja
dihilangkan. Skrip gagal dengan exit `3` dan
`dashboard_app masih memiliki 2 hak DML`; setelah rollback, grant DML langsung
dan tabel dengan DML efektif sama-sama nol. Bukti merah kedua memberi
`PUBLIC UPDATE` sementara pada `snapshot_row`: hitungan grant langsung tetap
nol, hak efektif menjadi satu tabel, dan skrip kembali gagal dengan exit `3`
pada asersi hak efektif. Grant sementara kemudian dicabut. Skrip asli lalu
dijalankan pada `solamax-pg-rlsstg` dan lulus dengan nol grant DML langsung
serta nol tabel dengan DML efektif.

Uji akses §6 dijalankan ulang setelah `0038` dan bootstrap yang diperkuat;
hasilnya tetap `effective_privileges|3|0`, `scope1|1|1|1|0`,
`scope2|1|1|1|0`, `no_guc|0|0|0`, dan ketiga uji negatif terlihat merah.
