# K0 / T3 — HASIL rekonstruksi tersegel (Bakau, 10 tanggal)

Segel: [`2026-08-10-keuangan-k0-t3-prareg.md`](2026-08-10-keuangan-k0-t3-prareg.md),
commit **`27c9055`**, ditulis & di-commit **sebelum** satu pun sel jawaban dibuka.
Pengakuan apa yang sudah terlihat sebelum menyegel ada di berkas itu — baca dulu.

## Hasil satu tabel

Level sel primitif: 10 tanggal × 7 produk × 7 besaran = **490 sel**.

| kategori | jumlah |
|---|---:|
| **EKSAK** (dalam toleransi 0,01 L / Rp 0,5) | **305** |
| kedua sisi kosong (cocok) | 155 |
| **BEDA** | 17 |
| sheet kosong padahal SolaMax berisi | 13 |

Dari **335 sel yang salah satu sisinya berisi → 305 EKSAK (91,0 %)**.

Level uang (7 pos × 10 tanggal, dibandingkan ke `IncomeStatement`/`BalanceSheet`):

| pos | eksak | catatan |
|---|---|---|
| **COGS** | **10/10** | selisih Rp 0,00 |
| **Gross Profit** | **10/10** | selisih Rp 0,00 |
| **LossesGainValue** | **10/10** | selisih Rp 0,00 |
| Revenue | 8/10 | 2 beda = tera (D1), masing-masing Rp 47.124 dan Rp 13.350 |
| TeraValue | 8/10 | cermin dari Revenue, saling menutup |
| Inventory (BS!C) | 9/10 | 1 beda = timing kiriman (D3) |
| SO Value (BS!D) | **0/10** | selisih sistematis (D2) |

Gross Profit eksak sampai rupiah pada **kesepuluh** tanggal, termasuk kelima akhir
bulan dan keempat hari pergantian harga. Itu pernyataan terkuat yang bisa dibuat di
K0: **mesin laba-rugi harian workbook dapat direproduksi dari SolaMax.**

## Klasifikasi setiap selisih

Tak satu pun tersisa "tidak dapat dijelaskan".

### D1 — beda DEFINISI: tera dinetokan ke volume (2 sel, Rp 60.474)

| tanggal | produk | SolaMax | sheet | selisih |
|---|---|---:|---:|---:|
| 2025-06-02 | Solar | vol 15.563,06 · tera 6,93 | vol 15.556,13 · tera kosong | −6,93 L |
| 2025-06-30 | Pertamax Turbo | vol 137,34 · tera 1,00 | vol 136,34 · tera kosong | −1,00 L |

Workbook mengurangkan tera dari volume dan mengosongkan sheet `Tera`. Karena
`COGS = (Volume − Tera) × −HargaBeli`, COGS **identik**; Revenue lebih rendah
`tera×jual` dan TeraValue 0 alih-alih `−tera×jual` → **Gross Profit sama persis**.
Bukan kesalahan. Tapi omzet kotor & TeraValue tak bisa diadu per baris.

### D2 — beda DEFINISI: SO mati (10/10 tanggal)

Selisih `SO Value` terurai **habis** secara aritmetika:

- **Solar −16.000 L pada SEMUA 10 tanggal** = Rp 105.074.482 tepat
  (16.000 × 6.567,155125). Penyebabnya dua SO yang tak pernah ditutup di EasyMax:

  | CNOSO | tgl tebus | ditebus | diterima | sisa |
  |---|---|---:|---:|---:|
  | 4023445216 | 2023-01-23 | 32.000 | 24.000 | 8.000 |
  | 4027089474 | 2023-11-24 | 40.000 | 32.000 | 8.000 |

  Umur 2,5–3 tahun. Finance sudah menghapusnya; `getDoHarian.sisa` masih membawanya.
- **Pertalite Khusus (BB-01 PREMIUM) 1.120.000–1.152.000 L** — SO PREMIUM mati.
  Tak punya `HargaBeli` → nilai Rp 0, tak berdampak uang, tapi mencolok di volume.
- **Pertamina Dex +4.000 L** pada 2025-06-02/06-30/08-31 — arah sebaliknya
  (sheet lebih besar).

Verifikasi penutup, per tanggal:
`2025-06-02: −105.074.482 + 4.000×13.470,641 = −51.191.918` ✓ (sesuai sheet)
`2025-12-31: −105.074.482 + 8.000×9.679,55175 = −27.638.068` ✓ (sesuai sheet)

Keduanya masuk kategori `sisa_macet` (`DO_STALE_DAYS = 30`) yang **sudah** dikenali
SolaMax tetapi tidak dikeluarkan dari angka utama `sisa`. → keputusan di T2 §D2.

### D3 — beda TIMING: batas tanggal kiriman (1 tanggal, saling menutup)

2025-12-31 Pertalite: `StockAkhirHari` SolaMax 31.190,18 vs sheet 23.190,18
(**−8.000 L**) dan `SisaSO` 48.000 vs 56.000 (**+8.000 L**). Satu kiriman 8.000 L
sudah masuk stok menurut SolaMax, masih SO menurut sheet. Dalam rupiah:
Inventory −77.436.414 / SO Value +77.436.414 → **netonya nol**.

### D4 — kandidat SALAH KETIK DI SHEET (1 sel)

2025-09-30 Dexlite: penebusan **8.000 L** ada di SolaMax (`tebus_header.dtgltbs`),
sel `PenebusanBBM` **kosong**. Satu-satunya selisih pada 10 tanggal yang tidak punya
penjelasan definisi/timing. Untuk dikonfirmasi tim keuangan.

### D5 — bukan bug: harga beli > harga jual benar-benar terjadi

Diprediksi di segel butir 4, dan terkonfirmasi: 2025-01-31 Pertamax Turbo
HargaBeli 14.257,18 > HargaJual 14.000 → COGS (−1.199.599) melebihi Revenue
(1.177.960). Workbook menunjukkan hal yang sama. Ini bukan selisih — ini bukti
bahwa penjaga yang akan dipasang punya subjek nyata (lihat §Penjaga).

## Yang saya prediksi dan MELESET

Segel butir 2 memperkirakan `HargaJual` via `mode(nhargajual)` akan meleset pada
hari pergantian harga. **Tidak meleset satu pun** — 10/10 eksak, termasuk keempat
hari pergantian harga. Modus ternyata cukup kuat karena harga berganti tengah malam,
bukan tengah hari. Dicatat karena prediksi yang salah harus dilaporkan juga.

## Uji dua penjaga harga yang diusulkan (§3)

Diminta eksplisit. Rentang uji 2021-01-01 … 2026-08-10 = **2.048 hari**, 7 produk.

**Penjaga 1 — "tolak bila harga beli > harga jual":**

| | |
|---|---|
| sel hari-produk yang melanggar | **436** |
| hari berbeda yang terkena | **336 dari 2.048 (16,4 %)** |
| rentang | 2021-09-21 … 2026-02-28 |
| per produk | Pertamina Dex 182 · Pertamax Turbo 137 · Pertamax 62 · Dexlite 54 · Pertalite Khusus 1 |
| selisih terbesar | Pertamina Dex 2024-01-01, beli melebihi jual Rp 2.282/L |

⚠️ **Peringatan desain.** Penjaga ini sebagai **penolakan keras** akan memblokir
16,4 % hari historis. Yang terkena hampir seluruhnya produk non-subsidi
(Pertamina Dex, Pertamax Turbo) — pada masa transisi harga, SPBU memang bisa
menjual di bawah harga tebus. Rekomendasi: **peringatan yang wajib diakui
(acknowledge) + alasan**, bukan `reject`; sisakan `reject` untuk kasus yang tak
masuk akal (mis. beli > 1,5 × jual). Kalau owner tetap ingin `reject` keras,
itu keputusan yang sah — tapi harus tahu ia menolak pola yang 336 kali nyata.
Latar Batu Layang Agustus 2026 (persediaan lebih saji Rp 184–240 juta) tetap
dilayani oleh versi peringatan, karena yang dicari adalah **perhatian manusia**.

**Penjaga 2 — "tagih bila harga jual berubah tapi harga beli tidak":**

| | |
|---|---|
| sel hari-produk yang terpicu | **128** |
| per produk | Pertamina Dex 45 · Dexlite 36 · Pertamax 20 · Pertamax Turbo 20 · Pertalite Khusus 5 · Solar 1 · Pertalite 1 |
| contoh terakhir | 2026-07-01 Dexlite jual 23.500→20.150, beli tetap 13.254,91 |

Penjaga ini **akan menangkap kerusakan yang sedang berjalan**. Perubahan harga beli
terakhir per produk: Pertamax 2026-01-05 · Dexlite 2026-01-01 · Pertamina Dex
2026-01-02 · Pertamax Turbo 2026-01-19 · Pertalite 2025-01-10 · **Solar 2024-12-01**
· Pertalite Khusus 2021-09-21. Harga jual bergerak jauh sesudahnya. Penjaga 2
layak dipasang tanpa keberatan.

## ⛔ Temuan di luar rencana: piutang pelanggan menyimpang Rp 6,5 miliar

Muncul saat membandingkan saldo pelanggan (bagian T3 yang diminta) ke
`BalanceSheet!F`. **Bukan** bagian dari patah 29 Januari — ini kerusakan
terpisah yang berjalan bertahun-tahun.

| tanggal | `BalanceSheet!F` (workbook) | SolaMax (`getSaldoPelanggan`, lokal+online) | selisih |
|---|---:|---:|---:|
| 2025-01-31 | 3.978.768.642 | 701.763.399 | +3.277.005.243 |
| 2025-06-30 | 5.265.906.151 | 826.382.657 | +4.439.523.494 |
| 2025-12-31 | 7.110.450.175 | 824.087.573 | +6.286.362.602 |
| 2026-01-12 | 7.215.380.182 | 659.853.498 | **+6.555.526.684** |

Sebabnya terbaca langsung dari buku itu sendiri —
**sisi penagihan hampir tidak pernah diposting**:

| `BukuHutangPiutangPelangganEasyM` — seumur hidup | |
|---|---:|
| `Piutang Pelanggan` (pengambilan kredit) | −13.967.346.182 |
| `Pembayaran / Deposit Pelanggan` | **+2.608.658.352** |
| `Adjustment` | −72.000.069 |

Sepanjang 2025-09 → 2026-07 tercatat pembayaran **Rp 1.830.000 total** (satu baris,
Januari 2026) melawan Rp 5,63 miliar piutang baru. EasyMax menunjukkan sebaliknya —
pelanggan Bakau memang membayar:

| tahun | piutang baru (`bppiut sjnsbp=1`) | pembayaran (`sjnsbp=2`) |
|---|---:|---:|
| 2024 | 2.872.034.027 | 2.565.256.145 |
| 2025 | 3.336.154.579 | 3.064.334.485 |
| 2026 (s/d Agu) | 3.299.508.694 | 2.466.659.698 |

**Dua kemungkinan, belum bisa dipilih di K0** — dan saya tidak akan menebak:

- **(a)** Uang tagihan memang masuk, tetapi dibukukan sebagai "Setoran Hasil
  Penjualan" di buku bank tanpa melepas piutangnya. Maka piutang **dan** pendapatan
  keduanya lebih saji ± Rp 6,5 miliar kumulatif.
- **(b)** Piutang workbook mencakup sesuatu di luar `bppiut` EasyMax (mis. tagihan
  yang diselesaikan di luar POS), sehingga bukan lebih saji melainkan beda cakupan.

Neraca tetap "seimbang" selama ini karena sisi lawannya konsisten di dalam workbook —
jadi `BalanceSheet!N` **tidak** akan pernah memperlihatkan masalah ini. Ini contoh
persis mengapa pemeriksa yang hanya menguji konsistensi-diri tidak cukup.

**Ini harus dijawab sebelum saldo awal per unit ditandatangani** — masuk daftar T4.

## Catatan mutu data EasyMax yang ditemukan sambil jalan (laporkan, jangan perbaiki)

1. **`delivery.nvolreal` punya pencilan ekstrem di Bakau.** Dua baris jelas salah
   entri: `2026-04-13` BB-07 `nvolreal = 25.531.454` (DO 8.000, `cnodo` 8136981579)
   dan `2026-07-12` BB-02 `nvolreal = 19.279.782` (DO 8.000, `cnodo` 8141013057).
   Selain itu **27 baris `nvolreal` negatif**, total −370.820.522, minimum
   −267.699.283. Setiap perhitungan berbasis `nvolreal` di Bakau akan rusak;
   `nvoldo` bersih. `getDailyGlByProduct` sudah memakai `nvoldo` — **jalur G/L aman**,
   tetapi jalur lain yang memakai `nvolreal` perlu diperiksa.
2. **`bppiut` Bakau 2022 melonjak Rp 34,56 miliar** piutang baru (58.527 baris)
   dibanding Rp 3–5 miliar di tahun lain. Kemungkinan mekanisme voucher/online
   (kode bertitik) yang saling meniadakan — `piutangOnline` memang konstan
   Rp 2.333.677 di kesepuluh tanggal. Perlu diperiksa sebelum angka lifetime
   dipakai untuk apa pun.

## Cara mengulang

Skrip & data antara ada di scratchpad sesi ini (`pred_sales.txt`, `pred_gl.txt`,
`pred_so.txt`, `pred_saldo.txt`, `csv/*.csv`). Semua query read-only, role
`dashboard_ro`, `set app.unit_ids='2'`.
