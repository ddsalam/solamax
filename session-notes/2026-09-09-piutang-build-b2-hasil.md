# SolaMax Piutang - hasil Build B2 dan gerbang publikasi atomik

Tanggal bukti: 2026-09-09 WIB. Branch: `codex/piutang-build-b2`.

## 1. Revisi dan batas eksekusi

- Basis branch: `origin/staging` pada `84dda73fadd3526eaaf59432bfa2e10732620c64`, sesudah PR #326 dan #327 merged.
- Commit B2:
  - `1290840` - kontrak SQL pembangun snapshot;
  - `abeb75d` - materialisasi dan publikasi generasi;
  - `2bb2d14` - worker durable dengan pagar operasional;
  - `5a5e816` - fixture kesetaraan dan atomisitas di RLS staging;
  - `2a19cc7` - hardening lease, recovery, timeout, dan hasil review.
- SHA-256 `0037_saldo_pelanggan_snapshot/migration.sql` tetap
  `54d22821b1338a5ce5c9dfcac440d159e646277a11182e7039fce6ab8ed4bfbd`.
- Bukti database hanya menyentuh instance uji lengkap
  `solamax:asia-southeast2:solamax-pg-rlsstg`, database `solamax`, role
  `ingest`, system identifier `7659054651798528016`.
- Kedua migrasi `0037` dan `0038` aktif dan ukuran database tetap di bawah
  pagar tinjau ulang 9 GB.
- MySQL EasyMax dan instance pilot LIVE
  `solamax:asia-southeast2:solamax-pg` tidak disentuh. Tidak ada data produksi
  yang dibaca atau disalin.
- `apps/agent/solamax-agent-bundle/` milik Dion tidak disentuh dan tetap di luar commit.

## 2. Yang dibangun

Pembangun menerima satu source cut berstatus `complete`, memeriksa evidence dan
kunci pelanggan, lalu membangun:

1. penutup bulan sebelumnya dari full history bila baseline valid belum ada;
2. tanggal target dari baseline tersebut ditambah delta bulan berjalan;
3. manifest lengkap, checksum SHA-256 berkunci row, enam total `NUMERIC`, dan
   pointer aktif dalam satu transaksi publikasi.

Pointer memakai compare-and-swap leksikografis
`(source_cycle_sequence, rebuild_epoch)`. Pembaca hanya dapat memilih manifest
`complete`, `published`, dan `validation_passed`; capture/diff source cut tetap
milik B3 dan jalur baca/cache tetap milik B4.

Worker memegang satu lease global, hanya menyewa pekerjaan pada 02.00-04.45 WIB,
menolak publikasi di luar 02.00-05.00 WIB, dan berhenti menyewa/publikasi ketika
ukuran database mencapai 9 GB. Lease dua menit di-heartbeat tiap 30 detik;
attempt dibatasi 15 menit, statement build 10 menit, dan transaksi publikasi 30
detik. Retry memakai exponential backoff 30 detik sampai 15 menit dengan jitter
0-25 persen dan maksimum lima attempt.

## 3. Kesetaraan snapshot terhadap query langsung

Oracle query langsung dan pembangun membaca baris sintetis yang sama. Lima belas
kombinasi unit/source-cycle/tanggal lulus dengan `missing_keys=0`,
`extra_keys=0`, enam selisih bucket sama dengan nol, dan
`mismatched_cells=0`.

| Kombinasi | Row oracle | Row snapshot | Missing | Extra | Delta APL | Delta EPL | Delta APO | Delta EPO | Delta AHL | Delta EHL | Sel beda |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A/C1/2026-01-31 | 13 | 13 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| A/C1/2026-02-01 | 13 | 13 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| A/C1/2026-02-15 | 13 | 13 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| A/C1/2026-02-20 | 13 | 13 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| A/C1/2026-02-28 | 13 | 13 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| A/C2/2026-01-31 | 13 | 13 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| A/C2/2026-02-01 | 13 | 13 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| A/C2/2026-02-15 | 13 | 13 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| A/C2/2026-02-20 | 13 | 13 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| A/C2/2026-02-28 | 13 | 13 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| A/C3/2026-02-01 | 12 | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| A/C3/2026-02-28 | 12 | 12 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| B/C1/2026-01-31 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| B/C1/2026-02-01 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| B/C1/2026-02-15 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

APL/EPL adalah awal/akhir piutang lokal, APO/EPO adalah awal/akhir piutang
online, dan AHL/EHL adalah awal/akhir hutang lokal.

## 4. Sepuluh kasus sulit wajib

Setiap kasus di bawah berada di fixture yang sama dan diperiksa oleh matriks
kesetaraan di atas. Seluruh kolom delta enam bucket, missing, extra, dan sel beda
adalah nol.

| Kasus sulit | Bukti fixture/oracle | Missing | Extra | Enam delta | Sel beda |
|---|---|---:|---:|---:|---:|
| Pelanggan bersaldo nol | `ZERO` dan `AS-ZERO` tetap menjadi row hasil | 0 | 0 | 0 | 0 |
| Kode bertitik dan tanpa titik | Lokal/Online dipisah oleh format kode, bukan `SJENIS` | 0 | 0 | 0 | 0 |
| `SJENIS` 1, 5, 3, dan 4 | Termasuk `SJENIS=4` bertitik; `N4` tanpa titik keluar dari laporan piutang | 0 | 0 | 0 | 0 |
| `sbatal=1` | Row `CANCEL` tidak mengubah saldo | 0 | 0 | 0 | 0 |
| `bppiut` tanpa master | `99.000.0001` dan `ORPHAN-ND` tetap muncul lewat LEFT JOIN | 0 | 0 | 0 | 0 |
| Unit tanpa kode bertitik | Unit B memiliki seksi Online kosong yang sah | 0 | 0 | 0 | 0 |
| Koreksi back-dated dan flip `sbatal` | C1 -> C2 mengubah amount lama dan membatalkan row lama | 0 | 0 | 0 | 0 |
| Ledger hilang antar-siklus | C2 -> C3 menghapus `P22`; snapshot turun dari 13 ke 12 row | 0 | 0 | 0 | 0 |
| Batas awal dan akhir bulan | 31 Januari, 1 Februari, dan 28 Februari diperiksa eksplisit | 0 | 0 | 0 | 0 |
| Batas tanggal `<` dan `<=` | Awal hari dan akhir hari dibandingkan pada tanggal yang sama | 0 | 0 | 0 | 0 |

## 5. Kontrol merah

Hanya pada copy SQL di fixture, seluruh batas `akhir` sengaja dimutasi dari
`dtgl <= D` menjadi `dtgl < D`. Perintah merah mengaktifkan asersi terbalik yang
mengharapkan kesetaraan dan keluar dengan status 1:

- row berbeda: 7;
- sel berbeda: 8;
- ekspektasi sengaja gagal: `expected 8n to be 0n`;
- cleanup setelah kegagalan: 28/28 hitungan relasi tersedia dan semuanya nol.

SQL produksi tidak diubah oleh kontrol merah.

## 6. Publikasi atomik

Generasi lama G1:

`407604b2-0294-40af-9726-7bd76dc7dd77|13|130|132|958|897|142|127`

Generasi G2 dibangun lebih dahulu hanya dengan enam row. Pembaca tetap melihat
signature G1. Setelah seluruh row G2 dipulihkan, transaksi final dipause sesudah
manifest completion namun sebelum pointer swap; koneksi pembaca kedua tetap
melihat signature G1 yang sama. Sesudah commit, pembaca melihat hanya G2:

`bf3c9fd6-86e6-4c0b-812a-644ae8ff1a89|13|180|182|958|897|142|127`

Tidak ada signature campuran atau generasi separuh jadi yang terlihat.

## 7. Constraint `0038` dan readiness

Probe mencoba melengkapi manifest yang seluruh field completion-nya valid
kecuali `row_count=NULL`. PostgreSQL menolaknya dengan code `23514` pada
constraint `sps_manifest_complete_row_count_required`.

Untuk readiness:

| Keadaan | Hasil baca |
|---|---|
| Manifest masih `building` | 0 numeric row; belum siap |
| Pointer dipaksa ke manifest `building` | ditolak FK, code `23503` |
| Generasi lengkap berisi tiga pelanggan dan seluruh saldo nol | 3 row; siap |

Generasi saldo-nol yang siap adalah
`edae5ea9-a3aa-47c2-a51d-6ae0a04f36be`. Jadi belum siap tidak disimpulkan dari
nilai angka nol.

## 8. Hardening worker hasil review

Review terstruktur memvalidasi delapan temuan dan seluruhnya diperbaiki:

- cleanup fixture tidak lagi menelan kegagalan;
- transaksi interaktif Prisma memakai timeout build/publish yang diterima,
  bukan default lima detik;
- baseline tak-terikat ikut gagal segera ketika attempt lease kedaluwarsa;
- bind, heartbeat, publication, dan completion dipagari `lease_owner` yang
  sama dan lease yang belum kedaluwarsa;
- superseded adalah hasil terminal sukses, bukan dead letter palsu;
- leased work lama dengan queued successor langsung terminal saat retry/reap,
  sehingga tidak melanggar indeks satu pending work per tanggal;
- error nonretryable langsung dead letter pada attempt pertama;
- test service worker mencakup skipped, busy, idle, done, superseded,
  retry-wait, dead-letter, lease-lost, heartbeat, dan penghentian timer.

Bukti live tambahan:

| Skenario lifecycle | Hasil |
|---|---|
| Explicit retry dengan queued successor | work lama `dead_letter` |
| Reap expired lease dengan queued successor | work lama `dead_letter` |
| Bind oleh owner lama | 0 row |
| Complete oleh owner lama | 0 row |
| Baseline tak-terikat milik attempt expired | manifest `failed` |

Reviewer lintas-model tidak menghasilkan artefak karena token OAuth provider
kedaluwarsa. Sesuai alur review, lensa adversarial lokal dipakai sebagai fallback;
tidak ada klaim agreement lintas-model. Validator menerima temuan #1-#8 dan
menolak #9 karena default timeout Prisma lima detik sudah membatasi callback
control-plane worker jauh di bawah lease dua menit.

## 9. Verifikasi dan cleanup

| Pemeriksaan | Hasil |
|---|---|
| Test default backend | 51 lulus, 10 opt-in skip |
| TypeScript typecheck | lulus |
| TypeScript build | lulus |
| Kontrol merah RLS staging | exit 1 sebagaimana diwajibkan |
| Fixture hijau RLS staging | 1 test lulus; 15/15 equality |
| Cleanup kontrol merah | 28/28 relasi nol |
| Cleanup fixture hijau | 28/28 relasi nol |

Percobaan hijau awal sebelum hardening pernah mengenai
`pool_acquire_timeout` pada pagar satu detik; transaksi rollback dan cleanup
28/28 tetap nol. Limit tidak dilonggarkan. Pengulangan bersih lulus, dan run
final setelah hardening lulus tanpa koreksi data atau konfigurasi.

## 10. Batas dan risiko tersisa

- Tidak ada benchmark performa di `solamax-pg-rlsstg`; runtime dan distribusi
  n >= 20 tetap milik B5 pada jalur yang disetujui.
- Builder mempercayai checksum source cut `complete` sebagai kontrak upstream;
  B3 wajib menjaga cut lengkap tetap immutable.
- Reuse baseline lintas source cycle sengaja belum diaktifkan sampai B3 dapat
  membuktikan tidak ada invalidasi back-dated sebelum bulan target.
- Pemulihan global lease expired tetap bergantung pada pemanggilan worker untuk
  unit pemilik lease karena RLS membatasi unit lain.
- Jalur baca B4 masih perlu menetapkan kontrak untuk source cut lengkap dengan
  nol customer, yang saat ini mengembalikan array kosong seperti not-ready.
- Belum ada fault injection dua worker nyata yang memaksa lease berpindah tepat
  saat publikasi, walau mutation fencing dan dua koneksi publikasi sudah diuji.

## 11. Post-deploy monitoring dan validasi

Belum ada deployment pada B2 ini. Saat Dion kelak mengizinkan wiring B3 dan
deployment ke staging, validasi operasionalnya:

- jendela: satu siklus off-peak 02.00-05.00 WIB, lalu amati sekurangnya satu
  retry window 15 menit; owner: Dion atau operator yang ia tunjuk;
- log yang dicari: `lease_lost`, `pool_acquire_timeout`, `attempt_timeout`,
  `pointer_cas_lost`, `manifest_completion_failed`, `lease_expired`, dan
  `superseded_by_pending_successor`;
- sinyal sehat: paling banyak satu work `leased`, heartbeat bergerak setiap 30
  detik, work berakhir `done` atau terminal `superseded`, pointer hanya menunjuk
  manifest lengkap, dan ukuran database di bawah 9 GB;
- sinyal gagal: lease tak bergerak dua menit, retry berulang sampai lima attempt,
  manifest `building` melewati 15 menit, pointer stale tanpa replacement, atau
  database mencapai pagar 9 GB;
- mitigasi: hentikan pemanggilan worker B3, biarkan pointer lama tetap melayani
  pembaca, reap lease/manifes lewat worker unit yang sama setelah penyebabnya
  dipahami, dan jangan rollback migrasi `0037`/`0038` yang sudah dipakai bersama.

## 12. Status gerbang

Build B2 selesai sampai gerbang laporan §4. Tidak ada push, PR, merge, promosi
ke `main`, capture/diff B3, jalur baca/cache B4, atau gold-check/performance B5
yang dilakukan. Branch berhenti untuk keputusan Dion.
