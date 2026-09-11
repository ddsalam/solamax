# Penutupan arc Piutang Fase 1

Tanggal penutupan: 11 September 2026 WIB
Lingkup: investigasi sumber EasyMax, rancangan, penyimpanan snapshot, pembangun,
capture dan invalidasi, jalur baca, layar saldo pelanggan, serta promosi awal ke
produksi.

## Ringkasan eksekutif

Arc ini menyelesaikan **butir #1 Dion: saldo piutang/hutang per pelanggan** dari
investigasi sampai kode produksi. Penyimpanan `0037`/`0038`, pembangun snapshot,
capture source cut, invalidasi, jalur baca transisi, dan layar
`/keuangan/piutang` sudah hidup di produksi. Dua deployment pilot terakhir
berhasil:

- run `34507661903`: `migrate-pilot` sukses dengan keluaran
  `No pending migrations to apply`, kemudian `deploy-pilot` sukses;
- run `34507661927`: `deploy-pilot` sukses.

Tidak ada perubahan skema pada dua run tersebut. Migrasi `0037` dan `0038`
sudah lebih dahulu hidup di produksi sejak promosi PR #328. SHA-256 migrasi
`0037_saldo_pelanggan_snapshot/migration.sql` tetap beku:
`54d22821b1338a5ce5c9dfcac440d159e646277a11182e7039fce6ab8ed4bfbd`.

**Yang hidup belum sama dengan yang menyala.** Agent di tujuh mesin SPBU belum
ditukar, sehingga belum ada `source_cut` nyata yang lengkap dan belum ada
snapshot produksi yang dapat dipublikasikan. Gerbang transisi B4 membuat
permukaan agregat lama tetap membaca ledger; karena itu tiga baris RECAP Laporan
Operasional dan angka piutang modul Keuangan tidak berubah. Layar butir #1 sudah
terpasang tetapi masih menampilkan **belum siap** di ketujuh unit. Cutover terjadi
sendiri per unit/tanggal hanya setelah snapshot valid berstatus `complete`
tersedia.

Butir #2/#3/#4 Dion—tagihan dibuat, dibayar, belum dibayar, dan jatuh tempo—belum
dimulai. Peringatan atau kebijakan limit/tempo juga belum dimulai. B5a sudah
tersegel tetapi belum membuka satu pun dari enam oracle EasyMax; B5b belum dapat
dimulai sebelum ada cut nyata dari kanari.

## Rantai yang dibangun dan mendarat

| PR | Hasil yang ditutup | Keadaan akhir |
|---|---|---|
| [#326](https://github.com/ddsalam/solamax/pull/326) | Konsolidasi bukti investigasi Fase 1 dan rancangan layar saldo pelanggan | merged ke `staging` 9 Sep |
| [#327](https://github.com/ddsalam/solamax/pull/327) | B1: migrasi `0037`/`0038`, kontrak penyimpanan snapshot, RLS, dan penguatan grant | merged ke `staging` 9 Sep |
| [#328](https://github.com/ddsalam/solamax/pull/328) | Promosi awal `staging` ke `main`; membuat `0037`/`0038` hidup di produksi | merged 9 Sep |
| [#329](https://github.com/ddsalam/solamax/pull/329) | B2: pembangun snapshot, worker durable, lease/pagar kapasitas, dan publikasi atomik | merged ke `staging` 10 Sep |
| [#330](https://github.com/ddsalam/solamax/pull/330) | B3: identitas `source_cut`, capture immutable, diff old/new, dirty watermark, dan invalidasi otomatis | merged ke `staging` 10 Sep |
| [#331](https://github.com/ddsalam/solamax/pull/331) | B4: reader snapshot, cache, dan gerbang transisi yang menjaga pemanggil agregat lama | merged ke `staging` 10 Sep |
| [#333](https://github.com/ddsalam/solamax/pull/333) | B6: layar daftar/detail saldo pelanggan serta ekspor CSV/PDF | merged ke `staging` 10 Sep |
| [#334](https://github.com/ddsalam/solamax/pull/334) | Back-merge `main` ke `staging`; menggabungkan sapuan delete-capable `terra_resmi` dengan `source_cut` B3 | merged ke `staging` 10 Sep |
| [#332](https://github.com/ddsalam/solamax/pull/332) | Promosi `staging` ke `main` sesudah back-merge; membawa B2, B3, B4, dan B6 ke produksi | merged 10 Sep |
| [#335](https://github.com/ddsalam/solamax/pull/335) | Usul guard divergensi `main`/`staging` dan fixture B6 yang dapat diklik Dion | merged ke `staging` 11 Sep; guard belum dipasang |

Urutan teknis yang kini ada di kode adalah:

```text
0037/0038
  -> capture source cut lengkap dari tiga full-sync
  -> diff + invalidasi dari tanggal perubahan paling awal
  -> builder dari cut complete
  -> manifest valid + publikasi pointer atomik
  -> reader snapshot yang ketat
  -> wrapper agregat transisi
  -> layar daftar/detail + ekspor
```

### B1 — kontrak penyimpanan

`0037` menambahkan permukaan source cut, manifest perubahan, work queue,
manifest snapshot, pointer, dan row saldo. Sepuluh tabel baru memakai RLS
`ENABLE` + `FORCE`. `dashboard_app` hanya boleh membaca tiga permukaan snapshot;
source capture dan seluruh DML tetap ditolak. `0038` menutup celah SQL tiga-nilai
yang sebelumnya membolehkan manifest `complete` dengan `row_count=NULL`.

Kapasitas diukur tanpa menyalin data produksi. Pada retensi 400 hari ditambah
penutup bulan, puncak dua source cut dan dua generasi snapshot menambah
**3,249 GB**. Bersama ukuran database saat itu, proyeksi puncak memakai **35,1%**
dari disk 15 GB pada `solamax:asia-southeast2:solamax-pg`. Pagar operasionalnya:
builder global-concurrency-1, jendela 02.00–05.00 WIB, dan tinjau ulang ketika
disk mencapai 9 GB atau 60%.

### B2 — pembangun dan publikasi atomik

Builder hanya menerima source cut `complete`. Ia membangun baseline penutup
bulan dan delta bulan berjalan, menghitung checksum serta enam total, lalu
mempublikasikan manifest dan pointer dalam satu transaksi. Pembaca tidak pernah
melihat generasi setengah jadi: selama G2 dibangun ia tetap melihat G1, dan baru
melihat seluruh G2 sesudah pointer swap di-commit.

Fixture sintetis memuat sepuluh kelas sulit: pelanggan saldo nol, kode bertitik
dan tanpa titik, variasi `SJENIS`, `SBATAL=1`, ledger tanpa master, unit tanpa
Online, koreksi back-dated, flip `SBATAL`, key yang hilang antar-cycle, serta
batas awal/akhir bulan dan `<` lawan `<=`. Kesetaraan builder terhadap oracle
query langsung lulus pada 15/15 kombinasi tanpa missing key, extra key, atau
selisih angka.

### B3 — capture dan invalidasi otomatis

Agent baru memberi satu UUID siklus kepada full-sync `pelanggan_master`,
`bppiut`, dan `bphut`, termasuk marker sah untuk domain kosong. Backend membuat
cut hanya setelah ketiganya lengkap. Diff membandingkan full key set, sehingga
DELETE, koreksi back-dated, perubahan klasifikasi, dan flip `SBATAL` terlihat.
Tanggal invalidasi memakai perubahan paling awal; pointer lama ditandai
`pending_replacement` tetapi tidak dipindahkan sebelum pengganti siap.

Kegagalan capture tidak membatalkan mirror utama atau respons `/ingest`.
Kompatibilitas mundur juga disengaja: agent lama tetap dapat sync, tetapi tidak
menghasilkan source cut. Fixture B3 lulus 12/12 kasus, 53/53 perbandingan
snapshot versus query langsung tanpa selisih, dan sepuluh fault stage tetap
menghasilkan ingest 200 dengan mirror committed.

### B4 — reader dan gerbang transisi

Reader rinci hanya membaca pointer ke generasi persis yang manifestnya lengkap,
terpublikasi, dan tervalidasi. Keadaan belum siap tidak membawa angka. Snapshot
lengkap yang benar-benar kosong adalah `ready`; pelanggan dengan enam nilai nol
tetap merupakan row sah. Cache tetap distrust terhadap hasil all-zero.

Permukaan agregat lama memakai kontrak berbeda: per unit/tanggal ia membaca
snapshot bila ready, atau query agregat ledger lama bila belum ready. Ini bukan
fallback per pelanggan dan tidak membuka scan tujuh-unit pada request pengguna.
Tipe hasil `getSaldoPelangganCached` adalah `SaldoPelanggan`, bukan
`SaldoPelanggan | null`, sehingga pemanggil lama mendapat jaminan dari kompiler.

Pada fixture sintetis, snapshot dan ledger sepakat 15/15 dengan nol selisih.
Runtime reader di `solamax:asia-southeast2:solamax-pg-rlsstg` dengan n=30 memberi
p50 141,861 ms dan p95 231,055 ms. Ini bukti fungsional, bukan SLO produksi:
DB uji adalah `db-f1-micro`, cardinality sintetisnya kecil, dan RAM serta beban
jaringannya tidak representatif.

### B6 — layar butir #1

Layar daftar hidup di `/keuangan/unit/[code]/piutang/[date]`; detail memakai
`/keuangan/unit/[code]/piutang/[date]/pelanggan/[customerCode]`. CSV/PDF memakai
seluruh hasil filter, bukan hanya halaman aktif. Piutang Lokal, Piutang Online,
dan Hutang Lokal tetap tiga bucket terpisah; tidak ada netting atau grand total
lintas bucket. Kode pelanggan bertitik menentukan keberadaan seksi Online.

Reader layar bersifat snapshot-only. Snapshot not-ready menghasilkan halaman
tanpa angka, tabel, atau ekspor numerik. Pelanggan enam-nol tetap tampil; kode
pelanggan yang mengandung `/` atau `%` tetap dapat dibuka; akses role dan unit
dijaga server-side; CSV dilindungi dari formula injection. Slot Aktivitas pada
detail sengaja tidak berpura-pura bahwa Tagihan, Pembayaran, Aging, atau
Kebijakan kredit sudah tersedia.

## 🔑 Dua kelas regresi yang nyaris terkirim

### 1. Cutover pembaca mendahului penghasil data

Kelas kegagalannya adalah **setiap komponen benar secara lokal, tetapi urutan
aktivasi sistem salah**. Migrasi benar, reader snapshot benar, cache benar,
rancangan diikuti, dan semua tes unit hijau. Namun B2/B3 belum hidup dan tidak
ada satu agent pun yang mengirim `source_cut`. Mengganti pemanggil lama langsung
ke reader snapshot berarti reader yang benar akan menjawab `not_ready` untuk
semua unit.

Komposisi tersebut akan:

- menghapus tiga baris RECAP saldo dari Laporan Operasional; dan
- membuat baris piutang pada modul Keuangan menjadi `null` atau melempar ketika
  membaca `saldo.akhir`.

Suite tidak menangkapnya. Regresi ditemukan lewat **penelusuran seluruh
pemanggil** API saldo dan pertanyaan sederhana: siapa yang sudah bergantung pada
nilai non-null sebelum writer baru menghasilkan apa pun?

Obatnya memisahkan dua kontrak:

1. reader rinci baru tetap snapshot-only dan ketat `not_ready`;
2. wrapper agregat lama memakai gerbang per unit/tanggal: snapshot ready menang,
   selain itu ledger agregat lama tetap dipakai.

Kontrol merah menghapus kedua fallback sementara dan membuat enam tes gagal;
setelah dipulihkan, seluruh tes fokus kembali hijau. Mengubah return type wrapper
menjadi non-nullable lebih kuat daripada komentar atau disiplin manusia:
kompiler memeriksa seluruh pemanggil pada setiap perubahan dan menolak
kemungkinan regresi yang sama sebelum kode dapat dibangun. Pelajaran umumnya:
cutover bukan sifat satu fungsi; ia sifat komposisi writer, readiness, reader,
cache, dan semua pemanggil yang sudah hidup.

### 2. Hotfix produksi melewati cabang integrasi

Kelas kegagalannya adalah **aturan proses yang hanya hidup dalam ingatan**. PR
#324 memasukkan perbaikan delete-capable `terra_resmi` langsung ke `main`,
melewati aturan staging-first. Perbaikan itu membuat `replace_window` dan sapuan
menghapus row yang sudah lenyap permanen di POS—kelas cacat yang sebelumnya
memerlukan DELETE manual di PostgreSQL.

Patch tersebut hanya ada di `main` selama **3 hari 9 jam 41 menit 16 detik**.
Tidak ada alarm. Divergensi baru terlihat karena B3 kebetulan menyentuh
`apps/agent/src/sync.ts` yang sama. Bila B3 tidak menyentuh berkas itu, promosi
dapat ter-merge bersih dan mengambil tree `staging`, sehingga perbaikan
`terra_resmi` hilang tanpa konflik atau jejak.

PR #334 melakukan back-merge `main` ke `staging` dan menggabungkan—bukan memilih
salah satu sisi—seluruh kemampuan delete-capable dari `main` dengan kontrak
`source_cut` B3 dari `staging`. Audit menunjukkan sembilan berkas main-only lain
semuanya bagian #324; tidak ada hotfix kedua yang tersembunyi.

Pengukuran sejarah menemukan dua episode sebelumnya: #45→#47 selama 28 menit
6 detik dan #90→#91 selama 12 jam 24 menit 12 detik. PR #1–#3 dikeluarkan karena
mendahului terbentuknya `staging`. Jadi #324 bukan kejadian pertama, tetapi
episode terlama dan paling berbahaya.

PR #335 membawa usul guard berbasis patch-difference dengan pengecualian hotfix
eksplisit maksimal 24 jam dan sembilan self-test. PR itu kini sudah merged ke
`staging`, tetapi **hanya artefak usul dan skrip siap tinjau**: belum ada workflow
atau branch protection yang memasangnya. Keputusan governance masih milik Dion.

## Fakta sumber dan angka yang perlu dapat ditemukan kembali

### Formula saldo yang dikunci

- Piutang Lokal: ledger `bppiut`, kode pelanggan tanpa titik, `SJENIS` dalam
  `{1,5}`.
- Piutang Online: ledger `bppiut`, kode pelanggan bertitik, tanpa menyamakan
  Online dengan `SJENIS=3`.
- Hutang Lokal: seluruh `bphut`, dengan tanda penyajian dibalik.
- Semua bucket hanya memakai `COALESCE(SBATAL,0)=0`.
- Awal hari memakai `DTGL < D`; akhir hari memakai `DTGL <= D`.
- Oracle sah adalah EasyMax **DAFTAR SALDO HUTANG PIUTANG**, bukan Laporan
  Penjualan Harian yang memakai definisi saldo awal berbeda.

Formula agregat ini sebelumnya telah direkonsiliasi terhadap oracle EasyMax pada
1.640 titik per pelanggan. Snapshot kemudian dibuktikan setara dengan ledger
secara sintetis. Mata rantai snapshot versus oracle pada data nyata tetap milik
B5b dan belum ditutup.

### Sensus armada 7/7

Pada populasi faktur hidup (`COALESCE(SBATAL,0)=0`):

- 14.743 faktur;
- 6.420 faktur mempunyai `DTGLJT > DTGL`;
- 3.699 berstatus belum lunas (`NSTATUS=0`);
- 11.044 berstatus `NSTATUS=1`, seluruhnya mempunyai pembayaran, nol
  pengecualian pada sensus ini;
- penautan pembayaran ke faktur mempunyai yatim **0** di ketujuh unit.

Porsi tempo sangat berbeda antarunit. Kotabaru justru tertinggi: 4.616 dari
7.275 faktur atau **63,5%**, walaupun lima contoh awal semuanya mempunyai
`DTGLJT=DTGL`. `DTGLJT` juga memuat nilai tak waras, terutama Kotabaru
(−1.080 sampai 32.890 hari), sehingga penggunaannya kelak harus dipagari per
baris dan tidak boleh mengubah tanggal sampah menjadi klaim keterlambatan.

### Arti `SBATAL` pada ledger

`SBATAL=1` mencakup 72,6% `bppiut` dan 78,6% `bphut` pada mirror yang diukur.
Probe waktu, pasangan, prefiks/keterangan, dan kardinalitas menunjukkan bahwa
kelas ini terutama merupakan jejak koreksi, pembalikan, atau penulisan ulang
berulang—bukan sekadar transaksi yang dibatalkan satu kali. Ia tetap tidak boleh
dimasukkan ke saldo aktif. Untuk pertanyaan tagihan yang dibuat, sumber kanonik
adalah modul open-item `tr_htagihan`, bukan histori ledger batal.

### Biaya query

Scan saldo per pelanggan langsung untuk tujuh unit menghasilkan nearest-rank
p95 **5.439,128 ms** pada n=6; empat dari enam run melewati lima detik dan semua
run tumpah ke disk sementara. Jalur itu dilarang menjadi jalur render. Snapshot
di DB uji membaca jauh di bawah satu detik, tetapi angka fungsional tersebut
belum merupakan SLO produksi.

## Pelajaran metode yang dapat dipakai ulang

1. **Lima baris contoh bukan sampel.** Lima baris hanya membuktikan bahwa suatu
   bentuk ada. Ia tidak mengukur proporsi. Klaim “`DTGLJT` tidak dipakai” gugur
   ketika sensus menunjukkan Kotabaru sebagai pemakai tertinggi, 63,5%.
2. **`Empty set` dari satu pola tidak membuktikan ketiadaan.**
   `SHOW TABLES LIKE '%bayar%'` kosong, tetapi `%tagih%` menemukan
   `tr_htagihan`, `tr_dtagihan`, dan tabel pembayaran `tr_byrtagih`. Hasil kosong
   hanya menilai pola pencarian.
3. **Nearest-rank p95 pada n=6 sama dengan maksimum.** Sampel kecil itu dapat
   memicu pagar fungsional, tetapi tidak layak diberi makna distribusi p95.
   Vonis runtime representatif membutuhkan sedikitnya n≥20.
4. **Kolom yang tidak ditarik tidak dapat dibedakan dari kolom yang tidak ada.**
   Mirror hanya berisi delapan kolom ledger yang dipilih agent. Hanya `DESCRIBE`
   pada sumber EasyMax yang dapat membuktikan skema sebenarnya. Prinsip yang
   sama menemukan sembilan kolom `tm_plg` dan ketiadaan limit/tempo.
5. **Berhenti pada klaim yang dijaga kondisi berhentinya.** Hasil tak terprediksi
   pada satu probe membekukan kesimpulan dan pekerjaan yang bergantung padanya;
   pekerjaan independen tetap dapat diteruskan. Ini mencegah satu ketidakpastian
   menjadi alasan menghentikan seluruh arc.
6. **Bedakan sistem dari alat.** Bila sistem mengembalikan keadaan yang tidak
   diprediksi, berhenti dan perbarui model bukti. Bila query, fixture, parser,
   atau harness sendiri rusak, perbaiki alat, buktikan kegagalannya tertutup,
   lalu lanjutkan tanpa mengubah hipotesis agar cocok dengan hasil.

## ⛔ Yang tidak selesai

### Butir produk yang belum dimulai

- **Butir #2/#3/#4 Dion belum dimulai:** daftar tagihan yang dibuat, dibayar,
  belum dibayar, beserta jatuh tempo. EasyMax terbukti mempunyai rantai
  `tr_htagihan -> tr_dtagihan -> tr_byrtagih`; sync domain ini sudah disetujui
  sebagai pekerjaan berdiri sendiri, tetapi belum dibangun.
- **Peringatan dan kebijakan limit/tempo belum dimulai.** `tm_plg` hanya memiliki
  sembilan kolom dan tidak menyimpan limit kredit maupun termin. Master tersebut
  harus menjadi milik SolaMax. Karena koneksi EasyMax mutlak read-only, SolaMax
  dapat memberi status/peringatan dan daftar tindakan, bukan memblokir pompa
  secara otomatis.

### Kemampuan yang terpasang tetapi belum menyala

- **Layar butir #1 dorman di tujuh unit.** Agent lama belum mengirim
  `source_cut`, sehingga snapshot belum ready dan layar menunjukkan belum siap.
- **B5a tersegel, oracle 0/6 belum dibuka.** Dua pembacaan `sync_state` stabil,
  300 prediksi per pelanggan, kontrol nol `PLG0458`, dan absennya seksi Online
  Adisucipto sudah tersegel. Tidak ada prediksi yang boleh disunting setelah
  oracle dibuka.
- **B5b belum dapat dimulai.** Ia harus membuktikan snapshot sama dengan legacy
  pada data produksi setelah kanari menghasilkan cut nyata.
- Runtime produksi representatif dan SLO layar belum diputuskan.

## Gerbang operasi dan keputusan Dion yang masih terbuka

1. **Enam workbook EasyMax untuk B5a.** Masing-masing satu file asli
   **DAFTAR SALDO HUTANG PIUTANG**, saldo akhir hari (`<=`), bukan Laporan
   Penjualan Harian:
   - Adisucipto (`64.781.01` / `6478101`): 1, 4, dan 9 September 2026;
   - 28 Oktober (`63.781.002` / `63781002`): 1, 4, dan 9 September 2026.
2. **Kanari rollout agent satu unit.** Panduan memilih Imam Bonjol
   (`64.781.11` / `6478111`). Enam unit lain tidak ikut sampai cut, snapshot,
   fallback, dan pembacaan layar kanari terbukti.
3. **Keputusan governance guard divergensi.** Skrip dan usul sudah ada di
   `staging` melalui #335, tetapi belum didaftarkan ke `.github/workflows/` dan
   belum menjadi branch protection.
4. **Fixture B6 di DB uji.** Fixture sintetis berada di instance lengkap
   `solamax:asia-southeast2:solamax-pg-rlsstg` dan kedaluwarsa
   **14 September 2026 pukul 01:27 WIB**, atau dibersihkan segera setelah Dion
   selesai. Perintah pembersih:

   ```bash
   psql "${SOLAMAX_RLSSTG_FIXTURE_URL:?kanal fixture DB uji belum disiapkan}" \
     --set=ON_ERROR_STOP=1 \
     --file scripts/piutang-b6/cleanup-rlsstg.sql
   ```

   Bukti berhasil yang wajib muncul:

   ```text
   B6_CLEANUP_OK pointer=0 rows=0 manifest=0 cycle=0 customers=0 assert_zero=1
   ```

Label owner PR #335 merupakan gerbang ketika penutupan ini diminta. Owner
bertindak sesudahnya dan PR #335 sudah merged pada 11 September 2026 01:41 WIB;
jadi label tersebut **bukan lagi gerbang terbuka**. Tidak ada label owner yang
dipasang oleh Codex.

## Temuan bisnis yang belum ditriase

Korek berbeda tajam dari armada: **686 dari 783 faktur (87,6%)** berstatus belum
lunas dan tidak satu pun mempunyai pembayaran tercatat. Pembayaran terakhirnya
bertanggal **27 Juli 2026**, sedangkan faktur terus terbit sampai 7 September.
Di 28 Oktober, pembayaran terakhir bertanggal **16 Juli 2026** sementara faktur
juga terus terbit.

Data yang tersedia tidak dapat membedakan dua tafsir:

1. uang memang belum diterima; atau
2. uang sudah diterima tetapi pembayaran belum diinput ke EasyMax.

Temuan ini tidak menunggu satu baris kode pun dan harus ditriase secara
operasional. Karena arah belum diketahui, **jangan menulis angka rupiah untuk
“belum tertagih” atau arah sebaliknya** pada Korek maupun 28 Oktober.

## Artefak penutup untuk kanari agent

Bundle kanari dibangun setelah promosi dari `origin/main` persis pada commit
`fb2d65cc5fe5678dced2c5f04f4b95afd0f36c09`, merge PR #332. Berkas yang
diserahkan adalah `solamax-agent-main-fb2d65c.zip`, dengan SHA-256:

```text
6ec8b917909fb903eab4a2ea2007060127914029192c3619af93ccc10062176d
```

Berkas pendamping `solamax-agent-main-fb2d65c.zip.sha256` memuat checksum yang
sama dalam format yang dapat diperiksa dengan `shasum -a 256 -c`. Arsip berisi
11 berkas flat dan lulus `unzip -t`; suite agent lulus 77/77 dan typecheck agent
lulus setelah prasyarat build `@solamax/shared`. `config.local.json` di dalamnya
hanya template placeholder, bukan kredensial atau konfigurasi satu unit.
Bundle yang dikompilasi membawa kontrak `source_cut` B3 dan jalur
`replace_window`/sapuan `terra_resmi` hasil back-merge.

## Tambahan penutupan sesudah kanari Imam Bonjol

Bagian ini memperbarui keadaan setelah catatan awal ditulis; bagian lain tidak
ditulis ulang. Dion menukar bundle di Imam Bonjol pada
`2026-09-11T16:03:40Z`. Bukti yang tersedia: SHA-256 `.cjs` di mesin cocok,
proses agent baru, 14/14 domain `sync_state` maju, dan 1.000 request ingest sejak
swap seluruhnya HTTP 200 tanpa 4xx/5xx. Ini bukti negatif yang kuat bahwa
payload yang diterima tidak rusak, tetapi belum membuktikan field opsional
`source_cut` benar-benar dikirim.

### Verifikasi DB ditunda secara sadar

`source_cycle` sesudah swap, kelengkapan `pelanggan_master`/`bppiut`/`bphut`,
generasi snapshot `complete`, dan kontrol negatif enam unit lain **belum diperiksa**.
`SOLAMAX_PILOT_VERIFY_URL` tidak ada karena kanal read-only dengan
akses ke schema `app` memang belum pernah dibuat. `dashboard_ro` ditolak pada
schema tersebut, sedangkan `dashboard_app` hanya boleh membaca tiga permukaan
snapshot; memakai role `ingest` akan memberi tugas baca kredensial yang mampu
menulis produksi dan ditolak.

Bukti penentu menunggu sesudah jendela build 02.00–05.00 WIB: enam angka RECAP
Imam Bonjol tanggal 9 September 2026 harus tetap identik dengan dasar berikut.

| Baris | Awal hari | Akhir hari |
|---|---:|---:|
| Piutang Pelanggan Lokal | Rp 14.747.755.960 | Rp 13.850.356.389 |
| Piutang Pelanggan Online | Rp 900.000 | Rp 900.000 |
| Hutang Pelanggan Lokal | (Rp 768.511.557) | (Rp 703.204.678) |

Snapshot terbit dengan enam angka identik membuktikan rantai `source_cut` sampai,
cycle tertangkap, snapshot dibangun dan dipublikasikan, jalur baca memakainya,
serta nilainya setara ledger pada data nyata. Bila `source_cut` tidak sampai,
mode gagalnya aman: snapshot tidak terbangun, layar tetap “belum siap”, dan
RECAP tetap membaca jalur legacy. Satu angka bergeser menghentikan rollout enam
unit lain.

### Swap bundle tidak boleh menimpa config unit

Zip `solamax-agent-main-fb2d65c.zip` memuat `config.local.json` placeholder.
Ekstrak zip ke folder sementara, lalu salin semua file **kecuali**
`config.local.json` ke `C:\solamax-agent`. Sebelum Task Scheduler menekan Run,
verifikasi `unitCode`, keberadaan `apiKey` tanpa mencetak nilainya, dan
`mysql.database`; Korek harus tetap memakai `easymax_korek`, bukan nilai template
`easymax`.

Dua checksum menjaga objek yang berbeda:

| Objek | Saat diperiksa | SHA-256 |
|---|---|---|
| `solamax-agent-main-fb2d65c.zip` | sebelum ekstrak | `6ec8b917909fb903eab4a2ea2007060127914029192c3619af93ccc10062176d` |
| `C:\solamax-agent\solamax-agent.cjs` | sesudah salin | `bf326a9f3c8ceb2690bbc63c57454d64537dd91ea0510c1fe73b82e7b1af538d` |

Menyilang kedua hash menimbulkan alarm palsu. Usul untuk arc onboarding:
ganti nama template menjadi `config.local.json.contoh` agar ekstraksi tidak
dapat menimpa config hidup. Ini usul, bukan perubahan yang diterapkan, dan
keputusannya milik Dion.

### Sapuan `terra_resmi` belum pernah hidup di produksi

Perbaikan #324 masih inert karena tiga lapis yang harus dibaca bersama:

1. `apps/agent/src/config.ts` memberi
   `terraResmiAutoSweepEnabled` default `false`; kunci yang hilang juga menjadi
   `false`.
2. `apps/agent/src/sync.ts` sengaja mengeluarkan `terra_resmi` dari scheduler
   sampai tangga rollout per unit mengaktifkan flag. Opt-in ini disengaja karena
   sapuan menghapus baris yang lenyap di sumber.
3. Kode #324 mendarat di `main` pada 7 September, tetapi bundle agent baru
   pertama kali ditukar di produksi pada kanari Imam Bonjol malam 11 September.
   Sebelum itu kodenya belum ada di mesin; sesudah swap, config lama Imam Bonjol
   hampir pasti tidak mempunyai kunci baru dan tetap memakai default `false`.

Akibatnya, perbaikan penghapusan permanen sesi tera di POS—yang membutuhkan satu
arc untuk ditemukan dan back-merge #334 untuk dipertahankan—belum pernah
berjalan di produksi. Jangan menyalakannya dalam arc snapshot. Jadikan aktivasi
arc terpisah setelah kanari snapshot tuntas: periksa flag setiap unit, lakukan
pratinjau selisih sumber-versus-Postgres, aktifkan satu unit, amati satu siklus
off-peak dan hasil hapusnya, lalu lanjutkan per unit hanya setelah hasilnya
diterima.

Pemeriksaan read-only di mesin, tanpa mengubah config. Bila Task Scheduler
memakai `--config` atau `SOLAMAX_AGENT_CONFIG`, ganti path di bawah dengan path
config efektif yang dipakai proses agent:

```powershell
powershell -NoProfile -Command "$s=[IO.File]::ReadAllText('C:\solamax-agent\config.local.json');$m=[regex]::Match($s,'["]terraResmiAutoSweepEnabled["]\s*:\s*(true|false)',[Text.RegularExpressions.RegexOptions]::IgnoreCase);if($m.Success){$m.Groups[1].Value}else{'MISSING => effective false'}"
```

### Usul role verifikasi khusus, belum dijalankan

Usulkan role login tersendiri `solamax_pilot_verify_ro` dengan
`NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, tanpa
keanggotaan pada role tulis. Nama tersebut adalah nama usulan; nama final dan
secret ditentukan Dion. Pembuatan login adalah langkah owner dan sengaja tidak
ada pada blok grant berikut, yang baru dijalankan setelah role final ada. Grant
minimum siap-tinjau berikut cukup untuk pemeriksaan pasca-swap; **jangan
jalankan dari sesi ini**:

```sql
ALTER ROLE solamax_pilot_verify_ro SET default_transaction_read_only = on;
GRANT USAGE ON SCHEMA public, app TO solamax_pilot_verify_ro;
GRANT SELECT (unit_id, code, name) ON public.unit
TO solamax_pilot_verify_ro;
GRANT SELECT ON TABLE
  public.sync_state,
  app.saldo_pelanggan_source_cycle,
  app.saldo_pelanggan_source_pelanggan,
  app.saldo_pelanggan_source_bppiut,
  app.saldo_pelanggan_source_bphut,
  app.saldo_pelanggan_snapshot_manifest,
  app.saldo_pelanggan_snapshot_pointer,
  app.saldo_pelanggan_snapshot_row
TO solamax_pilot_verify_ro;
```

Grant kolom pada `public.unit` sengaja tidak mencakup `api_key_hash`; uji penerimaan
role harus membuktikan pembacaan kolom itu ditolak. `public.unit` memang tidak
terkena RLS, sehingga grant kolom ini memperlihatkan identitas seluruh unit tetapi
tidak hash autentikasinya. Tabel `app.saldo_pelanggan_*` tetap terkena FORCE RLS.

Verifikator harus membuka `BEGIN READ ONLY` dan menetapkan `app.unit_ids` secara
transaction-local ke himpunan unit yang sedang diaudit. Sebelum menerima hasil
nol sebagai kontrol negatif, buktikan dalam transaksi yang sama bahwa
`current_setting('app.unit_ids', true)` persis berisi himpunan yang dimaksud dan
`public.sync_state` mengembalikan baris untuk unit-unit itu. Baru setelah kontrol
positif tersebut lulus, nol baris pada tabel sumber/snapshot menjadi bukti yang
sah; unset atau nilai malformed sendiri juga fail-closed ke nol baris dan tidak
boleh disalahartikan sebagai kontrol negatif yang lulus. Usul ini mengubah model
akses produksi dan sepenuhnya menunggu keputusan Dion.

### Paparan kredensial terpisah

Saat menyiapkan verifikasi, orkestrator mencetak password role `dashboard_ro`
ke transkrip. Ini kesalahan orkestrator, bukan Dion dan bukan Codex, serta
terpisah dari paparan `.env.local` yang penundaannya sudah diputuskan sadar.
Password `dashboard_ro` perlu dirotasi; waktu dan pelaksanaannya tetap keputusan
Dion. Tidak ada kredensial yang diputar dalam pekerjaan penutupan ini.

## Kondisi penutupan

Arc Fase 1 ditutup dengan kode butir #1 sudah di produksi tetapi rollout sumber
belum dimulai. Kelanjutan yang sah bukan memperluas implementasi pada branch
ini, melainkan tindakan Dion pada workbook B5a, kanari satu unit, cleanup
fixture, dan keputusan governance. Catatan sesi lama tetap dipertahankan sebagai
bukti per langkah; berkas ini hanya menjadi indeks naratif penutupnya. **Jangan
mulai pekerjaan baru dari branch penutupan ini.**
