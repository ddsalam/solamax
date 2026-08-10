# K0 / T3 — PRA-REGISTRASI (SEGEL) rekonstruksi Bakau dari SolaMax

**Status: DISEGEL.** Berkas ini di-commit **sebelum** satu pun sel jawaban
(`RevenuePenjualan`, `COGS`, `InventoryValue`, `SOValue`, `LossesGainValue`,
`TeraValue`, `IncomeStatement`, `BalanceSheet`, `VolumePenjualan`,
`StockAkhirHari`, `LossesGain`, `SisaSO`, `Tera`, `PenebusanBBM`, `HargaJual`)
dibuka untuk ke-10 tanggal di bawah. Prediksi yang disegel setelah melihat
jawaban tidak bernilai — karena itu urutannya dijaga oleh commit, bukan oleh niat.

## Apa yang SUDAH saya lihat sebelum menyegel (pengakuan penuh)

Kejujuran segel ini bergantung pada daftar ini lengkap:

1. **Struktur/rumus** semua sheet turunan (ARRAYFORMULA-nya), termasuk definisi
   `COGS = (VolumePenjualan − Tera) × −HargaBeli`, `Revenue = Volume × HargaJual`,
   `InventoryValue = StockAkhirHari × HargaBeli`, `SOValue = SisaSO × HargaBeli`,
   `LossesGainValue = LossesGain × HargaBeli`, `TeraValue = −Tera × HargaJual`.
   Dibaca **sengaja**, supaya prediksi memakai definisi yang sama dan selisih yang
   muncul benar-benar selisih ANGKA, bukan selisih definisi.
2. **`HargaBeli`** — masukan manual, dipakai apa adanya sebagai input rekonstruksi
   (diinstruksikan). Nilainya untuk ke-10 tanggal tercetak di tabel bawah.
3. **`HargaJual`** — saya sudah melihat nilainya untuk **2026-01-28** dan
   **2026-07-27** saja (saat menguji dua penjaga harga), dan statistik agregat
   2021–2026 (jumlah hari beli>jual dsb). **Tidak satu pun dari ke-10 tanggal T3.**
4. **`BalanceSheet`/`CashFlow`** — nilai harian 2026-01-19..2026-08-09 dan agregat
   bulanan Feb–Jul 2026 (kerja T1). **Di luar jendela T3** (2025 → 15 Jan 2026),
   kecuali `BSCheck` 2026-01-10..2026-01-18 yang saya kutip di T1; tanggal T3
   terakhir adalah **2026-01-12**, jadi untuk tanggal itu saya sudah tahu
   `BalanceSheet!N = 132.266`. Dicatat di sini agar tidak diklaim sebagai
   prediksi buta.

Selain itu, tidak ada sel jawaban T3 yang dibuka.

## Sumber prediksi

Seluruh angka di bawah dihitung dari **Postgres SolaMax** (`solamax-pg`, unit_id=2
Bakau, via cloud-sql-proxy, read-only role `dashboard_ro`), memakai definisi yang
sudah terbukti di repo ini:

| besaran | definisi yang dipakai | asal |
|---|---|---|
| Volume penjualan | `Σ sales_detail.nvolume` join `sales_header.dtgljual` | `getDailyGlByProduct` CTE `sale` |
| HargaJual | `mode() within group (order by sales_detail.nhargajual)` | turunan (workbook: input manual) |
| Tera | `Σ terra_resmi.nvolume`, `sbatal=0`, `business_date` | `getDailyGlByProduct` CTE `terad` (ledger RESMI, bukan `tera` mentah) |
| StockAkhirHari | `fisik` = Σ `nstockop` opname terakhir per tangki per hari-bisnis, tangki sampah dibuang | `getDailyGlByProduct` CTE `clo`/`fisik` |
| LossesGain | metode RESUME: `fisik − (fisik_prev + pen_do − (sales − tera))` | `getDailyGlByProduct` |
| Penebusan | `Σ tebus_detail.nvolume` pada `tebus_header.dtgltbs` | `getDoHarian` CTE `tebf` |
| SisaSO | `Σ_SO GREATEST(0, ditebus≤D − diterima≤D)`, tautan `CNOSO` case-insensitive | `getDoHarian` CTE `per_so`/`sisa` |
| Piutang/Hutang | aturan terkunci 2026-08-06: Lokal = `sjenis IN (1,5)` **dan** kode tanpa titik · Online = kode bertitik tanpa filter sjenis · Hutang = seluruh `bphut` dinegatifkan | `getSaldoPelanggan` |

Ambang: `GARBAGE_STOCK_L=100.000`, `GARBAGE_SELISIH_L=50.000`, lookback G/L 365 hari.

## Pemilihan 10 tanggal (aturan, bukan selera)

Jendela: 2025-01-01 … 2026-01-15 (neraca masih sehat; patah baru 29 Jan 2026).

- **5 akhir bulan:** 2025-01-31, 2025-03-31, 2025-06-30, 2025-09-30, 2025-12-31
- **4 hari pergantian harga**, diambil dari **data SolaMax sendiri** (perubahan
  `mode(nhargajual)` antar hari) — sengaja BUKAN dari sheet `HargaJual`, supaya
  pemilihan tanggal tidak mengintip jawaban: 2025-03-29, 2025-06-02, 2025-08-31,
  2025-12-01 (tiga di antaranya bukan tanggal 1, jadi menguji hari-ganti-harga
  yang tidak berimpit dengan batas bulan)
- **1 hari biasa terakhir sebelum patah:** 2026-01-12

## Prediksi yang disegel

Pemetaan produk: `BB-01`→Pertalite Khusus · `BB-02`→Pertamax · `BB-03`/`BB-05`→Solar ·
`BB-04`→Pertamax Turbo · `BB-06`→Dexlite · `BB-07`→Pertalite · `BB-08`→Pertamina Dex.

`HargaBeli` kosong ⇒ kolom turunannya sengaja dikosongkan (bukan nol).

### 2025-01-31

| produk | Volume (L) | HargaJual | Tera (L) | StockAkhir (L) | LossesGain (L) | Penebusan (L) | SisaSO (L) | HargaBeli (sheet) | Revenue | COGS | TeraValue | InventoryValue | SOValue | LossesGainValue |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BB-01 Pertalite Khusus | 0.00 | 0 | 0.00 |  |  | 0 | 1,120,000 |  | 0.00 |  | -0.00 |  |  |  |
| BB-02 Pertamax | 1,724.28 | 12,800 | 0.00 | 14,357.06 | -20.16 | 0 | 0 | 12,231.054250 | 22,070,784.00 | -21,089,762.22 | -0.00 | 175,601,979.73 | 0.00 | -246,578.05 |
| BB-03 Solar | 18,028.20 | 6,800 | 0.00 | 17,978.95 | -7.65 | 48,000 | 64,000 | 6,567.155125 | 122,591,760.00 | -118,393,986.02 | -0.00 | 118,070,553.63 | 420,297,928.00 | -50,238.74 |
| BB-04 Pertamax Turbo | 84.14 | 14,000 | 0.00 | 14,244.84 | -6.10 | 0 | 0 | 14,257.182875 | 1,177,960.00 | -1,199,599.37 | -0.00 | 203,091,288.91 | 0.00 | -86,968.82 |
| BB-06 Dexlite | 1,322.42 | 13,900 | 0.00 | 3,015.42 | 0.00 | 0 | 4,000 | 12,803.964750 | 18,381,638.00 | -16,932,219.06 | -0.00 | 38,609,331.39 | 51,215,859.00 | 0.00 |
| BB-07 Pertalite | 14,668.12 | 10,000 | 0.00 | 18,044.70 | -95.29 | 48,000 | 64,000 | 9,679.551750 | 146,681,200.00 | -141,980,826.62 | -0.00 | 174,664,607.46 | 619,491,312.00 | -922,364.49 |
| BB-08 Pertamina Dex | 240.72 | 14,200 | 0.00 | 1,301.23 | 0.00 | 0 | 2,000 | 13,620.957250 | 3,418,224.00 | -3,278,836.83 | -0.00 | 17,723,998.20 | 27,241,914.50 | 0.00 |
| **TOTAL** | | | | | | | | | **314,321,566.00** | **-302,875,230.12** | **0.00** | **727,761,759.32** | **1,118,247,013.50** | **-1,306,150.09** |

- **Gross Profit** (Revenue + TeraValue + COGS) = **11,446,335.88**
- **Operating Profit** (GP + LossesGainValue) = **10,140,185.78**
- Piutang Pelanggan EasyMax akhir hari: Lokal **699,429,722** · Online **2,333,677** · Hutang **-12,328,312** → neto **689,435,087**

### 2025-03-29

| produk | Volume (L) | HargaJual | Tera (L) | StockAkhir (L) | LossesGain (L) | Penebusan (L) | SisaSO (L) | HargaBeli (sheet) | Revenue | COGS | TeraValue | InventoryValue | SOValue | LossesGainValue |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BB-01 Pertalite Khusus | 0.00 | 0 | 0.00 |  |  | 0 | 1,120,000 |  | 0.00 |  | -0.00 |  |  |  |
| BB-02 Pertamax | 1,049.38 | 12,800 | 0.00 | 12,403.93 | -22.80 | 0 | 0 | 12,631.898125 | 13,432,064.00 | -13,255,661.25 | -0.00 | 156,685,180.11 | 0.00 | -288,007.28 |
| BB-03 Solar | 10,256.94 | 6,800 | 0.00 | 13,175.81 | 182.81 | 0 | 56,000 | 6,567.155125 | 69,747,192.00 | -67,358,916.09 | -0.00 | 86,527,588.17 | 367,760,687.00 | 1,200,541.63 |
| BB-04 Pertamax Turbo | 336.52 | 13,800 | 0.00 | 8,537.48 | 0.08 | 0 | 0 | 14,257.182875 | 4,643,976.00 | -4,797,827.18 | -0.00 | 121,720,413.65 | 0.00 | 1,140.57 |
| BB-06 Dexlite | 344.64 | 13,900 | 0.00 | 4,404.86 | 0.00 | 0 | 8,000 | 14,106.707000 | 4,790,496.00 | -4,861,735.50 | -0.00 | 62,138,069.40 | 112,853,656.00 | 0.00 |
| BB-07 Pertalite | 21,668.90 | 10,000 | 0.00 | 10,531.59 | 163.98 | 16,000 | 56,000 | 9,679.551750 | 216,689,000.00 | -209,745,238.92 | -0.00 | 101,941,070.41 | 542,054,898.00 | 1,587,252.90 |
| BB-08 Pertamina Dex | 47.11 | 14,200 | 0.00 | 7,188.26 | 0.00 | 0 | 0 | 14,372.540000 | 668,962.00 | -677,090.36 | -0.00 | 103,313,554.38 | 0.00 | 0.00 |
| **TOTAL** | | | | | | | | | **309,971,690.00** | **-300,696,469.30** | **0.00** | **632,325,876.12** | **1,022,669,241.00** | **2,500,927.82** |

- **Gross Profit** (Revenue + TeraValue + COGS) = **9,275,220.70**
- **Operating Profit** (GP + LossesGainValue) = **11,776,148.52**
- Piutang Pelanggan EasyMax akhir hari: Lokal **918,805,144** · Online **2,333,677** · Hutang **-76,353,756** → neto **844,785,065**

### 2025-03-31

| produk | Volume (L) | HargaJual | Tera (L) | StockAkhir (L) | LossesGain (L) | Penebusan (L) | SisaSO (L) | HargaBeli (sheet) | Revenue | COGS | TeraValue | InventoryValue | SOValue | LossesGainValue |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BB-01 Pertalite Khusus | 0.00 | 0 | 0.00 |  |  | 0 | 1,120,000 |  | 0.00 |  | -0.00 |  |  |  |
| BB-02 Pertamax | 1,511.57 | 12,800 | 0.00 | 9,537.98 | 7.42 | 8,000 | 8,000 | 12,231.054250 | 19,348,096.00 | -18,488,094.67 | -0.00 | 116,659,550.82 | 97,848,434.00 | 90,754.42 |
| BB-03 Solar | 1,715.03 | 6,800 | 0.00 | 18,965.89 | 49.42 | 24,000 | 64,000 | 6,567.155125 | 11,662,204.00 | -11,262,868.05 | -0.00 | 124,551,941.71 | 420,297,928.00 | 324,548.81 |
| BB-04 Pertamax Turbo | 283.63 | 13,800 | 0.00 | 8,091.59 | 1.59 | 0 | 0 | 14,257.182875 | 3,914,094.00 | -4,043,764.78 | -0.00 | 115,363,278.38 | 0.00 | 22,668.92 |
| BB-06 Dexlite | 217.02 | 13,900 | 0.00 | 7,889.20 | 0.00 | 0 | 4,000 | 14,106.707000 | 3,016,578.00 | -3,061,437.55 | -0.00 | 111,290,632.86 | 56,426,828.00 | 0.00 |
| BB-07 Pertalite | 16,346.30 | 10,000 | 0.00 | 21,292.64 | 201.43 | 56,000 | 64,000 | 9,679.551750 | 163,463,000.00 | -158,224,856.77 | -0.00 | 206,103,210.77 | 619,491,312.00 | 1,949,752.11 |
| BB-08 Pertamina Dex | 58.31 | 14,200 | 0.00 | 7,050.19 | 0.00 | 0 | 0 | 14,372.540000 | 828,002.00 | -838,062.81 | -0.00 | 101,329,137.78 | 0.00 | 0.00 |
| **TOTAL** | | | | | | | | | **202,231,974.00** | **-195,919,084.64** | **0.00** | **775,297,752.33** | **1,194,064,502.00** | **2,387,724.26** |

- **Gross Profit** (Revenue + TeraValue + COGS) = **6,312,889.36**
- **Operating Profit** (GP + LossesGainValue) = **8,700,613.62**
- Piutang Pelanggan EasyMax akhir hari: Lokal **931,117,501** · Online **2,333,677** · Hutang **-74,953,756** → neto **858,497,422**

### 2025-06-02

| produk | Volume (L) | HargaJual | Tera (L) | StockAkhir (L) | LossesGain (L) | Penebusan (L) | SisaSO (L) | HargaBeli (sheet) | Revenue | COGS | TeraValue | InventoryValue | SOValue | LossesGainValue |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BB-01 Pertalite Khusus | 0.00 | 0 | 0.00 |  |  | 0 | 1,120,000 |  | 0.00 |  | -0.00 |  |  |  |
| BB-02 Pertamax | 505.95 | 12,400 | 0.00 | 13,755.64 | 12.19 | 0 | 0 | 12,130.843250 | 6,273,780.00 | -6,137,600.14 | -0.00 | 166,867,512.64 | 0.00 | 147,874.98 |
| BB-03 Solar | 15,563.06 | 6,800 | 6.93 | 21,014.47 | 218.22 | 32,000 | 48,000 | 6,567.155125 | 105,828,808.00 | -102,159,518.85 | -47,124.00 | 138,005,284.36 | 315,223,446.00 | 1,433,084.59 |
| BB-04 Pertamax Turbo | 118.55 | 13,350 | 0.00 | 12,770.47 | -30.94 | 0 | 0 | 13,154.864250 | 1,582,642.50 | -1,559,509.16 | -0.00 | 167,993,799.26 | 0.00 | -407,011.50 |
| BB-06 Dexlite | 931.15 | 13,020 | 0.00 | 4,148.08 | 0.00 | 0 | 8,000 | 13,104.597000 | 12,123,573.00 | -12,202,345.50 | -0.00 | 54,358,916.72 | 104,836,776.00 | 0.00 |
| BB-07 Pertalite | 12,962.39 | 10,000 | 0.00 | 22,918.58 | 81.20 | 24,000 | 32,000 | 9,679.551750 | 129,623,900.00 | -125,470,124.81 | -0.00 | 221,841,581.15 | 309,745,656.00 | 785,979.60 |
| BB-08 Pertamina Dex | 61.92 | 13,500 | 0.00 | 4,676.45 | 0.00 | 0 | 0 | 13,470.641000 | 835,920.00 | -834,102.09 | -0.00 | 62,994,779.10 | 0.00 | 0.00 |
| **TOTAL** | | | | | | | | | **256,268,623.50** | **-248,363,200.55** | **-47,124.00** | **812,061,873.24** | **729,805,878.00** | **1,959,927.67** |

- **Gross Profit** (Revenue + TeraValue + COGS) = **7,858,298.95**
- **Operating Profit** (GP + LossesGainValue) = **9,818,226.62**
- Piutang Pelanggan EasyMax akhir hari: Lokal **958,679,775** · Online **2,333,677** · Hutang **-56,469,510** → neto **904,543,942**

### 2025-06-30

| produk | Volume (L) | HargaJual | Tera (L) | StockAkhir (L) | LossesGain (L) | Penebusan (L) | SisaSO (L) | HargaBeli (sheet) | Revenue | COGS | TeraValue | InventoryValue | SOValue | LossesGainValue |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BB-01 Pertalite Khusus | 0.00 | 0 | 0.00 |  |  | 0 | 1,120,000 |  | 0.00 |  | -0.00 |  |  |  |
| BB-02 Pertamax | 632.98 | 12,400 | 0.00 | 24,391.64 | -1.56 | 0 | 0 | 11,830.210375 | 7,848,952.00 | -7,488,286.56 | -0.00 | 288,558,232.59 | 0.00 | -18,455.13 |
| BB-03 Solar | 21,183.52 | 6,800 | 0.00 | 18,929.49 | 274.09 | 32,000 | 48,000 | 6,567.155125 | 144,047,936.00 | -139,115,461.93 | -0.00 | 124,312,897.27 | 315,223,446.00 | 1,799,991.55 |
| BB-04 Pertamax Turbo | 137.34 | 13,350 | 1.00 | 16,918.62 | 9.37 | 0 | 0 | 12,703.914750 | 1,833,489.00 | -1,732,051.74 | -13,350.00 | 214,932,706.17 | 0.00 | 119,035.68 |
| BB-06 Dexlite | 1,715.72 | 13,020 | 0.00 | 5,648.95 | 0.00 | 0 | 0 | 12,473.268500 | 22,338,674.40 | -21,400,636.23 | -0.00 | 70,460,870.09 | 0.00 | 0.00 |
| BB-07 Pertalite | 12,685.27 | 10,000 | 0.00 | 16,495.46 | 148.63 | 32,000 | 40,000 | 9,679.551750 | 126,852,700.00 | -122,787,727.43 | -0.00 | 159,668,658.71 | 387,182,070.00 | 1,438,671.78 |
| BB-08 Pertamina Dex | 4.81 | 13,500 | 0.00 | 6,428.01 | 0.00 | 0 | 0 | 12,919.481000 | 64,935.00 | -62,142.70 | -0.00 | 83,046,553.06 | 0.00 | 0.00 |
| **TOTAL** | | | | | | | | | **302,986,686.40** | **-292,586,306.60** | **-13,350.00** | **940,979,917.89** | **702,405,516.00** | **3,339,243.88** |

- **Gross Profit** (Revenue + TeraValue + COGS) = **10,387,029.80**
- **Operating Profit** (GP + LossesGainValue) = **13,726,273.68**
- Piutang Pelanggan EasyMax akhir hari: Lokal **824,048,980** · Online **2,333,677** · Hutang **-43,019,510** → neto **783,363,147**

### 2025-08-31

| produk | Volume (L) | HargaJual | Tera (L) | StockAkhir (L) | LossesGain (L) | Penebusan (L) | SisaSO (L) | HargaBeli (sheet) | Revenue | COGS | TeraValue | InventoryValue | SOValue | LossesGainValue |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BB-01 Pertalite Khusus | 0.00 | 0 | 0.00 |  |  | 0 | 1,120,000 |  | 0.00 |  | -0.00 |  |  |  |
| BB-02 Pertamax | 815.70 | 12,500 | 0.00 | 12,312.45 | -5.01 | 0 | 0 | 11,928.546250 | 10,196,250.00 | -9,730,115.18 | -0.00 | 146,869,629.28 | 0.00 | -59,762.02 |
| BB-03 Solar | 7,051.34 | 6,800 | 0.00 | 17,713.68 | -26.79 | 32,000 | 72,000 | 6,567.155125 | 47,949,112.00 | -46,307,243.62 | -0.00 | 116,328,484.39 | 472,835,169.00 | -175,934.09 |
| BB-04 Pertamax Turbo | 137.62 | 13,500 | 0.00 | 8,626.61 | -0.04 | 0 | 0 | 12,703.914750 | 1,857,870.00 | -1,748,312.75 | -0.00 | 109,591,718.02 | 0.00 | -508.16 |
| BB-06 Dexlite | 1,502.94 | 14,150 | 0.00 | 3,433.02 | 24.41 | 8,000 | 8,000 | 13,605.651750 | 21,266,601.00 | -20,448,478.24 | -0.00 | 46,708,474.57 | 108,845,214.00 | 332,113.96 |
| BB-07 Pertalite | 15,045.11 | 10,000 | 0.00 | 23,365.66 | 72.37 | 24,000 | 48,000 | 9,679.551750 | 150,451,100.00 | -145,629,920.83 | -0.00 | 226,169,115.14 | 464,618,484.00 | 700,509.16 |
| BB-08 Pertamina Dex | 219.33 | 14,450 | 0.00 | 2,273.36 | 1.47 | 4,000 | 4,000 | 13,871.486000 | 3,169,318.50 | -3,042,433.02 | -0.00 | 31,534,881.41 | 55,485,944.00 | 20,391.08 |
| **TOTAL** | | | | | | | | | **234,890,251.50** | **-226,906,503.64** | **0.00** | **677,202,302.82** | **1,101,784,811.00** | **816,809.94** |

- **Gross Profit** (Revenue + TeraValue + COGS) = **7,983,747.86**
- **Operating Profit** (GP + LossesGainValue) = **8,800,557.81**
- Piutang Pelanggan EasyMax akhir hari: Lokal **765,830,937** · Online **2,333,677** · Hutang **-45,347,910** → neto **722,816,704**

### 2025-09-30

| produk | Volume (L) | HargaJual | Tera (L) | StockAkhir (L) | LossesGain (L) | Penebusan (L) | SisaSO (L) | HargaBeli (sheet) | Revenue | COGS | TeraValue | InventoryValue | SOValue | LossesGainValue |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BB-01 Pertalite Khusus | 0.00 | 0 | 0.00 |  |  | 0 | 1,120,000 |  | 0.00 |  | -0.00 |  |  |  |
| BB-02 Pertamax | 566.70 | 12,500 | 0.00 | 14,094.29 | -24.03 | 0 | 0 | 11,930.421250 | 7,083,750.00 | -6,760,969.72 | -0.00 | 168,150,816.92 | 0.00 | -286,688.02 |
| BB-03 Solar | 23,448.11 | 6,800 | 0.00 | 10,277.49 | 238.36 | 0 | 32,000 | 6,567.155125 | 159,447,148.00 | -153,987,375.76 | -0.00 | 67,493,871.13 | 210,148,964.00 | 1,565,347.10 |
| BB-04 Pertamax Turbo | 53.06 | 13,400 | 0.00 | 12,916.85 | 2.38 | 0 | 0 | 12,703.914750 | 711,004.00 | -674,069.72 | -0.00 | 164,094,561.24 | 0.00 | 30,235.32 |
| BB-06 Dexlite | 3,042.60 | 13,900 | 0.00 | 2,414.70 | -69.00 | 8,000 | 8,000 | 13,355.125000 | 42,292,140.00 | -40,634,303.32 | -0.00 | 32,248,620.34 | 106,841,000.00 | -921,503.63 |
| BB-07 Pertalite | 12,972.57 | 10,000 | 0.00 | 21,046.82 | 118.53 | 0 | 40,000 | 9,679.551750 | 129,725,700.00 | -125,568,662.65 | -0.00 | 203,723,783.36 | 387,182,070.00 | 1,147,317.27 |
| BB-08 Pertamina Dex | 764.13 | 14,150 | 0.00 | 4,892.21 | 0.00 | 0 | 0 | 13,871.486000 | 10,812,439.50 | -10,599,618.60 | -0.00 | 67,862,222.52 | 0.00 | 0.00 |
| **TOTAL** | | | | | | | | | **350,072,181.50** | **-338,224,999.76** | **0.00** | **703,573,875.51** | **704,172,034.00** | **1,534,708.03** |

- **Gross Profit** (Revenue + TeraValue + COGS) = **11,847,181.74**
- **Operating Profit** (GP + LossesGainValue) = **13,381,889.77**
- Piutang Pelanggan EasyMax akhir hari: Lokal **853,069,597** · Online **2,333,677** · Hutang **-23,631,157** → neto **831,772,117**

### 2025-12-01

| produk | Volume (L) | HargaJual | Tera (L) | StockAkhir (L) | LossesGain (L) | Penebusan (L) | SisaSO (L) | HargaBeli (sheet) | Revenue | COGS | TeraValue | InventoryValue | SOValue | LossesGainValue |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BB-01 Pertalite Khusus | 0.00 | 0 | 0.00 |  |  | 0 | 1,152,000 |  | 0.00 |  | -0.00 |  |  |  |
| BB-02 Pertamax | 616.09 | 13,050 | 0.00 | 16,639.94 | 17.31 | 0 | 0 | 11,930.421250 | 8,039,974.50 | -7,350,213.23 | -0.00 | 198,521,493.77 | 0.00 | 206,515.59 |
| BB-03 Solar | 19,510.89 | 6,800 | 0.00 | 26,543.10 | 141.88 | 32,000 | 48,000 | 6,567.155125 | 132,674,052.00 | -128,131,041.26 | -0.00 | 174,312,655.20 | 315,223,446.00 | 931,747.97 |
| BB-04 Pertamax Turbo | 153.10 | 14,050 | 0.00 | 10,581.67 | -1.83 | 0 | 0 | 12,754.020000 | 2,151,055.00 | -1,952,640.46 | -0.00 | 134,958,830.81 | 0.00 | -23,339.86 |
| BB-06 Dexlite | 3,506.10 | 15,000 | 0.00 | 5,269.49 | -35.21 | 16,000 | 16,000 | 14,457.445500 | 52,591,500.00 | -50,689,249.67 | -0.00 | 76,183,364.49 | 231,319,128.00 | -509,046.66 |
| BB-07 Pertalite | 12,771.56 | 10,000 | 0.00 | 20,733.71 | 122.67 | 32,000 | 40,000 | 9,679.551750 | 127,715,600.00 | -123,622,975.95 | -0.00 | 200,693,018.91 | 387,182,070.00 | 1,187,390.61 |
| BB-08 Pertamina Dex | 332.44 | 15,300 | 0.00 | 3,447.10 | 0.00 | 0 | 4,000 | 13,871.486000 | 5,086,332.00 | -4,611,436.81 | -0.00 | 47,816,399.39 | 55,485,944.00 | 0.00 |
| **TOTAL** | | | | | | | | | **328,258,513.50** | **-316,357,557.37** | **0.00** | **832,485,762.58** | **989,210,588.00** | **1,793,267.66** |

- **Gross Profit** (Revenue + TeraValue + COGS) = **11,900,956.13**
- **Operating Profit** (GP + LossesGainValue) = **13,694,223.79**
- Piutang Pelanggan EasyMax akhir hari: Lokal **874,291,295** · Online **2,333,677** · Hutang **-71,023,470** → neto **805,601,502**

### 2025-12-31

| produk | Volume (L) | HargaJual | Tera (L) | StockAkhir (L) | LossesGain (L) | Penebusan (L) | SisaSO (L) | HargaBeli (sheet) | Revenue | COGS | TeraValue | InventoryValue | SOValue | LossesGainValue |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BB-01 Pertalite Khusus | 0.00 | 0 | 0.00 |  |  | 0 | 1,152,000 |  | 0.00 |  | -0.00 |  |  |  |
| BB-02 Pertamax | 1,051.69 | 13,050 | 0.00 | 18,913.64 | 51.00 | 0 | 8,000 | 12,481.581625 | 13,724,554.50 | -13,126,754.58 | -0.00 | 236,072,141.49 | 99,852,653.00 | 636,560.66 |
| BB-03 Solar | 3,753.39 | 6,800 | 0.00 | 18,792.02 | -41.65 | 40,000 | 56,000 | 6,567.155125 | 25,523,052.00 | -24,649,094.37 | -0.00 | 123,410,110.45 | 367,760,687.00 | -273,522.01 |
| BB-04 Pertamax Turbo | 259.59 | 14,050 | 0.00 | 13,341.60 | 6.61 | 0 | 0 | 13,405.391250 | 3,647,239.50 | -3,479,905.51 | -0.00 | 178,849,367.90 | 0.00 | 88,609.64 |
| BB-06 Dexlite | 976.43 | 15,000 | 0.00 | 7,039.88 | -85.04 | 0 | 0 | 14,457.445500 | 14,646,450.00 | -14,116,683.51 | -0.00 | 101,778,681.43 | 0.00 | -1,229,461.17 |
| BB-07 Pertalite | 17,208.00 | 10,000 | 0.00 | 31,190.18 | 115.04 | 40,000 | 48,000 | 9,679.551750 | 172,080,000.00 | -166,565,726.51 | -0.00 | 301,906,961.40 | 464,618,484.00 | 1,113,535.63 |
| BB-08 Pertamina Dex | 328.51 | 15,300 | 0.00 | 4,279.57 | 0.00 | 0 | 0 | 14,723.278000 | 5,026,203.00 | -4,836,744.06 | -0.00 | 63,009,298.83 | 0.00 | 0.00 |
| **TOTAL** | | | | | | | | | **234,647,499.00** | **-226,774,908.55** | **0.00** | **1,005,026,561.50** | **932,231,824.00** | **335,722.76** |

- **Gross Profit** (Revenue + TeraValue + COGS) = **7,872,590.45**
- **Operating Profit** (GP + LossesGainValue) = **8,208,313.21**
- Piutang Pelanggan EasyMax akhir hari: Lokal **821,753,896** · Online **2,333,677** · Hutang **-45,075,470** → neto **779,012,103**

### 2026-01-12

| produk | Volume (L) | HargaJual | Tera (L) | StockAkhir (L) | LossesGain (L) | Penebusan (L) | SisaSO (L) | HargaBeli (sheet) | Revenue | COGS | TeraValue | InventoryValue | SOValue | LossesGainValue |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| BB-01 Pertalite Khusus | 0.00 | 0 | 0.00 |  |  | 0 | 1,152,000 |  | 0.00 |  | -0.00 |  |  |  |
| BB-02 Pertamax | 758.36 | 12,650 | 0.00 | 17,414.88 | 40.02 | 0 | 0 | 12,080.737750 | 9,593,254.00 | -9,161,548.28 | -0.00 | 210,384,598.23 | 0.00 | 483,471.12 |
| BB-03 Solar | 21,514.15 | 6,800 | 0.00 | 18,121.52 | 323.03 | 32,000 | 48,000 | 6,567.155125 | 146,296,220.00 | -141,286,760.43 | -0.00 | 119,006,832.94 | 315,223,446.00 | 2,121,388.12 |
| BB-04 Pertamax Turbo | 208.16 | 13,700 | 0.00 | 10,900.49 | 2.46 | 0 | 0 | 13,405.391250 | 2,851,792.00 | -2,790,466.24 | -0.00 | 146,125,333.27 | 0.00 | 32,977.26 |
| BB-06 Dexlite | 2,272.15 | 13,800 | 0.00 | 6,347.09 | -37.80 | 0 | 12,000 | 13,254.914250 | 31,355,670.00 | -30,117,153.41 | -0.00 | 84,130,133.69 | 159,058,971.00 | -501,035.76 |
| BB-07 Pertalite | 13,506.90 | 10,000 | 0.00 | 19,517.93 | 9.81 | 24,000 | 32,000 | 9,679.551750 | 135,069,000.00 | -130,740,737.53 | -0.00 | 188,924,813.49 | 309,745,656.00 | 94,956.40 |
| BB-08 Pertamina Dex | 493.32 | 13,900 | 0.00 | 2,396.81 | 0.00 | 8,000 | 8,000 | 13,320.325000 | 6,857,148.00 | -6,571,182.73 | -0.00 | 31,926,288.16 | 106,562,600.00 | 0.00 |
| **TOTAL** | | | | | | | | | **332,023,084.00** | **-320,667,848.63** | **0.00** | **780,497,999.77** | **890,590,673.00** | **2,231,757.15** |

- **Gross Profit** (Revenue + TeraValue + COGS) = **11,355,235.37**
- **Operating Profit** (GP + LossesGainValue) = **13,586,992.52**
- Piutang Pelanggan EasyMax akhir hari: Lokal **657,519,821** · Online **2,333,677** · Hutang **-39,855,470** → neto **619,998,028**

## Yang saya harapkan MELESET (prediksi tentang prediksi)

Ditulis di muka supaya tidak bisa dirasionalisasi belakangan:

1. **`SisaSO` Pertalite Khusus (BB-01) = 1.120.000 L** hampir pasti tidak ada di
   workbook (kolomnya kosong sejak lama). Ini SO PREMIUM mati yang tak pernah
   ditutup di EasyMax — kategori `sisa_macet`. Selisih ini **bukan** bug workbook.
2. **`HargaJual` via `mode(nhargajual)`** akan meleset pada hari pergantian harga
   bila mayoritas transaksi hari itu masih memakai harga lama — modus mengambil
   harga yang paling sering, workbook memakai harga yang berlaku. Kandidat kuat:
   2025-03-29, 2025-06-02, 2025-08-31, 2025-12-01.
3. **`StockAkhirHari`/`LossesGain`** bergantung pada opname terakhir per tangki;
   bila ada tangki yang tak dionamekan hari itu, `fisik` saya lebih rendah.
4. **Pertamax Turbo 2025-01-31**: HargaBeli 14.257,18 > HargaJual 14.000 →
   COGS > Revenue. Bila workbook menunjukkan hal yang sama, itu bukan selisih,
   itu konfirmasi bahwa penjaga "beli > jual" memang punya subjek nyata.

**Segel ditutup di sini.**
