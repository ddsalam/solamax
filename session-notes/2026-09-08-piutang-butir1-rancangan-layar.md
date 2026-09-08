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

## 1. Vonis dan batas rancangan

Pengukuran lulus: snapshot penutup bulanan + delta memotong jumlah baris ledger
secara berarti. Rekomendasi tunggal dokumen ini adalah **snapshot harian dalam
tabel aplikasi yang dipublikasikan atomik, dibangun dari snapshot penutup bulan
sebelumnya + delta bulan target**. Materialized view tidak dipilih karena
publikasi per-unit, provenance per generasi, keadaan `building|complete|failed`,
dan invalidasi tanggal-tertentu lebih alami serta lebih aman pada tabel aplikasi.
Snapshot bulanan tanpa snapshot tanggal-target juga tidak dipilih sebagai jalur
render: request pengguna tidak boleh menunggu scan delta ledger.

Rancangan ini tidak membutuhkan rekap armada agar berguna. Pemilih unit yang
sudah menjadi pola modul Keuangan membawa pengguna ke satu unit; setiap layar
membaca satu snapshot `(unit,tanggal)`. Rekap armada kelak hanya lapisan
opsional yang membaca snapshot lengkap ketujuh unit, bukan `bppiut`/`bphut`
langsung.

Query kandidat yang sebelumnya berhenti di p95 5.854,166 ms dinyatakan benar
secara konstruksi dan dipertahankan sebagai **builder bootstrap + oracle teknis**.
Ia tidak boleh dipanggil dari request pengguna dan tidak diukur ulang pada arc
ini.

## 2. Tujuh keputusan layar

### 2.1 Dua layar dan rute persis

Gunakan dua layar read-only di modul Keuangan:

1. daftar unit/tanggal:
   `/keuangan/unit/[code]/piutang/[date]`;
2. detail pelanggan:
   `/keuangan/unit/[code]/piutang/[date]/pelanggan/[customerCode]`, dengan
   `customerCode = encodeURIComponent(trim(ckdplg))` dan resolusi selalu bersama
   `unit.unit_id`, tidak pernah dengan kode saja.

Daftar adalah layar kerja utama. Detail pada Fase 1 hanya mengulang identitas,
provenance snapshot, dan enam angka pelanggan dalam ruang yang lebih mudah
dibaca; nilainya berasal dari row snapshot yang sama, bukan query kedua. Alasan
tetap menyediakan layar detail sekarang adalah rutenya menjadi rumah stabil
bagi slot tagihan/tempo/aging kelak tanpa mengubah navigasi atau identitas.

Tautan masuk ditempatkan dari laporan keuangan harian unit dan dari navigasi
Keuangan. `UnitDateFilters` tetap pola pemilih unit/tanggal. Tidak ada halaman
armada yang diwajibkan untuk menuntaskan pekerjaan ini.

### 2.2 Tiga bucket tanpa netting tersirat

Setiap baris pelanggan mempunyai tiga blok kolom yang dipisahkan secara visual:

| Pelanggan | Piutang Lokal | Piutang Online* | Hutang Lokal |
|---|---|---|---|
| kode + nama | Awal · Akhir | Awal · Akhir | Awal · Akhir |

Header `Awal` wajib menulis `dtgl < D · s.d. D−1`; header `Akhir` wajib menulis
`dtgl ≤ D · s.d. D`. Tanda angka dipertahankan, termasuk Hutang Lokal yang
dinegatifkan oleh formula. Tidak ada kolom “Total”, grand total gabungan,
subtotal lintas bucket, atau warna yang menyiratkan bahwa ketiganya boleh
dijumlah/netto. Catatan tetap di atas tabel: **“Tiga bucket berbeda; jangan
dijumlahkan atau dinetokan.”** Pada layar sempit, satu pelanggan menjadi kartu
dengan tiga blok yang urutannya sama—bukan tabel yang memotong kolom.

`* Piutang Online` presence-gated sesuai §7; kolomnya tidak tampil bila unit
belum mempunyai kode bertitik.

### 2.3 Pelanggan nol tetap ada tanpa menenggelamkan yang bersaldo

Default tetap **Semua pelanggan**, bukan filter “bersaldo”. Urutan pertama
adalah baris yang sedikitnya satu dari enam angkanya nonnol, lalu baris
nol-semua; di dalam masing-masing kelompok urut nama A–Z lalu kode. Ini hanya
predikat boolean `OR`, bukan penjumlahan bucket. Baris nol-semua mendapat badge
`Saldo nol pada kedua batas` dan angka `Rp0` eksplisit pada seluruh sel.

Kontrol cepat `Semua · Bersaldo · Saldo nol` boleh mempersempit tampilan, tetapi
default dan ekspor tanpa filter tetap memasukkan pelanggan nol. Pencarian selalu
dapat menemukan pelanggan nol meski ia berada di halaman belakang.

### 2.4 Urutan, pencarian, dan paginasi

Pencarian bersifat case-insensitive atas `trim(ckdplg)` dan nama label. Sort
default adalah `ada salah satu dari enam nilai nonnol DESC, nama ASC, kode ASC`;
sort alternatif hanya nama atau kode. Tidak ada sort berdasarkan “saldo
terbesar” lintas bucket karena itu akan menciptakan ukuran gabungan baru.

Render **50 pelanggan sekaligus**. Kotabaru adalah unit terberat menurut ledger,
dengan 1.205 pelanggan atau 25 halaman; kapasitas browsing per-unit terbesar
saat ini adalah Imam Bonjol, 2.973 pelanggan atau **60 halaman**. Sebanyak 6.393
baris armada tidak pernah dirender dalam satu DOM. Snapshot lengkap
`(unit,tanggal)` boleh di-cache di server; pencarian/filter/sort/pagination
diterapkan server-side atas rowset itu, dan browser hanya menerima 50 baris
beserta hitungan hasil. Nomor halaman dan filter hidup di query string agar
tautan bisa dibagikan.

### 2.5 Keadaan belum siap

Manifest, bukan isi angka, memutuskan kesiapan:

- `building` tanpa generasi lengkap sebelumnya: panel berjudul **“Data saldo
  sedang disiapkan”**, menyebut unit dan tanggal target, dan tidak menampilkan
  angka target;
- `building` dengan generasi lengkap sebelumnya: generasi lama tetap tampil
  melalui pointer aktif, dengan waktu sumbernya dan banner **“Data sedang
  diperbarui—menampilkan data per …”**;
- `failed` tanpa generasi lama: **“Data saldo belum siap”** dengan waktu upaya
  terakhir dan jalur pelaporan, bukan enam nol;
- `failed` dengan generasi lama: generasi lengkap lama tetap tampil dengan
  banner **“Pembaruan gagal—menampilkan data per …”**;
- `complete`: angka boleh tampil, termasuk snapshot sah yang seluruhnya nol.

Snapshot kosong tanpa manifest `complete`, manifest `complete` dengan jumlah
row tidak cocok, atau generasi parsial selalu “belum siap”. Tidak ada fallback
ke scan ledger di request pengguna.

### 2.6 Ekspor

Sediakan **PDF + CSV**, bukan XLSX. Ini mengikuti keputusan mengikat
`KEUANGAN-HARIAN.md` §10.19: Excel dapat membuka CSV dan dashboard tidak perlu
konvensi/dependensi XLSX baru. Keduanya mengekspor seluruh hasil filter, bukan
hanya 50 baris pada halaman aktif; pelanggan nol tetap ikut bila filter
`Semua` dipilih.

Kop PDF memakai `KopKeuangan`/`ptLabelForUnits` yang sudah ada:

- PT sesuai unit ber-scope;
- judul `Daftar Saldo Hutang Piutang per Pelanggan`;
- subjudul `SPBU [kode] · [nama] · Tanggal D`;
- waktu pembuatan WIB dan identitas pencetak;
- nomor `halaman / total`.

Catatan kaki PDF dan metadata awal CSV wajib memuat:

> Saldo awal memakai transaksi `dtgl < D` (s.d. D−1); saldo akhir memakai
> `dtgl <= D` (s.d. D). Piutang Lokal, Piutang Online, dan Hutang Lokal adalah
> tiga bucket terpisah dan tidak dijumlahkan/netto. Hanya baris
> `COALESCE(sbatal,0)=0`. Snapshot formula [versi], dihitung [waktu WIB] setelah
> siklus sumber [id/waktu].

CSV mempunyai kolom identitas unit, kode/nama pelanggan, tanggal dan batas,
serta enam angka bucket terpisah. Nol ditulis `0`; keadaan belum siap ditulis
`belum siap` dan ekspor angka dinonaktifkan, tidak menjadi sel kosong.

PDF dan CSV adalah permukaan server tersendiri, sehingga setiap action/handler
ekspor wajib mengulang kontrak akses secara mandiri: panggil `getDataScope()`,
selesaikan kode URL dengan `scope.requireUnit(code)`, tolak peran yang gagal
`canViewLaporanKeuangan`, validasi tanggal/filter/sort, lalu query hanya dengan
`ScopedUnitId` hasil scope. Guard halaman tidak dianggap memberi otorisasi pada
handler ekspor. Yang boleh dipakai ulang hanya cache rowset
`(unit,tanggal,generation_id)`; artefak ekspor yang memuat identitas pencetak
tidak di-cache lintas pengguna.

Sebelum quoting CSV, seluruh teks asal sumber—kode/nama unit dan pelanggan serta
teks lain—melewati sanitizer spreadsheet bersama. Bila karakter pertama setelah
whitespace adalah `=`, `+`, `-`, atau `@`, atau nilai dimulai tab/CR, sanitizer
mem-prefix seluruh nilai dengan apostrof ASCII (`'`) sebagai penanda teks aman;
setelah itu barulah `selCsv` menangani koma, kutip, dan newline. Enam nilai saldo
hasil builder memakai jalur numerik terpisah agar tetap berupa angka, bukan teks.

### 2.7 Slot masa depan yang tidak dibangun

Di bawah ringkasan enam angka pada rute detail, sisakan region stabil
`Aktivitas pelanggan`. Fase 1 tidak merender tab kosong. Kontrak layout dan
rute menyediakan empat slot yang kelak dapat diaktifkan tanpa memindahkan
ringkasan saldo:

1. `Tagihan` — butir #2, daftar tagihan yang dibuat;
2. `Pembayaran` — butir #3 dan pembayaran sebagian;
3. `Belum dibayar & Aging` — butir #4, jatuh tempo, sumber tempo, dan kualitas
   `DTGLJT`;
4. `Kebijakan kredit` — limit, peringatan, serta status blokir.

Daftar utama juga menyisakan slot metadata/badge di ujung kanan, tetapi tidak
menampilkan badge tagihan, aging, limit, atau blokir sebelum sumber dan
semantiknya disetujui. Dengan demikian Fase 1 tidak berpura-pura memiliki data
yang belum dicerminkan.

## 3. Kontrak angka yang diwarisi

Tidak ada formula baru:

- Piutang Lokal = `bppiut`, master `sjenis IN (1,5)` **dan** kode tanpa titik;
- Piutang Online = `bppiut`, kode bertitik, **tanpa** filter `sjenis`;
- Hutang Lokal = seluruh `bphut`, lalu dinegatifkan;
- seluruh ledger memakai `COALESCE(sbatal,0)=0`;
- `awal` memakai `dtgl < D`; `akhir` memakai `dtgl <= D`;
- kunci baris berasal dari union master, piutang, dan hutang agar pelanggan nol
  tetap hadir;
- identitas selalu `(unit_id, trim(ckdplg))`; nama hanyalah label saat baca.

Baris `SBATAL=1` **tidak ditampilkan sebagai riwayat** pada kedua layar maupun
ekspor. Bukti S1–S4 menunjukkan populasi itu terutama jejak
koreksi/pembalikan/penulisan ulang berulang; melabelinya “dibatalkan” akan salah.

Snapshot menyimpan keenam nilai sebagai PostgreSQL `NUMERIC` pada presisi uang
ledger. `SUM`, penutup bulan, delta, dan penjumlahan baseline+delta seluruhnya
tetap `NUMERIC`; hanya ada **satu** cast ke `float8` pada boundary output/API
yang sama dengan `getSaldoPelanggan`. Dengan demikian enam keluaran `float8`
yang sudah diterima tetap persis, dan penyaji tetap memakai konvensi Rupiah
Keuangan yang ada. Dokumen ini tidak memperkenalkan pembulatan, nilai absolut,
netting, clamp, atau decimal-string UI baru; perubahan kontrak reader menjadi
decimal string harus kembali sebagai keputusan terpisah kepada Dion.

**KEPUTUSAN DION:** setiap permintaan kelak untuk menggabungkan tiga bucket,
mengubah tanda Hutang, menyembunyikan pelanggan nol dari default, atau mengubah
aturan pembulatan adalah perubahan angka yang dilihat dan harus kembali kepada
Dion. Rancangan dapat dibangun tanpa keputusan tersebut karena seluruhnya
mempertahankan perilaku kini.

## 4. Bentuk snapshot yang direkomendasikan

### 4.1 Dua tabel konseptual, satu publikasi atomik

`app.saldo_pelanggan_snapshot_manifest` mempunyai beberapa generasi immutable
per `(unit_id, as_of_date)` dengan: `generation_id`, `formula_version`,
`status building|complete|failed`, `base_month_end`, `source_cycle_id`, waktu
selesai sumber, `computed_at`, `published_at`, jumlah row, checksum enam nilai,
jumlah row sumber per domain, checksum berkunci per domain,
`source_cycle_sequence`, `rebuild_epoch`, dan ringkasan kegagalan. Satu pointer
aktif terpisah per `(unit_id, as_of_date)` menunjuk generasi lengkap yang boleh
dibaca. Generasi `building` tidak pernah menggantikan atau menyunting generasi
aktif lama.

`app.saldo_pelanggan_snapshot_row` mempunyai grain yang disepakati
`(generation_id, as_of_date, unit_id, trim(ckdplg))` dan enam nilai bucket
`NUMERIC`. Nama tidak disalin ke tiap snapshot; ia dijoin dari master saat baca
sebagai label. Kode kosong/null tidak boleh dibuang atau digabung ke kode buatan:
builder harus menggagalkan generasi dan melaporkan pelanggaran invariant bila
ia muncul pada populasi hidup.

Builder membuat manifest `building`, menulis seluruh row ke `generation_id`
baru, lalu dalam satu transaksi memeriksa jumlah row, keunikan per
`(unit,kode)`, checksum deterministik berkunci atas
`(unit,tanggal,kode,enam NUMERIC)`, rekonsiliasi enam total, count/checksum source
cut, dan provenance. Checksum berkunci wajib menangkap pertukaran nilai antar
pelanggan yang total agregatnya kebetulan sama. Hanya setelah semuanya lulus
status menjadi `complete` dan pointer aktif berpindah. Setiap build memegang
lease/advisory lock single-writer per `(unit_id,as_of_date)`;
perpindahan pointer memakai compare-and-swap yang hanya menerima tuple
`(source_cycle_sequence,rebuild_epoch)` yang lebih baru dari pointer aktif.
Retry dengan idempotency key yang sama tidak membuat publikasi ganda, sedangkan
generasi yang kalah urutan menjadi `failed` dengan alasan `superseded` dan tidak
boleh dipublikasikan. Generasi lama tetap aktif bila pembangunan gagal. RLS
berkunci `unit_id` tetap wajib pada manifest dan row: tabel memakai
`ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`, policy pembaca memakai
`USING`, policy penulis builder memakai `WITH CHECK`, dan identitas builder tidak
boleh menjadi bypass lintas-unit tanpa scope siklus yang sedang dikerjakan.

### 4.2 Penutup bulan + delta bulan target

Untuk target `D` pada bulan `M`, builder mengambil snapshot lengkap akhir bulan
`M−1`, lalu membaca mutasi hidup hanya pada `[awal M, D]`:

```text
awal_bucket(D)  = akhir_bucket(M−1) + Σ mutasi [awal M, D)
akhir_bucket(D) = akhir_bucket(M−1) + Σ mutasi [awal M, D]
```

Seluruh operand dan hasil antara formula itu `NUMERIC`; cast `float8` tidak
boleh muncul pada baseline, delta, atau row snapshot. Baseline M−1 hanya sah
bila manifestnya `complete`, versi formula cocok, serta row count dan checksum
berkuncinya lulus. Bila penutup M−1 belum ada atau korup, job background
menjalankan full-history oracle §6 untuk membangun dan memvalidasi penutup itu,
mempublikasikannya lebih dahulu, lalu melanjutkan target D. Bootstrap ini
diserialkan per unit, tunduk pada budget §4.7, dan tidak pernah dijalankan dari
request pengguna. Bentuk builder internal mempertahankan semua predicate/grain
oracle tetapi menahan hasil `SUM` sebagai `NUMERIC`; cast pada SQL §6 tetap
hanya boundary kompatibilitas output pembanding.

Tanda, filter master, format kode, dan klasifikasi bucket pada delta identik
dengan query oracle §6. Kunci target adalah union kunci snapshot dasar, master
saat ini, dan kode ledger bulan target. Pada hari pertama bulan, `awal(D)` sama
dengan snapshot akhir bulan sebelumnya; `akhir(D)` menambahkan mutasi hari itu.
Penutup bulan adalah target `D` pada hari terakhir bulan, jadi satu algoritme
melayani hari berjalan, tanggal historis, dan baseline bulan berikutnya.

Request pengguna **hanya membaca hasil yang sudah dipublikasikan**. Delta
bulanan berjalan di builder latar, bukan di request.

### 4.3 Kesegaran relatif terhadap full-sync

Ledger saldo dan master saat ini ikut cadence master default sekitar satu jam.
Snapshot tidak berjalan menurut jam yang menebak kapan sumber selesai. Untuk
setiap unit, ia dipicu hanya setelah satu siklus bernomor menyatakan
`pelanggan_master`, `bppiut`, dan `bphut` seluruhnya berhasil diterima. Kegagalan
salah satu domain tidak boleh menghasilkan snapshot campuran.

Input builder adalah **source cut immutable** per `(unit,source_cycle_id)`,
bukan tiga mirror hidup. Setiap domain full-sync masuk ke staging siklusnya
sendiri; chunk tidak mengubah cut yang sudah dipromosikan. Setelah ketiga domain
lengkap, completion evidence memverifikasi jumlah row, keunikan key, dan checksum
deterministik atas `(unit,domain,primary-key,kolom-relevan)` untuk masing-masing
domain. Source cut, completion evidence, dan change manifest lalu dipromosikan
bersama dalam satu transaksi. Siklus berikutnya menulis staging/cut berbeda,
sehingga tidak dapat mengubah data yang sedang dibaca builder siklus N. Builder
wajib membaca tepat `source_cycle_id` pada manifestnya dan gagal—tidak “maju”
ke mirror hidup atau cut N+1—bila cut itu hilang/tidak lengkap. Cut dipertahankan
sampai semua generasi yang bergantung padanya selesai atau masuk jalur pemulihan
eksplisit.

Sesudah siklus lengkap:

1. tandai generasi target hari berjalan `building`;
2. bangun dari penutup bulan + delta;
3. validasi, pre-warm rowset immutable dengan kunci
   `(unit,D,generation_id)`, lalu publikasikan pointer secara atomik dengan
   aturan urutan §4.1;
4. bersihkan cache generasi lama secara best-effort dan pre-warm tanggal hari
   berjalan/H−1 serta tanggal historis yang baru dipublikasikan, mengikuti pola
   `solamax-warm-board` secara sekuensial.

TTL tetap mengikuti `saldo-cache.ts`: historis `≤ H−2` selama 24 jam; hari
berjalan dan H−1 selama 120 detik. Di antara full-sync dan publikasi, pengguna
melihat generasi lengkap lama beserta waktu sumbernya dan banner pembaruan,
bukan row parsial.

### 4.4 Full-sync tanpa watermark dan invalidasi back-dated

Karena full-sync tidak membawa watermark perubahan, “tanggal mana berubah”
belum tersedia gratis. Implementasi snapshot wajib memakai staging source cut
§4.3 untuk membandingkan full key set baru terhadap cut yang sedang aktif, lalu
menambahkan manifest perubahan pada jalur ingest—bukan menebak dari
`MAX(dtgl)`:

- untuk INSERT/UPDATE/flip `sbatal`, catat tanggal terdampak paling awal dari
  `min(old.dtgl,new.dtgl)` per `(source_cycle_id,unit,ledger)`;
- untuk key ledger yang ada pada cut lama tetapi tidak ada pada full-sync baru,
  rekam DELETE sebelum cut lama diganti dan gunakan `old.dtgl` sebagai tanggal
  terdampak; full-sync kosong tetap merupakan full key set sah yang harus
  direkonsiliasi, bukan payload yang boleh diabaikan;
- perubahan `sjenis` atau kunci pada `pelanggan_master` dapat mereklasifikasi
  seluruh histori Piutang Lokal; itu menginvalidasi sejak snapshot tertua yang
  disimpan untuk unit tersebut;
- penghapusan/re-key pelanggan master diperlakukan seperti perubahan kunci:
  diff lama-vs-baru merekam tanggal snapshot tersimpan paling awal untuk unit
  sebelum mirror dipromosikan, agar angka lama tidak bertahan tanpa klasifikasi
  barunya;
- perubahan nama saja tidak mengubah angka karena nama dijoin sebagai label;
- setiap perubahan memperbarui **dirty watermark durable per unit** dalam
  transaksi yang sama dengan UPSERT/DELETE-nya:
  `dirty_invalid_from = LEAST(existing,changed_date)`. Watermark tidak terikat
  kelulusan satu cycle, tetap hidup melewati cycle gagal/ditinggalkan, dan baru
  boleh dibersihkan setelah seluruh target tersimpan sejak tanggal itu mempunyai
  pointer generasi dari source cut lengkap yang mencakup perubahan dan berhasil
  dipublikasikan;
- dari `dirty_invalid_from`, tandai pointer aktif yang terdampak
  `stale/pending-replacement` tetapi **jangan** menonaktifkan atau memindahkannya.
  Bangun generasi pengganti berurutan dari penutup bulan sehat terakhir, lalu
  tukar tiap pointer hanya setelah generasi barunya lolos validasi.

Menangkap old/new pada UPSERT serta diff key yang hilang memang pekerjaan
tambahan—itulah biaya eksplisit akibat full-sync tanpa watermark. Cut lama tidak
boleh di-truncate/diganti sebelum bukti UPDATE/DELETE dan dirty watermark
tersimpan atomik bersama promosi cut baru. Sampai source cut, manifest
perubahan, dirty watermark, dan penanda siklus lengkap tersedia, pipeline
snapshot belum layak dirilis. Tidak ada fallback scan request untuk menutupi
prasyarat ini.

### 4.5 Retensi dan ukuran

Rekomendasi retensi:

- snapshot harian lengkap untuk 400 hari terakhir;
- snapshot penutup setiap bulan dipertahankan sejak data pertama;
- tanggal lebih tua dari 400 hari yang bukan penutup bulan dibangun async dari
  penutup bulan sebelumnya ketika diminta, dipublikasikan sebagai snapshot
  biasa, lalu boleh dibersihkan setelah 30 hari tidak diakses;
- manifest audit dipertahankan walau row generasi gagal/tergantikan dibersihkan.

Dengan 6.393 pelanggan saat ini, batas atas sederhana adalah 2.557.200 row
untuk 400 hari. Rentang sumber tertua Oktober 2011 hingga Agustus 2026 mempunyai
179 penutup bulan; setelah menghindari duplikasi 13 bulan yang masih ada di
retensi harian, tambahan batas atas 1.061.238 row. Total batas atas stabil
sekitar **3.618.438 row**. Ini sengaja konservatif karena memakai seluruh 6.393
pelanggan juga untuk bulan sebelum mereka ada.

Dengan perkiraan 160–240 byte per row termasuk indeks utama, lalu headroom 30%
untuk tuple/index/bloat, kebutuhan steady-state snapshot aktif sekitar
**0,8–1,2 GB**. Angka itu belum mencakup generasi pengganti sementara, source
cut staging, dan snapshot historis on-demand yang belum melewati TTL. Untuk
peak rebuild, kapasitas awal wajib menyediakan setidaknya 2× batas atas row
snapshot (**2,4 GB pada ujung atas estimasi**) ditambah ukuran terukur satu
source cut penuh; cache eksternal dihitung terpisah. Row generasi
`failed`/`superseded` dibersihkan dalam 24 jam setelah audit tersimpan, source
cut dibersihkan setelah tidak ada work/generasi yang merujuknya, dan snapshot
on-demand mengikuti 30 hari tidak diakses. Manifest jauh lebih kecil. Semua ini
perkiraan desain, bukan pengukuran tabel; implementasi wajib mengukur
`pg_total_relation_size`, ruang peak dua-generasi, staging, dan efektivitas
cleanup pada fixture representatif sebelum retensi dikunci operasional.

### 4.6 Jalur mundur ketika snapshot gagal

Urutannya tunggal: pertahankan pointer ke generasi `complete` lama + banner
stale/pending-replacement; bila
belum pernah ada generasi lengkap, tampilkan “Data saldo belum siap”. Ekspor
target dinonaktifkan. Sistem mencatat dan mengekspos waktu kegagalan serta unit
yang terkena kepada operator. Ia tidak memanggil query full-history, query delta,
atau rekap tujuh-unit dari request pengguna.

### 4.7 Recovery work dan budget beban produksi

Antrean build bersifat durable dan terpisah dari status manifest. Setiap work
memakai idempotency key `(unit,date,source_cycle_id,rebuild_epoch)` dan state
`queued|leased|retry_wait|dead_letter|done`. Lease berlaku 2 menit, worker
heartbeat tiap 30 detik, dan satu attempt dibatasi 15 menit. Reaper berjalan
setiap menit: lease kedaluwarsa mengubah manifest `building` menjadi `failed`
retryable dan mengantrekan attempt berikutnya. Maksimum lima attempt memakai
backoff `min(30 detik × 2^(attempt−1), 15 menit)` + jitter 0–25%. Sesudah batas
itu work masuk `dead_letter`; operator dapat manual-replay dengan `rebuild_epoch`
baru. Sepanjang recovery, pointer lengkap terakhir tetap dilayani. Rebuild
kronologis tidak melompati tanggal gagal yang menjadi baseline tanggal berikut;
tanggal itu diselesaikan atau di-replay dahulu.

Completion full-sync hanya **enqueue setelah transaksi ingest commit**, tidak
pernah menjalankan/menunggu builder atau pre-warm di dalam transaksi ingest.
Work queued untuk `(unit,date)` dikoales menjadi `source_cycle_id` terbaru;
work lama yang sudah leased boleh selesai tetapi CAS §4.1 menolaknya. Siklus
tanpa perubahan material ledger/klasifikasi menjadi no-op: tidak membangun row,
tidak memindah pointer, dan hanya mencatat completion. Nama-only tidak memicu
rebuild angka karena nama dibaca sebagai label. Advisory lock memberi
single-flight per `(unit,date)`.

Budget awal produksi adalah **global concurrency 1** untuk keseluruhan rangkaian
bootstrap/build, validasi-publish, dan pre-warm—bukan satu per unit. Worker hanya
boleh memakai satu koneksi builder dan harus menyisakan sedikitnya satu koneksi
pool untuk traffic request; bila headroom itu tidak tersedia, waktu tunggu pool
melewati 1 detik, atau terjadi pool timeout, work kembali `retry_wait` dengan
backoff di atas. Statement build dibatasi 10 menit dan transaksi publikasi 30
detik; timeout tidak boleh memindah pointer. Metrik wajib: queue age, stale age,
attempt/build/pre-warm duration, row dibaca/ditulis, no-op/coalesced/superseded,
lease expiry, retry/dead-letter, pool wait/timeout, dan latency/error request
saldo. Concurrency baru boleh dinaikkan setelah load test bersamaan atas tujuh
full-sync, builder, pre-warm, serta page read representatif membuktikan pool
headroom dan SLO request tetap aman.

## 5. Pengukuran baris bulanan

Pengukuran read-only dilakukan setelah commit pra-registrasi `7fb5ca0`, pada
batas 2026-08-31. Seluruh hitungan memakai `COALESCE(sbatal,0)=0`.

| Unit | `bppiut` histori / Ags | `bphut` histori / Ags | Gabungan histori | Gabungan Ags | Rasio Ags |
|---|---:|---:|---:|---:|---:|
| Imam Bonjol | 60.383 / 1.106 | 44.360 / 772 | 104.743 | 1.878 | 1,793% |
| Bakau | 80.170 / 236 | 8.277 / 57 | 88.447 | 293 | 0,331% |
| Adisucipto | 550 / 190 | 123 / 39 | 673 | 229 | **34,027%** |
| Kotabaru | 344.923 / 1.312 | 37.924 / 138 | 382.847 | 1.450 | **0,379%** |
| Batu Layang | 102.314 / 357 | 2.018 / 267 | 104.332 | 624 | 0,598% |
| Korek | 5.964 / 250 | 161 / 31 | 6.125 | 281 | 4,588% |
| 28 Oktober | 169.009 / 440 | 22.622 / 271 | 191.631 | 711 | 0,371% |
| **Armada** |  |  | **878.798** | **5.466** | **0,622%** |

Hasil utama lulus jauh di bawah 25%: armada sekitar **161×** lebih sedikit dan
Kotabaru sekitar **264×** lebih sedikit. Ini adalah pengurangan **struktural
jumlah row kandidat**, bukan bukti runtime, jumlah page fisik yang benar-benar
dibaca, atau kapasitas produksi; row batal/index path dapat membuat biaya fisik
berbeda dan harus dibuktikan lewat load test §4.7. Adisucipto yang baru
diakuisisi adalah pengecualian deskriptif yang diprediksi: penyebut historinya
baru 673 row.
Absolutnya tetap hanya 229 row, sehingga ia tidak membatalkan pemotongan sumber
biaya struktural pada unit berat.

Distribusi gabungan ledger per bulan selama Sep 2025…Ags 2026:

| Unit | Min | Median | Maks | Total 12 bulan |
|---|---:|---:|---:|---:|
| Imam Bonjol | 1.603 | 1.855,0 | 1.984 | 22.147 |
| Bakau | 285 | 310,0 | 360 | 3.757 |
| Adisucipto | 0 | 8,5 | 229 | 673 |
| Kotabaru | 1.216 | 1.417,0 | 1.562 | 16.726 |
| Batu Layang | 150 | 342,5 | 637 | 4.785 |
| Korek | 123 | 261,0 | 307 | 2.923 |
| 28 Oktober | 499 | 610,0 | 711 | 7.305 |

Hitungan master tepat 6.393: IB 2.973, Bakau 630, AS 5, Kotabaru 1.205, Batu
Layang 537, Korek 191, dan 28 Oktober 852. Master tetap biaya tetap satu kali;
ledger-lah yang dipotong dari seluruh histori menjadi satu bulan.

SQL pengukuran yang dijalankan:

```sql
WITH ledger AS (
  SELECT 'bppiut'::text AS ledger, unit_id, dtgl
  FROM public.bppiut
  WHERE COALESCE(sbatal,0)=0 AND dtgl <= DATE '2026-08-31'
  UNION ALL
  SELECT 'bphut'::text AS ledger, unit_id, dtgl
  FROM public.bphut
  WHERE COALESCE(sbatal,0)=0 AND dtgl <= DATE '2026-08-31'
)
SELECT ledger, unit_id, count(*) AS history_rows,
       count(*) FILTER (
         WHERE dtgl BETWEEN DATE '2026-08-01' AND DATE '2026-08-31'
       ) AS august_rows
FROM ledger
GROUP BY ledger, unit_id
ORDER BY unit_id, ledger;
```

## 6. Query builder bootstrap dan oracle teknis

Fungsi implementasi kelak wajib menerima satu `ScopedUnitId` ber-brand dari
`getDataScope()` dan tanggal tervalidasi. SQL berikut adalah kandidat yang sudah
diukur; parameter `$1` adalah unit itu dan `$2` adalah `D`. Ia membangun row
dari union master/piutang/hutang dan tidak membuang saldo nol.

```sql
WITH customer_keys AS (
  SELECT trim(ckdplg) AS ckdplg
  FROM public.pelanggan_master WHERE unit_id = $1
  UNION
  SELECT trim(ckdplg) FROM public.bppiut
  WHERE unit_id = $1 AND COALESCE(sbatal,0)=0 AND dtgl <= $2
  UNION
  SELECT trim(ckdplg) FROM public.bphut
  WHERE unit_id = $1 AND COALESCE(sbatal,0)=0 AND dtgl <= $2
), customer_labels AS (
  SELECT trim(ckdplg) AS ckdplg, max(vcnmplg) AS customer_name
  FROM public.pelanggan_master
  WHERE unit_id = $1
  GROUP BY trim(ckdplg)
), local_customer_keys AS (
  SELECT trim(ckdplg) AS ckdplg
  FROM public.pelanggan_master
  WHERE unit_id = $1 AND sjenis IN (1,5)
  GROUP BY trim(ckdplg)
), piut AS (
  SELECT trim(b.ckdplg) AS ckdplg,
    COALESCE(sum(b.njumlah * CASE b.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END)
      FILTER (WHERE m.ckdplg IS NOT NULL
        AND NOT COALESCE(position('.' in trim(b.ckdplg)) > 0,false)
        AND b.dtgl < $2),0)::float8 AS awal_piutang_lokal,
    COALESCE(sum(b.njumlah * CASE b.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END)
      FILTER (WHERE m.ckdplg IS NOT NULL
        AND NOT COALESCE(position('.' in trim(b.ckdplg)) > 0,false)),0)::float8
      AS akhir_piutang_lokal,
    COALESCE(sum(b.njumlah * CASE b.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END)
      FILTER (WHERE COALESCE(position('.' in trim(b.ckdplg)) > 0,false)
        AND b.dtgl < $2),0)::float8 AS awal_piutang_online,
    COALESCE(sum(b.njumlah * CASE b.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END)
      FILTER (WHERE COALESCE(position('.' in trim(b.ckdplg)) > 0,false)),0)::float8
      AS akhir_piutang_online
  FROM public.bppiut b
  LEFT JOIN local_customer_keys m ON m.ckdplg = trim(b.ckdplg)
  WHERE b.unit_id = $1 AND COALESCE(b.sbatal,0)=0 AND b.dtgl <= $2
  GROUP BY trim(b.ckdplg)
), hut AS (
  SELECT trim(h.ckdplg) AS ckdplg,
    (-COALESCE(sum(h.njumlah * CASE h.sjnsbp WHEN 2 THEN 1 WHEN 1 THEN -1 ELSE 0 END)
      FILTER (WHERE h.dtgl < $2),0))::float8 AS awal_hutang_lokal,
    (-COALESCE(sum(h.njumlah * CASE h.sjnsbp WHEN 2 THEN 1 WHEN 1 THEN -1 ELSE 0 END),0))::float8
      AS akhir_hutang_lokal
  FROM public.bphut h
  WHERE h.unit_id = $1 AND COALESCE(h.sbatal,0)=0 AND h.dtgl <= $2
  GROUP BY trim(h.ckdplg)
)
SELECT $1::smallint AS unit_id, k.ckdplg, l.customer_name,
  COALESCE(p.awal_piutang_lokal,0)::float8 AS "awalPiutangLokal",
  COALESCE(p.akhir_piutang_lokal,0)::float8 AS "akhirPiutangLokal",
  COALESCE(p.awal_piutang_online,0)::float8 AS "awalPiutangOnline",
  COALESCE(p.akhir_piutang_online,0)::float8 AS "akhirPiutangOnline",
  COALESCE(h.awal_hutang_lokal,0)::float8 AS "awalHutangLokal",
  COALESCE(h.akhir_hutang_lokal,0)::float8 AS "akhirHutangLokal"
FROM customer_keys k
LEFT JOIN customer_labels l ON l.ckdplg IS NOT DISTINCT FROM k.ckdplg
LEFT JOIN piut p ON p.ckdplg IS NOT DISTINCT FROM k.ckdplg
LEFT JOIN hut h ON h.ckdplg IS NOT DISTINCT FROM k.ckdplg;
```

Pengukuran `EXPLAIN (ANALYZE, BUFFERS)` terdahulu pada Kotabaru, 2026-08-31,
menghasilkan 1.205 row:

| n | Observasi (ms) | Median | p95 nearest-rank |
|---:|---|---:|---:|
| 6 | 5.854,166 · 3.238,989 · 3.802,796 · 3.567,413 · 3.206,779 · 3.173,191 | **3.403,201** | **5.854,166** |

Vonisnya bukan dibatalkan: query full-history ini builder/oracle latar, bukan
jalur render. Ia boleh dipakai untuk bootstrap dan gold-check internal setelah
sync lengkap, dengan beban terjadwal dan per-unit.

## 7. Cache, presence-gate Adisucipto, dan akses

Pembaca lebih dulu mengambil pointer aktif kecil dari manifest, lalu membaca
cache immutable `(unit,tanggal,generation_id)` + pre-warm. Setelah pointer
berpindah, cache generasi lama tidak lagi terjangkau walau proses mati sebelum
cleanup; invalidasi cache bukan syarat correctness. Generalisasi
`shouldBypassEmptySaldo` memeriksa seluruh rowset: bila tidak ada row atau
seluruh enam angka seluruh pelanggan nol dari **cache**, abaikan hit itu dan
baca snapshot+manifest segar. Hasil segar all-zero hanya boleh disajikan bila
manifest `complete`, jumlah row sama dengan populasi kunci, dan checksum lulus.
Jadi unit yang benar-benar nol membayar read snapshot tambahan, bukan menerima
angka salah.

`hasOnlineCustomer` dihitung dari **seluruh snapshot sebelum filter, search,
sort, dan pagination**:

```text
hasOnlineCustomer := any(position('.' in trim(ckdplg)) > 0)
```

Jika false, blok/kolom Piutang Online tidak tampil tetapi unit dan dua bucket
lain tetap normal. Satu kode bertitik—meski keenam nilainya nol—membuat bloknya
muncul otomatis. Tidak ada hardcode unit 3, daftar pengecualian, atau flag.

Kedua route **dan setiap action/handler PDF/CSV secara mandiri** memanggil
`getDataScope()`, lalu `scope.requireUnit(code)`, kemudian menolak pembaca yang
gagal `canViewLaporanKeuangan`; seluruh parameter tanggal/filter/sort divalidasi
sebelum query. Peran yang dapat melihat:
`keuangan`, `direksi`, `admin_perusahaan`, dan `super_admin`; `pengawas` tidak.
Setiap fungsi query menerima `ScopedUnitId`, dan RLS adalah lapisan kedua—bukan
pengganti pemeriksaan scope pemanggil. Cache bersama hanya menyimpan rowset
unit/tanggal/generasi; artefak ekspor beridentitas pencetak tidak dibagikan
lintas pengguna.

## 8. Gold-check implementasi kelak

Minta Dion empat berkas EasyMax **“DAFTAR SALDO HUTANG PIUTANG”** `.xlsx`:

- Kotabaru per 2026-08-30 dan 2026-08-31 (unit terberat);
- Adisucipto per 2026-08-30 dan 2026-08-31 (unit baru dan presence-gate Online).

Untuk setiap unit, bandingkan seluruh pelanggan per `(unit,kode)` dan ketiga
bucket **akhir** pada batas `dtgl <= tanggal`, termasuk pelanggan nol. Berkas
D−1 juga harus sama dengan tiga nilai `awal` snapshot D. Cocok total saja tidak
cukup. “Laporan Penjualan Harian” tidak boleh dipakai sebagai oracle karena ia
memakai saldo awal.

## 9. Daftar uji yang mengunci rancangan

1. SQL formula: Piutang Lokal memakai `sjenis {1,5}` + nondotted; Online dotted
   tanpa filter `sjenis`; Hutang seluruh `bphut` dan dinegatifkan; ketiganya
   mengecualikan `SBATAL=1`.
2. Batas tanggal: transaksi D hanya mengubah `akhir(D)`, dan
   `akhir(D−1) = awal(D)` per pelanggan/bucket.
3. Union kunci mempertahankan pelanggan master nol dan kode yang hanya muncul
   pada salah satu ledger; tidak ada join lintas unit.
4. Agregat enam kolom semua row snapshot sama persis dengan
   `getSaldoPelanggan(unit,D)`.
5. Builder penutup-bulan+delta sama per pelanggan dengan query oracle
   full-history pada awal, tengah, dan akhir bulan, termasuk bulan tanpa mutasi
   dan nilai pecahan seperti `0.10 + 0.20`. Baseline dan delta tetap `NUMERIC`
   lalu cast `float8` tepat sekali di output. Baseline yang hilang/korup memicu
   bootstrap background full-history yang harus lolos count, keyed checksum,
   dan enam total sebelum target D dilanjutkan; request tidak menjalankannya.
6. Manifest/publikasi: `building`, `failed`, row count/checksum salah, dan
   generasi parsial tidak pernah menjadi aktif; publikasi berpindah atomik.
   Dua builder berurutan/bersamaan tidak dapat membuat cycle lebih lama aktif;
   retry idempotent, CAS menolak generasi superseded, dan source cut N tidak
   pernah membaca chunk N+1. Worker yang mati tanpa melepas lease direap dan
   di-retry dengan backoff; attempt habis masuk dead-letter dan manual replay
   memulihkan urutan tanpa melepas fallback lengkap lama.
7. Invalidasi: UPDATE/flip `sbatal`, DELETE/omission ledger, perubahan/hilang/
   re-key master semuanya berasal dari diff full key set lama-vs-baru. Perubahan
   bertanggal X menandai X dan sesudahnya stale tetapi generasi complete lama
   tetap terbaca sampai penggantinya valid; perubahan nama hanya mengganti
   label. Abort setelah batch perubahan lalu retry yang `skip-unchanged` tetap
   mempertahankan dirty watermark sampai publikasi yang mencakupnya berhasil.
8. Cache: rowset cached nol-semua selalu dibaca ulang; fresh all-zero hanya
   tampil dengan manifest lengkap; empty snapshot tanpa manifest berarti belum
   siap. Cache memakai `generation_id`; crash setelah pointer swap tetapi
   sebelum cleanup tidak pernah menghidupkan rowset generasi lama.
9. Presence-gate AS: unit tanpa kode bertitik tidak error/tidak hilang dan blok
   Online absen; menyisipkan satu kode bertitik bernilai nol membuat blok muncul
   tanpa config.
10. Scope/akses: route layar dan setiap handler PDF/CSV menerima
    `ScopedUnitId`; kode unit di luar scope, parameter invalid, dan peran
    non-Keuangan gagal sebelum query snapshot; RLS tetap memisahkan unit dan
    artefak ekspor personal tidak bocor melalui cache bersama.
11. Daftar: sort stabil, search kode/nama, filter nol, pagination 50, dan browser
    tidak menerima lebih dari satu halaman; fixture Imam Bonjol 2.973 pelanggan
    menghasilkan 60 halaman dan halaman terakhir berisi 23 row.
12. Ekspor: PDF/CSV memakai rowset filter yang sama dengan layar, bukan halaman;
    enam angka, nol eksplisit, batas tanggal, provenance, kop, pencetak, dan
    catatan anti-netting hadir. Kode/nama sumber dengan `=HYPERLINK(...)`,
    `+cmd`, `-2+3`, `@SUM(...)`, leading whitespace, tab/CR, koma, kutip, dan
    newline dinetralisasi/di-quote sebagai teks, sementara enam saldo tetap
    numerik.
13. Gold integration: seluruh row Kotabaru/AS pada empat oracle `.xlsx` cocok;
    D−1 oracle cocok dengan `awal(D)`.
14. Guard sumber: tidak ada handler route yang membaca `bppiut`/`bphut` atau
    memanggil builder/oracle; rekap armada, bila ditambah, hanya membaca snapshot.
15. Budget refresh: tujuh completion full-sync bersamaan tetap menghasilkan
    global concurrency satu termasuk pre-warm; enqueue terjadi setelah commit,
    no-op dilewati, cycle queued dikoales, pool-pressure memicu backoff, dan load
    test menjaga headroom serta latency/error page read sebelum concurrency naik.

## 10. Koreksi metode yang dapat dipakai ulang

Nearest-rank p95 dengan `n=6` selalu observasi ke-6, yaitu maksimum:
`ceil(0,95×6)=6`. Agar rank p95 berada di bawah maksimum dibutuhkan **n≥20**.
Pengukuran performa mendatang yang mengklaim p95 nearest-rank harus
mem-praregistrasi urutan run/cache dan memakai sedikitnya 20 observasi; n kecil
boleh melaporkan median+max, tetapi tidak menyamarkan max sebagai tail estimate
yang stabil. Pelajaran ini tidak membuka ulang vonis snapshot pada query kini.

## 11. Pagar tempo yang diturunkan derajatnya

`DTGLJT−DTGL` 0…365 hari adalah **default sementara yang belum diukur**, bukan
angka terkunci. Yang terbukti baru Bakau sah sampai 101 hari dan Kotabaru
mengandung nilai sampai 32.890 hari; sebaran 102…32.889 belum diukur. Ia dapat
diukur tanpa probe POS tambahan begitu modul tagihan dicerminkan, dengan
distribusi per-unit atas populasi tagihan mirror sebelum aturan produk
ditentukan. Tidak satu pun angka tempo dipakai oleh butir #1.

## 12. Yang masih belum diketahui

- Bentuk final penanda siklus lengkap dan change-manifest old/new pada jalur
  full-sync; keduanya prasyarat implementasi snapshot.
- Ukuran tabel sesungguhnya, rasio kompresi/index, dan waktu pembangunan harian;
  0,8–1,2 GB adalah estimasi konservatif.
- SLA maksimum usia snapshot yang diterima Finance ketika agent/unit offline.
- Apakah kode null/kosong pernah muncul pada populasi ledger hidup; builder
  dirancang gagal-terlihat, bukan membuangnya.
- Hasil gold-check Kotabaru dan Adisucipto yang akan diminta saat implementasi.
- Apakah rekap armada kelak dibutuhkan; layar per-unit tidak bergantung padanya.

## 13. Yang sengaja tidak dirancang

- Butir #2/#3/#4: tagihan dibuat, dibayar, dan belum dibayar.
- Sync `tr_htagihan`, `tr_dtagihan`, atau `tr_byrtagih`.
- Aging, jatuh tempo, `NSTATUS`, dan pembayaran sebagian.
- Limit kredit, peringatan, serta status/aksi blokir.
- Triase sinyal Korek dan 28 Oktober.
- Riwayat `SBATAL=1`.
- Materialized view, scan tujuh-unit langsung, dan fallback ledger di request.
- Migrasi, tabel nyata, job, route, komponen, atau kode produk apa pun.

## 14. Rumah permanen

Sesudah Dion menerima rancangan dan implementasi benar-benar dibuka, keputusan
mengikatnya dipindahkan ke `apps/dashboard/PIUTANG-PELANGGAN.md`, mengikuti pola
`KEUANGAN-HARIAN.md`/`KETAATAN-ADMINISTRASI.md`, lalu ditautkan dari `CLAUDE.md`
di sebelah dokumen Keuangan. Session note ini tetap sebagai bukti kronologis,
termasuk pra-registrasi dan pengukuran; vault tidak disentuh ulang.

## 15. Batas sistem

**SolaMax tidak bisa memblokir pelanggan di pompa.** Koneksi EasyMax `SELECT`-only
(aturan tak-bisa-dinegosiasi #1, `CLAUDE.md`), dan blokir kredit hidup di POS.
Yang bisa dibangun: peringatan + status di dalam SolaMax + daftar perintah untuk
pengawas. **Penegakannya tetap manusia.** Jangan pernah menulis kata
"pemblokiran otomatis" di UI, dokumen, atau laporan.
