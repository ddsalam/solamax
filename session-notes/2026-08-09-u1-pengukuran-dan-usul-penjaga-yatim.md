# 2026-08-09 — U1 diukur lalu disambungkan · usul penjaga berkas yatim

## 1 · Pengukuran U1 — **jendelanya disebut**

`2026-07-27 … 2026-08-08` · 13 hari × 7 unit = **91 unit-hari**
= kolom papan 14-hari **minus** kolom hari ini (yang memang tak dinilai).

**Kontrol jendela:** papan pilot hari ini melaporkan 10 merah + 7 kuning +
43 hijau + 31 pra-adopsi = **91**. Cocok. Dan tes pengukurnya mengasersikan
`n === 91` — jendela yang menciut jadi nol tak bisa lolos sebagai "aman".

### Prediksi dikunci SEBELUM mengukur, lalu hasilnya

| | prediksi | hasil | |
| --- | --- | ---: | :--: |
| P1 keluar dari `na` (masuk penyebut) | 45–65 | **60** | ✅ |
| P2 jadi `fail` (nada skor memburuk) | 5–20 | **17** | ✅ |
| P3 tetap `na` | ≥ 31 | **31** | ✅ |
| P4 `setoran_tersalin` | 0 | **0** | ✅ |
| P5 `ok` | ≥ 43 | **43** | ✅ |

Distribusi vonis: `selaras` 43 · `lebih_setor` 7 · `kurang_setor` 3 ·
`belum_diisi` 7 · `pra_adopsi` 31. **`tak_terhitung` NOL** — tak ada hari lampau
di jendela ini yang shift-nya bolong; pipeline utuh sepanjang 13 hari.

### Dampaknya, dalam kalimat yang tepat

| sel | yang berubah |
| ---: | --- |
| **31** | tak ada apa-apa (tetap `na`, di luar penyebut) |
| **43** | penyebut +1 **dan** pembilang +1 — skor `x/y` berubah, **nada tidak** |
| **17** | penyebut +1, **cek gagal baru** → nada skor memburuk ≥1 langkah |

Jadi **17 dari 91** yang berubah nadanya. Bukan "91 sel berubah".

⚠️ Yang **tidak** saya ukur: nada akhir tiap hari sesudahnya. Itu menuntut 91
`buildLaporanModel` penuh (query terberat halaman ~104 dtk di satu unit), dan
17 adalah **batas atas** yang sudah cukup untuk memutuskan. Disebut supaya tak
dibaca sebagai pengukuran nada.

### `ok = 43` **persis** sama dengan 43 hijau papan

Menyenangkan, dan saya tidak memperlakukannya sebagai bukti. Hijau papan menuntut
penjualan **dan** opname **dan** administrasi hijau; `ok = 43` hanya menuntut
administrasi hijau. Keduanya sama **hanya jika** tiap sel ber-administrasi-hijau
kebetulan juga lengkap di dua modul lain. Itu kebetulan yang masuk akal, bukan
identitas.

### Dua hal operasional yang muncul dari daftar `fail`

Dicatat sebagai **pengamatan**, bukan tuduhan — keduanya di luar lingkup U1.

1. **`6478101` kosong TUJUH hari berturut** (07-27 … 08-02), uang tunai
   Rp 145–261 juta per hari tak terpertanggungjawabkan di panel. Bukan satu hari
   terlewat; sebuah pola.
2. **`6478201` 2026-08-07**: H = 344.766.190 vs I = 483.803.000 → **+139 juta**.
   Jauh di luar kelas selisih lain di jendela ini (yang lain ≤ 3,4 juta).

## 2 · Usul: penjaga berkas YATIM

**Sebabnya nyata.** `apps/dashboard/src/lib/compliance.ts.bak` — sisa uji mutasi
saya sendiri — ter-`git add -A`, ter-commit, lolos review, dan **tayang di
`main`**. Ia yatim (tak ada yang mengimpornya), basi 36 baris, dan berisi
**salinan logika vonis** yang mendahului gerbang `hari_berjalan`. Pembaca
berikutnya yang membukanya akan membaca aturan yang sudah tidak berlaku.

Yang membuatnya berbahaya bukan ukurannya, melainkan **kemiripannya**: berkas
bernama `compliance.ts.bak` tepat di sebelah `compliance.ts`.

### Tiga bentuk

**(a) `.gitignore` pola cadangan** — `*.bak` `*.orig` `*.rej` `*~` `*.copy.*`.
· Biaya nol · Mencegah `git add -A` menyapunya
· **Kelemahan:** hanya menutup akhiran yang diketahui. `compliance.old.ts` lolos.

**(b) Cek CI "yatim beneran"** — gagal bila ada berkas di `src/` yang tak
diimpor siapa pun, di luar entri konvensi Next (`page/layout/route/middleware`),
tes, dan konfigurasi.
· Menangkap kelasnya, bukan akhirannya
· **Kelemahan: banyak positif palsu.** Entri berbasis konvensi, komponen yang
dipakai lewat re-export, berkas yang sengaja disiapkan lebih dulu. **Gerbang yang
sering salah akan dimatikan orang** — dan gerbang mati lebih buruk dari tak ada
gerbang, karena ia terlihat seperti perlindungan.

**(c) Cek CI pola cadangan** — gagal bila ada berkas **ter-track** yang cocok
pola cadangan, di mana pun di repo.
· Deterministik, nol positif palsu yang bisa saya bayangkan
· Menangkap yang lolos (a), termasuk `git add -f`
· **Kelemahan:** sama seperti (a), ia menjaga **akhiran**, bukan **konsep**.

### Rekomendasi: **(a) + (c)**, dan alasan menolak (b)

(a) mencegah, (c) menangkap yang lolos pencegahan. Keduanya murah dan tak pernah
salah tuduh.

**(b) ditolak untuk sekarang** — bukan karena idenya salah, tapi karena rasio
positif-palsunya akan membuat orang mematikannya, dan kita sudah punya satu
contoh gerbang yang lolos justru karena tak pernah menggigit
(`enforce_admins: false`). Kalau nanti benar-benar dibutuhkan, ia harus dimulai
sebagai **peringatan yang dibaca**, bukan cek yang memblokir.

⚠️ **Prasyarat yang tak boleh dilewati** (pelajaran G1, dibayar dua kali): setelah
(c) dipasang, **tonton ia MERAH sekali** pada berkas cadangan sungguhan, lalu
hijau setelah berkas itu dihapus. Gerbang yang belum pernah dilihat menolak
bukan gerbang.

> Catatan jujur: (a) dan (c) **tidak** akan menangkap kasus yang paling mahal —
> salinan yatim yang namanya wajar. Yang menangkap itu tetap review. Saya tidak
> mengklaim lebih.

## 3 · Usul: legenda papan Ketaatan memberi label NADA, bukan KODE

**Pengamatan owner**, dicatat untuk dikerjakan terpisah.

Legenda menulis "lengkap · sebagian · **kosong**". Tapi sel merah bisa berarti
`setoran_tersalin`, `kurang_setor`, `setoran_kosong`, `belum_diisi`, atau
`config_hilang` — semuanya terbaca **"kosong"** oleh yang membaca legendanya,
padahal hanya dua di antaranya benar-benar tentang kekosongan.

Ini **sudah begitu sebelum** aturan salin-setoran; yang baru hanya menambah satu
penghuni lagi ke label yang artinya makin longgar. Detail sebenarnya ada di
tooltip per-sel (`adminNote`) — jadi informasinya tidak hilang, hanya legendanya
yang berjanji lebih sempit dari kenyataannya.

Keluarga yang sama dengan tema dua hari ini: **kanal yang membawa lebih sedikit
nilai daripada fakta yang dititipkan padanya** — `note.tone` dua-nilai untuk
fakta tiga-nilai, dan sekarang legenda tiga-nada untuk vonis dua-belas-kode.

> ✅ **SUDAH DIKERJAKAN — PR #245, tayang di pilot 2026-08-09.** Legenda kini
> "lengkap & selaras · perlu dicek · perlu tindakan", plus kalimat eksplisit
> bahwa warna menyatakan TINGKAT bukan sebab. Dijaga dua lapis: `satisfies
> Record<HmTone, string>` (nada baru tanpa entri legenda = error tsc) dan tes
> yang membaca sumber halamannya.

---

# 2026-08-09 (tinjauan kedua owner) — aturan salin-setoran BUTA SATU ARAH

## 0 · Bentuk kegagalannya, dinamai lebih dulu

> **Query-nya menjawab pertanyaan yang lebih sempit dari fenomenanya, lalu
> hasilnya dilaporkan seolah menjawab yang penuh.**

Keluarga yang sama dengan tiga kegagalan pengukuran kemarin. Bukan hasil yang
salah — **pertanyaan** yang salah. Dan yang paling menyakitkan: **bukti kasus
ini sudah lewat di depan mata saya.** Pengukuran U1 kemarin mencetak
`6478201 2026-08-07 lebih_setor H=344.766.190 I=483.803.000` dan saya
melaporkannya sebagai "pengamatan operasional", bukan sebagai aturan
salin-setoran yang gagal menyala. Saya punya angkanya dan tidak menghubungkannya.

## 1 · Pemindaian ULANG, tanpa arah

`2026-06-01 … 2026-08-08` · 7 unit. **"0 dari 14" DICABUT.**

| | |
| --- | ---: |
| pasangan diperiksa (kedua hari ber-setoran) | **102** |
| `I` identik | **1** |
| tertangkap aturan yang tayang | **0** |
| **TERLEWAT (arah mundur)** | **1** |
| F **dan** G ikut identik | **1** |
| F&G identik sementara `I` sudah beda | **0** (laten) |

Ambang anti-vakum saya (`> 300`) **meleset** — pasangan menuntut KEDUA hari
ber-setoran dan lantai adopsi masih muda, jadi 102 memang jendela penuhnya.
Diturunkan ke 50 dan dicatat sebagai tebakan yang salah, bukan diam-diam.

**Kenapa arsip perekam TAK MUNGKIN melihatnya** — dua alasan, keduanya berdiri
sendiri: (1) arahnya, (2) waktunya. Arsip mencatat 08-07 `I=241.297.000`,
`F=0`, `G=40.600.000`; nilai 483.803.000 **belum ada** saat perekam berhenti
08-09 01:47. "0 dari 14" nol karena buta, bukan karena bersih.

## 2 · Jejak audit — temuannya lebih buruk dari "terlewat"

`app.manual_entry`, unit Batu Layang, dibaca dengan GUC `app.unit_ids` di-set
(tanpa itu RLS fail-closed mengembalikan **nol baris**, dan nol baris terbaca
sebagai "tak ada data" — kontrolnya dijalankan: 0 → 20 baris setelah GUC).

| waktu WIB 2026-08-09 | yang terjadi |
| --- | --- |
| 12:08–12:11 | **08-07 DISUNTING** · F 0 → 103.478.000 · G 40.600.000 → 40.608.000 · setoran 241.297.000 **di-void** → 483.803.000 |
| 12:12–12:14 | **08-08 DIBUAT** dengan ketiga nilai yang sama persis |

Rekonstruksi (E = A − (B+C+D), murni EasyMax, tak tersentuh suntingan =
281.896.190):

```
H 08-07 SEBELUM = 281.896.190 + 0 − 40.600.000 = 241.296.190
I 08-07 SEBELUM =                                241.297.000
selisih         =                                        810 → SELARAS
```

> **08-07 tadinya BENAR; suntingan itu yang merusaknya.** Bukan hari salah yang
> lalu diperbaiki — hari benar yang ditimpa angka hari lain. Dan kesalahan itu
> **masih hidup di produksi saat catatan ini ditulis.**

## 3 · Perbaikan #3 — WAKTU EVALUASI: bentuk & biaya *(belum dibangun)*

### Temuan yang mengubah premisnya

**Tidak ada vonis yang disimpan.** `adminStatus` dipanggil saat RENDER, dari data
saat itu juga (`force-dynamic`, tanpa tabel vonis, tanpa cache vonis). Jadi
"`D` harus dinilai ulang saat `D+1` masuk" **sudah terjadi dengan sendirinya** —
setiap render sudah menghitung ulang. Yang berubah bukan *kapan* vonis dihitung,
melainkan **data apa yang tersedia saat menghitungnya**.

Itu membuat perbaikan ini jauh lebih murah dari dugaan owner maupun dugaan saya.

### Biaya, per permukaan

| permukaan | jendela sekarang | butuh `D+1`? | biaya query |
| --- | --- | --- | --- |
| papan Ketaatan | deret rapat `DAYS+1` | sudah ada di deret | **0** |
| feed anomali | `[today−7, today]` rapat | sudah ada di deret | **0** |
| Rincian (satu tanggal) | `D`, `D−1` | ya | **+1** query kecil |
| Laporan (satu tanggal) | `D`, `D−1` | ya | **+1** query kecil |

Perubahan tipe: `iSebelumnya: number \| null` → sepasang tetangga. Karena ia
**wajib**, keempat pemanggil akan gagal type-check — itu memang gunanya.
`pasangkanSetoranKemarin()` jadi `pasangkanTetangga()`, satu tempat, sudah teruji.

### Bentuk aturannya

Rumusan yang **menyatukan** kedua arah dan tidak menuduh hari yang benar:

> Untuk hari `D` yang **dinilai** (bukan pending): bila `|I(D) − H(D)| >`
> toleransi **dan** `I(D)` sama persis dengan `I(D−1)` **atau** `I(D+1)`
> → `setoran_tersalin`.

Syarat "tak cocok dengan H-nya SENDIRI" yang memilih hari mana yang ditandai.
Pada Batu Layang ia menyala di **08-07** (meleset 139 jt, sama dengan 08-08) dan
**diam** di 08-08 (cocok sampai Rp 458). Itu perilaku yang diinginkan, dan ia
muncul tanpa aturan tambahan.

### Paparan waktu — TERUKUR, bukan ditaksir

Saat 08-07 dirusak (12:11), 08-08 **belum punya baris sama sekali**: tak ada arah
yang bisa berbunyi. Deteksi mundur menyala **12:14** — **tiga menit** kemudian.
Dugaan "arah mundur pasti terlambat berhari-hari" **salah** pada kasus ini.
n = 1; jangan dijadikan hukum.

### Sisi yang harus diputuskan owner, bukan saya

1. **Bandingkan dengan `D+1` = HARI INI?** Setoran hari ini masih diisi; nilai
   yang kebetulan sama sesaat bisa menyalakan alarm lalu padam. Pilihan: (i)
   bandingkan apa adanya — paling cepat, bisa berkedip · (ii) hanya bandingkan
   `D+1` yang sudah lewat tengah malam — lebih tenang, telat sehari.
2. **Perbaikan #2 (F & G).** Kalau I diperbaiki agar cocok dengan H yang sudah
   salah, hari itu terbaca selaras padahal komponennya milik hari lain. Basis
   datanya: **0 dari 102** — sepenuhnya laten. Bentuk yang saya sarankan:
   sinyal **terpisah dan lebih lemah** ("komponen manual identik dengan hari
   tetangga"), bukan ditumpuk ke `setoran_tersalin`, karena F/G identik bisa sah
   (biaya tetap harian) dan menumpuknya akan mengencerkan vonis yang sekarang
   tajam. **Butuh angka positif-palsu sebelum dinyalakan** — belum saya ukur.
3. Apakah `setoran_tersalin` tetap MERAH bila satu-satunya bukti adalah
   kesamaan dengan `D+1` (yang secara kronologi diketik BELAKANGAN).

> ✅ **SUDAH DIBANGUN — PR #240, tayang di pilot 2026-08-09.** Aturannya dua arah;
> hari yang ditandai adalah yang tak cocok dengan H-nya sendiri, tetangga hanya
> memasok bukti asal-usul. Ketiga keputusan owner terpasang: `D+1` = hari ini
> tidak dibandingkan (ditegakkan di dalam `adminStatus`) · F&G masuk PESAN lewat
> `komponenIkut`, bukan pemicu · tetap MERAH walau buktinya hanya `D+1`.
> Waktu evaluasi tidak berubah — tak ada vonis tersimpan.

## 4 · Bentuk untuk arsip: permukaan pelaporan yang berbohong

> **`gh pr checks` hanya menampilkan check MILIK PR. Workflow yang gagal di-parse
> tidak menghasilkan check sama sekali — jadi ketiadaannya terbaca sebagai
> ketiadaan masalah.**

Bukan bug kami; permukaan pelaporannya. Ia berbahaya justru karena **hijaunya
benar** untuk apa yang ia ukur. Saya nyaris melaporkan gerbang G4 "terpasang"
atas dasar itu.

**Aturan turunan:** setelah menambah/mengubah berkas di `.github/workflows/`,
periksa `gh run list --branch <branch>` — **bukan** `gh pr checks`. Sejak
2026-08-09 penjaganya mekanis: `scripts/ci/check-workflows.sh` di dalam CI biasa,
sehingga kegagalannya muncul di permukaan yang memang dilihat orang.

## 5 · Tiga hal lain yang layak dinaikkan ke arsip

**TERRA adalah bug KEBENARAN, bukan kelengkapan tampilan.** Halaman Laporan tak
pernah mengambil komponen B. Tanpa B, `H = A − (B+C+D) + F − G` ter-hitung
terlalu **besar** dan setiap hari akan menuduh "kurang setor". Ia tak terlihat
selama vonis setoran belum disambungkan — cacat yang hanya muncul saat angkanya
mulai **dipakai untuk memutuskan**.

**Typing struktural tidak membedakan dua hal yang kebetulan berbentuk sama.**
Baris `terra_resmi` dan `pelanggan` sama-sama `{ liter, rp }`, jadi
menyambungkan query yang salah **lolos type-check**. Yang menangkapnya bukan
tipe, melainkan penjaga yang MEMBACA berkas halamannya. Di mana pun dua sumber
berbeda kebetulan sebentuk, tipe berhenti jadi penjaga.

**Lima prediksi dikunci, kelimanya benar — pertama kali dalam tiga hari.**
Bedanya dengan prediksi Korek yang meleset: kali ini saya meramal atas
**mekanisme yang sudah saya baca** (`alarmScore`, cabang `adminStatus`, lantai
adopsi), bukan atas model yang saya tahu tak lengkap. Ramalan hanya sebaik
bacaan yang mendahuluinya. ⚠️ Dan itu **tidak** menyelamatkan aturan
salin-setoran: prediksinya benar semua di dalam pertanyaan yang salah.

---

# 2026-08-09 (penyelidikan UX) — antarmuka membuka tanggal yang TIDAK dimaksud

Diminta owner: selidiki jalur masuk **sebelum** menyempurnakan deteksi. Dua
kejadian dari **dua pengawas berbeda** dengan pola identik bukan kecerobohan
individu.

**Tak ada kode yang diubah dalam penyelidikan ini.**

## Mekanismenya

Tanggal default halaman Rincian datang dari `getSelection()` di
[`selection.ts`](../apps/dashboard/src/lib/selection.ts):

```
tanggal = cookie `solamax.date`  bila formatnya sah
        = hari ini (WIB)         bila tidak
```

Dan cookie itu **ditulis ulang setiap kali** pengawas membuka rute laporan
per-unit (`selectionCookieWrites`, `dateFromUrl: true`, umur **30 hari**). Jadi
defaultnya adalah **"tanggal laporan yang terakhir kebetulan saya buka"** —
bukan tanggal yang belum diisi.

Kartu Beranda dan tautan sidebar keduanya memakai tanggal yang sama itu. Tak ada
satu pun jalur masuk yang bertanya "hari mana yang belum diisi?".

## Kenapa itu menghasilkan PERSIS pola yang terlihat

| | yang dibuka aplikasi | yang dimaksud pengawas |
| --- | --- | --- |
| **Korek** 08-07 10:28 | 08-07 | **08-06** (hari yang baru tutup) |
| **Batu Layang** 08-09 12:08 | **08-07** — cookie dari sesi 08-08 | **08-08** |

Untuk Batu Layang ini **berbasis jejak, bukan dugaan**: entri bd 08-07 dibuat
**08-08 10:04–10:05**, jadi pada 08-08 mereka memang berada di
`/rincian/2026-08-07` → cookie berisi `2026-08-07` selama 30 hari → sesi 08-09
membuka **08-07** lagi.

Untuk Korek saya **tidak bisa** memastikan default mana yang menyala — melihat
halaman tak meninggalkan jejak. Yang pasti: aplikasi membuka **08-07** dan angka
yang mereka ketik milik **08-06**.

> Kedua default gagal karena alasan yang sama: **hari yang ingin diisi pengawas
> hampir tak pernah "hari ini", dan tidak andal "yang terakhir saya buka" — ia
> "hari terbaru yang belum diisi".** Dan aplikasi SUDAH tahu hari mana itu:
> `adminStatus` menghitung `belum_diisi` setiap render. Informasinya ada; jalur
> masuknya tidak memakainya.

## Faktor kedua: tanggalnya tak terlihat saat mengetik

Di `rincian/[date]/page.tsx`, "Tanggal bisnis …" dirender **satu kali** di kop
lembar (baris 170). Panel input ada di baris **279** — setelah **empat** seksi
ledger (Omset, Terra, Pelanggan, EDC), yang panjangnya mengikuti jumlah baris
transaksi hari itu.

`ManualEntryForm` sendiri **tidak menampilkan tanggal sama sekali** (diperiksa:
tak ada rujukan tanggal di JSX-nya; prop `date` hanya dikirim ke server action).

Jadi saat pengawas mengetik, tanggal yang sedang mereka isi **sudah ter-scroll
keluar layar**, dan form untuk 08-07 tampak identik dengan form untuk 08-08.

## Ringkas: tiga lapis yang semuanya menunjuk arah sama

1. **Default salah** — cookie "terakhir dibuka", bukan "belum diisi".
2. **Tak ada isyarat** bahwa hari yang terbuka **sudah** terisi (menimpa hari
   yang sudah benar tak terasa berbeda dari mengisi hari kosong).
3. **Tanggal tak terlihat** di titik pengetikan.

Deteksi menangkapnya **sesudah**. Ketiga hal di atas yang membuatnya **terjadi**.

> ✅ **SUDAH DIKERJAKAN — PR #241, tayang di pilot 2026-08-09**, dan
> **diverifikasi owner DI LAYAR** dua arah: Batu Layang 08-08 (terisi) →
> tanggal tebal + kotak kuning menyebut ketiga seksi; Adisucipto 07-28 (kosong)
> → tanggal tampil, NOL peringatan.
>
> Dua lapis yang diserang: tanggal di atas kolom input, dan peringatan
> hari-sudah-terisi. **Lapis ketiga — default tanggal = cookie "terakhir
> dibuka" — SENGAJA TIDAK DISENTUH** (arc topbar Juli; membatalkannya lewat
> pintu belakang memunculkan lagi bug dropdown desinkron).
>
> ⚠️ **Nada KUNING, bukan merah — jangan "diperbaiki" nanti.** Membuka hari yang
> sudah terisi adalah tindakan SAH: untuk membaca atau mengoreksi. Merah di situ
> akan berteriak serigala tiap hari dan mati dalam sepekan. Menyebut nama hari
> ("Sabtu") juga bukan hiasan — itu isyarat kedua yang INDEPENDEN dari angka
> tanggalnya, dan orang menangkap "kok Sabtu?" lebih cepat daripada "kok 8?".
>
> ⚠️ **Mitigasi tidak menghapus mekanismenya.** Kalau kesalahan serupa muncul
> lagi meski peringatan sudah ada, itu sinyal **mitigasinya tak cukup** — bukan
> bahwa peringatannya gagal dipasang.

## ⚠️ BUKAN KODE — Batu Layang 08-07 masih rusak di produksi

Entri asli sudah ter-**void** dan tak bisa dipulihkan lewat aplikasi tanpa
dimasukkan ulang. Angka yang harus dikembalikan pada **business date 2026-08-07**:

| komponen | nilai yang benar | yang ada sekarang |
| --- | ---: | ---: |
| **F** Pendapatan Lain | **0** (tak ada baris) | 103.478.000 |
| **G** Pengeluaran | **40.600.000** | 40.608.000 |
| **I** Setoran Bank | **241.297.000** | 483.803.000 |

### ✅ HASILNYA — dikoreksi LENGKAP, lubangnya tidak terbangun

Diperiksa baca-saja di DB pilot, **2026-08-09 pukul 18:30–18:31 WIB** pengawas
mengoreksi **ketiganya**:

| komponen | tindakan | hasil |
| --- | --- | ---: |
| **F** | kedua baris salinan (100.000.000 + 3.478.000) **di-void** | **0** ✓ |
| **G** | 58.000 & 250.000 di-void, 300.000 dipasang kembali | **40.600.000** ✓ |
| **I** | 483.803.000 di-void, 241.297.000 dimasukkan ulang | **241.297.000** ✓ |

`H` kembali 241.296.190, selisih **Rp 810** → **selaras**. Baris 08-08 **tidak
tersentuh** (F 103.478.000 · G 40.608.000 · I 483.803.000).

> **Skenario "hanya `I` yang diperbaiki" TIDAK terjadi.** Lubang F&G tetap laten,
> dan ia tetap laten karena **instruksi menyebut ketiga angkanya** — bukan karena
> ada aturan yang menjaganya. Itu persis bentuk keputusannya: skenario yang
> dibangunkan oleh rencana kita sendiri ditutup oleh **orang**, dengan instruksi
> yang eksplisit dan verifikasi pada **angkanya, bukan warnanya**.

Konsekuensi langsung yang sudah terlihat: penjaga hidup `dua-arah` kini mencetak
**0 kasus** pada jendela penuh — persis peringatan yang ditulis di dekatnya. Ia
menyala pada kesempatan nyata pertamanya.

Dengan itu `H` kembali 241.296.190 dan selisihnya Rp 810 → **selaras**.
Baris 08-08 sudah benar dan **jangan disentuh**.

**Datanya tidak saya sentuh.**

---

# 2026-08-09 (putaran ketiga) — dua bentuk yang layak dibawa ke proyek lain

## A · Gerbang yang label pelepasnya belum dibuat

`arsip-siklus-kedua` **tidak ada di repo** saat gerbang G4 dipasang. Saya
membuktikan ia bisa **MERAH**, lalu menyatakannya "terpasang" — padahal jalur
**HIJAU**-nya mustahil.

> **Membuktikan MERAH tanpa membuktikan HIJAU adalah setengah bukti, dan
> setengah yang hilang justru yang menentukan gerbangnya dipakai atau
> ditinggalkan.** Gerbang yang jalan keluarnya tak ada tak bisa dibedakan dari
> gerbang tanpa jalan keluar: orang berikutnya akan mengira ia rusak lalu
> mencari cara melewatinya.

Ini **ketiga kalinya dalam dua hari** untuk keluarga yang sama — `/dev/tcp` di
zsh (pemeriksa yang tak bisa hijau) · workflow yang gagal parse (pemeriksa yang
tak pernah berjalan) · dan sekarang gerbang yang tak bisa dilepas. Yang ketiga
terjadi **pada alat yang dibangun untuk menangkap justru kelas ini**.

**Bentuknya yang diperbaiki, bukan kejadiannya:**

1. **Gerbang yang menuntut label wajib MEMASTIKAN labelnya ada**, dan bila tidak,
   pesan gagalnya menyebut **perintah persis** untuk membuatnya. Kegagalan itu
   diberi pesan berbeda — *"cacat gerbangnya, bukan cacat PR-mu"* — karena
   menyamakan keduanya membuat orang mencari jalan pintas.
2. **Keputusannya keluar dari YAML** ke `scripts/ci/check-arsip-g4.sh`, dan
   `check-arsip-g4.selftest.sh` mengujinya **lima keadaan termasuk jalur hijau**
   — memanggil skrip yang **sama** dengan yang dipanggil workflow, bukan
   tiruannya. Self-test itu berjalan di CI biasa.

Self-test-nya diuji dua arah: jalur hijau dilucuti → **merah**; pemeriksaan
keberadaan label dilucuti → **merah**; dipulihkan → hijau.

**Aturan turunan:** setiap gerbang yang menuntut sebuah *artefak* (label, secret,
berkas, izin) harus memeriksa artefak itu **ada** sebelum menuntutnya — dan
diuji pada keadaan **lolos**, bukan hanya keadaan tolak.

## B · Keputusan yang BENAR untuk membaca, jadi salah saat permukaannya menulis

Koreksi penting dari owner atas penyelidikan UX saya. Perilaku cookie
"terakhir dibuka" **bukan kecerobohan** — ia **sengaja dibangun** pada arc topbar
picker Juli: cookie diturunkan menjadi *last-used write-through* untuk
memperbaiki dropdown yang desinkron pada navigasi lunak. Untuk **navigasi**,
keputusan itu benar dan masih benar.

Yang tak diantisipasi siapa pun: **permukaan yang sama kemudian mendapat jalur
TULIS UANG** (panel input Rincian). Saat itu "terakhir dibuka" berubah dari
**kenyamanan** menjadi **jebakan** — bukan karena keputusannya memburuk, tapi
karena taruhannya berubah.

> **Sebuah keputusan default yang benar untuk MEMBACA bisa menjadi salah begitu
> permukaannya mulai MENULIS.** Yang berubah bukan keputusannya, melainkan
> konsekuensi kesalahannya.

⚠️ **Jangan tulis ini sebagai "cookie-nya salah".** Menyalahkan keputusan lamanya
akan menyembunyikan pelajarannya, dan pelajarannya berlaku di luar proyek ini:
saat sebuah permukaan baca-saja mendapat kemampuan menulis, **semua default yang
dipilih untuk kenyamanan baca wajib ditinjau ulang** — bukan dibatalkan, ditinjau.

Karena itu keputusan owner: **perbaiki ISYARATNYA, jangan ubah default-nya.**
Membatalkan perilaku cookie lewat pintu belakang akan memunculkan kembali bug
dropdown desinkron yang arc Juli memang selesaikan.

## C · Yang dibangun (kedua isyarat)

Menyerang tepat dua dari tiga lapis yang ditemukan penyelidikan — lapis
default **tidak** disentuh.

| lapis | sebelum | sekarang |
| --- | --- | --- |
| tanggal saat mengetik | hanya di kop lembar, ~110 baris di atas panel; `ManualEntryForm` tak menyebut tanggal sama sekali | **"Tanggal bisnis: …" tepat di atas kolom input** |
| hari sudah terisi | tak ada isyarat — menimpa hari benar terasa sama dengan mengisi hari kosong | **peringatan menyebut seksi & jumlah barisnya** |

`PanelIsyarat` **wajib** di `ManualPanel`: menambahkan panel tanpa menyediakan
tanggalnya adalah error type-check, bukan panel diam yang mengulang cacat lama.

**Keadaan diamnya benar-benar diam** — `rincianTerisi: null` dan tak ada elemen
peringatan sama sekali saat hari kosong. Peringatan yang selalu menyala akan
diabaikan dalam seminggu; itu diuji sebagai tes tersendiri, dan mutasi
"peringatan SELALU muncul" memerahkannya.

Lima mutasi membuktikan kelimanya bisa merah: peringatan tak pernah muncul ·
peringatan selalu muncul · tanggal dilepas dari panel · model selalu bilang
"sudah terisi" · seksi kosong ikut disebut.


---

# 2026-08-09 (penutup arc) — dua bentuk terakhir

## A · Lubang laten bisa DIBANGUNKAN oleh tindakan perbaikan kita sendiri

Ditemukan saat menyapu sisa pekerjaan, bukan saat menulis kodenya — dan tak ada
kode yang diubah karenanya (keputusan owner).

Aturan salin-setoran dijaga `kode !== "selaras"`. Itu benar: dua hari yang
setorannya kebetulan sama tapi dua-duanya selaras bukan kesalahan. **Tapi syarat
yang sama juga mematikan `komponenIkut` tepat pada saat ia paling dibutuhkan.**

Skenarionya adalah **rencana koreksi kita sendiri** untuk Batu Layang 08-07.
Bila pengawas hanya memperbaiki `I` agar cocok dengan `H` yang **sudah salah** —
mis. mengetik `344.766.000`, dan setoran memang selalu dibulatkan ke ribuan —
maka |I − H| = **190** ≤ toleransi → **selaras, hijau**, sementara F dan G masih
milik 08-08. Aturannya berhenti menyala, jadi fakta "komponen manual identik
dengan hari tetangga" **tak pernah tersuarakan**.

> **Sebuah lubang yang laten dalam data historis (0 dari 102) bisa dibangunkan
> oleh tindakan perbaikan yang kita rencanakan sendiri.** Mengukur laju kejadian
> pada data masa lalu tidak memberi tahu apa pun tentang keadaan yang akan kita
> CIPTAKAN berikutnya.

**Keputusan owner: JANGAN ubah kode.** Instruksi koreksinya menyebut **ketiga**
nilainya secara eksplisit, dan owner memverifikasi hasilnya di layar dengan
memeriksa **ketiga angkanya, bukan warnanya**. Skenario itu ditutup oleh **orang**,
bukan oleh aturan yang laju positif-palsunya belum terukur.

Angka yang harus dikembalikan pada **2026-08-07**, unit Batu Layang:

| komponen | benar | (yang salah) |
| --- | ---: | ---: |
| **F** Pendapatan Lain | **0** (tanpa baris) | 103.478.000 |
| **G** Pengeluaran | **40.600.000** | 40.608.000 |
| **I** Setoran Bank | **241.297.000** | 483.803.000 |

## B · Snapshot sesi bisa BASI terhadap repo

Saat menyiapkan PR promosi, snapshot berkas di sesi saya menampilkan
`arsip-g4.yml` **tanpa** wiring `BASE_REF`/`HEAD_REF` — padahal PR-nya sudah
di-merge. Saya memeriksa `staging` langsung alih-alih melaporkan dari snapshot.

> **Sumber yang ada di depan mata terasa otoritatif justru karena ia ada di depan
> mata.** Keluarga yang sama dengan `ingested_at` dan dengan data yang bergerak
> di bawah kaki: yang berbahaya bukan sumber yang jelas usang, melainkan sumber
> yang tampak segar.

**Aturan turunan:** sebelum menyatakan sesuatu tentang keadaan repo — terutama
setelah merge yang dilakukan orang lain — baca dari `git`, bukan dari apa yang
kebetulan terpampang di konteks.

## C · Pengamatan cabang pengecualian G4 — hasilnya, dan batasnya

Cabangnya **dieksekusi** pada PR #246 (`PR promosi (staging → main) — G4
dikecualikan.`), jadi wiring `BASE_REF`/`HEAD_REF` **terbukti sampai ke skrip**.

Tapi promosi itu membawa **nol** berkas `session-notes/`, jadi ia **tidak**
membuktikan pengecualiannya **mengubah hasil** — tanpa pengecualian ia tetap
lolos lewat cabang "G4 tak berlaku". Pengamatan penuhnya menunggu promosi yang
membawa commit arsip. **Jangan tandai celah ini tertutup penuh sebelum itu.**
