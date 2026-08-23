# Keuangan Harian — catatan PENUTUP arc K2/K3 (24 Agustus 2026)

Ditulis saat daftar pekerjaan kode habis. **Bukan ringkasan**; ini yang harus
dibawa siapa pun yang membuka modul ini berikutnya — terutama hal-hal yang akan
terlihat seperti cacat padahal bukan.

## Keadaan, diukur bukan diingat (24 Agu 2026)

| | |
|---|---|
| rute `/keuangan` di produksi | **6** (Layar 1–5 + Kelola Akun Kas) |
| migrasi | **36** (`0036_saldo_awal` terakhir) |
| keputusan ber-nomor `§10.x` | **23** |
| merge ke `staging` sejak 10 Agu | **54** |
| merge `staging` → `main` sejak 10 Agu | **11** |
| uji dashboard | **1302 lulus / 192 skip** |

## ⛔ EMPAT HAL YANG AKAN TERLIHAT SEPERTI CACAT, DAN BUKAN

Kalau sesi berikutnya "memperbaiki" salah satunya di kode, itu **regresi**.

### 1. `app.cash_ledger` KOSONG di ketujuh unit

Ini satu baris yang menjelaskan mengapa lima kerusakan pembukuan Bakau (±Rp 46 M)
belum bergerak: **aplikasinya siap, bukunya belum dimulai.** Buku kas kosong
bukan cacat aplikasi — ia pekerjaan yang belum dilakukan manusia.

Akibat yang mengikutinya, dan semuanya BENAR:
`kasAkhir` = `null` (§10.21, bernama `belum_ada_mutasi_kas`) → `langkahHarian`
`null` → **gerbang tutup hari tak bisa lulus di mana pun**.

⛔ **Jangan menambah "impor" atau "saldo awal otomatis" untuk mengisinya.**
Jalur saldo pembuka sudah ada (§10.24, wewenang Head of Finance); yang belum ada
adalah orang yang mengisinya.

### 2. Seluruh riwayat sebelum 2026-08-01 kehilangan LABA KOTOR

§10.23, disengaja. Ketujuh unit baru lengkap harga belinya sejak **2026-08-01**;
sebelum itu ada produk yang menyumbang omzet tanpa beban pokok, dan menjumlahkan
GP dari himpunan itu **lebih saji** (terukur: Bakau 2026-07-15 menunjukkan GP
persis sama dengan omzetnya).

**Pemulihannya mengisi harga beli MUNDUR, bukan mengubah kodenya.**

⚠️ Dan kalau kelak aturannya disentuh: syaratnya `perusakGp`, **bukan**
`incomplete`. Aturan yang memakai `incomplete` menihilkan **kesepuluh tanggal
emas** — semuanya punya BB-01 Pertalite Khusus tanpa harga beli, tetapi omzetnya
nol sehingga tak pernah merusak GP. **Aturan yang terlalu luas membuang bukti
yang sah bersama angka yang salah.**

### 3. Enam unit bagan akunnya belum lengkap

Satu rekening bank; tanpa `Kas Besar`, tanpa `EDC Penampungan`. Unitnya **tetap
tampil dan ditandai** (§10.22) — menandai membuat kekurangannya terlihat,
menyembunyikan membuat unitnya yang tak terlihat. Tandanya **pengamatan**, bukan
tuduhan: kita tidak tahu apakah keenamnya memang hanya punya satu rekening.

📌 Untuk owner, bukan kode: **Imam Bonjol dan Adisucipto terdaftar dengan nomor
rekening yang sama** (`Bank BCA - 5125033811`).

### 4. Papan keuangan BELUM PERNAH DIBUKA siapa pun di produksi

Baris `[ukur]` masih **nol** — dan kosongnya sudah diuji dua arah berkali-kali
(kontrol positif berbunyi, kontrol negatif diam). Jadi belum ada satu pun angka
kinerja nyata dari modul ini.

## Tuas yang tercatat, dan syarat pemicunya

**`qScoped` 64 → 19 round-trip.** Tiap `qScoped` berharga empat perjalanan
(`BEGIN` · `set_config` · kueri · `COMMIT`); satu transaksi bisa memuat banyak
kueri dengan RLS yang **persis sama**.

Terukur di produksi lewat instrumennya sendiri:

```
[ukur] bahan-laporan  kueri=16   pernyataan=64    ← identik di ketujuh unit
[ukur] papan          kueri=119  pernyataan=476   ← harness, tanpa getDayClose
halaman sungguhan     ±126 kueri / ±504 round-trip, pool bercap 10
```

⛔ **Syaratnya "ADA YANG MELAMBAT", bukan "angkanya besar".** Jangan dikerjakan
tanpa **durasi nyata dari log Cloud Run** — durasi dari laptop didominasi RTT
(64 round-trip × RTT) dan tak sebanding. Biaya per-unit terbukti **tak bergantung
data**, jadi kurvanya linear terhadap jumlah unit termodelkan, dan tujuh adalah
maksimumnya.

## Gerbang yang menunggu ORANG, bukan agen

- **#294 · #297 · #304** menunggu label `arsip-siklus-kedua` **dari owner**.
  Gerbang G4 sengaja menunjuk owner; **jangan dilabeli agen.**
- **Gerbang `pilot`** tiap promosi: persetujuan owner.
- **Saldo pembuka**: wewenang Head of Finance (§10.24) — bukan peran `keuangan`,
  dan bukan agen.

## Yang saya bawa dari arc ini, dalam satu kalimat

Yang membuat modul ini bisa dipercaya bukan jumlah penjaganya, melainkan berapa
kali sebuah hijau **ditolak karena tak dipercaya** — termasuk hijau milik sendiri:
penjaga tanpa subjek, filter log yang tak diuji dua arah, `JSON.stringify` yang
membuang `footer`, pipeline `grep | head` yang menelan galat typecheck, dan
empat kali "satu pembuat vonis" dilanggar **di dalam tesnya sendiri**.
