# Panduan verifikasi B6 — Saldo Piutang per Pelanggan

Tanggal panduan: 10 September 2026 WIB  
Ditujukan kepada: Dion  
Sifat: pemeriksaan tampilan; tidak perlu membaca kode

## Sebelum mulai

Gunakan hanya dua alamat kanonik berikut. Jangan memakai hostname Cloud Run
lain yang juga mengarah ke service yang sama, karena login Auth.js dapat gagal
bila host berbeda dari `AUTH_URL`.

- **Lingkungan uji**: `solamax-dashboard-rlsstg`, terhubung ke database uji
  `solamax:asia-southeast2:solamax-pg-rlsstg`:
  `https://solamax-dashboard-rlsstg-113869564052.asia-southeast2.run.app`
- **Pilot LIVE**: `solamax-dashboard-staging`, terhubung ke database pilot LIVE
  `solamax:asia-southeast2:solamax-pg`:
  `https://solamax-dashboard-staging-113869564052.asia-southeast2.run.app`

Layar ini boleh dilihat oleh peran **keuangan**, **direksi**,
**admin_perusahaan**, dan **super_admin**. Peran **pengawas tidak boleh
melihatnya**: grup Keuangan tidak ditampilkan dan URL yang diketik langsung
harus berakhir 404. Menyembunyikan menu bukan pengaman utama; setiap rute dan
ekspor tetap memeriksa izin di server.

Nama fitur sehari-hari adalah `/keuangan/piutang`, tetapi rute yang diputuskan
untuk satu unit dan tanggal adalah
`/keuangan/unit/[code]/piutang/[date]`. Detail pelanggan memakai
`/keuangan/unit/[code]/piutang/[date]/pelanggan/[customerCode]`. Kode pelanggan
selalu milik unit yang sedang dibuka; kode yang sama di dua unit tidak pernah
digabung.

Tanggal pemeriksaan tetap di panduan ini adalah **9 September 2026**, hari
selesai terakhir ketika panduan dibuat. Bila pemeriksaan dilakukan pada tanggal
lain, buat salinan panduan dengan URL bertanggal baru; jangan menebak dari URL
lama.

## Tahap 1 — lingkungan uji sebelum promosi

Prasyarat tahap ini: fixture sintetis B6 sudah dipasang di database uji
`solamax:asia-southeast2:solamax-pg-rlsstg`, dan alamat-alamat di bawah sudah
dicatat oleh pembuat fixture. Fixture bukan salinan data produksi.

1. **Keadaan siap dan tata letak.** Buka
   `https://solamax-dashboard-rlsstg-113869564052.asia-southeast2.run.app/keuangan/unit/6478111/piutang/2026-09-09`.
   Yang harus terlihat: judul Daftar Saldo Hutang Piutang per Pelanggan,
   identitas Imam Bonjol dan tanggal 9 September 2026, serta tiga blok terpisah
   **Piutang Lokal**, **Piutang Online**, dan **Hutang Lokal**. Masing-masing
   mempunyai kolom **Awal (`dtgl < D`, s.d. D−1)** dan **Akhir (`dtgl <= D`,
   s.d. D)**. Harus ada catatan bahwa ketiga bucket tidak boleh dijumlah atau
   dinetokan; tidak boleh ada grand total gabungan. Tombol PDF dan CSV harus
   aktif dan mengekspor seluruh hasil filter, bukan hanya halaman yang tampak.
   Yang berarti gagal: satu bucket hilang/tertukar, tanda Hutang diubah, batas
   tanggal tak tertulis, ada total gabungan, atau ekspor hanya berisi 50 baris.
2. **Pelanggan nol tetap dapat ditemukan.** Buka
   `https://solamax-dashboard-rlsstg-113869564052.asia-southeast2.run.app/keuangan/unit/6478111/piutang/2026-09-09?q=NOL%2F02&filter=semua&sort=default&page=1`.
   Yang harus terlihat: pelanggan fixture berkode `NOL/02`, badge **Saldo nol
   pada kedua batas**, dan enam nilai `Rp0`. Pada URL tanpa pencarian di langkah
   1, pelanggan bersaldo harus berada lebih dahulu dan pelanggan nol menyusul;
   default tetap **Semua**, bukan “Bersaldo”. Yang berarti gagal: pelanggan nol
   hilang, pencarian tidak menemukannya, atau nilai nol pelanggan itu dipakai
   untuk menyatakan seluruh snapshot belum siap.
3. **Pencarian, filter, dan paginasi.** Buka
   `https://solamax-dashboard-rlsstg-113869564052.asia-southeast2.run.app/keuangan/unit/6478111/piutang/2026-09-09?filter=semua&sort=kode&page=2`.
   Yang harus terlihat: **Halaman 2**, 50 pelanggan per halaman, dan pilihan
   filter/sort tetap terpilih. Ubah pencarian ke `NOL/02`; URL harus membawa
   `q=NOL%2F02` dan hasil kembali menemukan pelanggan nol walaupun semula berada
   di halaman belakang. Yang berarti gagal: halaman memuat seluruh fixture
   sekaligus, pilihan hilang saat berpindah halaman, atau pencarian hanya bekerja
   pada 50 baris yang sedang tampak.
4. **Unit tanpa Online.** Buka
   `https://solamax-dashboard-rlsstg-113869564052.asia-southeast2.run.app/keuangan/unit/6478101/piutang/2026-09-09`.
   Yang harus terlihat: snapshot Adisucipto tetap siap dengan Piutang Lokal dan
   Hutang Lokal, sedangkan seluruh blok **Piutang Online tidak ditampilkan**.
   Yang berarti gagal: halaman error, blok Online kosong tetap dipaksakan, atau
   data Lokal/Hutang ikut hilang.
5. **Keadaan belum siap.** Buka
   `https://solamax-dashboard-rlsstg-113869564052.asia-southeast2.run.app/keuangan/unit/6378301/piutang/2026-09-09`.
   Yang harus terlihat: panel **Data saldo belum siap** yang menyebut Bakau,
   tanggal, alasan manusiawi, dan tindakan berikutnya. Tidak boleh ada
   tabel, enam angka, atau ekspor numerik. Yang berarti gagal: keadaan ini tampak
   sebagai `Rp0`, tabel kosong, spinner tanpa akhir, atau kode internal.
6. **Campuran siap/belum siap.** Buka kembali URL Imam Bonjol pada langkah 1,
   lalu URL Bakau pada langkah 5 tanpa mengubah tanggal. Yang harus terlihat:
   Imam Bonjol tetap berisi angka fixture dan Bakau tetap
   belum siap; keadaan satu unit tidak menular ke unit lain. Yang berarti gagal:
   keduanya dipaksa menjadi seragam atau angka/unit pertama terbawa ke URL
   kedua.
7. **Rute detail stabil.** Buka
   `https://solamax-dashboard-rlsstg-113869564052.asia-southeast2.run.app/keuangan/unit/6478111/piutang/2026-09-09/pelanggan/NOL%2F02`.
   Yang harus terlihat: identitas `NOL/02`, provenance snapshot, dan enam angka
   yang sama dengan daftar. Ruang Aktivitas pelanggan boleh menjadi slot masa
   depan, tetapi tidak boleh menampilkan tab Tagihan/Aging/Limit yang berpura-
   pura sudah ada. Yang berarti gagal: detail membaca unit lain, angkanya berbeda
   dari daftar, atau kode bergaris miring merusak rute.

**Kondisi berhenti dan lapor tahap 1:** hentikan tahap ini dan kirim tangkapan
layar beserta URL jika satu saja keadaan fixture tidak dapat dibedakan dengan
jelas—terutama bila keadaan belum siap berubah menjadi angka nol atau tabel
kosong.

## Tahap 2 — pilot LIVE sesudah promosi, sebelum satu pun agent ditukar

Pada tahap ini B2/B3 sudah dipromosikan ke pilot LIVE, tetapi bundle agent lama
masih berjalan di seluruh tujuh mesin SPBU. Karena belum ada `source_cut`, layar
piutang rinci **memang harus belum siap**. Keadaan ini bukan kerusakan dan tidak
boleh diakali dengan scan ledger per pelanggan.

### 2A. Periksa ketujuh unit

Buka seluruh URL berikut satu per satu:

1. Imam Bonjol: `https://solamax-dashboard-staging-113869564052.asia-southeast2.run.app/keuangan/unit/6478111/piutang/2026-09-09`
2. Bakau: `https://solamax-dashboard-staging-113869564052.asia-southeast2.run.app/keuangan/unit/6378301/piutang/2026-09-09`
3. Adisucipto: `https://solamax-dashboard-staging-113869564052.asia-southeast2.run.app/keuangan/unit/6478101/piutang/2026-09-09`
4. Bundaran Kotabaru: `https://solamax-dashboard-staging-113869564052.asia-southeast2.run.app/keuangan/unit/6478106/piutang/2026-09-09`
5. Batu Layang: `https://solamax-dashboard-staging-113869564052.asia-southeast2.run.app/keuangan/unit/6478201/piutang/2026-09-09`
6. Korek: `https://solamax-dashboard-staging-113869564052.asia-southeast2.run.app/keuangan/unit/6478311/piutang/2026-09-09`
7. 28 Oktober: `https://solamax-dashboard-staging-113869564052.asia-southeast2.run.app/keuangan/unit/63781002/piutang/2026-09-09`

Di setiap URL, lihat panel utama. Yang benar adalah tulisan manusiawi bahwa data
saldo belum siap karena unit belum mengirim cut dan sedang menunggu pembaruan
agent di mesin SPBU. Tidak boleh ada enam angka `Rp0`, grand total nol, atau
tabel kosong yang menyamarkan ketidaksiapan. Tombol ekspor angka harus
dinonaktifkan.

Yang berarti gagal: salah satu unit menampilkan nol/kosong seolah-olah itu data
sah, menampilkan kode alasan internal, atau menjalankan lama lalu tetap mencoba
menampilkan hasil.

### 2B. Pastikan dua laporan lama tidak kehilangan saldo

1. Buka **Laporan Operasional Harian** Imam Bonjol di
   `https://solamax-dashboard-staging-113869564052.asia-southeast2.run.app/unit/6478111/laporan/2026-09-09`.
   Turun ke bagian **Saldo Hutang/Piutang & Recap Harian**. Tiga baris **Saldo
   Piutang Pelanggan Lokal**, **Saldo Piutang Pelanggan Online**, dan **Saldo
   Hutang Pelanggan Lokal** harus tetap menampilkan kolom Awal hari/Akhir hari
   seperti sebelum B6. Baris tidak boleh hilang atau berubah menjadi kosong
   hanya karena snapshot rinci belum siap.
2. Buka **Laporan Keuangan Harian** Imam Bonjol di
   `https://solamax-dashboard-staging-113869564052.asia-southeast2.run.app/keuangan/unit/6478111/2026-09-09`.
   Turun ke panel **Balance Sheet**, lalu lihat baris **Hutang piutang pelanggan
   EasyMax**. Angka harus tetap tampil seperti sebelum B6; ia masih dilayani
   gerbang transisi B4 sampai snapshot lengkap tersedia.

Yang berarti gagal: salah satu saldo lama hilang, menjadi `null`, atau berubah
menjadi nol bersamaan dengan layar rinci yang belum siap.

**Kondisi berhenti dan lapor tahap 2:** bila satu unit menampilkan nol alih-alih
“belum siap”, atau satu baris saldo hilang dari salah satu laporan lama, jangan
menukar agent mana pun; laporkan URL, unit, tanggal, dan tangkapan layarnya.

## Tahap 3 — sesudah kanari satu unit

### Usul kanari: Imam Bonjol saja

Kanari yang diusulkan adalah **Imam Bonjol (`64.781.11` / `6478111`)**, tepat
satu unit. Imam Bonjol adalah pilot awal dan unit yang paling lama diamati di
operasi SolaMax; rekonsiliasi historisnya juga paling luas. Itu memberi jejak
pembanding dan jalur rollback yang paling dikenal sambil membatasi risiko ke
satu mesin. **Jangan menukar enam mesin lain pada tahap ini.**

Tahap 3 baru dimulai sesudah bundle yang disetujui ditukar dan proses agent
Imam Bonjol direstart, satu `source_cut` tiga-domain selesai diterima di
`solamax:asia-southeast2:solamax-pg`, dan worker selesai memublikasikan snapshot
historis **9 September 2026** dari cut lengkap itu. Tidak ada seed snapshot
manual yang dijanjikan; bila target historis itu belum dibangun, halaman tetap
belum siap dan Tahap 3 belum boleh dinilai.

1. Buka kanari Imam Bonjol di
   `https://solamax-dashboard-staging-113869564052.asia-southeast2.run.app/keuangan/unit/6478111/piutang/2026-09-09`.
   Yang harus terlihat: tabel pelanggan dengan angka nyata dan provenance siklus
   sumber, bukan panel belum siap. Yang berarti gagal: masih belum siap setelah
   worker dinyatakan selesai, provenance tak ada, atau angka seluruhnya nol tanpa
   bukti snapshot nol yang sah.
2. Pastikan enam unit lain belum ikut berpindah dengan membuka:

   - `https://solamax-dashboard-staging-113869564052.asia-southeast2.run.app/keuangan/unit/6378301/piutang/2026-09-09`
   - `https://solamax-dashboard-staging-113869564052.asia-southeast2.run.app/keuangan/unit/6478101/piutang/2026-09-09`
   - `https://solamax-dashboard-staging-113869564052.asia-southeast2.run.app/keuangan/unit/6478106/piutang/2026-09-09`
   - `https://solamax-dashboard-staging-113869564052.asia-southeast2.run.app/keuangan/unit/6478201/piutang/2026-09-09`
   - `https://solamax-dashboard-staging-113869564052.asia-southeast2.run.app/keuangan/unit/6478311/piutang/2026-09-09`
   - `https://solamax-dashboard-staging-113869564052.asia-southeast2.run.app/keuangan/unit/63781002/piutang/2026-09-09`

   Yang harus terlihat: keenamnya masih **Data saldo belum siap** dan menyebut
   bahwa unit menunggu pembaruan agent. Yang berarti gagal: salah satu memuat
   angka rinci sebelum bundle unit itu pernah ditukar, atau menampilkan nol
   sebagai pengganti status.

### Bandingkan baris pelanggan, bukan hanya total

Di EasyMax Imam Bonjol, buka laporan **DAFTAR SALDO HUTANG PIUTANG** untuk
tanggal yang sama dengan URL kanari. **Jangan memakai Laporan Penjualan
Harian**; laporan itu memakai definisi saldo awal yang berbeda. Cocokkan kode
pelanggan baris demi baris pada seksi Piutang Lokal, Piutang Online bila
dicetak, dan Hutang Lokal. Untuk batas akhir, kolom `SALDO` EasyMax harus cocok
dengan kolom **Akhir (`dtgl <= D`, s.d. D)** di dashboard. Untuk membuktikan
batas awal, buka laporan EasyMax sehari sebelumnya dan cocokkan `SALDO`-nya
dengan kolom **Awal (`dtgl < D`, s.d. D−1)**. Jangan menerima kecocokan total
saja karena dua kesalahan pelanggan dapat saling menghapus.

Baris pelanggan yang keenam angkanya nol harus tetap terlihat dengan penanda
“Saldo nol pada kedua batas”. Seksi Online tampil hanya jika data Imam Bonjol
mempunyai sedikitnya satu kode pelanggan bertitik; jangan meminta flag unit atau
pengecualian nama.

**Kondisi berhenti dan lapor tahap 3:** hentikan kanari dan jangan lanjut ke
enam unit lain bila bundle/cut tidak terbukti, snapshot Imam Bonjol belum siap,
salah satu enam unit lain tiba-tiba menampilkan angka, atau satu baris pelanggan
tidak cocok dengan laporan EasyMax yang benar.

## Bukti teknis pasca-swap yang disiapkan, bukan dijalankan sekarang

Satu perintah literal dari satu host **tidak dapat dengan jujur membuktikan
ketiga hal sekaligus**: identitas file berada di mesin Windows SPBU, sedangkan
kemajuan `sync_state` dan penerimaan `source_cut` berada di Cloud SQL. Karena
itu bukti minimum melintasi dua trust domain dan terdiri dari dua perintah
read-only berikut. Dion cukup menerima kedua keluarannya; operator teknis yang
menjalankannya setelah swap.

### A. Di mesin Imam Bonjol — identitas bundle yang benar-benar berjalan

Prasyarat: pembuat rilis sudah mencatat SHA-256 persis dari artefak yang
disetujui sebagai `<EXPECTED_SHA256>`, swap sudah selesai, dan Task Scheduler
**SolaMax Agent** sudah direstart sesuai runbook. Jalankan satu baris berikut di
Command Prompt tanpa mengubah file (alatnya tersedia pada kelas Windows lama
yang dituju runbook):

```bat
certutil -hashfile C:\solamax-agent\solamax-agent.cjs SHA256 && schtasks /Query /TN "SolaMax Agent" /V /FO LIST && (wmic process where "Name='node.exe'" get ProcessId,CommandLine | findstr /I "solamax-agent.cjs")
```

Lulus hanya bila SHA-256 keluaran `certutil` sama persis dengan
`<EXPECTED_SHA256>`, Task Scheduler menunjukkan task yang benar, dan keluaran
proses memuat `node solamax-agent.cjs`. Hash menggantikan “nomor versi” karena
bundle saat ini belum mempunyai flag versi tertanam. Hasil ini harus menyertakan
hash yang telah direkam sebelum file dibawa ke SPBU; hash yang baru dihitung
setelah swap tanpa pembanding tidak membuktikan identitas rilis.

### B. Dari kanal operasi Cloud SQL — `sync_state` maju dan `source_cut` diterima

Prasyarat: kanal SQL yang sudah disetujui menunjuk **pilot LIVE**
`solamax:asia-southeast2:solamax-pg`, sesi verifikasi dibatasi read-only, URL
koneksi sudah tersedia sebagai `SOLAMAX_PILOT_VERIFY_URL`, dan waktu restart
UTC tersedia sebagai `SOLAMAX_SWAP_UTC` (contoh bentuk:
`2026-09-10T11:30:00Z`). Jalankan satu wrapper berikut; ia berhenti bila input
belum disiapkan atau SQL gagal:

```bash
: "${SOLAMAX_PILOT_VERIFY_URL:?kanal verifikasi pilot LIVE belum disiapkan}"; : "${SOLAMAX_SWAP_UTC:?waktu restart UTC belum dicatat}"; psql "$SOLAMAX_PILOT_VERIFY_URL" --set=ON_ERROR_STOP=1 --set=swap_utc="$SOLAMAX_SWAP_UTC" <<'SQL'
BEGIN READ ONLY;
SELECT set_config(
  'app.unit_ids',
  (SELECT unit_id::text FROM public.unit WHERE code = '6478111'),
  true
);
WITH target AS (
  SELECT unit_id FROM public.unit WHERE code = '6478111'
)
SELECT s.domain, s.last_run_at, s.last_row_count,
       (s.last_run_at > (:'swap_utc')::timestamptz) AS maju_sesudah_swap
FROM public.sync_state s
JOIN target t USING (unit_id)
WHERE s.domain IN ('masters', 'piutang', 'hutang')
ORDER BY s.domain;

WITH target AS (
  SELECT unit_id FROM public.unit WHERE code = '6478111'
)
SELECT c.source_cycle_id, c.status, c.source_completed_at,
       c.pelanggan_row_count, c.bppiut_row_count, c.bphut_row_count,
       c.pelanggan_keyed_checksum IS NOT NULL AS pelanggan_checksum_ada,
       c.bppiut_keyed_checksum IS NOT NULL AS bppiut_checksum_ada,
       c.bphut_keyed_checksum IS NOT NULL AS bphut_checksum_ada
FROM app.saldo_pelanggan_source_cycle c
JOIN target t USING (unit_id)
WHERE c.started_at > (:'swap_utc')::timestamptz
  AND c.status = 'complete'
ORDER BY c.source_cycle_sequence DESC
LIMIT 1;
ROLLBACK;
SQL
```

Lulus hanya bila ketiga domain ada dan seluruh `maju_sesudah_swap=true`, lalu
cycle terbaru berstatus `complete`, `source_completed_at` terisi, ketiga row
count terisi, dan ketiga checksum bernilai `true`. Baris cycle lengkap itu
adalah bukti backend menerima marker `source_cut` untuk `pelanggan_master`,
`bppiut`, dan `bphut`; sukses `sync_state` saja tidak cukup, karena agent lama
juga dapat memajukannya tanpa `source_cut`.

## Kewaspadaan B5a dan kapan B5b boleh dimulai

B5a tetap menunggu enam workbook dari Dion: **DAFTAR SALDO HUTANG PIUTANG**
Adisucipto dan 28 Oktober untuk 1, 4, dan 9 September 2026. Tanggal 9 September
adalah hari-ini−1 saat prediksi disegel. Full-sync menarik koreksi back-dated,
tetapi entri POS tanggal itu masih mungkin menyusul. Bila hanya 9 September
menyimpang sedangkan 1 dan 4 September cocok, hipotesis pertama adalah entri
menyusul, bukan cacat formula/reader. Prediksi tersegel tidak boleh disunting;
keadaan baru di-append sebagai bukti.

B5b **belum boleh dijalankan sekarang**. Ia baru aktif setelah B2/B3 hidup di
pilot LIVE, bundle baru benar-benar berjalan di setidaknya satu unit kanari,
`source_cut` unit itu lengkap, dan snapshot target sudah dipublikasikan. Saat
itu B5b membandingkan `snapshot = legacy` pada unit dan tanggal yang sama secara
read-only; ia bukan izin rollout enam unit berikutnya.

## Jejak keputusan yang dipakai

Panduan ini diturunkan dari rancangan layar yang dikunci di
`session-notes/2026-09-08-piutang-butir1-rancangan-layar.md` §2, model promosi
dan hostname kanonik di `DEPLOY.md`, izin baca di
`apps/dashboard/src/lib/keuangan-wewenang.ts`, nama/rute laporan hidup di kode
dashboard, kontrak source-cut B3, hasil reader/transisi B4, serta preregistrasi
B5a. Tidak ada domain, kredensial, atau perilaku mesin SPBU yang direka di luar
bukti repo tersebut.
