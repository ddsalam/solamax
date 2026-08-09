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
