# Hasil back-merge `main` ke `staging`

Tanggal: 10 September 2026 WIB

Branch: `codex/backmerge-main-to-staging`

Basis: `origin/staging` `6ee048e0db8989c03cb4f7b45489395dafb8339a`

Sumber merge: `origin/main` `9c69d4b5b256acd0f136a33d2167d49b1bc54e80`

Merge-base: `84dda73fadd3526eaaf59432bfa2e10732620c64`

Target PR: #334 ke `staging`

## Hasil

Konflik tunggal di `apps/agent/src/sync.ts` diselesaikan sebagai integrasi, bukan
dengan memilih satu sisi. Jalur delete-capable `terra_resmi` dari `main` tetap ada:
hot-path `replace_window`, sapuan historis, `SWEEP_TABLE`, DELETE-only untuk
jendela kosong, fallback UPSERT saat jendela melebihi kapasitas, dan jalur manual.
Kontrak B3 dari `staging` juga tetap ada: satu `source_cut.cycle_id` per cadence,
chunk lengkap untuk `pelanggan_master`, `bppiut`, dan `bphut`, serta marker cut
kosong yang tidak boleh tertukar dengan kegagalan query.

Dry-run mencetak `source_cut` dan `replace_window` sekaligus. Backend tetap
menyelesaikan transaksi mirror sebelum memanggil capture snapshot.

Review keselamatan menemukan bahwa scheduler `terra_resmi` dapat mendahului
tangga rollout runbook. Karena sapuan sejarah dapat menghapus data sah bila sumber
pernah dipangkas, scheduler kini opt-in melalui
`sync.terraResmiAutoSweepEnabled` (default `false`). Hot-path, registry, dan
`--deep-sweep terra_resmi` manual tidak dinonaktifkan. Setelah satu unit lulus
pratinjau dan sapuan bertahap, operator dapat mengaktifkan flag itu hanya pada unit
tersebut. Runbook diperjelas agar dry-run tidak dianggap mampu memperlihatkan orphan
yang berada dalam jendela berisi campuran baris hidup dan yatim.

## Bukti dua kemampuan

### `terra_resmi` delete-capable

- Agent menghasilkan `replace_window` untuk jendela kini dan untuk setiap jendela
  sapuan. Jendela kosong menghasilkan payload DELETE-only; jendela terlalu besar
  turun secara aman menjadi UPSERT chunked tanpa mengklaim replacement.
- Backend menerima payload `terra_resmi` bertabel kosong, mengambil advisory lock,
  menjalankan `DELETE FROM "terra_resmi"` untuk unit/rentang itu, tidak menjalankan
  INSERT, lalu memperbarui `sync_state`.
- Kontrol merah: handler `SWEEP_TABLE.terra_resmi` sementara diarahkan ke handler
  non-delete `sweepTera`. Tes DELETE-only memerah (`expected payload count > 0`,
  aktual `0`). Perubahan sementara dipulihkan; tes yang sama hijau.

### `source_cut` B3

- Agent mengirim identitas cut yang sama untuk tiga sumber snapshot dan metadata
  `chunk_index`, `chunk_count`, serta `row_count`, termasuk cut lengkap nol baris.
- Tes backend memakai marker transaksi dan membuktikan capture melihat mirror yang
  sudah commit, bukan sekadar menjadi statement terakhir di callback transaksi.
- Kontrol merah: kondisi pemanggilan capture sementara dibuat selalu salah. Tes
  post-commit memerah (`capture` dipanggil `0`, diharapkan `1`). Perubahan sementara
  dipulihkan; tes yang sama hijau.

## Audit auto-merge dan divergensi cabang

Perbandingan tree langsung `origin/main..origin/staging` berisi 89 path yang
berbeda: `sync.ts` ditambah **88 path lain**. Angka 88 itu bukan 88 perbaikan yang
hilang dari staging. Sebanyak 84 path merupakan pekerjaan staging B2–B6 yang memang
belum ada di main. Delta main-only sejak merge-base hanya **10 path** dan semuanya
berasal dari arc #324. Kedua himpunan bertumpang-tindih pada lima path
(`sync.ts`, `sync.test.ts`, `ingest.service.ts`, dan dua berkas shared), sehingga
84 + 10 − 5 = 89 path tree yang berbeda:

1. `apps/agent/src/config.ts`
2. `apps/agent/src/domains.ts`
3. `apps/agent/src/sync.test.ts`
4. `apps/agent/src/sync.ts`
5. `apps/backend/src/ingest/ingest.service.ts`
6. `apps/backend/src/ingest/sql.test.ts`
7. `apps/backend/src/ingest/sql.ts`
8. `packages/shared/src/ingest.test.ts`
9. `packages/shared/src/ingest.ts`
10. `session-notes/terra-resmi-orphan-sweep-runbook.md`

Jadi ada **9 berkas main-only selain `sync.ts`**, tetapi tidak ada perbaikan
main-only lain di luar #324. Berkas auto-merge diaudit satu per satu: perubahan
`source_cut` di shared/backend/agent bersifat aditif terhadap whitelist,
`replace_window`, SQL delete, transform `terra_resmi`, tes, config, dan runbook
dari main.

## Audit eksplisit `sync.ts` terhadap `origin/main`

`git diff --numstat origin/main -- apps/agent/src/sync.ts` menghasilkan 89 baris
tambahan dan 24 baris main yang diganti. Seluruh 24 baris yang tidak terbawa
verbatim tercatat di bawah; tidak ada baris hilang tanpa alasan.

| # | Baris `origin/main` yang diganti | Alasan |
|---:|---|---|
| 1 | signature `syncSaldoLedger(d, def)` | Ditambah `sourceCutCycleId`; perilaku ledger lama tetap dipanggil. |
| 2 | `if (rows.length === 0) {` | Diganti `chunkCount = Math.max(1, ...)` agar sumber kosong tetap menjadi cut lengkap. |
| 3 | log ```${def.domain}: 0 baris``` | Diganti log dispatch payload kosong yang membawa identitas cut. |
| 4 | `return;` pada ledger kosong | Dihapus supaya cut kosong tidak hilang. |
| 5 | penutup blok ledger kosong | Konsekuensi struktural butir 2–4. |
| 6 | loop offset `i` ledger | Diganti loop `chunkIndex` untuk metadata cut deterministik. |
| 7 | `rows.slice(i, i + batchSize)` | Diganti slice ekuivalen berbasis `offset`, lalu diberi metadata cut. |
| 8 | komentar “KEDUANYA otomatis” | Diperjelas: scheduler `terra_resmi` aktif setelah flag rollout per unit; kemampuan manual/hot-path tetap ada. |
| 9 | signature `syncMasters(d)` | Ditambah `sourceCutCycleId`. |
| 10 | assignment langsung semua hasil master | Master non-pelanggan tetap sama; `pelanggan_master` ditahan untuk chunk cut. |
| 11 | early-return bila seluruh master kosong | Tetap berlaku saat query pelanggan gagal; keberhasilan nol baris kini menghasilkan cut kosong. |
| 12 | `await dispatch(d, {` lama | Dipertahankan pada fallback query gagal dan diganti loop chunk pada hasil sukses. |
| 13 | `unit_code: d.cfg.unitCode` | Nilai sama ada pada kedua jalur pengganti. |
| 14 | `domain: "masters"` | Nilai sama ada pada kedua jalur pengganti. |
| 15 | `watermark_high: null` | Nilai sama ada pada kedua jalur pengganti. |
| 16 | `tables` | Tetap `tables` pada fallback; menjadi `chunkTables` pada source cut sukses. |
| 17 | penutup dispatch master | Konsekuensi struktural pemisahan fallback dan loop chunk. |
| 18 | `syncMasters(d)` di cadence | Dipertahankan sebagai `syncMasters(d, sourceCutCycleId)`. |
| 19 | `syncSaldoLedger(d, def)` di cadence | Dipertahankan sebagai pemanggilan dengan cycle ID yang sama. |
| 20 | log cadence `terra_resmi` tanpa kondisi | Diganti log eksplisit aktif/nonaktif menurut flag rollout. |
| 21 | log tier-2 “semua 8 domain” | Diganti jumlah domain aktif aktual. |
| 22 | komentar `lastTier2Full` “SEMUA 7 domain” | Dikoreksi menjadi semua domain aktif; komentar lama juga salah hitung. |
| 23 | loop tier-1 atas seluruh `SWEEP_TABLE` | Diganti daftar scheduler; registry manual penuh tetap sama. |
| 24 | loop tier-2-full atas seluruh `SWEEP_TABLE` | Diganti daftar scheduler dengan gerbang rollout yang sama. |

Tidak ada hunk source-cut yang menyentuh implementasi `syncTerraResmi`,
`sweepTerraResmi`, isi `SWEEP_TABLE`, atau SQL delete backend. Sebaliknya, perubahan
rollout hanya menyaring penjadwalan otomatis sampai flag unit diaktifkan.

## Temuan proses dan usulan pencegahan

#324 masuk langsung ke `main` pada 7 September 2026 dan tidak masuk ke `staging`.
Divergensi melanggar aturan staging-first dan diam selama tiga hari sampai promosi
berikutnya menemukan konflik. Pemeriksaan yang bergantung pada seseorang mengingat
back-merge bukan gerbang.

Usulan, **belum dipasang** karena keputusan governance milik Dion:

1. Pada CI `staging`, fetch kedua ref lalu merah bila
   `git log --right-only --cherry-pick --no-merges --format=%H origin/staging...origin/main`
   tidak kosong. `--no-merges` mengabaikan merge commit promosi biasa, sedangkan
   `--cherry-pick` membedakan patch main-only nyata seperti dua commit #324.
2. Tambahkan policy PR ke `main` yang hanya menerima head `staging`. Emergency
   hotfix harus masuk `staging` terlebih dahulu atau membuka back-merge otomatis
   yang wajib hijau sebelum promosi berikutnya.

## Gerbang dan sisa risiko

- Agent: 77/77 tes lulus.
- Shared: 16/16 tes lulus.
- Backend: 92 tes lulus; 22 integration test yang memerlukan database uji tetap
  dilaporkan sebagai skip.
- `pnpm check` lulus: 38 migrasi lolos parser SQL, self-test mutasi 9/9,
  typecheck empat workspace lulus, dan 1.599 tes lulus (dashboard 1.414,
  backend 92, agent 77, shared 16). Sebanyak 223 tes berbasis environment tetap
  dilaporkan sebagai skip.
- Typecheck agent, shared, dan backend lulus setelah artefak shared dibangun pada
  worktree baru. Prisma Client berhasil digenerasi.
- Review terstruktur selesai pada artifact
  `/tmp/compound-engineering-501/ce-code-review/20260910-231710-d4c91854`.
- Sisa review yang tidak menghalangi merge: `runManualSweep` masih dapat menulis log
  “selesai” setelah payload terakhir ter-buffer karena backend offline. Mengubah
  kontrak return seluruh walker menyentuh semua domain sapuan dan berada di luar
  resolusi konflik ini; operator wajib memeriksa log `backend offline`/buffer.
- Hot-path tetap menahan DELETE ketika seluruh sumber `tr_hterra` kosong. Ini guard
  sengaja untuk membedakan sumber kosong sah/terpangkas dari penghapusan final;
  penghapusan terakhir ditutup oleh sapuan manual/terjadwal setelah opt-in.

`git diff --check` lulus tanpa whitespace error. Pada pembacaan pertama setelah PR
dibuat, GitHub melaporkan `MERGEABLE` terhadap `staging` yang tepat, tetapi
`mergeStateStatus=BLOCKED`: G4 `arsip` merah karena dua berkas `session-notes/**`
belum menerima label owner `arsip-siklus-kedua`. Label tidak dipasang dan catatan
tidak dihapus oleh Codex; check akan berjalan ulang sendiri sesudah Dion menyatakan
temuannya bertahan satu putaran.

Tidak ada promosi atau PR baru ke `main`, tidak ada deployment, tidak ada akses data
EasyMax/produksi, dan #332 tidak diubah. `apps/agent/solamax-agent-bundle/` tidak
disentuh. Migrasi `0037` tetap beku dengan SHA-256
`54d22821b1338a5ce5c9dfcac440d159e646277a11182e7039fce6ab8ed4bfbd`.
