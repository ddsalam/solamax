# Piutang pelanggan Fase 1 — hasil Gerbang 0D enam unit dan probe `SBATAL`

Tanggal eksekusi: 2026-09-08 (WIB). Branch:
`codex/piutang-fase1-probe`. Metode S1–S4 disegel pada commit `9d8c74c`
sebelum query dijalankan:
[`2026-09-08-piutang-fase1-preregistrasi-6.md`](2026-09-08-piutang-fase1-preregistrasi-6.md).

Seluruh query mirror memakai Cloud SQL pilot LIVE `solamax-pg`, role
`dashboard_ro`, GUC polos `1,2,3,4,5,6,7`, transaksi read-only, dan hanya
statement `SELECT`/`SET` scope. Lima segel serta hasil lama tidak disunting.

Status: **Gerbang 1 tetap DITAHAN** sampai hasil D1–D4 Kotabaru kembali.
Probe `SBATAL` selesai; domain sync tagihan, snapshot, limit kredit, UI, dan
kode produk belum dimulai.

## 1. Gerbang 0D — hasil armada **6 dari 7 unit**

Tiga puluh tangkapan layar SQL Manager diperiksa satu per satu. Kotabaru tidak
masuk angka armada berikut.

| Unit | ID | Faktur hidup | Rentang `DTGL` | JT sama / lambat / awal | Tempo min…maks | Faktur 12 bln | Bayar hidup | Bayar 12 bln | Yatim | Bayar terakhir |
|---|---:|---:|---|---:|---|---:|---:|---:|---:|---|
| Imam Bonjol | 1 | 2.353 | 2022-09-02…2026-09-07 | 1.068 / **1.283** / 2 | −24…45 | 762 | 1.938 | 438 | **0** | 2026-09-04 |
| Bakau | 2 | 848 | 2015-11-01…2026-09-07 | 701 / 147 / 0 | 0…101 | 316 | 742 | 258 | **0** | 2026-09-02 |
| Adisucipto | 3 | 100 | 2026-03-23…2026-09-08 | 100 / 0 / 0 | 0…0 | 100 | 93 | 93 | **0** | 2026-09-07 |
| Batu Layang | 5 | 717 | 2020-05-21…2026-09-07 | 535 / 182 / 0 | 0…18 | 296 | 547 | 302 | **0** | 2026-09-07 |
| Korek | 6 | 783 | 2021-06-12…2026-09-07 | 763 / 19 / 1 | −1…23 | 459 | 97 | 97 | **0** | 2026-07-27 |
| 28 Oktober | 7 | 2.667 | 2018-06-21…2026-09-07 | 2.481 / 173 / 13 | −40…87 | 478 | 2.312 | 278 | **0** | 2026-07-16 |

Distribusi validasi `NSTATUS` yang menjadi dasar vonis terkunci:

| Unit | `NSTATUS=0` (n / tanpa bayar) | `NSTATUS=1` (n / tanpa bayar) |
|---|---|---|
| Imam Bonjol | 442 / **441** | 1.911 / **0** |
| Bakau | 190 / 145 | 658 / **0** |
| 28 Oktober | 379 / 357 | 2.288 / **0** |

Kontrol populasi penuh `tr_htagihan` Imam Bonjol: `SBATAL` 0→2.353 dan
1→165; `NSTATUS` 0→607 dan 1→1.911; `SJENISTAG` 1→1.439 dan 2→1.079.

### Empat vonis yang dikunci

1. 🔴 **`DTGLJT` dipakai; vonis sementara dari lima contoh Kotabaru
   dicabut.** Imam Bonjol mempunyai 1.283/2.353 = **54,5%** faktur bertempo,
   sampai 45 hari. Fitur jatuh tempo dapat bersumber dari EasyMax.
2. ⚠️ Pengisian tempo bervariasi ekstrem antar unit: Imam Bonjol 54,5%, Batu
   Layang 25,4%, Bakau 17,3%, 28 Oktober 6,5%, Korek 2,4%, Adisucipto 0%.
   Karena itu tempo wajib *presence-gated* per unit. Di unit dengan `jt_sama`
   dominan, termin harus datang dari master SolaMax; tanggal faktur yang sekadar
   disalin tidak boleh ditampilkan sebagai “jatuh tempo hari ini”.
3. ✅ Pada tiga unit validasi, **`NSTATUS=1` berarti lunas**: seluruh
   1.911 + 658 + 2.288 faktur mempunyai pembayaran. Kebalikannya tidak
   simetris: `NSTATUS=0` masih mempunyai pembayaran pada IB 1/442, Bakau
   45/190, dan 28 Oktober 22/379. Itu membentuk hipotesis pembayaran sebagian,
   **belum** membuktikannya.
4. ✅ **Yatim = 0 pada keenam unit.** Penautan pembayaran→faktur utuh untuk
   populasi yang diuji; kondisi berhenti D4 tidak terpicu.

Konsekuensi rencana: FIFO-imputed batal permanen karena open-item nyata hidup di
modul tagihan. Status lunas bersumber dari `NSTATUS`, tetapi tetap memerlukan
jaring verifikasi `sum(tr_byrtagih.ntotal)` terhadap `tr_htagihan.ngatot` setelah
domain tagihan tersedia di mirror.

Kelas kualitas kecil yang dicatat tanpa investigasi baru: 16 faktur mempunyai
jatuh tempo sebelum tanggal faktur—IB 2, 28 Oktober 13, dan Korek 1.

## 2. Sinyal operasional 28 Oktober dan Korek

28 Oktober terakhir mencatat pembayaran pada **2026-07-16** dan Korek pada
**2026-07-27**, sementara keduanya masih menerbitkan faktur sampai
**2026-09-07**. Bentuk datanya konsisten dengan jeda enam sampai delapan minggu
tanpa pembayaran baru di modul.

Data ini tidak dapat memilih antara dua tafsir:

1. uang memang belum diterima; atau
2. uang sudah diterima tetapi pembayaran belum diinput ke EasyMax.

Karena arah tidak teridentifikasi, sinyal tidak diberi angka rupiah “belum
tertagih” dan tidak dipakai untuk menuduh salah satu keadaan.

## 3. Blok empat query khusus Kotabaru

Gunakan koneksi baru pada DB Kotabaru. Jalankan persis empat query berikut,
tanpa tambahan.

```sql
-- Q1 · D1 + faktur 12 bulan
SELECT COUNT(*) AS n_faktur,
       MIN(DTGL) AS tgl_awal,
       MAX(DTGL) AS tgl_akhir,
       SUM(CASE WHEN DTGLJT = DTGL THEN 1 ELSE 0 END) AS jt_sama,
       SUM(CASE WHEN DTGLJT > DTGL THEN 1 ELSE 0 END) AS jt_lambat,
       SUM(CASE WHEN DTGLJT < DTGL THEN 1 ELSE 0 END) AS jt_awal,
       MIN(DATEDIFF(DTGLJT, DTGL)) AS tempo_min,
       MAX(DATEDIFF(DTGLJT, DTGL)) AS tempo_maks,
       SUM(CASE WHEN DTGL >= '2025-09-01' THEN 1 ELSE 0 END) AS faktur_12bln
FROM tr_htagihan
WHERE COALESCE(SBATAL,0) = 0;

-- Q2 · D2 + kontrol SBATAL dalam satu grid
SELECT 'NSTATUS' AS kolom, NSTATUS AS nilai, COUNT(*) AS n
FROM tr_htagihan GROUP BY NSTATUS
UNION ALL
SELECT 'SJENISTAG', SJENISTAG, COUNT(*)
FROM tr_htagihan GROUP BY SJENISTAG
UNION ALL
SELECT 'SBATAL', SBATAL, COUNT(*)
FROM tr_htagihan GROUP BY SBATAL;

-- Q3 · D3, arti NSTATUS dilawan ke keberadaan pembayaran hidup
SELECT h.NSTATUS,
       COUNT(*) AS n,
       SUM(CASE WHEN (SELECT COUNT(*)
                      FROM tr_byrtagih b
                      WHERE b.CKDTAGIH = h.CKDTAGIH
                        AND COALESCE(b.SBATAL,0) = 0) = 0
                THEN 1 ELSE 0 END) AS tanpa_bayar
FROM tr_htagihan h
WHERE COALESCE(h.SBATAL,0) = 0
GROUP BY h.NSTATUS;

-- Q4 · D4 + rentang dan pembayaran 12 bulan
SELECT COUNT(*) AS n_bayar,
       SUM(CASE WHEN h.CKDTAGIH IS NULL THEN 1 ELSE 0 END) AS yatim,
       MIN(b.DTGL) AS bayar_awal,
       MAX(b.DTGL) AS bayar_akhir,
       SUM(CASE WHEN b.DTGL >= '2025-09-01' THEN 1 ELSE 0 END) AS bayar_12bln
FROM tr_byrtagih b
LEFT JOIN tr_htagihan h ON h.CKDTAGIH = b.CKDTAGIH
WHERE COALESCE(b.SBATAL,0) = 0;
```

## 4. Probe `SBATAL` — snapshot pengukuran

Saat S1–S4 dimulai, mirror memuat 2.450.571 baris batal: 2.024.215 di
`bppiut` dan 426.356 di `bphut`. Ini 320 lebih banyak daripada snapshot P4
sebelumnya (2.450.251), karena ledger LIVE terus bergerak. Setiap probe memakai
transaksi read-only sendiri; denominator dicantumkan agar pergeseran berikutnya
tidak disalahartikan sebagai kontradiksi.

Kontras utama tetap sangat besar:

| Sumber | `SBATAL=0` | `SBATAL=1` | Porsi `SBATAL=1` |
|---|---:|---:|---:|
| `bppiut` mirror | 764.163 | 2.024.215 | 72,60% |
| `bphut` mirror | 115.876 | 426.356 | 78,63% |
| `tr_htagihan` IB dari POS | 2.353 | 165 | **6,55%** |

Nama kolom sama tidak berarti semantik pemakaian sama. Probe berikut menguji
apakah populasi ledger lebih menyerupai jejak koreksi/penulisan ulang.

## 5. S1 — tersebar sistemik, tetapi bervariasi

`0/1` berarti jumlah baris hidup/jumlah baris batal. Rentang persentase hanya
memakai tahun berpopulasi (sedikitnya 100 baris).

| Ledger | Unit | Penuh | Porsi batal | Tahun dalam pita 58–88% | Rentang tahunan | Porsi batal pada tahun terbesar |
|---|---:|---:|---:|---:|---|---:|
| `bphut` | 1 | 299.088 | 85,11% | 5/5 | 79,75…87,76% | 29,44% |
| `bphut` | 2 | 26.347 | 68,55% | 9/10 | 48,67…78,96% | 17,51% |
| `bphut` | 3 | 707 | 80,91% | 1/1 | 80,91% | 100,00% |
| `bphut` | 4 | 95.830 | 60,39% | 11/16 | 44,08…71,77% | 9,02% |
| `bphut` | 5 | 12.810 | 83,72% | 2/2 | 78,82…84,74% | 83,68% |
| `bphut` | 6 | 745 | 75,97% | 1/1 | 75,97% | 100,00% |
| `bphut` | 7 | 106.705 | 78,74% | 9/9 | 70,53…85,07% | 27,15% |
| `bppiut` | 1 | 405.989 | 85,07% | 5/5 | 79,61…87,02% | 29,28% |
| `bppiut` | 2 | 272.292 | 70,54% | 9/12 | 19,92…77,50% | 73,17% |
| `bppiut` | 3 | 3.214 | 81,64% | 1/1 | 81,64% | 100,00% |
| `bppiut` | 4 | 933.802 | 63,03% | 11/16 | 43,29…79,87% | 14,75% |
| `bppiut` | 5 | 382.117 | 73,20% | 8/8 | 65,65…85,35% | 55,56% |
| `bppiut` | 6 | 24.428 | 75,45% | 4/6 | 42,85…82,82% | 50,34% |
| `bppiut` | 7 | 766.536 | 77,94% | 9/9 | 71,19…85,96% | 36,02% |

Adisucipto dan Korek `bphut` baru mempunyai satu tahun riwayat, sehingga
konsentrasi 100% di sana tidak dapat disebut peristiwa. Batu Layang `bphut`
juga baru material sejak 2025; 83,68% baris batal berada pada 2026 karena tahun
itu memuat sebagian besar populasinya. Unit bersejarah panjang memperlihatkan
baris batal lintas tahun. Kotabaru dan Bakau bahkan menunjukkan level yang naik
bertahap dari sekitar 43–48% ke 70% lebih, bukan satu peristiwa tunggal.

**Vonis S1:** mekanisme **sistemik tetapi bervariasi**. Prediksi “tersebar lintas
waktu” diterima, sedangkan label “stabil ±73%” terlalu kuat dan tidak dipakai.

Seri tahunan lengkap (`tahun: 0/1 (porsi 1)`):

```text
bphut u1 · 2022: 5.030/29.576 (85,46%) · 2023: 11.293/44.480 (79,75%) · 2024: 11.377/70.870 (86,17%) · 2025: 10.450/74.930 (87,76%) · 2026: 6.398/34.684 (84,43%)
bphut u2 · 2016: 4/6 (60,00%) · 2017: 462/438 (48,67%) · 2018: 773/1.132 (59,42%) · 2019: 991/1.736 (63,66%) · 2020: 795/1.812 (69,51%) · 2021: 907/1.888 (67,55%) · 2022: 1.177/2.904 (71,16%) · 2023: 1.108/3.162 (74,05%) · 2024: 756/1.214 (61,62%) · 2025: 768/1.728 (69,23%) · 2026: 544/2.042 (78,96%)
bphut u3 · 2026: 135/572 (80,91%)
bphut u4 · 2011: 107/258 (70,68%) · 2012: 2.755/2.172 (44,08%) · 2013: 4.389/3.765 (46,17%) · 2014: 4.013/3.198 (44,35%) · 2015: 3.728/3.342 (47,27%) · 2016: 3.613/4.566 (55,83%) · 2017: 2.786/4.988 (64,16%) · 2018: 2.515/5.218 (67,48%) · 2019: 1.867/3.934 (67,82%) · 2020: 1.869/4.752 (71,77%) · 2021: 2.039/4.942 (70,79%) · 2022: 2.004/3.824 (65,61%) · 2023: 2.033/3.768 (64,95%) · 2024: 1.603/2.616 (62,01%) · 2025: 1.559/3.900 (71,44%) · 2026: 1.075/2.632 (71,00%)
bphut u5 · 2019: 1/4 (80,00%) · 2020: 1/4 (80,00%) · 2025: 468/1.742 (78,82%) · 2026: 1.616/8.974 (84,74%)
bphut u6 · 2026: 179/566 (75,97%)
bphut u7 · 2018: 364/1.032 (73,93%) · 2019: 3.495/11.934 (77,35%) · 2020: 5.354/22.809 (80,99%) · 2021: 4.585/15.492 (77,16%) · 2022: 2.552/6.906 (73,02%) · 2023: 1.590/3.806 (70,53%) · 2024: 1.479/3.832 (72,15%) · 2025: 1.470/7.952 (84,40%) · 2026: 1.799/10.254 (85,07%)
bppiut u1 · 2022: 16.143/101.112 (86,23%) · 2023: 11.651/45.486 (79,61%) · 2024: 12.215/71.384 (85,39%) · 2025: 12.038/80.678 (87,02%) · 2026: 8.570/46.712 (84,50%)
bppiut u2 · 2015: 201/50 (19,92%) · 2016: 327/134 (29,07%) · 2017: 115/108 (48,43%) · 2018: 922/1.466 (61,39%) · 2019: 505/714 (58,57%) · 2020: 176/362 (67,29%) · 2021: 7.252/18.176 (71,48%) · 2022: 58.527/140.544 (70,60%) · 2023: 4.887/13.484 (73,40%) · 2024: 2.559/4.216 (62,23%) · 2025: 2.729/5.852 (68,20%) · 2026: 2.022/6.964 (77,50%)
bppiut u3 · 2026: 590/2.624 (81,64%)
bppiut u4 · 2011: 2.634/10.452 (79,87%) · 2012: 10.489/14.122 (57,38%) · 2013: 49.773/39.188 (44,05%) · 2014: 31.552/24.090 (43,29%) · 2015: 21.274/19.464 (47,78%) · 2016: 11.682/15.146 (56,46%) · 2017: 10.405/19.773 (65,52%) · 2018: 16.847/33.131 (66,29%) · 2019: 30.156/68.046 (69,29%) · 2020: 21.411/50.696 (70,31%) · 2021: 37.194/79.430 (68,11%) · 2022: 48.717/86.833 (64,06%) · 2023: 13.694/28.794 (67,77%) · 2024: 14.390/27.056 (65,28%) · 2025: 14.960/43.455 (74,39%) · 2026: 10.046/28.902 (74,21%)
bppiut u5 · 2019: 1.902/8.016 (80,82%) · 2020: 3.820/14.110 (78,69%) · 2021: 21.285/45.323 (68,04%) · 2022: 54.666/155.400 (73,98%) · 2023: 12.350/23.607 (65,65%) · 2024: 4.680/13.932 (74,85%) · 2025: 1.248/5.118 (80,40%) · 2026: 2.440/14.220 (85,35%)
bppiut u6 · 2021: 105/152 (59,14%) · 2022: 1.203/902 (42,85%) · 2023: 406/516 (55,97%) · 2024: 875/2.658 (75,23%) · 2025: 1.485/4.924 (76,83%) · 2026: 1.924/9.278 (82,82%)
bppiut u7 · 2018: 6.963/27.206 (79,62%) · 2019: 27.926/105.672 (79,10%) · 2020: 10.577/34.298 (76,43%) · 2021: 40.248/145.816 (78,37%) · 2022: 65.576/215.205 (76,65%) · 2023: 6.764/16.716 (71,19%) · 2024: 3.513/8.972 (71,86%) · 2025: 4.118/22.488 (84,52%) · 2026: 3.436/21.042 (85,96%)
```

## 6. S2 — tanda tangan pasangan jauh di atas kontrol acak

Pasangan mensyaratkan ledger, unit, pelanggan, `sjnsbp`, dan `njumlah` sama.
Kontrol hanya memindahkan pelanggan pada baris batal secara deterministik ke
pelanggan lain dalam unit yang sama. Tidak ada pelanggan `NULL`/kosong pada
populasi batal.

### Armada — empat jendela kumulatif

| Ledger | Skenario | Hari sama | ±1 hari | ±7 hari | ±30 hari |
|---|---|---:|---:|---:|---:|
| `bphut` | nyata | 47,0358% | 47,1193% | **47,2994%** | 47,5241% |
| `bphut` | pelanggan acak | 0,0443% | 0,0905% | **0,2754%** | 0,5115% |
| `bppiut` | nyata | 48,8200% | 48,8827% | **49,0015%** | 49,0931% |
| `bppiut` | pelanggan acak | 0,4728% | 0,9522% | **2,0614%** | 3,3820% |

Pada jendela utama ±7 hari:

- `bphut`: nyata 201.664/426.356 vs kontrol 1.174/426.356—**171,75×**
  dan +47,0240 poin persentase;
- `bppiut`: nyata 991.896/2.024.215 vs kontrol 41.728/2.024.215—**23,77×**
  dan +46,9401 poin persentase.

Keduanya melewati ambang tersegel 10× dan +20 poin pada level armada.

### Per unit — jendela ±7 hari

| Ledger | Unit | Batal | Nyata | Kontrol acak |
|---|---:|---:|---:|---:|
| `bphut` | 1 | 254.540 | 46,9722% | 0,1615% |
| `bphut` | 2 | 18.062 | 48,4332% | 0,6422% |
| `bphut` | 3 | 572 | 46,3287% | 0,5245% |
| `bphut` | 4 | 57.875 | 48,8173% | 0,4959% |
| `bphut` | 5 | 10.724 | 46,9787% | 1,3241% |
| `bphut` | 6 | 566 | 48,5866% | 28,0919% |
| `bphut` | 7 | 84.017 | 47,0405% | 0,0667% |
| `bppiut` | 1 | 345.372 | 48,4654% | 0,5354% |
| `bppiut` | 2 | 192.070 | 49,6033% | 8,0033% |
| `bppiut` | 3 | 2.624 | 47,5229% | 0,0000% |
| `bppiut` | 4 | 588.578 | 49,1063% | 0,9533% |
| `bppiut` | 5 | 279.726 | 48,8060% | 2,8692% |
| `bppiut` | 6 | 18.430 | 46,9506% | 0,0922% |
| `bppiut` | 7 | 597.415 | 49,1760% | 1,8167% |

Kontrol `bphut` unit 6 dan `bppiut` unit 2 lebih tinggi daripada unit lain.
Pada populasi S4, `bphut` unit 6 hanya mempunyai dua pelanggan dengan kedua
status; penyebab pasti tingginya kontrol tidak ditetapkan oleh probe ini.
Keduanya tetap unggul lebih dari 20 poin, tetapi tidak memenuhi syarat rasio
10× secara individual. Vonis memakai level armada yang dipraregistrasikan dan
tidak menyembunyikan dua pengecualian itu.

**Vonis S2:** pasangan identik sangat jauh di atas kebetulan dan mendukung
koreksi/penulisan ulang. Hasil tidak membuktikan proses POS mana yang
menciptakannya.

## 7. S3 — prefiks bertumpang-tindih penuh; teks menunjukkan pembalik

| Ledger | Status | Sebaran prefiks (`baris`; porsi status) |
|---|---|---|
| `bphut` | batal | `JP` 380.645; 89,2787% · `UV` 43.990; 10,3177% · `DP` 1.604; 0,3762% · `TP` 117; 0,0274% |
| `bphut` | hidup | `JP` 78.721; 67,9356% · `UV` 24.449; 21,0993% · `DP` 11.490; 9,9158% · `TP` 1.035; 0,8932% · `01` 181; 0,1562% |
| `bppiut` | batal | `JP` 1.583.981; 78,2516% · `UV` 439.364; 21,7054% · `BT` 700; 0,0346% · `TP` 108; 0,0053% · `TV` 62; 0,0031% |
| `bppiut` | hidup | `JP` 575.440; 75,3033% · `UV` 176.120; 23,0474% · `BT` 11.225; 1,4689% · `TP` 811; 0,1061% · `TV` 528; 0,0691% · `01` 39; 0,0051% |

Seluruh empat prefiks batal `bphut` dan seluruh lima prefiks batal `bppiut`
juga hadir pada populasi hidup: tumpang-tindih baris **100%** pada kedua ledger.

Dari 20 contoh deterministik, sepuluh baris hidup semuanya memakai keterangan
transaksi biasa. Enam dari sepuluh baris batal secara eksplisit berakhiran
`- Pembalik`; empat lainnya memakai keterangan penjualan biasa tanpa penanda.
Jadi prediksi bahwa mayoritas sampel batal tidak akan menyebut pembatalan
**ditolak 6/10**, tetapi arah buktinya justru lebih tegas: `SBATAL=1` banyak
memuat posting pembalik/koreksi atas kelas transaksi yang sama, bukan kelas
dokumen terpisah.

**Vonis S3:** pola prefiks dan teks konsisten dengan reversal/koreksi. Mirror
tidak menjelaskan apakah pembalik dibuat otomatis, saat edit, atau saat tutup
shift.

### Dua puluh contoh deterministik

| Ledger | Status | Unit | Tanggal | PK | `vcref` | `vcket` |
|---|---|---:|---|---|---|---|
| `bphut` | batal | 1 | 2025-02-05 | `PH2025020500273` | `JP2025000001486` | Penjualan Pelanggan Debet Tanggal 05-02-2025 Shift 1 - Pembalik |
| `bphut` | batal | 2 | 2018-09-12 | `PH2018091200009` | `JP2018000000432` | Penjualan Pelanggan Debet Tanggal 12-09-2018 Shift 2 - Pembalik |
| `bphut` | batal | 1 | 2024-11-15 | `PH2024111500084` | `JP2024000014867` | Penjualan Pelanggan Debet Tanggal 15-11-2024 Shift 1 |
| `bphut` | batal | 1 | 2024-12-12 | `PH2024121200114` | `JP2024000016194` | Penjualan Pelanggan Debet Tanggal 12-12-2024 Shift 2 |
| `bphut` | batal | 1 | 2024-11-22 | `PH2024112200271` | `JP2024000015231` | Penjualan Pelanggan Debet Tanggal 22-11-2024 Shift 2 |
| `bphut` | hidup | 1 | 2024-09-10 | `PH2024091000192` | `JP2024000011635` | Penjualan Pelanggan Debet Tanggal 10-09-2024 Shift 2 |
| `bphut` | hidup | 7 | 2020-07-17 | `PH2020071700090` | `JP2020000012266` | Penjualan Pelanggan Debet Tanggal 17-07-2020 Shift 1 |
| `bphut` | hidup | 7 | 2021-04-26 | `PH2021042600003` | `DP202100276` | DEPOSIT PERUM DAMRI PER 26 APRIL 2021 |
| `bphut` | hidup | 1 | 2023-05-16 | `PH2023051600093` | `JP2023000006866` | Penjualan Pelanggan Debet Tanggal 16-05-2023 Shift 2 |
| `bphut` | hidup | 4 | 2025-11-28 | `PH2025112800002` | `JP2025000003215` | Penjualan Pelanggan Debet Tanggal 28-11-2025 Shift 1 |
| `bppiut` | batal | 7 | 2022-12-12 | `PP2022121200242` | `JP2022000064128` | Penjualan Pelanggan Tunai Tanggal 12-12-2022 Shift 1 |
| `bppiut` | batal | 7 | 2020-10-14 | `PP2020101400035` | `JP2020000013398` | Penjualan Pelanggan Kredit Tanggal 14-10-2020 Shift 3 - Pembalik |
| `bppiut` | batal | 4 | 2026-05-19 | `PP2026051900147` | `JP2026000001402` | Penjualan Pelanggan Kredit Tanggal 19-05-2026 Shift 2 - Pembalik |
| `bppiut` | batal | 7 | 2021-08-26 | `PP2021082601043` | `JP2021000018246` | Penjualan Pelanggan Tunai Tanggal 26-08-2021 Shift 3 - Pembalik |
| `bppiut` | batal | 1 | 2026-02-05 | `PP2026020500039` | `JP2026000001462` | Penjualan Pelanggan Kredit Tanggal 05-02-2026 Shift 1 - Pembalik |
| `bppiut` | hidup | 7 | 2019-11-29 | `PP2019112901114` | `JP2019000027139` | Penjualan Pelanggan Tunai Tanggal 29-11-2019 Shift 3 |
| `bppiut` | hidup | 7 | 2022-02-01 | `PP2022020100373` | `JP2022000005669` | Penjualan Pelanggan Tunai Tanggal 01-02-2022 Shift 2 |
| `bppiut` | hidup | 1 | 2024-06-20 | `PP2024062000146` | `JP2024000007637` | Penjualan Pelanggan Kredit Tanggal 20-06-2024 Shift 1 |
| `bppiut` | hidup | 5 | 2022-10-29 | `PP2022102900071` | `JP2022000046234` | Penjualan Pelanggan Tunai Tanggal 29-10-2022 Shift 1 |
| `bppiut` | hidup | 4 | 2022-07-23 | `PP2022072300316` | `JP2022000026348` | Penjualan Pelanggan Tunai Tanggal 23-07-2022 Shift 1 |

## 8. S4 — jauh dari penulisan ulang satu-kali

Rasio dihitung per pelanggan yang mempunyai baris batal dan hidup. `Agregat`
adalah jumlah batal dibagi jumlah hidup pada populasi bersama. Tabel dipisah
agar seluruh ukuran yang disegel tetap terbaca. Setelah review menemukan kolom
yang terlewat dari catatan awal, S4 dijalankan ulang pada 13:26 WIB dalam satu
snapshot `REPEATABLE READ`, tetap dengan role dan GUC yang sama. Ingest LIVE
membuat beberapa hitungan mentah `bppiut` bergeser selama sesi, tetapi agregat,
median, P95, maksimum, porsi dekat 1:1/≥2 yang sudah dicatat, serta arah vonis
tetap sama.

### Kardinalitas populasi bersama

| Ledger | Unit | Pelanggan | Baris batal | Baris hidup | Agregat |
|---|---:|---:|---:|---:|---:|
| `bphut` | 1 | 86 | 254.540 | 44.444 | 5,7272 |
| `bphut` | 2 | 13 | 18.062 | 8.285 | 2,1801 |
| `bphut` | 3 | 2 | 572 | 135 | 4,2370 |
| `bphut` | 4 | 72 | 57.867 | 37.951 | 1,5248 |
| `bphut` | 5 | 12 | 10.724 | 2.086 | 5,1409 |
| `bphut` | 6 | 2 | 566 | 179 | 3,1620 |
| `bphut` | 7 | 32 | 84.017 | 22.687 | 3,7033 |
| `bphut` | **semua** | **219** | **426.348** | **115.767** | **3,6828** |
| `bppiut` | 1 | 805 | 345.242 | 60.614 | 5,6957 |
| `bppiut` | 2 | 564 | 192.054 | 80.211 | 2,3944 |
| `bppiut` | 3 | 3 | 2.624 | 590 | 4,4475 |
| `bppiut` | 4 | 1.063 | 588.572 | 345.171 | 1,7052 |
| `bppiut` | 5 | 511 | 279.700 | 102.389 | 2,7317 |
| `bppiut` | 6 | 77 | 18.424 | 5.986 | 3,0778 |
| `bppiut` | 7 | 780 | 597.395 | 169.102 | 3,5327 |
| `bppiut` | **semua** | **3.803** | **2.024.011** | **764.063** | **2,6490** |

### Distribusi rasio per pelanggan

| Ledger | Unit | Min | P25 | Median | P75 | P95 | Maks | Dekat 1:1 | ≥2 | ≥5 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `bphut` | 1 | 1,0000 | 4,9490 | 5,7317 | 6,4302 | 8,9380 | 16,0 | 1,16% | 98,84% | 73,26% |
| `bphut` | 2 | 0,9551 | 1,6818 | 2,2558 | 2,4783 | 3,5539 | 3,8 | 15,38% | 61,54% | 0% |
| `bphut` | 3 | 2,6000 | 3,0804 | 3,5609 | 4,0413 | 4,4257 | 4,5217 | 0% | 100% | 0% |
| `bphut` | 4 | 0,3158 | 0,8663 | 1,2202 | 2,0000 | 2,8100 | 4,0 | 34,72% | 26,39% | 0% |
| `bphut` | 5 | 3,9195 | 4,0495 | 4,7649 | 5,1393 | 6,5908 | 7,2029 | 0% | 100% | 41,67% |
| `bphut` | 6 | 3,1250 | 3,1575 | 3,1900 | 3,2224 | 3,2484 | 3,2549 | 0% | 100% | 0% |
| `bphut` | 7 | 2,0000 | 3,3134 | 3,8334 | 5,0616 | 6,0640 | 8,0 | 0% | 100% | 28,13% |
| `bphut` | **semua** | **0,3158** | **1,8696** | **3,8000** | **5,5923** | **7,5500** | **16,0** | **12,79%** | **73,06%** | **35,16%** |
| `bppiut` | 1 | 1,0000 | 5,0088 | 6,0571 | 7,1489 | 9,4303 | 54,0 | 0,12% | 99,63% | 78,01% |
| `bppiut` | 2 | 0,2174 | 2,1968 | 2,4154 | 2,5852 | 2,9716 | 5,2 | 0,35% | 87,23% | 0,18% |
| `bppiut` | 3 | 4,4251 | 4,4410 | 4,4570 | 6,2285 | 7,6457 | 8,0 | 0% | 100% | 33,33% |
| `bppiut` | 4 | 0,1667 | 0,8633 | 1,4541 | 1,9461 | 2,5709 | 14,0 | 19,29% | 22,39% | 0,38% |
| `bppiut` | 5 | 0,7778 | 2,4165 | 2,6875 | 3,0000 | 4,0000 | 14,0 | 0,59% | 95,69% | 2,35% |
| `bppiut` | 6 | 0,5217 | 1,0000 | 2,0000 | 2,0000 | 4,5180 | 14,0 | 20,78% | 63,64% | 2,60% |
| `bppiut` | 7 | 0,6667 | 3,2067 | 3,4579 | 3,7620 | 4,6667 | 20,0 | 0,38% | 98,97% | 4,23% |
| `bppiut` | **semua** | **0,1667** | **1,9891** | **2,6861** | **3,8769** | **7,2564** | **54,0** | **6,05%** | **74,81%** | **17,91%** |

### Populasi batal tanpa baris hidup

| Ledger | Pelanggan | Baris batal |
|---|---:|---:|
| `bphut` | **1** | **8** |
| `bppiut` | **24** | **204** |

Pada populasi bersama, pelanggan dekat rasio 1:1 hanya 6,05% (`bppiut`) dan
12,79% (`bphut`), jauh di bawah ambang penolakan 80%.

**Vonis S4:** penulisan ulang satu-kali ditolak. Kardinalitas tinggi dan
bervariasi, konsisten dengan koreksi/penulisan ulang berulang.

## 9. Vonis gabungan S1–S4

Keempat sinyal tidak bertentangan:

| Probe | Hasil singkat | Arah bukti |
|---|---|---|
| S1 | batal tersebar lintas tahun; level berubah bertahap | mekanisme sistemik, bukan satu peristiwa |
| S2 | pasangan ±7 hari 47–49%, jauh di atas kontrol 0,28–2,06% | posting ulang/koreksi |
| S3 | prefiks overlap 100%; 6/10 sampel batal menyebut `Pembalik` | reversal atas transaksi yang sama |
| S4 | median 2,69–3,80 batal per hidup; ekor sampai 54 | penyuntingan berulang, bukan 1:1 |

Sesuai aturan yang disegel, kelas yang dikunci adalah:

> **`SBATAL=1` pada kedua ledger terutama merupakan jejak
> koreksi/pembalikan/penulisan ulang berulang, bukan sekadar kumpulan transaksi
> yang dibatalkan satu kali.**

Batas inferensi: mirror tidak membuktikan pemicu operasionalnya—otomatis oleh
POS, edit pengguna, pembalikan shift, atau kombinasi. Baris `SBATAL=1` juga
tidak boleh dimasukkan kembali ke formula saldo atau dianggap sebagai tagihan
aktif. Formula saldo `SBATAL=0` tetap terkunci. Untuk “tagihan yang sudah
dibuat”, sumber kanonik tetap modul open-item `tr_htagihan`; histori pembalik
ledger adalah lapisan audit/penjelasan yang berbeda.

Kondisi berhenti “S1–S4 saling bertentangan” tidak terpicu. Yang tetap menahan
Gerbang 1 adalah lubang Kotabaru, bukan konflik probe `SBATAL`.

## 10. Yang masih belum diketahui

- D1–D4 Kotabaru: distribusi tempo, status, validasi pembayaran, dan yatim.
- Penyebab pasti serta waktu pembuatan baris pembalik di POS; mirror hanya
  menunjukkan pola hasil akhirnya.
- Verifikasi `NSTATUS` terhadap `sum(tr_byrtagih.ntotal)` vs `NGATOT`. Tabel
  tagihan belum dicerminkan sehingga uji ini belum dapat dijalankan dari mirror.
- Apakah `NSTATUS=0` + ada pembayaran benar-benar berarti pembayaran sebagian.
  Ini juga menunggu domain sync tagihan dan tidak disimpulkan dari `NSTATUS`
  sendiri.
- Keputusan Dion apakah `tr_htagihan`, `tr_dtagihan`, dan `tr_byrtagih` akan
  menjadi domain sync baru. Belum ada kode atau migrasi.
- Bentuk UI akhir, SLA snapshot, dan master termin/limit kredit. Limit kredit
  tetap arc berikutnya karena `tm_plg` tidak menyimpannya.
- Untuk sinyal 28 Oktober/Korek: apakah uang belum masuk atau sudah masuk tetapi
  belum diinput.

## 11. Batas sistem

**SolaMax tidak bisa memblokir pelanggan di pompa.** Koneksi EasyMax
`SELECT`-only, dan blokir kredit hidup di POS. Yang dapat dibangun adalah
peringatan, status di SolaMax, dan daftar tindakan untuk pengawas; penegakan
tetap manusia.
