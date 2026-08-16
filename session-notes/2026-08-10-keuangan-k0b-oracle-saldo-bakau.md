# K0-b — Verifikasi `getSaldoPelanggan` terhadap oracle di BAKAU

**Putusan: CONFIRMED — 5/5 tanggal, 15/15 sel EKSAK.**
Batas §8.4 di [`KEUANGAN-HARIAN.md`](../apps/dashboard/KEUANGAN-HARIAN.md) **DITUTUP**.
Pertanyaan §7.5 (piutang Rp 7,2 M vs Rp 0,66 M) **TERJAWAB** — lihat §4.

## 1. Oracle yang dipakai — dan kenapa ia sah

Ditemukan read-only di Drive, folder `1ZxV5BZc0-5Wkat02VzbVVOdvP0G6N-yq`
(pemilik `pengawas.spbubakau@gmail.com`), berkas PDF harian
"LAPORAN HUTANG PIUTANG <tanggal>".

Isinya **bukan** "Laporan Penjualan Harian". Kop internalnya:

```
C:\PROGRAM FILES (X86)\EASYMAX\REPORTS\RPT_GLDFTSALDOHP.FRX
SPBU 63.783.01 - BAKAU  Ds Sungai Bakau Besar Laut — Mempawah
Sampai dengan <tanggal>
… DAFTAR SALDO HUTANG/PIUTANG PELANGGAN
```

Tiga seksi, persis seperti oracle 28 Oktober & IB yang mengunci formula pada
2026-08-06: `DAFTAR SALDO PIUTANG PELANGGAN LOKAL` ·
`DAFTAR SALDO PIUTANG PELANGGAN ONLINE` · `DAFTAR SALDO HUTANG PELANGGAN LOKAL`.
`RPT_GLDFTSALDOHP` = **G**eneral **L**edger **D**a**FT**ar **SALDO** **H**utang
**P**iutang. **Oracle sah.**

"Sampai dengan D" = saldo **akhir hari D** → dibandingkan ke batas `<=`
(`akhir`) di `getSaldoPelanggan`, sesuai aturan terkunci.

## 2. Hasil

Formula: [`getSaldoPelanggan`](../apps/dashboard/src/lib/queries.ts#L1450) apa adanya —
Lokal = `sjenis IN (1,5)` **dan** kode tanpa titik · Online = kode **bertitik**
tanpa filter `sjenis` · Hutang = seluruh `bphut` dinegatifkan · semua `sbatal=0`.

| tanggal | seksi | Oracle (PDF) | SolaMax | selisih |
|---|---|---:|---:|---:|
| 2022-09-20 | Piutang Lokal | 33.479.896 | 33.479.896 | **0** |
| 2022-09-20 | Piutang Online | 2.333.677 | 2.333.677 | **0** |
| 2022-09-20 | Hutang Lokal | −24.154.939 | −24.154.939 | **0** |
| 2022-09-30 | Piutang Lokal | 56.437.453 | 56.437.453 | **0** |
| 2022-09-30 | Piutang Online | 2.333.677 | 2.333.677 | **0** |
| 2022-09-30 | Hutang Lokal | −29.158.339 | −29.158.339 | **0** |
| 2022-10-01 | Piutang Lokal | 56.437.453 | 56.437.453 | **0** |
| 2022-10-01 | Piutang Online | 2.333.677 | 2.333.677 | **0** |
| 2022-10-01 | Hutang Lokal | −28.458.339 | −28.458.339 | **0** |
| 2022-10-02 | Piutang Lokal | 56.437.453 | 56.437.453 | **0** |
| 2022-10-02 | Piutang Online | 2.333.677 | 2.333.677 | **0** |
| 2022-10-02 | Hutang Lokal | −27.058.339 | −27.058.339 | **0** |
| 2022-10-04 | Piutang Lokal | 60.207.453 | 60.207.453 | **0** |
| 2022-10-04 | Piutang Online | 2.333.677 | 2.333.677 | **0** |
| 2022-10-04 | Hutang Lokal | −25.708.339 | −25.708.339 | **0** |

**15/15 EKSAK.** Total keseluruhan lintas unit menjadi **39 sel di 3 unit**
(28 Oktober 9/9 · IB 15/15 · Bakau 15/15).

**Daya-beda uji ini nyata, bukan lima salinan hari yang sama:**
Piutang Lokal mengambil **tiga** nilai berbeda (33.479.896 → 56.437.453 →
60.207.453) dan Hutang Lokal **berubah pada kelima tanggal** (−24,15 → −29,16 →
−28,46 → −27,06 → −25,71 juta). Kalau formula salah arah/batas, mustahil kelimanya
mendarat tepat. Satu tanggal (2022-09-20) sengaja diambil jauh dari kelompok
lainnya agar bukan sekadar deret berurutan.

**Kontrol negatif yang tersedia gratis:** Piutang Online konstan 2.333.677
(WULING MOTORS) di kelima tanggal — dan **angka yang sama persis** muncul di
kesepuluh tanggal 2025–2026 pada rekonstruksi T3. Ini konsisten, tapi lihat §5.

## 3. Kelengkapan data 2025–2026 (kontrol kedua)

Verifikasi di atas memakai tanggal **2022**. Supaya kesimpulannya boleh dibawa ke
2025–2026, dicek kontinuitas `bppiut` Bakau:

| bulan | baris | hari berdata | piutang baru | pembayaran |
|---|---:|---:|---:|---:|
| 2025-10 | 252 | 31/31 | 358.006.980 | 344.120.648 |
| 2025-11 | 239 | 30/30 | 296.231.007 | 290.887.641 |
| 2025-12 | 219 | 31/31 | 248.460.578 | 298.597.977 |
| 2026-01 | 238 | 31/31 | 288.515.592 | 340.819.770 |
| 2026-02 | 208 | 28/28 | 295.529.116 | 103.085.335 |
| 2026-03 | 264 | 31/31 | 479.982.697 | 243.367.568 |
| 2026-04 | 269 | 30/30 | 543.655.027 | 422.643.201 |
| 2026-05 | 242 | 31/31 | 442.569.682 | 209.960.363 |
| 2026-06 | 230 | 30/30 | 578.781.635 | 393.730.496 |
| 2026-07 | 283 | 31/31 | 477.453.487 | 662.513.375 |
| 2026-08 (s/d 10) | 75 | 10/10 | 193.021.458 | 90.539.590 |

**Tak ada hari yang bolong**, dan **kedua sisi** (piutang baru & pembayaran) ada di
setiap bulan. Tidak ada celah backfill yang bisa menjelaskan Rp 6,5 miliar.

## 4. Konsekuensi: §7.5 terjawab

Di [T3](2026-08-10-keuangan-k0-t3-hasil.md) dua kemungkinan dibiarkan terbuka:

- **(a)** uang tagihan masuk tapi dibukukan sebagai "Setoran Hasil Penjualan"
  tanpa melepas piutangnya → piutang **dan** pendapatan lebih saji;
- **(b)** piutang workbook mencakup sesuatu di luar `bppiut` EasyMax → beda cakupan.

**(b) GUGUR**, dua alasan:
1. Formula SolaMax kini terbukti mereproduksi laporan resmi EasyMax Bakau **eksak**,
   jadi Rp 0,66 miliar adalah angka EasyMax yang benar — bukan artefak formula.
2. Piutang non-EasyMax punya bukunya **sendiri** di workbook
   (`BukuHutangPiutangNonEasyMax`, 17 account) dan **sudah** disajikan terpisah di
   `BalanceSheet!G`. Tidak ada tempat bagi (b) untuk bersembunyi.

→ **(a) yang berlaku.** Buku `BukuHutangPiutangPelangganEasyM` mencatat pengambilan
kredit tetapi hampir tidak pernah mencatat penagihan (Rp 1,83 juta sepanjang
Sep-2025 → Jul-2026 melawan Rp 5,63 miliar piutang baru), sementara EasyMax
menunjukkan pelanggan memang membayar. Selisih ±Rp 6,5 miliar adalah **lebih saji
di workbook**, bukan kekurangan di SolaMax.

Yang **masih** harus dijawab tim keuangan — bukan lagi "mana yang benar", melainkan
**ke mana lawan-catatnya pergi**: kalau uangnya masuk bank sebagai "Setoran Hasil
Penjualan", maka pendapatan ikut lebih saji dan jurnal koreksinya menyentuh
laba, bukan hanya neraca. Pertanyaan §7.5 diganti bunyinya di
`KEUANGAN-HARIAN.md` mengikuti ini.

## 5. Batas verifikasi ini — jangan diklaim lebih

1. **Tanggalnya 2022, bukan 2025–2026.** Yang terbukti adalah **formulanya**.
   Kelengkapan data 2025–2026 diperiksa terpisah (§3) dan bersih, tapi itu uji
   kontinuitas — bukan pencocokan ke oracle 2025–2026. Kalau tim keuangan bisa
   mengirim "DAFTAR SALDO HUTANG PIUTANG" Bakau untuk satu tanggal 2026, uji ini
   layak diulang sekali lagi; **tidak** memblokir apa pun.
2. **Rekonsiliasi per-pelanggan tidak dijalankan** — yang dibandingkan total per
   seksi (15 sel), bukan 16+1+12 baris pelanggan per tanggal.
3. **Piutang Online beku sejak 2022.** WULING MOTORS 2.333.677 tidak berubah dari
   2022-09-20 sampai 2026-01-12 — cocok di kedua sisi, jadi bukan cacat formula,
   tapi piutang yang tidak bergerak 3,5 tahun layak ditanyakan sendiri.

## Belum ditelusuri (satu baris, sesuai instruksi)

- Sisi **debit** buku workbook juga tidak cocok mulus: 2026-04 mencatat
  `Piutang Pelanggan` −1.409.422.305 vs `bppiut` piutang baru 543.655.027 (2,6×),
  padahal bulan lain berselisih ≤ 5 %. Tidak ditelusuri — tidak mengubah putusan
  §4, karena sisi penagihan tetap gap yang dominan dan tak ambigu.
