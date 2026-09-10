# SolaMax Piutang - hasil Build B3 capture dan invalidasi otomatis

Tanggal bukti: 2026-09-10 WIB. Branch: `codex/piutang-build-b3`.

## 1. Revisi dan batas eksekusi

- Basis B3: `bb7ec0e`, head B2 yang juga menjadi head PR #329 ke `staging`.
- Commit B3:
  - `56b0e3c` - kontrak `source_cut` lengkap dari agent, termasuk marker
    full-sync kosong;
  - `fb07362` - staging immutable, diff old/new, dirty watermark, worker
    finalizer, retensi source rows, dan fixture gerbang.
- SHA-256 `0037_saldo_pelanggan_snapshot/migration.sql` tetap
  `54d22821b1338a5ce5c9dfcac440d159e646277a11182e7039fce6ab8ed4bfbd`.
- Bukti database hanya memakai instance uji lengkap
  `solamax:asia-southeast2:solamax-pg-rlsstg`, database `solamax`, role
  `ingest`, system identifier `7659054651798528016`. Migrasi `0037` dan `0038`
  keduanya terverifikasi aktif.
- Tidak ada data produksi yang dibaca atau disalin. EasyMax hanya dibaca oleh
  agent; tidak ada penulisan MySQL. Instance pilot
  `solamax:asia-southeast2:solamax-pg` tidak disentuh.
- Tidak ada benchmark performa di `solamax-pg-rlsstg`; runtime nyata dengan
  n >= 20 tetap milik B5.
- `apps/agent/solamax-agent-bundle/` milik Dion tidak disentuh dan tetap
  untracked di luar seluruh commit.

## 2. Mekanisme yang dibangun

Agent membuat satu UUID siklus untuk tiga full-sync `pelanggan_master`,
`bppiut`, dan `bphut`, mengirim identitas chunk serta total row domain, dan
tetap mengirim marker sah ketika full-sync berisi nol row. Kegagalan baca MySQL
tidak pernah menerbitkan marker cut lengkap.

Backend lebih dahulu meng-commit mirror dan `sync_state` dalam transaksi lama.
Capture source-cut kemudian berjalan dalam transaksi terpisah dengan
`maxWait=500 ms` dan `timeout=3 s`. Kegagalan capture dicatat tetapi tidak
mengubah respons `/ingest`. Lock alokasi sequence yang pendek dipisahkan dari
lock finalisasi/publikasi, sehingga staging ingest tidak menunggu diff atau
publikasi snapshot yang panjang.

Worker hanya memfinalisasi cut setelah tiga domain mengklaim lengkap. Dalam
satu transaksi atomik ia:

1. memverifikasi row count dan checksum 256-bit bounded-memory untuk tiap domain;
2. membandingkan full key set baru dengan cut lengkap aktif, termasuk DELETE;
3. menyimpan manifest perubahan dan `dirty_invalid_from` dengan `LEAST`;
4. menandai pointer terdampak `pending_replacement` tanpa memindahkan pointer;
5. mempromosikan cut baru, mengganti work lama yang belum leased, dan mengantre
   rebuild dari cut baru;
6. menandai cut staging lama gagal dan melepas source rows cut gagal atau cut
   lengkap lama yang sudah tidak mempunyai konsumen aktif.

Finalisasi tetap tunduk pada pagar worker B1: jendela 02.00-05.00 WIB, satu
build global, dan tinjau ulang pada ukuran database 9 GB. Error finalisasi tidak
menghalangi worker menyewa work lama yang sudah durable. Semua lock bersifat
transaction-local dan terlepas pada commit maupun rollback.

### Konsekuensi rollout dan kompatibilitas agen lama

B3 mengubah kontrak agent: tiga full-sync pembentuk saldo sekarang berbagi
`source_cut`, dan agent mengirim identitas itu pada setiap chunk. Karena itu,
capture otomatis baru aktif setelah bundle agent diganti pada seluruh tujuh
mesin. Verifikasi pasca-swap tujuh mesin menjadi prasyarat bersama untuk
B3-agent, sinkronisasi tagihan, dan backlog 3b; rollout parsial tidak boleh
ditafsirkan sebagai kesiapan snapshot semua unit.

Kontrak `source_cut` tetap opsional untuk kompatibilitas mundur. Agen lama yang
belum mengirimkannya tetap menerima respons sukses dan tetap menulis mirror
serta `sync_state`; backend hanya tidak membentuk cut untuk ingest tersebut.
Tes eksplisit mengikat perilaku ini dan memastikan capture tidak dipanggil.
Konsekuensinya pada B4 juga eksplisit: unit yang belum pernah mempunyai cut
lengkap/published harus dibaca sebagai **belum siap**, bukan sebagai saldo nol.

## 3. Gerbang kasus sulit dan kesetaraan

Fixture sintetis PostgreSQL menjalankan 12 tes. Setiap tanggal yang dibangun
ulang dibandingkan dengan query langsung pada source cut yang sama. Total ada
53 perbandingan kasus-tanggal; seluruhnya menghasilkan `key_mismatches=0` dan
`row_mismatches=0`.

| Kasus | Invalidasi paling awal | Perbandingan | Hasil snapshot vs query langsung |
|---|---|---:|---|
| Koreksi back-dated lintas bulan | 2025-12-15 | 5 tanggal | 0 beda |
| `sbatal` 0 -> 1 | 2026-02-05 | 3 tanggal | 0 beda |
| `sbatal` 1 -> 0 | 2026-02-06 | 3 tanggal | 0 beda |
| Baris ledger hilang antar-cut | `old.dtgl` 2026-03-10 | 2 tanggal | 0 beda |
| Full-sync hutang menjadi nol row | `old.dtgl` 2026-02-10 | 3 tanggal | 0 beda |
| `sjenis` Lokal -> Online | snapshot tertua 2025-11-30 | 6 tanggal | 0 beda |
| `sjenis` Online -> Lokal | snapshot tertua 2025-10-31 | 7 tanggal | 0 beda |
| Nama saja | tidak ada invalidasi/rebuild | 1 tanggal | 0 beda |
| Re-key pelanggan | snapshot tertua 2025-09-30 | 8 tanggal | 0 beda |
| Cycle gagal lalu cycle berikutnya sukses | watermark tetap 2025-12-15 | 5 tanggal | 0 beda |
| Kontrol hijau pasangan kontrol merah | 2025-12-15 | 5 tanggal | 0 beda |
| Isolasi unit kedua | 2025-12-20 | 5 tanggal | 0 beda; unit pertama tidak berubah |

DELETE ledger juga diverifikasi sebagai `change_kind=delete`, memakai
`old_business_date`, dan mempunyai `new_business_date=NULL`. Perubahan nama
menjadi `label_only=true`, `classification_changed=false`, tidak membuat dirty
watermark, dan tidak memindahkan pointer.

## 4. Ingest tetap selamat pada setiap tahap

Fault barrier nyata dijalankan pada setiap langkah capture/finalisasi berikut:

| Tahap yang diinjeksi gagal | Respons ingest | Mirror | Transaksi capture/finalisasi |
|---|---|---|---|
| `ensure_cycle` | 200 | committed | rolled back |
| `stage_rows` | 200 | committed | rolled back |
| `complete_domain` | 200 | committed | rolled back |
| `verify_domains` | 200 | committed | rolled back |
| `diff_changes` | 200 | committed | rolled back |
| `dirty_watermark` | 200 | committed | rolled back |
| `mark_pointers` | 200 | committed | rolled back |
| `promote_cycle` | 200 | committed | rolled back |
| `enqueue_work` | 200 | committed | rolled back |
| `prune_source_cuts` | 200 | committed | rolled back |

Sesudah setiap kegagalan, mirror `bphut` memuat nilai terbaru dan dirty
watermark sebelumnya tetap 2025-12-15. Cycle lengkap berikutnya berhasil
merekonsiliasi terhadap cut lengkap terakhir, membangun ulang seluruh pointer
terdampak, lalu membersihkan dirty watermark hanya setelah coverage lengkap.

Kegagalan berulang tidak meninggalkan lease atau work parsial karena enqueue
berada dalam transaksi finalisasi yang sama. Cut gagal/ditinggalkan tidak
menjadi pertumbuhan source rows permanen: ketika cut lengkap lebih baru lolos,
cut staging lebih lama diterminalkan dan source rows yang tidak lagi mempunyai
konsumen aktif dibersihkan.

## 5. Latensi ingest

Pengukuran hanya pada harness lokal fake-Prisma tanpa jaringan, n=30; ini
mengukur overhead orchestration, bukan runtime database:

| Metrik | Baseline | Dengan capture | Tambahan |
|---|---:|---:|---:|
| p50 | 0.005 ms | 0.005 ms | 0.001 ms |
| p95 | 0.006 ms | 0.014 ms | 0.008 ms |

Jalur request hanya melakukan staging bounded; agregasi checksum, diff,
invalidasi, promosi, dan fan-out work dipindahkan ke worker. Batas terburuk
tambahan request karena transaksi capture adalah 3 detik, terpisah dari commit
mirror 15 detik dan tetap di bawah timeout agent 20 detik.

## 6. Kontrol merah tanggal

Fixture membuat dua perubahan dengan tanggal 2025-12-15 dan 2026-03-10.
Implementasi hijau menghasilkan paling awal 2025-12-15. Kontrol merah yang
membawa `MAX(dtgl)` menghasilkan 2026-03-10 dan secara eksplisit dinilai merah.
Asersi SQL default juga menjaga `min(invalid_from_date)` dan
`dirty_invalid_from = LEAST(...)`, serta menolak `max(invalid_from_date)`.

## 7. Verifikasi dan cleanup

| Pemeriksaan | Hasil |
|---|---|
| `pnpm check` | lulus |
| Dashboard | 1331 lulus, 193 opt-in skip |
| Agent | 68 lulus |
| Backend default | 85 lulus, 22 opt-in skip |
| Shared | 14 lulus |
| Fixture B3 di `solamax:asia-southeast2:solamax-pg-rlsstg` | 12/12 lulus |
| Matriks snapshot vs query langsung | 53/53, seluruh selisih nol |
| Fault injection | 10/10 ingest 200 + mirror committed |
| Kontrol merah MAX | merah: 2026-03-10 != 2025-12-15 |
| Cleanup fixture | `remaining_fixture_roots=0` |
| Migrasi `0037` | tidak berubah; checksum cocok |

## 8. Review terstruktur

Review lokal memakai lensa correctness, standards, testing, maintainability,
security, performance, API contract, dan reliability, ditambah review
adversarial lintas-model Claude Opus dan satu validator independen.

Perbaikan yang diterapkan:

- cut malformed yang sudah obsolete diterminalkan sebelum verifikasi evidence;
- kegagalan finalizer tidak lagi memblokir leasing work durable;
- checksum full-domain tidak lagi memakai `string_agg` besar, melainkan digest
  fixed-size dari row count dan empat lane `bit_xor`;
- lock alokasi/staging ingest dipisahkan dari lock publikasi;
- source rows cut gagal dan cut lama tanpa konsumen aktif mendapat jalur retensi;
- kontrol merah default diikat ke SQL produksi, bukan hanya dua literal tanggal.

Validator menolak usulan inbox payload dan job database GitHub Actions sebagai
defect B3: fail-open dengan recovery pada full-sync lengkap berikutnya adalah
kontrak yang sudah ditetapkan, sedangkan fixture PostgreSQL manual pada RLS
staging adalah gerbang yang diminta. Ketiadaan replay segera dan automasi CI
untuk fixture live tetap dicatat sebagai batas operasional, bukan pelanggaran
correctness B3.

## 9. PR B2 dan status berhenti

PR B2 [#329](https://github.com/ddsalam/solamax/pull/329) sudah dibuka ke
`staging`. Pemeriksaan terakhir sebelum laporan: kedua job `check` lulus,
`mergeable=MERGEABLE`, tetapi G4 `arsip` gagal karena label owner belum ada;
label PR masih kosong. Label tidak dipasang oleh Codex dan catatan sesi tidak
dihapus.

Build B3 selesai sampai gerbang laporan ini. Branch B3 siap dipush dan dibukakan
PR ke `staging`; branch tidak di-merge dan tidak dipromosikan ke `main`. Jalur
baca/cache B4, UI, tagihan, limit kredit, serta runtime B5 tetap di luar lingkup.
