# B7 · `SOValue` — SEGEL PRA-REGISTRASI (21 Agustus 2026)

⛔ **Ditulis dan di-commit SEBELUM satu angka pun dibuka.** Jawabannya belum
dijalankan saat berkas ini dibuat; commit inilah stempel waktunya.

## Prasyarat yang dipenuhi lebih dulu

Pelajaran 28 Oktober: pra-registrasi hanya sah setelah SELURUH domain selesai
backfill. Diperiksa di produksi (Bakau, `6378301`), read-only:

| domain | baris | rentang | dalam jendela emas |
|---|---:|---|---:|
| `tebus_header` | 2.896 | 2015-08-04 … 2026-08-21 | 291 |
| `tebus_detail` | 4.152 | — | — |
| `delivery` | 12.808 | 2015-08-04 … 2026-08-21 | 1.387 |

Keduanya melampaui jendela 2025-01-01 … 2026-01-12 di kedua ujung. ✔

## ⚠️ Premis brief yang saya BANTAH lebih dulu, supaya segel ini bisa salah

Brief menyebut: *"meleset di 4 dari 10; dugaan yang belum terbukti: beda sumbu
tanggal"*. Bukti yang tercatat mengatakan sesuatu yang lebih spesifik, dan segel
ini bertaruh pada versi yang lebih spesifik itu.

[`2026-08-10-keuangan-k0-t3-hasil.md`](2026-08-10-keuangan-k0-t3-hasil.md)
mencatat `SO Value` **0/10** — tetapi itu **sebelum B6 terpasang**. Selisihnya di
sana sudah **terurai habis** jadi tiga suku, dan hanya SATU di antaranya sumbu
tanggal:

| suku | tanggal terdampak | arah | nilai |
|---|---|---|---|
| **D2** dua SO Solar mati sejak 2023 (16.000 L) | **10/10** | SolaMax > sheet | Rp 105.074.482 |
| **D2′** Pertamina Dex 4.000 L | 3 | **sheet > SolaMax** | ~Rp 53,9 juta |
| **D3** sumbu tanggal, Pertalite 8.000 L | **1** | sheet > SolaMax | Rp 77.436.414 |

B6 (`sisaSoAktif = sisa − sisa_macet`) **sudah terpasang** di
`keuangan-laporan-queries.ts:146,200`, jadi suku D2 semestinya sudah lenyap dari
angka hari ini. Yang tersisa itulah yang diprediksi di bawah.

## PREDIKSI — dibuka setelah commit ini

**P1 · Solar sembuh di 10/10.** `SisaSO` Solar SolaMax hari ini = nilai sheet,
sebab kedua SO mati 2023 kini `sisa_macet`. Uji konkret 2025-12-31: Solar
**40.000 L** (dulu 56.000), `SOValue` Solar **Rp 262.686.205**
(= 40.000 × 6.567,155125).

**P2 · Yang MELESET tepat EMPAT tanggal, dan inilah keempatnya:**

| tanggal | sebab yang saya duga | asset-neutral? |
|---|---|---|
| 2025-06-02 | Pertamina Dex +4.000 L (D2′) | **tidak diketahui** |
| 2025-06-30 | Pertamina Dex +4.000 L (D2′) | **tidak diketahui** |
| 2025-08-31 | Pertamina Dex +4.000 L (D2′) | **tidak diketahui** |
| 2025-12-31 | sumbu tanggal, Pertalite 8.000 L (D3) | **YA** — Inventory −77.436.414 / SOValue +77.436.414 |

**P3 · Enam tanggal ini adalah KONTROL NEGATIF dan harus tetap eksak:**
2025-01-31 · 2025-03-29 · 2025-03-31 · 2025-09-30 · 2025-12-01 · 2026-01-12.
Perbaikan yang menyembuhkan empat tetapi merusak salah satu dari enam **bukan
perbaikan**.

**P4 · Sumbu tanggal menjelaskan SATU dari empat, bukan empat-empatnya.** Tiga
sisanya (Dex) berarah **berlawanan** — sheet lebih besar — jadi ia tak mungkin
disembuhkan oleh mekanisme yang sama, dan sebabnya **belum diketahui**.

**P5 · Motivasi brief tidak berlaku untuk D3.** Brief beralasan `SOValue` yang
meleset = **tier gerbang tutup hari yang salah**, sebab `soValue` suku di dalam
`asset` dan `asset` menghasilkan `langkahHarian`. Untuk D3 itu **tidak berlaku**:
selisihnya berpindah antara `inventoryValue` dan `soValue` yang **keduanya di
dalam `asset` yang sama**, jadi `asset` tak berubah dan `langkahHarian` tak
tersentuh. Yang benar-benar menggerakkan `asset` adalah D2 — dan D2 sudah
diperbaiki B6. **Kalau P5 benar, B7 bukan cacat gerbang.**

## Bagaimana segel ini bisa SALAH

- P1 salah bila `DO_STALE_DAYS = 30` tak menangkap kedua SO 2023 itu (mis. ada
  penerimaan parsial yang menyegarkan `lastd`).
- P2 salah bila jumlah tanggal meleset ≠ 4, atau tanggalnya bukan keempat ini.
- P3 salah bila satu saja dari keenam kontrol ternyata sudah tidak eksak.
- P4 salah bila ketiga tanggal Dex ternyata juga soal sumbu tanggal.
- P5 salah bila `soValue` ternyata masuk `asset` lewat jalur yang tidak
  membatalkan `inventoryValue` — dibaca dari `keuangan-laporan-model.ts:212-219`.
