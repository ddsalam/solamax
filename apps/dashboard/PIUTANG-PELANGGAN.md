# Piutang pelanggan — keputusan yang mengikat

Pemantauan **tagihan pelanggan kredit** per SPBU: faktur, pembayarannya, jatuh tempo,
penjualan kredit yang belum ditagihkan, dan ringkasan lintas SPBU.

**Berkas ini bukan tutorial dan bukan kronologi.** Ia daftar keputusan yang mengikat ke
depan, alasannya, dan batas yang diketahui — mengikuti pola
[`KEUANGAN-HARIAN.md`](KEUANGAN-HARIAN.md) dan
[`KETAATAN-ADMINISTRASI.md`](KETAATAN-ADMINISTRASI.md). Kalau kamu menyentuh
`tagihan-model.ts`, `tagihan-queries.ts`, `termin-*.ts`, domain sinkron `tagihan`, atau
layar di bawah `/keuangan/**/tagihan`, baca ini lebih dulu.

Rencana: [`docs/plans/2026-11-13-1845-feat-tagihan-pelanggan-monitoring-plan.md`](../../docs/plans/2026-11-13-1845-feat-tagihan-pelanggan-monitoring-plan.md)
(keputusan owner 13 November 2026). Urutan rilis per unit:
[`docs/runbooks/tagihan-rollout.md`](../../docs/runbooks/tagihan-rollout.md).
Riwayat rancangan layar saldo: [`session-notes/2026-09-08-piutang-butir1-rancangan-layar.md`](../../session-notes/2026-09-08-piutang-butir1-rancangan-layar.md)
(§14 menetapkan berkas ini sebagai rumah permanennya).

> ⛔ **Repositori ini publik.** Berkas ini memuat aturan dan prosedur, bukan data. Angka
> nyata, nama pelanggan, nomor dokumen, dan hasil probe atau gold-check tidak ditulis di
> sini, di uji, maupun di pesan commit. Contoh di uji selalu ilustratif.

---

## 1 · Cakupan

**Yang dikerjakan.** SolaMax mencerminkan modul faktur EasyMax (kepala faktur, tautan
faktur ke dokumen penjualan, pembayaran faktur) dan menyajikannya untuk tim Finance:

| Layar | Rute | Isi |
|---|---|---|
| S1 Daftar tagihan | `/keuangan/unit/[code]/tagihan` | faktur per unit dengan status terhitung, empat ubin, saringan, ekspor CSV |
| S2 Rincian faktur | `/keuangan/unit/[code]/tagihan/faktur/[kode]` | dokumen penjualan dalam faktur dan seluruh pembayarannya |
| S3 Belum ditagihkan | saringan `belum_ditagihkan` di S1 | penjualan kredit yang belum masuk faktur mana pun, per pelanggan |
| S4 Atur termin | `/keuangan/unit/[code]/tagihan/termin` | termin bawaan unit dan pengecualian per pelanggan |
| S5 Ringkasan lintas SPBU | `/keuangan/tagihan` | satu baris per SPBU dalam cakupan pembaca |
| S6 Tab pelanggan | halaman pelanggan di Saldo pelanggan | faktur dan pembayaran satu pelanggan |

**Yang BUKAN cakupan, dan tidak boleh diselipkan tanpa keputusan baru:**

- Mencocokkan baris rekening koran ke pelanggan atau ke faktur.
- Limit kredit, peringatan, dan pemblokiran. SolaMax **tidak bisa** menahan pelanggan di
  pompa — koneksi EasyMax `SELECT`-only. Jangan pernah menulis "pemblokiran otomatis" di
  layar, dokumen, atau laporan.
- Pengingat, surat tagih, catatan tindak lanjut, janji bayar.
- Umur piutang untuk saldo yang tidak punya faktur.
- Perubahan apa pun pada cara saldo "Saldo pelanggan" dihitung (sumber kebenarannya tetap
  `getSaldoPelanggan`; lihat `CLAUDE.md`).
- **SolaMax tidak pernah menulis ke EasyMax.** Faktur diterbitkan dan pembayaran dicatat
  admin cabang di EasyMax; layar ini hanya memantulkannya.

## 2 · Status faktur — dihitung, tidak disimpan, tidak dipercaya dari EasyMax

**Satu pembuat vonis:** `deriveTagihanStatus` di `src/lib/tagihan-model.ts`. Kueri hanya
menarik fakta; tak ada vonis status di SQL, di halaman, maupun di ekspor.

Urutannya:

1. `sisa` = nilai faktur − jumlah pembayaran faktur yang **tidak batal**, dihitung dari
   angka **mentah** lalu dibulatkan ke rupiah **satu kali**.
2. `dibayar` yang tampil = nilai faktur (bulat) − `sisa`, supaya tiga angka di layar dan
   di ekspor selalu saling cocok.
3. Status bayar dari `sisa` yang sudah bulat: `sisa = 0` → **Lunas** · `sisa < 0` →
   **Lebih bayar** · `sisa > 0` dengan `dibayar > 0` → **Sebagian** · selainnya belum
   dibayar.
4. Hanya bila masih bersisa (belum dibayar atau Sebagian): **Belum jatuh tempo**,
   **Lewat jatuh tempo** (hari ini − jatuh tempo, dalam hari), atau **Termin belum
   diatur** (§3).

Aturan yang mengikat:

- **Status bayar lahir dari pembayaran**, bukan dari flag status EasyMax. Flag itu hanya
  mengenal lunas/belum — ia tak bisa menyatakan bayar sebagian maupun lebih bayar, dan
  bisa basi.
- **Flag status dan kolom sisa-saldo EasyMax hanya pembanding.** Bila status terhitung
  berselisih dengan flag → penanda `beda_status`; bila `sisa` terhitung berselisih dengan
  kolom sisa-saldo → penanda `beda_sisa`. Keduanya berdiri sendiri, ditampilkan agar
  cabang memeriksa, dan **tidak pernah mengubah status**. Lebih bayar dengan flag lunas
  bukan selisih.
- **Semua perbandingan dalam rupiah bulat.** Kolom sumber bertitik-mengambang;
  membandingkannya mentah menghasilkan "Sebagian" palsu sebesar sepersekian rupiah.
- **Sisa dibulatkan sekali, dari selisih mentahnya** — bukan nilai bulat dikurangi
  pembayaran bulat. Dua pembulatan terpisah bisa meleset 1 rupiah dari kolom sisa-saldo
  EasyMax dan menyalakan `beda_sisa` palsu. Akibat yang diterima: `dibayar` di baris
  faktur bisa berbeda 1 rupiah dari total tabel pembayarannya.
- **Nilai faktur = grand total bila terisi (bukan nol), selain itu total.** Bila
  keduanya nol atau kosong, faktur itu **tidak pernah dianggap Lunas**: ia tetap di
  "Perlu tindakan" dengan penanda **nilai faktur kosong**, dihitung dalam *jumlah* faktur
  ubin tetapi tidak dalam rupiahnya, dan tidak dibandingkan dengan sisa-saldo EasyMax.
- **Faktur batal tidak punya status; pembayaran batal tidak pernah dihitung.** Keduanya
  tetap dicerminkan dan tetap terlihat di rincian sebagai riwayat.
- **Tanpa ambang lebih bayar** pada rilis pertama: kelebihan berapa pun = Lebih bayar.
  Melipat kelebihan kecil ke Lunas adalah keputusan sesudah Finance melihat daftar nyata.
- **Lebih bayar dinilai per faktur**, bukan per pelanggan.
- **Setiap faktur yang tidak persis Lunas selalu tampil** — termasuk Lebih bayar. Hanya
  Lunas yang disaring per periode, dan **setiap** faktur Lunas tunduk padanya — termasuk
  yang lunas hanya sesudah pembulatan rupiah. Periodenya = tanggal pembayaran hidup
  terakhir; tanpa pembayaran, tanggal faktur.
- **Status tidak disimpan.** Ia bergantung pada hari ini (WIB) dan pada termin yang bisa
  diubah kapan saja; status tersimpan pasti basi. "Hari ini sama dengan jatuh tempo"
  **belum** lewat.

## 3 · Jatuh tempo

Satu fungsi: `resolveJatuhTempo`. Tiap faktur punya tepat satu sumber jatuh tempo, dan
layar selalu menyebut sumbernya.

| Keadaan jatuh tempo EasyMax | Dipakai? | Penanda |
|---|---|---|
| 1 s.d. 365 hari sesudah tanggal faktur | **ya** — sumber `easymax` | — |
| kosong, atau **sama dengan** tanggal faktur | tidak — dianggap tidak diisi | — |
| sebelum tanggal faktur, atau lebih dari 365 hari sesudahnya | **tidak pernah** | `jt_easymax_tak_wajar` |

Bila jatuh tempo EasyMax tidak dipakai: jatuh tempo = tanggal faktur + termin SolaMax —
**pengecualian pelanggan** bila ada (`termin_pelanggan`), selain itu **termin bawaan
unit** (`termin_unit`). Tanpa keduanya: `belum_diatur` → status **Termin belum diatur**.

- **Termin belum diatur tidak pernah dihitung lewat jatuh tempo**, dan tidak pula
  dihitung belum jatuh tempo. Ia punya ubin sendiri supaya tidak terbaca sebagai "aman".
- **"Sama dengan tanggal faktur = tidak diisi"** adalah temuan probe: ada unit yang
  hampir tidak pernah mengisi jatuh tempo, dan EasyMax menyimpannya sama dengan tanggal
  faktur. Memakainya apa adanya membuat seluruh faktur unit itu lewat jatuh tempo pada
  hari kedua.
- ⚠️ **Batas 365 hari bersifat SEMENTARA** dan hidup di satu konstanta
  (`BATAS_JATUH_TEMPO_EASYMAX_HARI`). Unit yang diketahui menyimpan jatuh tempo ngawur
  belum menjalankan paket probe saat batas ini dipilih. Mengubahnya = mengubah satu
  angka, lalu menjalankan ulang uji model; jangan menambah batas kedua di tempat lain.
- Termin 0 hari **sah**: jatuh tempo pada tanggal faktur.

## 4 · Master termin — siapa boleh mengubah, dan kenapa

Dua tabel `app` ber-`unit_id` (migrasi 0064): `termin_unit` (satu termin bawaan per unit)
dan `termin_pelanggan` (pengecualian per pelanggan). Dua tabel, bukan satu dengan
`unit_id` yang boleh kosong — bentuk itu patah di bawah kebijakan RLS `unit_scope`
(`KEUANGAN-HARIAN.md` §4.1b).

- **Termin = bilangan bulat hari, 0 s.d. 365** (CHECK di basis data + `periksaTerminHari`).
- **Mengubah = void + sisip; menghapus pengecualian = void tanpa pengganti.** Tak ada
  `DELETE` (hak itu dicabut dari `dashboard_app`). Riwayat tetap terbaca, dan tiap
  perubahan menulis tepat satu baris `app.audit_log` di transaksi yang sama.
- **Menyimpan nilai yang sama = tidak menulis apa pun** — tanpa void, tanpa baris baru,
  tanpa audit. Riwayat termin adalah daftar *perubahan*; menyimpan ulang angka yang sama
  akan mengganti "siapa & kapan" tanpa ada keputusan baru. Layar menjawabnya dengan
  kalimat biasa, bukan galat.
- **Perubahan langsung berlaku untuk semua faktur tanpa jatuh tempo EasyMax yang sah**,
  termasuk faktur lama yang masih terbuka. Termin adalah sifat hubungan dengan pelanggan,
  bukan potret per faktur; tak ada "termin pada tanggal faktur".
- **Siapa & kapan selalu tampil** di S4 untuk termin bawaan dan tiap pengecualian.
- **Pengecualian yatim** (pelanggannya sudah tak ada di master EasyMax) **tetap tampil,
  ditandai, dan bisa dihapus.** Menyembunyikannya berarti ia terus menggeser jatuh tempo
  faktur lama tanpa bisa dilihat. Ia tidak bisa diberi nilai baru.
- Kode pelanggan selalu dalam bentuk kunci `btrim(ckdplg)` — sama dengan Saldo pelanggan.
  Hanya spasi ASCII yang dipangkas; garis miring dan titik tidak disentuh.
- **Di luar kotak pencarian layar, yang tidak peka huruf besar/kecil hanya dua:**
  pencarian termin pelanggan untuk sebuah faktur (`terminUntuk` — pengecualian `abc`
  berlaku bagi faktur ber-kode `ABC`, seperti EasyMax membandingkannya) dan awalan
  rujukan `JP`/`UV` pada "Belum ditagihkan" (§5). **Semua pencocokan lain tetap persis**
  sesudah dipangkas: kode
  pelanggan pada join master, pengelompokan dan saringan, nomor rujukan terhadap tautan
  faktur, nomor faktur, dan kunci snapshot Saldo pelanggan.
- **Daftar pelanggan S4 bawaannya hanya pelanggan yang bisa punya piutang** (populasi
  §5: kelas {1, 5} dengan kode tanpa titik, atau kode bertitik) **ditambah setiap
  pelanggan yang sudah punya pengecualian**, berapa pun kelasnya. `?semua=1` menampilkan
  seluruh master. Pengecualian tidak pernah tersembunyi oleh penyempitan ini.

### ⚖️ Wewenang: `canAturTermin` — pengecualian SEMPIT atas `KEUANGAN-HARIAN.md` §10.12

| Hal | Predikat | Siapa |
|---|---|---|
| Membaca semua layar tagihan | `canViewLaporanKeuangan` | `keuangan`, `direksi`, `admin_perusahaan`, `super_admin` |
| Mengubah termin | `canAturTermin` | staf `keuangan`, **Head of Finance**, `super_admin` |

**Keputusan owner 13 November 2026:** "semua staf Finance boleh mengubah termin" —
dipilih di atas "HoF saja" dan di atas alur usul/setuju, supaya termin cepat terisi.

"Semua staf Finance" **mencakup** Head of Finance, sedangkan `canInputKeuangan` sengaja
menolaknya (§10.12: HoF dan peran `keuangan` saling meniadakan). Memakai
`canInputKeuangan` di sini akan mengulang kejadian reklasifikasi 27 September 2026
(§10.29): HoF tertolak dari tindakan yang justru diputuskan boleh baginya, dan layarnya
terbaca seperti fitur rusak.

Kenapa pengecualian ini tidak melubangi pemisahan tugas: termin **bukan "mengetik"
transaksi**. Ia tidak melahirkan kas, nominal, maupun tanggal buku; ia menentukan
*penyajian* jatuh tempo. Kontrolnya **keterlihatan**, bukan pemisahan tugas — riwayat
void dan `audit_log`.

- `canInputKeuangan` **tidak disentuh**; §10.12 tetap utuh untuk seluruh input harian.
- `canAturTermin` ditulis berdiri sendiri, supaya pelonggaran di sini tak merembes ke
  input lain dan pergeseran predikat lain tak ikut menggesernya.
- Gerbangnya di **server action** (`termin-actions.ts`), sebelum koneksi dibuka. S4 tidak
  merender kolom isian bagi yang tak berwenang, tetapi itu kenyamanan, bukan kontrol.
- Yang tak berwenang melihat **penjelasan**, bukan tombol mati tanpa sebab
  (`pesanTakBolehAturTermin` — satu sumber untuk layar dan server).
- Satu unit per aksi: transaksi hanya memuat unit yang lolos `requireUnit`.

## 5 · Belum ditagihkan

**Definisi.** Posting **debet hidup** di cermin buku piutang yang rujukannya dokumen
penjualan atau pemakaian voucher, milik **populasi piutang**, dan **tidak tertaut ke
faktur hidup mana pun**. Satu dokumen = satu **(rujukan, pelanggan)**; ia bisa punya
lebih dari satu posting: dijumlahkan.

- **Rujukan yang diposting ke dua pelanggan dihitung di masing-masing pelanggan**, dengan
  jumlahnya sendiri. "Tertaut ke faktur hidup" tetap diputuskan per rujukan: tautan
  faktur tidak menyimpan kode pelanggan, jadi satu tautan menutup rujukan itu untuk
  semua pelanggannya.
- **Kredit hidup ber-rujukan sama milik pelanggan yang sama mengurangi debetnya**
  (penjualan yang dibalik). Dokumen yang netonya ≤ 0 bukan "belum ditagihkan"; yang
  dibalik sebagian tampil sebesar sisanya. Kredit batal, kredit milik pelanggan lain,
  dan kredit tanpa debet tidak berpengaruh.
- **Awalan rujukan `JP`/`UV` dibaca tanpa membedakan huruf besar/kecil**; nomor
  rujukannya sendiri tetap dicocokkan persis dengan tautan faktur (§4).

**Populasi pelanggannya sama persis dengan "Saldo pelanggan"** — bukan definisi baru:

- **Lokal** = kelas master {1, 5} **dan** kode tanpa titik.
- **Online** = kode bertitik, tanpa syarat kelas.
- Pembeda Lokal/Online adalah **format kode, bukan kelas**.

Aturan yang mengikat:

- **Pelanggan kelas penjualan tunai dikecualikan.** Mereka memposting debet yang memang
  tidak pernah difakturkan; bila ikut, mereka menetap di kelompok ini selamanya dan
  menenggelamkan yang perlu dikejar.
- **Tautan selalu dibaca lewat kepala fakturnya.** Tabel tautan menyimpan baris milik
  faktur yang sudah batal; tautan yang fakturnya batal atau lenyap **tidak**
  menyembunyikan penjualan.
- **Tanpa lantai tanggal** pada rilis pertama. Bila suatu unit menampakkan tumpukan lama,
  memasang lantai adalah keputusan owner — bukan penyesuaian diam-diam di kueri.
- Posting voucher bisa juga hidup di buku hutang. Unit yang diprobe tidak memilikinya di
  antara dokumen berfaktur; tiap unit memeriksanya (probe T9) sebelum rilisnya.
- Bentuk kuerinya (gabung-lalu-kelompokkan, bukan anti-join) **disengaja dan terukur** —
  alasannya di komentar `tagihan-queries.ts`. Jangan "disederhanakan" kembali.

## 6 · Cocok-silang dengan Saldo pelanggan (R20)

Per pelanggan, layar menyandingkan:

```
Σ sisa SELURUH faktur hidup (lebih bayar ikut sebagai negatif)  +  belum ditagihkan
        dibanding
saldo akhir piutang pelanggan itu di snapshot Saldo pelanggan yang terbit terakhir
```

Kelompok saldonya mengikuti format kode (bertitik = Online, selainnya Lokal), dan
tanggal snapshotnya **selalu disebut** ("per …").

- **Selisih DITAMPILKAN, tidak disembunyikan dan tidak dijelaskan.**
- **Arti selisih:** ada pergerakan buku piutang yang tidak lewat faktur. Sumber yang sah
  antara lain kredit buku piutang yang tidak terikat pembayaran faktur, dan beda waktu
  antara snapshot saldo dan cermin tagihan.
- **Yang BUKAN arti selisih:** bukan bukti salah hitung, bukan bukti kecurangan, dan
  bukan alasan mengubah salah satu sisinya. Tidak ada tombol "samakan", tidak ada
  penyesuaian, tidak ada baris penyeimbang. Saldo pelanggan tetap dihitung dengan caranya
  sendiri.
- **Tanpa snapshot terbit → "belum tersedia"**, bukan selisih terhadap nol.
- **Snapshot terbit yang rowset-nya tidak lolos bukti integritas juga "belum tersedia".**
  Saldo pembanding dibaca lewat pembaca Saldo pelanggan sendiri (`getSaldoSnapshot`):
  jumlah baris, checksum dan total rowset harus sama dengan manifestnya. Pointer terbit
  saja bukan bukti; rowset yang tak lengkap tidak pernah terbaca sebagai "saldo 0".
- **Snapshot pembanding yang sedang menunggu pengganti disebutkan** ("sedang
  diperbarui") di S3 dan di halaman pelanggan.
- **Tautan "Halaman pelanggan" di rincian faktur hanya dibuat bila halamannya ada** —
  pelanggan faktur itu punya baris di snapshot terbit terakhir. Bila tidak (kode kosong,
  belum ada snapshot, atau pelanggan belum masuk snapshot), nama dan kodenya tampil
  sebagai teks biasa.

## 7 · Kesiapan dan kesegaran — dari siklus LENGKAP

- Sebuah unit dianggap punya data tagihan **hanya** bila ia pernah menyelesaikan satu
  siklus lengkap: baris di `tagihan_cycle`, yang ditulis transaksi manifest penutup
  siklus (§8). **Bukan** dari `sync_state`, yang ikut maju pada payload parsial mana pun.
- Unit yang belum pernah menyelesaikan siklus menampilkan **"Data tagihan belum tersedia
  untuk SPBU ini"** (`TAGIHAN_BELUM_TERSEDIA`) — di S1, di barisnya di S5, di mana pun.
  **Tidak pernah sebagai nol.** Nol faktur dan "belum ada data" adalah dua pernyataan
  berbeda.
- Karena itu **tidak ada feature flag**: backend dan dashboard boleh tayang sebelum
  satu pun agent ditukar.
- **Setiap layar menyebut kesegarannya** — waktu siklus lengkap terakhir, WIB.
- Master termin **tidak menunggu** kesiapan: Finance boleh mengisinya lebih dulu.
- Semua daftar berbatas baris — faktur, dokumen belum ditagihkan, **dan pembayaran**.
  Bila batas terlampaui, hasilnya ditandai `terpotong` dan layar **mengatakannya**;
  tidak pernah dipotong diam-diam.
- **Buku piutang dipindai paling banyak sekali per permintaan.** Kelompok "Belum
  ditagihkan" dan dokumennya (kelompok yang dibuka di S3, ekspor CSV) keluar dari satu
  kueri; layar yang tidak menampilkannya (S4) tidak menjalankannya.

## 8 · Sinkron dan pangkas — aturan keselamatan

Domain `tagihan` adalah **potret penuh**: tiap siklus (kadensi master) agent membaca utuh
ketiga tabel, mengirimnya terpotong **per faktur** (tautan dan pembayaran sebuah faktur
selalu sepayload dengan kepalanya), lalu menutup dengan satu payload **manifest** berisi
daftar kunci lengkap kepala faktur dan pembayaran yang dibacanya.

Kenapa harus memangkas: upsert saja tidak pernah menghapus. Faktur atau pembayaran yang
dihapus di EasyMax akan tinggal selamanya di cermin — dan menghapus dokumen sesudah
menanggal-ulangnya adalah perilaku EasyMax yang dikenal.

> ⛔ **Manifest hanya dikirim sesudah siklus LENGKAP:** ketiga kueri sumber berhasil
> **dan** setiap potongan diterima backend. Satu kueri gagal atau satu potongan ditolak →
> **tanpa manifest → backend tidak memangkas apa pun.**

- Sengaja **tidak** meniru `syncMasters`, yang menelan kegagalan per tabel: di sini tabel
  yang "kosong karena gagal" akan terbaca sebagai "hapus semuanya".
- Sumber yang memang kosong **tetap** mengirim manifest. Daftar kosong diterima bila cermin
  unit itu juga kosong (unit tanpa faktur tetap berstempel siklus lengkap). Bila cermin
  **masih berisi faktur**, backend menolaknya (409) dan tidak menghapus apa pun — "nol
  baris" juga wujud agent yang menunjuk basis data kosong atau baru separuh dipulihkan.
  Mengosongkan cermin butuh `izinkan_kosong` dari operator; agent tidak pernah mengirimnya.
- Backend memangkas dalam **satu transaksi di bawah kunci per unit**: hapus kepala dan
  pembayaran yang kuncinya tak terdaftar, hapus tautan faktur yang tak ada lagi, lalu
  stempel waktu siklus lengkap. Manifest satu unit tak pernah menyentuh unit lain.
- Manifest ditolak (409, **seluruh transaksi batal**) bila: ia **basi** — `chunk_token`-nya
  bukan potongan tagihan terakhir yang diterima untuk unit itu, artinya ada potongan lain
  yang mendarat sesudah siklusnya; atau sesudah pangkas jumlah kepala/pembayaran di cermin
  **tidak sama** dengan jumlah kunci manifest (ada kunci yang barisnya tak pernah tiba).
  Manifest yang sudah distempel lalu terkirim ulang diterima tanpa dikerjakan lagi.
- Tabel tagihan hanya diterima di domain `tagihan`, dan sebaliknya. Tiap daftar kunci
  manifest dibatasi 100.000 kunci; agent membatalkan siklus sebelum mengirim apa pun bila
  melampauinya.
- > ⛔ **Payload domain ini TIDAK PERNAH masuk buffer offline.** Buffer diputar ulang di
  > awal siklus berikutnya; potongan atau manifest lama yang mendarat *sesudah* siklus
  > yang lebih baru akan menghapus faktur yang baru dibuat, atau menghidupkan lagi baris
  > yang sudah dipangkas. Tidak ada yang hilang dengan tidak mem-buffer: siklus berikutnya
  > membaca ulang semuanya.
- > ⛔ **Jangan menjalankan sinkron sekali-jalan (`--once`, `3-sync-once.bat`) untuk unit
  > yang loop agent-nya sedang berjalan.** Penjaga "satu siklus pada satu waktu" hanya
  > berlaku di dalam satu proses. Dua proses bisa menyelang-nyeling potongan dan manifest,
  > dan manifest yang lebih tua bisa mendarat belakangan. Penjaga `chunk_token` menolak
  > manifest yang didahului potongan proses lain, tetapi **tidak** menolak potongan yang
  > berselang-seling itu sendiri — larangan ini tetap berlaku. Untuk memeriksa tanpa
  > mengirim, pakai dry-run.
- Semua kolom dicerminkan apa adanya, termasuk flag status, kolom sisa-saldo, jatuh tempo
  mentah, dan baris batal. Tanggal nol menjadi NULL. **Tak ada yang diturunkan saat
  ingest.**
- Agent tetap `SELECT`-only (aturan tak bisa dinegosiasi №1 di `CLAUDE.md`).

Urutan tukar bundle dan cara membaca log-nya:
[`apps/agent/RUNBOOK-SPBU.md`](../agent/RUNBOOK-SPBU.md) — "Rilis domain `tagihan`".

## 9 · Akses dan isolasi unit

- Setiap rute di bawah `/keuangan` menolak pembaca tak berhak dengan
  `canViewLaporanKeuangan` → `notFound()` (`gerbang-rute-keuangan.guard.test.ts`
  menemukan rutenya sendiri). Rute ekspor hidup di bawah `app/api/keuangan`.
- Setiap kueri menerima `ScopedUnitId` dari `getDataScope()` dan berjalan lewat
  `qScoped()`. Tabel cermin (0063) dan tabel termin (0064) ber-RLS `unit_scope`.
- S5 membentuk barisnya **hanya dari unit dalam cakupan pembaca**; unit di luar cakupan
  tidak mungkin ikut walau basis data memulangkannya.
- Butir menu "Tagihan pelanggan" dan "Ringkasan tagihan" ikut tersembunyi bersama grup
  Keuangan bagi yang tak boleh membacanya. **Menyembunyikan menu bukan kontrol akses**
  (`KEUANGAN-HARIAN.md` §10.17).

## 10 · Yang sengaja ditunda

| Hal | Kenapa ditunda | Yang membangunkannya |
|---|---|---|
| Ambang lebih bayar | belum ada daftar nyata untuk menilai besarnya | Finance melihat daftar Lebih bayar yang didominasi selisih receh |
| Batas kewajaran jatuh tempo selain 365 hari | unit pemilik data ngawur belum diprobe | hasil probe unit itu |
| Lantai tanggal "Belum ditagihkan" | belum ada bukti tumpukan lama | suatu unit menampakkan backlog bertahun-tahun |
| Arti dua nilai jenis faktur | tak ada kebutuhan yang bergantung padanya | kebutuhan pertama yang membedakannya |
| Tanggal berlaku termin / termin per faktur | tidak diminta; termin adalah sifat hubungan | keputusan owner yang menghendaki riwayat termin memengaruhi faktur lama |
| Pencocokan bank ke faktur, limit kredit, penagihan aktif | di luar cakupan (§1) | rencana tersendiri |

## 11 · Batas yang DIKETAHUI

- **Layar ini tidak bisa membedakan "belum dibayar" dari "pembayaran belum dicatat di
  EasyMax".** Unit yang berhenti mencatat pembayaran akan tampak menunggak besar. S5
  menampilkan tanggal pembayaran terakhir yang tercatat per unit supaya pembaca
  melihatnya lebih dulu.
- **"Termin belum diatur" bisa terbaca sebagai "tidak lewat jatuh tempo".** Peredamnya
  ubin sendiri dan tautan ke S4; itu peredam, bukan jaminan.
- **Kesegaran mengikuti kadensi master** (per jam). Cukup untuk kerja penagihan harian;
  mengetatkannya adalah perubahan konfigurasi agent, bukan perubahan aturan.
- **Ketiga kueri sumber bukan satu potret transaksi** (agent tidak membuka transaksi).
  Faktur yang lahir di sela kueri tampil sebagai tautan/pembayaran tanpa kepala dan
  tertahan sampai siklus berikutnya.
- **Tiap unit bisa berperilaku lain dari unit yang diprobe.** Paket probe adalah gerbang
  per unit (runbook rilis), dan gold-check terhadap dua menu EasyMax adalah syarat
  sebelum angka suatu unit dipercaya.
- **Gold-check yang tidak bisa gagal tidak membuktikan apa-apa** — lihat runbook.
