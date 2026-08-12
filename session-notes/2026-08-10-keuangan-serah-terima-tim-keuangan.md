# Pembukuan SPBU Bakau — apa yang perlu diketahui dan dikerjakan

Untuk tim keuangan SolaGroup · 10 Agustus 2026

Dokumen ini hasil pemeriksaan atas workbook **`Finance SPBU 6378301 BK`** (Bakau),
dibandingkan dengan data mentah kasir EasyMax. **Tidak ada satu pun angka di
workbook yang kami ubah.** Yang kami lakukan hanya membaca dan membandingkan.

Kabar baiknya lebih dulu: **rumus laba harian di workbook itu benar.** Kami
menghitung ulang laba kotor sepuluh hari secara terpisah dari data kasir, dan
kesepuluhnya cocok **sampai rupiah**. Jadi kerangkanya sehat; yang bermasalah
adalah beberapa hal yang berhenti diisi.

---

## Bagian 1 — Empat hal yang rusak

### 1. Pembelian BBM berhenti dicatat sejak akhir Januari 2026

Pembayaran pembelian BBM terakhir yang tercatat adalah **28 Januari 2026 sebesar
Rp 624.969.102** di buku Bank BCA-5125036811. Sesudah itu tidak ada satu pun
pencatatan pembelian BBM — padahal BBM tetap datang tiap hari, tetap dijual, dan
harga pokoknya tetap dibebankan ke laba. Akibatnya uang di rekening terlihat terus
menumpuk tanpa pernah berkurang untuk membayar Pertamina, dan neraca makin lama
makin tidak seimbang.

> **Rp 39.452.607.134** — besar ketidakseimbangan neraca per 27 Juli 2026.
> Sebagai pembanding, nilai BBM yang diterima tanpa pernah dicatat sebagai
> pembelian pada periode yang sama kami taksir **Rp 40,39 miliar**. Dua angka ini
> berdekatan, dan itulah yang meyakinkan kami bahwa inilah sebabnya.

Perlu diketahui: bukan hanya pencatatan di buku bank yang berhenti. Lembar isian
`SisaSO` berhenti 30 Januari dan `PenebusanBBM` berhenti 2 Februari. Jadi
memperbaiki buku bank saja tidak cukup — ketiganya harus diisi ulang bersamaan.

### 2. Piutang pelanggan tercatat jauh lebih besar dari kenyataan

Workbook mencatat piutang pelanggan **Rp 7,2 miliar**, sedangkan data kasir
EasyMax menunjukkan **Rp 0,66 miliar** (posisi 12 Januari 2026). Sebabnya: buku
piutang di workbook mencatat setiap pengambilan BBM secara kredit, tetapi hampir
tidak pernah mencatat saat pelanggan membayar.

> **Rp 1.830.000** — total pembayaran pelanggan yang tercatat di workbook
> sepanjang September 2025 sampai Juli 2026, melawan **Rp 5,63 miliar** piutang
> baru pada periode yang sama. Data kasir menunjukkan pelanggan sebenarnya
> membayar dengan normal (tahun 2025: menambah Rp 3,34 miliar, membayar
> Rp 3,06 miliar).

Kami sudah memastikan **cara menghitung** angka kasir itu benar dengan mencocokkannya
ke laporan resmi EasyMax "Daftar Saldo Hutang Piutang" Bakau — **lima belas angka,
semuanya cocok persis**.

Satu hal perlu disebut apa adanya: **lima tanggal uji itu tahun 2022**, sebab hanya
tanggal-tanggal itu yang laporan resminya tersimpan. Jadi yang terbukti adalah
rumusnya, bukan angka Januari 2026 secara langsung. Sebagai gantinya kami memeriksa
pencatatan piutang Oktober 2025 – Agustus 2026 dan tidak menemukan satu pun hari
yang bolong, jadi tidak ada celah data yang bisa menjelaskan selisih Rp 6,5 miliar.
Kesimpulannya tetap: yang keliru adalah workbook, bukan data kasir. **Kalau unit bisa
mencetak laporan "Daftar Saldo Hutang Piutang" untuk satu tanggal tahun 2026, kirimkan
ke kami** — uji yang sama akan diulang dan hasilnya menutup keraguan terakhir.

**Yang masih perlu dijawab orang keuangan:** kalau uang tagihan itu masuk ke bank
tetapi dicatat sebagai "Setoran Hasil Penjualan", berarti **pendapatan juga ikut
kelebihan catat**. Ini menentukan apakah koreksinya menyentuh laba atau hanya
neraca.

### 3. Harga beli Solar kosong sejak 4 Maret 2026

Kolom harga beli Solar dibiarkan kosong sejak tanggal itu. Karena harga pokok
dihitung sebagai *jumlah liter × harga beli*, maka sejak 4 Maret **harga pokok
Solar tercatat nol** dan **persediaan Solar juga tercatat nol** — padahal Solar
adalah produk dengan volume penjualan terbesar di Bakau. Artinya laba yang
tersaji sejak tanggal itu lebih besar dari yang sebenarnya.

> **4 Maret 2026** — sejak tanggal ini Solar terjual tanpa harga pokok sama sekali.

Masalah serupa dalam bentuk lebih ringan: harga beli produk lain juga sudah lama
tidak diperbarui (Pertamax terakhir 5 Januari 2026, Dexlite 1 Januari 2026,
Pertalite 10 Januari 2025), sementara harga jual terus berubah sampai Juli 2026.
Margin yang tersaji karenanya tidak mencerminkan keadaan sebenarnya.

### 4. Empat rekening bank sudah bertahun-tahun tidak dibukukan

Saldonya masih ikut dihitung sebagai kas di neraca, padahal tidak pernah
dicocokkan ke rekening koran: BCA-5125978301 (terakhir dibukukan Agustus 2022),
BRI (November 2021), BNI (September 2021), Mandiri (Januari 2024).

> **± Rp 94 juta** — total saldo keempat rekening itu yang masih tercatat sebagai
> kas perusahaan tanpa konfirmasi selama 2–5 tahun.

Catatan tambahan di luar keempatnya: pos **"EDC Penampungan"** naik terus dari nol
pada 2021 menjadi **Rp 12.435.466.761** dan nyaris tidak pernah turun. Uang EDC
biasanya cair ke rekening dalam satu hari kerja, jadi angka sebesar itu tidak
mungkin benar-benar mengendap. Perlu diputuskan pos ini sebenarnya apa.

---

## Bagian 2 — Yang perlu dikerjakan minggu ini

Urutannya mengikat: nomor 5 tidak masuk akal dikerjakan sebelum 1–4 beres.

| # | Pekerjaan | Kenapa harus urutan ini | Penanggung jawab | Target |
|---|---|---|---|---|
| 1 | **Isi ulang pencatatan pembelian BBM** 29 Jan 2026 → sekarang: lembar `PenebusanBBM`, `SisaSO`, dan kredit "Pembelian BBM" di buku bank | Selama ini belum diisi, semua koreksi lain akan langsung usang besoknya | ______________ | ______ |
| 2 | **Isi harga beli Solar** sejak 4 Maret 2026, lalu perbarui harga beli semua produk | Harga pokok saat ini salah; menutup periode mana pun sebelum ini beres akan mengunci angka yang keliru | ______________ | ______ |
| 3 | **Cocokkan saldo kelima rekening bank ke rekening koran**, termasuk empat rekening yang lama tidak dibukukan | Kas adalah satu-satunya pos yang bisa dibuktikan ke pihak luar | ______________ | ______ |
| 4 | **Telusuri piutang pelanggan**: ke mana pembayaran pelanggan dibukukan selama ini | Menentukan apakah koreksinya menyentuh laba atau hanya neraca | ______________ | ______ |
| 5 | **Putuskan perlakuan "EDC Penampungan"** | Harus selesai sebelum saldo awal ditandatangani | ______________ | ______ |
| 6 | **Susun jurnal koreksi** untuk (a) selisih lama Rp 3.635.936 dan (b) periode 29 Jan → tanggal cut-over | Baru bisa disusun setelah 1–5 diketahui angkanya | ______________ | ______ |
| 7 | **Persetujuan Direksi** atas jurnal koreksi | Nilainya jauh di atas batas kewenangan lain | ______________ | ______ |

Catatan untuk nomor 1: daftar BBM yang masuk per hari per produk **sudah tersedia
di sistem SolaMax** dan bisa dicetak — tidak perlu dihitung ulang dari nota.

Catatan untuk nomor 6: jangan memakai angka Rp 132.268 yang selama ini disebut
sebagai selisih lama. Angka yang benar adalah **Rp 3.635.936** per 28 Januari 2026.
Selisih ini juga **bukan** batas toleransi — setelah dikoreksi harus kembali nol.

---

## Bagian 3 — Sepuluh pertanyaan untuk dibahas dalam rapat

Ditulis supaya bisa dijawab langsung dalam rapat. Semuanya menahan langkah
berikutnya, jadi jawaban "nanti dulu" pun perlu disebut siapa yang memutuskan.

1. **Apakah semua tujuh SPBU akan memakai daftar akun (bagan akun) yang sama, atau
   tiap SPBU punya sendiri?** Kalau sama, siapa yang berwenang menambah akun baru?
2. **Apa saja sebab-selisih yang boleh dipilih saat menutup hari?** Kami usulkan
   mulai dari: pembulatan slip setoran, selisih kas fisik, selisih settlement EDC,
   salah kategori, salah tanggal, entri ganda. Perlu ditambah apa?
3. **Empat belas kategori biaya yang dipakai pengawas masuk ke akun akuntansi yang
   mana?** Siapa yang menandatangani pemetaan pertamanya?
4. **Pos "EDC Penampungan" Rp 12,4 miliar itu sebenarnya apa** — rekening
   sungguhan, atau selisih yang menumpuk bertahun-tahun? Kapan uang EDC dianggap
   sudah cair?
5. **Ke mana pembayaran pelanggan dibukukan selama ini,** kalau bukan ke buku
   piutang? Apakah ikut masuk ke "Setoran Hasil Penjualan"?
6. **Tanggal berapa tiap SPBU mulai dibukukan di sistem baru, dan siapa yang
   menandatangani saldo awalnya?**
7. **Empat rekening bank yang lama tidak dibukukan itu masih ada, sudah ditutup,
   atau saldonya perlu dihapusbukukan?**
8. **Apakah jabatan Head of Finance sudah ada?** Kalau belum, semua penutupan hari
   yang selisihnya di atas Rp 10.000 harus lewat Direksi — apakah itu diterima?
9. **Pesanan BBM yang sudah lama tidak pernah datang — masih dihitung atau
   dihapus?** Contohnya dua pesanan Solar dari tahun 2023 senilai Rp 105.074.482
   yang di workbook sudah dihapus tetapi di sistem masih tercatat.
10. **Kalau BBM datang tanggal 31 tetapi pesanannya baru ditutup tanggal 1, masuk
    bulan yang mana?** Perlu satu aturan yang dipakai semua SPBU.

---

## Yang perlu diketahui tentang dokumen ini

- Semua angka di atas berasal dari salinan workbook per **10 Agustus 2026 pukul
  16.55 WIB** dan dari data SolaMax. Workbook Bakau sendiri berhenti diisi sekitar
  **27–28 Juli 2026**.
- Rincian teknis, cara menghitung ulang, dan batas-batas pemeriksaan ada di
  `apps/dashboard/KEUANGAN-HARIAN.md` beserta catatan pendukungnya. Dokumen ini
  sengaja tidak mengulanginya.
- **Belum ada sistem yang dibangun.** Yang selesai baru pemeriksaan dan keputusan
  rancangan. Pembangunan menunggu jawaban atas sepuluh pertanyaan di atas.
