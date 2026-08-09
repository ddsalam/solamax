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

**Belum dikerjakan. Menunggu gerbang owner.**

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

**Tidak ada yang dibangun. Menunggu gerbang.**

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
