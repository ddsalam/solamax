# K0 / T1 — Bedah kerusakan neraca Bakau (workbook `Finance SPBU 6378301 BK`)

**Sifat: temuan keuangan, bukan pekerjaan aplikasi.** Tidak ada sel spreadsheet yang
disunting. Semua angka dikutip dari salinan xlsx (unduhan 2026-08-10 16:56 WIB,
`modifiedTime` sheet 2026-08-10 16:55 WIB — jadi salinan = versi terkini).

## Ringkasan satu paragraf

Pencatatan **pembelian BBM berhenti total pada 28 Januari 2026** dan tidak pernah
dimulai lagi. Kredit `Pembelian BBM` terakhir di seluruh buku kas/bank adalah
**28-01-2026, Rp −624.969.102** di `BukuBankBCA-5125036811`. Sementara itu sisi
penjualan terus jalan otomatis: COGS tetap dibebankan, stok fisik tetap terisi dari
pembacaan tangki, dan setoran hasil penjualan tetap masuk ke BCA. Akibatnya setiap
liter yang diterima sejak saat itu menaikkan aset tanpa pernah mengurangi kas atau
menambah hutang. Per 27-07-2026 selisih neraca mencapai **Rp −39.452.607.134**.
Pemeriksaan silang independen dari data pengiriman SolaMax menaksir nilai BBM yang
diterima tanpa pernah dicatat sebagai pembelian pada periode yang sama sebesar
**Rp 40,39 miliar** — sejalan dalam ~2,4%.

## Tiga koreksi terhadap premis yang diberikan

Ditulis lebih dulu karena mengubah cara membaca sisanya.

1. **"Tak pernah lewat ±132.268 sepanjang Jan-2021 → Jan-2026" — TIDAK BENAR.**
   `BalanceSheet!N` adalah **angka kumulatif** (residu yang tidak pernah dinolkan),
   bukan selisih harian. Sebelum 29-01-2026 (1.854 hari): 913 hari ≤ Rp 1.000;
   921 hari Rp 1.000–132.268; 8 hari Rp 132rb–1jt; 11 hari Rp 1jt–10jt; **1 hari
   Rp 204.591.500** (2022-01-20, berbalik keesokan harinya). Angka 132.268 adalah
   nilai residu pada 10–15 Jan 2026 saja, bukan batas historis.

2. **Residu legacy yang sebenarnya = Rp 3.635.936, bukan Rp 132.268.** Ada dua
   langkah tambahan setelah 132.267 terbentuk (2024-01-05): **2026-01-16 +31.638**
   dan **2026-01-19 +3.490.121**. Ini yang harus dibersihkan di §6, bukan 132.268.

3. **Hipotesis §2 benar di intinya, tetapi tidak lengkap — dan bagian "hanya sisi
   kredit" keliru.** Bukan sekadar posting bank yang berhenti; **seluruh rantai
   pencatatan pembelian** berhenti, termasuk sheet masukannya:

   | rantai | baris terakhir berisi |
   |---|---|
   | kredit `Pembelian BBM` di buku kas/bank (1.233 baris seumur hidup) | **2026-01-28** |
   | `SisaSO` (sheet masukan) | **2026-01-30** |
   | `PenebusanBBM` (sheet masukan) | **2026-02-02** |

   Jadi memperbaiki posting bank saja tidak cukup; sumber masukannya pun mati.

## Rekonstruksi `BalanceSheet!N`

Struktur yang berlaku (dibaca dari rumusnya):

- `H Total Asset = B Cash + C Inventory + D SO Value + E Temp.Inv + F HP Pelanggan EasyMax + G HP Non-EasyMax`
- `M Total Equity = J Opened RE + K Net Income + L Income Adj`, dengan `J(d) = M(d−1) − ΔI Kontribusi`
- **`N Balance Sheet Check = M − H`**

| komponen | 2026-01-28 | 2026-01-29 | Δ |
|---|---:|---:|---:|
| Cash On Hand | 6.974.383.255,19 | 7.344.392.853,69 | **+370.009.598,50** |
| Inventory | 896.043.272,02 | 892.631.692,92 | −3.411.579,10 |
| SO Value | 783.807.300,00 | 470.840.333,00 | **−312.966.967,00** |
| HP Pelanggan EasyMax | 7.379.413.381,00 | 7.394.967.102,00 | +15.553.721,00 |
| HP Non-EasyMax | −2.226.329.546,00 | −2.231.162.546,00 | −4.833.000,00 |
| **Total Asset** | 13.807.317.662,58 | 13.871.669.435,98 | **+64.351.773,40** |
| Net Income hari itu | 10.418.361,56 | 11.572.291,36 | |
| **Balance Sheet Check** | **+3.635.936** | **−49.143.546** | **−52.779.482** |

**Suku yang berubah −52,8 juta:** tidak ada satu suku tunggal — yang patah adalah
**hubungan antar suku**. Aset tumbuh Rp 64.351.773 sementara laba hanya
Rp 11.572.291; selisihnya persis Rp 52.779.482.

Identitas hariannya (diturunkan, lalu **diuji dan cocok sampai rupiah**):

```
err(d) = NetIncome − ΔTotalAsset
       = |penebusan| − COGS + G/L + Tera − ΔInventory − ΔSOValue
```

Uji residu identitas ini (`err − prediksi`) pada hari-hari normal = **0**.

| tanggal | err | penebusan (CashFlow) | COGS | ΔInventory | ΔSOValue | residu |
|---|---:|---:|---:|---:|---:|---:|
| 2026-01-28 | 0 | 624.969.102 | 328.607.453 | −37.318.815 | +336.901.308 | **0** |
| 2026-01-29 | −52.779.482 | 0 | 369.992.338 | −3.411.579 | −312.966.967 | −300 |
| 2026-01-30 | +157.873.367 | 915.007.430 | 344.664.477 | −28.283.445 | −470.840.333 | **−915.007.429** |
| 2026-02-02 | −169.672.987 | 495.960.279 | 179.034.301 | −8.517.226 | 0 | **−495.960.279** |
| 2026-02-03 | −182.510.896 | 0 | 355.203.242 | −168.090.870 | 0 | 0 |
| 2026-03-15 | −304.538.389 | 0 | 433.262.676 | −124.019.553 | 0 | −133 |
| 2026-07-10 | **+1** | 0 | 181.559.667 | −181.213.104 | 0 | +1 |

Cara membaca tiga baris terpenting:

- **29-01**: SO turun Rp 313 jt (BBM diterima) tetapi tidak ada penebusan yang
  dibayar dan persediaan hanya turun Rp 3,4 jt. Rp 52,8 juta BBM masuk tangki
  tanpa lawan-catat. **Ini hari pertama patah.**
- **30-01 dan 02-02**: residu = **persis** nilai penebusan yang tercatat di sheet
  `PenebusanBBM` (Rp 915.007.430 dan Rp 495.960.279). Artinya angka itu masuk
  kolom `CashFlow!X Penebusan SO` tetapi **tidak pernah mendarat di buku bank
  mana pun** → `CashFlow Check` 30-01 = −915.007.430.
- **10-07**: err = **+1**. Hari tanpa pengiriman: persediaan turun persis sebesar
  COGS, jadi neraca harian itu seimbang. Ini membuktikan mekanismenya —
  **kebocoran terjadi tepat pada hari ada pengiriman**, sebesar nilai kiriman.

Karena itu selisih kumulatif ≈ **nilai seluruh BBM yang diterima sejak 29-01-2026
yang tidak pernah dicatat sebagai pembelian**.

## Uji hipotesis §2 (Σ penebusan vs Σ kredit "Pembelian BBM")

Diminta eksplisit. Seluruh buku (Kas Besar + 5 bank + EDC):

| bulan | Penebusan (sheet `PenebusanBBM`) | Kredit `Pembelian BBM` (buku) | selisih |
|---|---:|---:|---:|
| 2025-10 | −9.384.194.340 | −9.382.380.538 | −1.813.802 |
| 2025-11 | −8.361.799.994 | −8.362.581.670 | +781.676 |
| 2025-12 | −10.227.723.505 | −10.256.584.274 | +28.860.769 |
| **2026-01** | −8.651.846.005 | −7.736.813.975 | **−915.032.030** |
| **2026-02** | −495.960.279 | **0** | **−495.960.279** |
| 2026-03 … 2026-07 | **0** | **0** | 0 |

**Verdikt: hipotesis TERBUKTI SEBAGIAN.**
- Benar: sisi kredit pembelian BBM berhenti terposting, dan `BukuBankBCA-5125036811`
  memang tempatnya (semua penebusan dibayar dari rekening itu).
- Salah/kurang: dari **Maret 2026 kedua sisi nol** — bukan "pembelian tetap terjadi
  tapi kreditnya hilang", melainkan **sheet masukannya juga berhenti diisi**.
  Yang tersisa hanyalah selisih Jan–Feb (Rp 1,41 miliar) di mana sheet terisi tapi
  buku tidak.

Pertumbuhan saldo BCA-5125036811 (−820.818.594 pada 1 Feb → +49.877.536.376 pada
27 Jul ≈ **+50,7 miliar**) memang sebanding dengan penebusan bulanan yang hilang,
tetapi **tidak sama dengan** selisih neraca (39,46 miliar) — karena rekening itu
juga terus menerima setoran hasil penjualan yang sah. Jangan pakai +50,7 miliar
sebagai ukuran kerusakan.

## Pemeriksaan silang independen (SolaMax Postgres)

Nilai BBM yang **diterima** Bakau (`unit_id=2`) 29-01-2026 … 27-07-2026, dihargai
dengan `HargaBeli` dari sheet, basis volume DO (`delivery.nvoldo`):

| bulan | nilai penerimaan |
|---|---:|
| 2026-01 (29–31) | 967.544.671 |
| 2026-02 | 8.966.192.284 |
| 2026-03 | 8.157.791.668 |
| 2026-04 | 6.480.305.782 |
| 2026-05 | 5.267.571.123 |
| 2026-06 | 5.384.198.719 |
| 2026-07 (s/d 27) | 5.165.132.213 |
| **TOTAL** | **40.388.736.460** |

Bandingkan dengan akumulasi selisih neraca pada jendela yang sama:
`−39.452.607.134 − 3.635.936 = −39.456.243.070`.

**Beda Rp 0,93 miliar (2,4%).** Wajar: sebagian ditutup penebusan Jan–Feb yang
sempat masuk `CashFlow` (Rp 1,41 miliar), sisanya pergerakan level persediaan dan
G/L. Ini konfirmasi besaran & sebab, **bukan** rekonsiliasi eksak — jangan kutip
sebagai angka final.

## Temuan menyertai (bukan penyebab patah 29 Jan, tapi harus diputuskan)

1. **Solar berhenti punya harga beli sejak 2026-03-04.** Akibat langsung, karena
   `COGS = (Volume − Tera) × HargaBeli` dan `InventoryValue = Stock × HargaBeli`:
   **COGS Solar = 0 dan Inventory Solar = 0 sejak 4 Maret 2026.** Solar adalah
   produk bervolume terbesar Bakau. Laba sejak tanggal itu **lebih saji** sebesar
   seluruh harga pokok Solar.

2. **Harga beli beku.** Perubahan terakhir per produk: Pertamax 2026-01-05 ·
   Dexlite 2026-01-01 · Pertamina Dex 2026-01-02 · Pertamax Turbo 2026-01-19 ·
   Pertalite 2025-01-10 · **Solar 2024-12-01** · Pertalite Khusus 2021-09-21.
   Sementara harga jual terus bergerak (mis. Dexlite 13.800 → 20.150 antara Jan
   dan Jul 2026). Margin yang tersaji karenanya fiktif.

3. **`EDC Penampungan` naik dari 0 (2021) ke Rp 12.435.466.761** dan hanya turun
   pada 78 dari 2.067 hari. Akun penampungan EDC yang tidak pernah cair adalah
   kemustahilan operasional (settlement acquirer T+1). Perlu keputusan — sudah
   ada di daftar pertanyaan T4.

4. **Empat dari lima buku bank dorman**, saldonya masih ikut di neraca:
   `BCA-5125978301` terakhir 2022-08-18 (−4.598.834) · `BRI` 2021-11-23 (645.284) ·
   `Mandiri` 2024-01-10 (90.017.159) · `BNI` 2021-09-23 (8.026.278). Total ± Rp 94
   juta kas yang belum pernah dikonfirmasi ke rekening koran selama 2–5 tahun.

5. **Workbook berhenti dipelihara ± 27–28 Juli 2026** (`BukuKasBesar` 2026-07-28,
   `BiayaOperasional`/`StockAkhirHari`/buku hutang-piutang 2026-07-27). Satu-satunya
   sheet yang masih hidup adalah `PengambilanBBMPelangganEasyMax` (IMPORTRANGE,
   terisi s/d 2026-08-09) karena ia otomatis.

6. **Uraian transaksi tidak dapat dipercaya sebagai jejak.** Baris kas besar
   28/29/30 Jan semuanya berbunyi "Setoran penjualan Tgl 27/1/2026"; baris BCA
   berbunyi "Tgl 27/8/2026". Copy-paste tanpa penyesuaian tanggal.

## Langkah koreksi yang disarankan (urutan mengikat)

Semua di ranah tim keuangan; **jangan** ada yang dieksekusi dari sisi aplikasi.

1. **Hentikan pendarahan dulu.** Isi kembali `PenebusanBBM` + `SisaSO` dan posting
   kredit `Pembelian BBM` untuk 29-01-2026 → sekarang. Basis volume yang dapat
   dipakai tersedia di SolaMax (`delivery` per hari per produk, tautan `CNOSO`).
   Tanpa ini, koreksi apa pun akan langsung usang.
2. **Perbaiki `HargaBeli` Solar sejak 2026-03-04** dan mutakhirkan harga beli semua
   produk. Jangan menutup periode mana pun sebelum ini beres — COGS-nya salah.
3. **Rekonsiliasi kas riil**: konfirmasi saldo kelima rekening ke rekening koran
   per tanggal cut-over, termasuk empat rekening dorman.
4. **Putuskan perlakuan `EDC Penampungan`** sebelum saldo awal ditandatangani.
5. **Baru** susun jurnal koreksi: (a) satu jurnal untuk residu legacy
   Rp 3.635.936 (§6), (b) jurnal untuk periode 29-01 → cut-over berdasarkan hasil
   langkah 1–4. Keduanya butuh persetujuan Direksi.

## Cara mengulang pemeriksaan ini

- Salinan kerja & CSV per sheet: `scratchpad/fin.xlsx`, `scratchpad/csv/*.csv`
- Postgres: `cloud-sql-proxy solamax:asia-southeast2:solamax-pg --port 5432`,
  role read-only `dashboard_ro`, `set app.unit_ids='2'` (RLS).
- Identitas harian & dekomposisi: lihat rumus `err(d)` di atas; residu ≠ 0 hanya
  pada hari di mana penebusan tercatat di sheet tetapi tidak di buku.
