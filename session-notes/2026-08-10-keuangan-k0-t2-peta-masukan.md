# K0 / T2 — Peta masukan `Finance SPBU 6378301 BK` → sumber SolaMax

Kolom **"terbukti eksak?"** hanya boleh berbunyi YA bila ada bukti angka di repo
ini. Bukti T3 = 10 tanggal Bakau tersegel (`2026-08-10-keuangan-k0-t3-prareg.md`,
commit `27c9055`) → hasil di `…-t3-hasil.md`. Selain itu: BELUM DIUJI.

Legenda grain: `H`=per hari · `H×P`=per hari per produk · `TX`=per transaksi.

## A. Sheet masukan yang bisa diturunkan dari EasyMax

| # | sheet | kolom | sumber SolaMax (tabel/kolom) | grain | terbukti eksak? |
|---|---|---|---|---|---|
| 1 | `HargaJual` | B–H per produk | `sales_detail.nhargajual` (modus per hari-produk); master `product.nhrgjual` hanya nilai berjalan | H×P | **YA — 10/10 tanggal** (2 tanggal beda hanya karena tera, lihat C1) |
| 2 | `VolumePenjualan` | B–H per produk | `Σ sales_detail.nvolume` ⋈ `sales_header.dtgljual` | H×P | **YA — 68/70 sel**; 2 sel beda = tera (C1) |
| 3 | `LossesGain` | B–H per produk | metode RESUME `getDailyGlByProduct.gl` = `fisik − (fisik_prev + pen_do − (sales − tera))` | H×P | **YA — 70/70 sel** |
| 4 | `StockAkhirHari` | B–H per produk | `getDailyGlByProduct.fisik` = Σ `opname.nstockop` opname terakhir per tangki per hari-bisnis | H×P | **YA — 69/70 sel**; 1 sel beda = timing kiriman (C3) |
| 5 | `PenebusanBBM` | Volume (Lt) per produk | `Σ tebus_detail.nvolume` pada `tebus_header.dtgltbs`, `sbatal=0` | H×P | **YA — 69/70 sel**; 1 sel sheet kosong (C4) |
| 5b | `PenebusanBBM` | Sub Total (Rp) | **turunan** = Volume × `HargaBeli` (rumus sheet) | H×P | mengikuti 5 + `HargaBeli` |
| 6 | `SisaSO` | B–H per produk | `getDoHarian.sisa` = `Σ_SO GREATEST(0, ditebus≤D − diterima≤D)`, tautan `CNOSO` case-insensitive | H×P | **TIDAK — 0/10 tanggal**; selisih sistematis, lihat C2 |
| 7 | `Tera` | B–H per produk | `Σ terra_resmi.nvolume`, `sbatal=0`, `business_date` (ledger RESMI, **bukan** tabel `tera` mentah) | H×P | **YA** bila workbook mengisinya; masalahnya workbook sering **tidak** mengisi (C1) |
| 8 | `PengambilanBBMPelangganEasyMax` | Tanggal · Nama Pelanggan · Volume (L) · Nominal (Rp) | `pelanggan_sale` (+`pelanggan_master` utk nama) | TX | BELUM DIUJI |
| 9 | `BukuHutangPiutangPelangganEasyM` | A tgl · B ket · C jenis mutasi · D pelanggan · E nominal · F.. saldo berjalan | `bppiut`/`bphut` + `pelanggan_master.sjenis`; aturan terkunci 2026-08-06 (`getSaldoPelanggan`) | TX → saldo H | **saldo agregat DIHITUNG di T3** (tersegel, belum di-diff terhadap sheet — lihat batas di `…-t3-hasil.md`) |
| 10 | `BukuEDC` | per shift × {BCA-5125978301, BRI, Mandiri, BNI} | `edc` (natural key + `jrnkey = date*10+shift`) | H×shift×bank | BELUM DIUJI |

## B. Sheet masukan yang TIDAK bisa diturunkan dari EasyMax

| # | sheet | kolom | sumber | grain | catatan |
|---|---|---|---|---|---|
| 11 | `HargaBeli` | B–H per produk | **MANUAL** (keputusan owner, final) | berlaku-sejak × produk | Bentuk masukan: `(unit, produk, berlaku_sejak) → harga`, void + audit. **Bukan** deret harian; sheet sekarang mereplikasi nilai yang sama ke tiap baris hari. Jangan tarik `tr_dtebus.NHRGBELI`; jangan sentuh `TebusDetail`. |
| 12 | `BiayaOperasional` | A tgl · B keterangan · C **kategori** · D via (akun) · E nominal | **DUA PINTU**: pengawas via Rincian Penjualan (`app.ManualEntry` seksi `pengeluaran`) + entri Finance | TX | ⛔ `ManualEntry` **belum punya kolom kategori** — inilah lubangnya (lihat §D) |
| 13 | `BukuKasBesar` | A tgl · B ket · C Debet/Kredit/Adjustment · D kategori debet · E kategori kredit · F nominal · G saldo | **MANUAL** — `tr_hkasbank` EasyMax dorman sejak 2019 | TX | Baris "Setoran Hasil Penjualan" **bisa ditawarkan terisi** dari nilai setoran per shift yang sudah diketahui SolaMax (`ManualEntry` seksi `setoran_tunai` / `deposit`), tinggal disetujui — bukan diposting diam-diam |
| 14 | `BukuBankBCA-5125036811` | idem 13 | **MANUAL** (rekening koran) | TX | satu-satunya buku bank yang masih hidup (s/d 2026-07-28) |
| 15 | `BukuBankBCA-5125978301` | idem 13 | **MANUAL** | TX | **dorman** — baris terakhir 2022-08-18 |
| 16 | `BukuBankBRI` | idem 13 | **MANUAL** | TX | **dorman** — 2021-11-23 |
| 17 | `BukuBankBNI` | idem 13 | **MANUAL** | TX | **dorman** — 2021-09-23 |
| 18 | `BukuBankMandiri` | idem 13 | **MANUAL** | TX | **dorman** — 2024-01-10 |
| 19 | `BukuHutangPiutangNonEasyMax` | A tgl · B ket · C Piutang/Hutang/Adjustment · D account · E nominal | **MANUAL** (17 account di `List!E`, mis. SPBU sesama grup, Bright, Kebab) | TX | tak ada padanan EasyMax |

Sheet turunan murni (tanpa masukan sendiri) — tidak dipetakan karena hanya rumus:
`RevenuePenjualan` = Volume×HargaJual · `COGS` = (Volume−Tera)×−HargaBeli ·
`InventoryValue` = StockAkhirHari×HargaBeli · `SOValue` = SisaSO×HargaBeli ·
`LossesGainValue` = LossesGain×HargaBeli · `TeraValue` = −Tera×HargaJual ·
`CashFlow` · `IncomeStatement` · `BalanceSheet` · `LaporanHarian`/`Periode`/`Biaya`.
Selain itu ada `Devidend`, `PendapatanLainLain`, `TemporaryInvestment` (masing-masing
manual, kolom "Via <akun>") dan `AdjustmentCashFlow`/`AdjustmentIncome` (manual).

## C. Selisih terstruktur yang sudah diketahui (jangan diperlakukan sebagai bug baru)

- **C1 — tera dinetokan ke dalam volume.** Pada hari ada tera, workbook mengurangi
  volume penjualan dan **mengosongkan** sheet `Tera`. SolaMax memisahkan keduanya.
  Efek ke `Gross Profit` = **nol** (Revenue turun `tera×jual`, TeraValue naik dari
  `−tera×jual` ke 0). Ini **beda definisi**, bukan kesalahan. Tapi ia membuat omzet
  kotor & TeraValue tidak bisa dibandingkan langsung per baris.
- **C2 — `SisaSO` beda pada 10/10 tanggal**, dua komponen, keduanya sistematis:
  (a) **Solar −16.000 L konstan** — dua SO mati yang masih dihitung SolaMax:
  `CNOSO 4023445216` (tebus 2023-01-23, 32.000 dipesan / 24.000 diterima) dan
  `CNOSO 4027089474` (tebus 2023-11-24, 40.000 / 32.000). Finance sudah menghapusnya;
  SolaMax masih membawanya. Nilainya persis Rp 105.074.482.
  (b) **Pertalite Khusus (BB-01 PREMIUM) 1,12–1,152 juta L** — SO PREMIUM mati,
  tidak pernah punya `HargaBeli` sehingga nilainya Rp 0; tak berdampak uang.
  → Keduanya kategori `sisa_macet` (`DO_STALE_DAYS=30`). **Keputusan yang dibutuhkan:
  apakah `SisaSO` untuk keuangan memakai `sisa` atau `sisa − sisa_macet`.**
- **C3 — batas tanggal kiriman.** 2025-12-31 Pertalite: SolaMax sudah memasukkan
  8.000 L ke stok, workbook masih menghitungnya sebagai SO. Saling menutup
  (Inventory −77.436.414 / SO Value +77.436.414). **Beda timing.**
- **C4 — 2025-09-30 Dexlite 8.000 L**: penebusan ada di SolaMax, sel sheet kosong.
  Kandidat **salah ketik / entri terlewat di sheet**.

## D. Yang harus diputuskan sebelum K1 (bentuk data, bukan kode)

1. **`ManualEntry` belum punya `operational_category`.** Sekarang hanya
   `(unitId, businessDate, section, urut, keterangan, amount, void, audit)` —
   `section ∈ {pendapatan_lain, pengeluaran, setoran_tunai}`. Agar biaya
   berkategori sejak awal, layar Rincian Penjualan harus menyajikan 14 kategori
   `List!K`. Ini menambah **kolom milik pengawas**, terpisah dari `accounting_account`
   milik Finance (lihat `KEUANGAN-HARIAN.md`).
2. **`SisaSO`**: `sisa` atau `sisa − sisa_macet` (C2).
3. **Tera**: dipisah (SolaMax) atau dinetokan (workbook) (C1).
4. **Batas tanggal kiriman**: `dtgltrm` vs tanggal SO ditutup (C3).

## E. Status IMPORTRANGE `PengambilanBBMPelangganEasyMax`

Ditanyakan eksplisit. Sumber: spreadsheet **`1ZFV1NNELE_fCEBvq738KQNRd6mpm7wQywo5sm0_pHBI`
= "Laporan Penjualan Harian SPBU 6378301 BK "** (perhatikan spasi di akhir judul),
pemilik damiandionsalam@gmail.com.

- **HIDUP.** `modifiedTime` sumber = 2026-08-10 08:22 UTC (hari ini).
- **LENGKAP & paling mutakhir di seluruh workbook**: baris terisi s/d **2026-08-09**,
  sementara setiap sheet yang diisi tangan berhenti di 2026-07-27/28. Justru sheet
  inilah satu-satunya yang tidak ikut mati — karena ia otomatis.
- Catatan teknis: pada ekspor xlsx, IMPORTRANGE muncul sebagai
  `__xludf.DUMMYFUNCTION` dengan nilai ter-cache; ID sumber tidak terbaca dari
  xlsx, jadi ID di atas diverifikasi lewat metadata Drive, bukan dari rumusnya.
