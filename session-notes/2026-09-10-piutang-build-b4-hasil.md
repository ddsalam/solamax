# SolaMax Piutang - hasil Build B4 jalur baca dan cache

Tanggal bukti: 2026-09-10 WIB. Branch: `codex/piutang-build-b4`.

## 1. Ruang lingkup dan batas

B4 menambah pembaca snapshot immutable untuk saldo per-pelanggan. Jalur rinci
baru hanya membaca pointer yang menunjuk manifest `complete`, `published`, dan
`validation_passed`, lalu membaca generasi tepat yang ditunjuk pointer. Setelah
koreksi urutan cutover, permukaan agregat yang sudah hidup memakai presence-gate
per unit/tanggal: snapshot complete bila tersedia, agregat ledger lama bila belum.

- Tidak ada fallback query **per-pelanggan** ke `public.bppiut`/`public.bphut`.
  Hanya query agregat lama tiga baris yang dipertahankan untuk Laporan
  Operasional, warm-board, dan Laporan Keuangan selama rollout.
- `ScopedUnitId` ber-brand tetap menjadi argumen wajib dan setiap query melalui
  `qScoped`; brand menjaga batas otorisasi terhadap scope yang salah atau
  melebar, sedangkan RLS fail-closed hanya mengembalikan nol baris saat scope
  tidak ada.
- Pelanggan bersaldo nol tetap berada di rowset. Piutang Lokal, Piutang Online,
  dan Hutang Lokal tetap tiga ember terpisah.
- Batas tetap berlabel: `awal` berarti `< D`, `akhir` berarti `<= D`.
- Unit/tanggal tanpa pointer lengkap tetap menghasilkan `not_ready` pada API
  snapshot rinci. Wrapper agregat lama mengembalikan hasil ledger, bukan `null`
  dan bukan nol yang direka.
- UI/layar, gold-check EasyMax B5, tagihan, limit kredit, tempo, dan peringatan
  tidak diubah.

SHA-256 migrasi `0037_saldo_pelanggan_snapshot/migration.sql` tetap
`54d22821b1338a5ce5c9dfcac440d159e646277a11182e7039fce6ab8ed4bfbd`.
`apps/agent/solamax-agent-bundle/` milik Dion tetap untracked dan tidak disentuh.

## 2. Kontrak pembaca

Pembaca berjalan dalam dua tahap:

1. pointer/metadata dibaca segar untuk `(unit, tanggal)`;
2. rowset dibaca hanya untuk `(unit, tanggal, generation_id)` yang tepat.

Query rowset menghitung ulang row count, checksum SHA-256 berurutan yang sama
dengan validator builder, dan keenam total manifest. Hanya generasi yang cocok
pada seluruh bukti tersebut yang menghasilkan sentinel integritas dan state
`ready`. Ini membedakan tiga keadaan yang sebelumnya mudah tercampur:

- tidak ada snapshot lengkap: `not_ready`;
- snapshot lengkap sah dengan nol pelanggan: `ready`, `rows=[]`;
- snapshot lengkap sah dengan pelanggan bernilai enam nol: `ready`, pelanggan
  tetap muncul.

Nama pelanggan dijoin dari master hanya sebagai label. Master tidak menjadi
sumber angka, dan kode yang sama sesudah `btrim` dikelompokkan agar label tidak
menggandakan row snapshot.

## 3. Kontrak cache

Pointer tidak pernah di-cache. Hanya hasil baca generasi immutable yang di-cache
dengan key `(unit, tanggal, generation_id)`.

| Kelas tanggal | TTL |
|---|---:|
| historis, `D <= H-2` | 86.400 detik |
| H-1 dan H | 120 detik |

Cache hit `not_ready`, rowset kosong, atau seluruh pelanggan bernilai enam nol
selalu dibypass dan dibaca segar. Hasil segar all-zero boleh diterima karena
count, checksum, dan total manifest sudah divalidasi. Bila generasi hilang di
antara pembacaan pointer dan rowset, pointer dibaca ulang tepat satu kali;
generation baru memakai key baru. Tidak ada invalidasi cache lama yang diperlukan
untuk correctness.

## 4. Kesetaraan jalur baca

Fixture sintetis membangun snapshot dengan SQL produksi dari tiga source cycle
unit A dan satu source cycle unit B, lalu memanggil API publik
`getSaldoSnapshot -> qScoped`. Oracle dihitung independen dari mirror sintetis.

| Cycle/unit | Tanggal | Baris oracle/read | Missing | Extra | Enam delta agregat | Mismatch row/cell/float8 |
|---|---|---:|---:|---:|---|---|
| A/C1 | 31 Jan; 1, 15, 20, 28 Feb | 13/13 per tanggal | 0 | 0 | semua 0 | 0/0/0 |
| A/C2 | 31 Jan; 1, 15, 20, 28 Feb | 13/13 per tanggal | 0 | 0 | semua 0 | 0/0/0 |
| A/C3 | 1 dan 28 Feb | 12/12 per tanggal | 0 | 0 | semua 0 | 0/0/0 |
| B/C1 | 31 Jan; 1 dan 15 Feb | 3/3 per tanggal | 0 | 0 | semua 0 | 0/0/0 |

Total: **15/15 kasus-tanggal sama**, dengan seluruh `missing_keys`,
`extra_keys`, enam delta, `mismatched_rows`, `mismatched_cells`, dan
`float8_mismatched_cells` bernilai nol.

| Kasus sulit | Bukti |
|---|---|
| pelanggan bersaldo nol | baris tetap ada; enam nilai nol |
| kode bertitik dan tidak bertitik | keduanya ada dan masuk ember berbeda |
| `SJENIS` 1/5/3/4 | 1/5 lokal; 3/4 tanpa titik tidak masuk lokal; kode bertitik tetap Online |
| `sbatal=1` | dikeluarkan dari saldo |
| orphan bertitik tanpa master | tetap masuk Piutang Online |
| orphan piutang tidak bertitik tanpa master | tetap ada sebagai baris enam nol |
| pelanggan hutang-only | tetap ada |
| desimal `0,10 + 0,20` | cocok eksak pada pembandingan numeric dan float8 |
| unit tanpa kode bertitik | rowset sah dan presence Online `false` |
| koreksi back-dated dan flip `sbatal` | cycle berikutnya cocok oracle baru |
| key ledger hilang antar-cycle | row lama hilang dari snapshot baru |
| batas awal/akhir bulan | seluruh tanggal batas cocok |
| `< D` lawan `<= D` | saldo akhir 31 Jan sama dengan saldo awal 1 Feb |

## 5. Readiness dan kontrol korupsi

| Keadaan | Hasil API |
|---|---|
| tanpa pointer | `not_ready` |
| manifest `building`, tanpa generasi lama | `not_ready` |
| manifest `failed`, tanpa generasi lama | `not_ready` |
| pointer lengkap lama ketika replacement pending | `ready` + metadata stale/pending |
| generasi lengkap seluruh pelanggan all-zero | `ready` |
| generasi lengkap nol pelanggan | `ready`, `rows=[]` |
| satu row dihapus | `not_ready` karena count mismatch |
| satu nominal diubah, row count tetap | `not_ready` karena checksum mismatch |
| satu total manifest diubah | `not_ready` karena total mismatch |

Jalur snapshot rinci tetap mengembalikan `not_ready` tanpa angka. Jalur agregat
lama diuji terpisah agar ketidaksiapan snapshot jatuh ke ledger dan tidak pernah
menghapus tiga baris Laporan Operasional atau membuat piutang Keuangan `null`.

### Kontrol merah eksplisit

Fixture yang sama dijalankan dengan
`SNAPSHOT_B4_REQUIRE_MUTANT_ACCEPTED=1`. Kontrol itu sengaja menuntut mutasi
nominal dengan row count tetap dibaca sebagai `ready`. Run keluar dengan kode 1:

```text
expected 'not_ready' to be 'ready'
```

Artinya pagar checksum produksi yang benar-benar dipakai pembaca membuat kontrol
merah. Walau run sengaja gagal, `B4_CLEANUP_REPORT` tetap melaporkan
`remaining_fixture_rows=0`.

## 6. Presence gate Online

`hasOnlineCustomer` dihitung dari seluruh rowset snapshot sebelum filter atau
paginasi, hanya dengan keberadaan titik pada `customer_code`.

| Kasus | Hasil |
|---|---|
| pelanggan bertitik dengan enam nilai nol | `true` |
| orphan ledger bertitik | `true` |
| orphan tidak bertitik enam nol | tidak menyalakan Online |
| unit tanpa kode bertitik | `false` |
| halaman terfilter tidak memuat sentinel bertitik | flag penuh tetap `true` |

Tidak ada unit ID, flag, atau daftar pengecualian yang di-hardcode.

## 7. Bukti akses negatif

Run memakai instance uji lengkap
`solamax:asia-southeast2:solamax-pg-rlsstg`, database `solamax`, system
identifier `7659054651798528016`. Role pembaca adalah `dashboard_app` dengan
`rolsuper=false` dan `rolbypassrls=false`. Migrasi `0037` dan `0038` diverifikasi
aktif sebelum fixture ditulis.

| Pemeriksaan | Hasil |
|---|---|
| kontrol writer | 19 manifest, 10 pointer, 166 row snapshot |
| tanpa GUC | manifest 0, pointer 0, row 0 |
| scope unit A | 154 row unit A |
| query unit B di scope A | 0 row |
| koneksi yang sama sesudah commit | 0 row |
| SELECT source-capture sebagai `dashboard_app` | ditolak `42501` |
| INSERT/UPDATE/DELETE snapshot sebagai `dashboard_app` | masing-masing ditolak `42501` |

Seluruh unit fixture memakai ID `SMALLINT` negatif acak. Tidak ada data produksi
yang dibaca atau disalin ke `-rlsstg`; instance pilot live
`solamax:asia-southeast2:solamax-pg` tidak disentuh. Cleanup akhir menemukan nol
row fixture tersisa.

## 8. Runtime jalur baca nyata

Pengukuran memanggil jalur storage produksi tanpa cache:
`getSaldoSnapshot -> qScoped -> pointer -> exact generation`. Tiga warmup
dikeluarkan, lalu 30 pembacaan sekuensial semuanya berhasil.

| n | Berhasil/error | Query logis | Round-trip SQL | Min | Median (p50) | p95 | Maks |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 30 | 30/0 | 2/call | 8/call | 132,697 ms | 141,861 ms | 231,055 ms | 234,381 ms |

p95 berada jauh di bawah satu detik. Namun ini **bukan vonis kapasitas atau SLO
produksi**: `solamax-pg-rlsstg` memakai cardinality sintetis kecil, RAM lebih
rendah, dan tidak mewakili distribusi pelanggan, concurrency, cache hit, maupun
jaringan produksi. Vonis representatif tetap ditunda ke B5 sesuai gerbang.

## 9. Verifikasi

| Pemeriksaan | Hasil |
|---|---|
| `pnpm check` | lulus |
| dashboard default | 1.351 lulus, 201 opt-in skip |
| agent/backend/shared | 68 / 86 / 14 lulus; backend 22 opt-in skip |
| reader snapshot + transisi unit | 16/16 lulus |
| cache + model + reader + Keuangan | 67/67 lulus |
| scope-wiring | 39/39 lulus |
| SQL dashboard dieksekusi di PostgreSQL uji | 40/40 lulus; rowset CTE dipanggil langsung |
| fixture B4 hijau | 6/6 lulus |
| equality | 15/15; seluruh beda nol |
| runtime | n=30; p50 141,861 ms; p95 231,055 ms |
| kontrol merah | exit 1 pada inversi readiness yang disengaja |
| cleanup hijau dan merah | masing-masing 0 row tersisa |
| migrasi `0037` | checksum tidak berubah |

## 10. Simplifikasi dan review akhir

Tiga lensa simplifikasi memeriksa reuse, kualitas, dan efisiensi. Hasil yang
diterapkan mencakup assembler snapshot bersama, union hasil SQL yang ketat,
satu traversal rowset, cache cold-miss tanpa query ulang, barrel API yang tidak
membocorkan SQL internal, dan CTE `snapshot_rows AS MATERIALIZED`. Fixture B2
tidak dipindah karena itu akan mengubah bukti yang sudah diterima di luar batas
mutasi B4.

Code review terstruktur selesai dengan run ID
`20260910-124335-9fefb94c`. Review lokal mencakup correctness, standards,
testing, maintainability, security, performance, dan reliability; adversarial
independen dijalankan oleh `claude-opus-5` melalui Claude CLI. Tiga temuan yang
lolos validator sudah diterapkan:

- K1 kini memanggil `getSaldoSnapshotGeneration` langsung sehingga SQL rowset
  benar-benar diparse dan dieksekusi PostgreSQL;
- catatan batas keamanan membedakan brand `ScopedUnitId` dari RLS tanpa memakai
  penalaran “backstop” yang keliru;
- guard CI builder sekarang menghitung dan mengunci kedua lengan signed
  `SJNSBP`, dua negasi hutang, batas lokal/Online, dan larangan `sjenis = 3`.

Empat saran peer tidak diterapkan karena bertentangan dengan keputusan owner:
UI dan gold-check tetap B5, provenance stale tetap tersedia di API rinci tanpa
menambah UI B4, dan cache all-zero wajib dibypass. Dua temuan P1 lain ditolak
validator sebagai positif-palsu. Satu perbaikan alat CI ikut dilakukan: penjaga
nama tabel sekarang mengenali CTE PostgreSQL `AS [NOT] MATERIALIZED`, disertai
kontrol regresi.

Build B4 berhenti pada gerbang laporan ini. Branch tidak dipromosikan ke `main`;
tidak ada PR B4 yang dibuka sebelum keputusan owner berikutnya.

## 11. Koreksi cutover agregat dan urutan promosi

Koreksi setelah review orkestrator menjaga dua kontrak yang berbeda:

1. `getSaldoSnapshot`/`getSaldoSnapshotCached` tetap snapshot-only dan eksplisit
   `not_ready`; fitur per-pelanggan baru tidak pernah memindai tujuh ledger unit
   pada request pengguna.
2. `getSaldoPelanggan`/`getSaldoPelangganCached` adalah wrapper transisi untuk
   permukaan agregat yang sudah hidup. Pointer diperiksa segar per unit/tanggal.
   Snapshot complete menang; tanpa snapshot valid, query agregat lama satu-scan
   per `bppiut`/`bphut` dipakai dan tetap di-cache per unit/tanggal dengan TTL
   86.400/120 detik serta bypass all-zero.

Fixture DB sintetis di `solamax:asia-southeast2:solamax-pg-rlsstg` menambah bukti:

| Kasus cutover | Hasil |
|---|---|
| snapshot complete tersedia | wrapper agregat membaca snapshot |
| total snapshot vs query agregat lama pada data sama | identik |
| tidak ada snapshot untuk unit/tanggal | wrapper memakai agregat ledger lama |
| fallback per-pelanggan | tidak ada |
| Laporan Operasional tanpa snapshot | tetap tiga baris saldo |
| Laporan Keuangan tanpa snapshot | `piutangEasymax=24`, delta `-11`, bukan `null` |
| cleanup fixture | `remaining_fixture_rows=0` |

Kontrol merah transisi dijalankan dengan kedua fallback sementara dihapus. Run
keluar kode 1: enam uji gagal, termasuk wrapper cache yang menerima `null` dan
Laporan Keuangan yang melempar saat membaca `saldo.akhir`. Setelah fallback
dipulihkan, 41/41 uji fokus kembali hijau.

Teks wajib untuk badan PR B4 kelak:

> Promosi ke `main` aman dengan jalur transisi ini: setiap unit/tanggal tetap
> memakai agregat ledger lama sampai snapshot `complete` terpublikasi, lalu
> menyeberang sendiri ke snapshot tanpa flag, daftar pengecualian, atau koordinasi
> rollout. Tanpa jalur transisi, promosi baru aman setelah B2+B3 hidup, bundle
> ditukar di ketujuh mesin, dan snapshot ketujuh unit terbukti terbangun. B4
> memakai opsi pertama agar promosi `staging` tidak ditahan rollout tujuh mesin.

B4 tetap staging-first dan belum di-push/dibuka sebagai PR pada gerbang ini.

Review ulang khusus koreksi cutover memakai run ID
`20260910-142604-4821270a`. Delapan lensa review selesai, termasuk lintasan
adversarial independen. Validator menolak seluruh kandidat utama karena
bertentangan dengan kontrak presence-gate eksplisit, mempertahankan perilaku
lama yang memang diminta, atau sudah dicakup uji sekelilingnya. Satu
penyempurnaan tanpa perubahan hasil tetap diterapkan: cold miss agregat all-zero
kini diterima setelah satu scan dan tidak langsung menjalankan scan identik
kedua; cache hit all-zero tetap dibypass seperti kebijakan lama.
