# Gold-check 28 Oktober — PRA-REGISTRASI prediksi (ditulis SEBELUM `--probe10` dijalankan)

> **Tujuan berkas ini:** mengunci seluruh nilai yang saya prediksi **sebelum** oracle
> EasyMax dijalankan, supaya rekonsiliasi tidak bisa di-rasionalisasi belakangan.
> Commit ini mendahului eksekusi `--probe10` di mesin SPBU. Kalau ada satu sel pun
> meleset di luar toleransi yang dinyatakan di bawah, itu **temuan**, bukan bahan
> penyesuaian narasi.
>
> Unit 7 · `63781002` · tenant `pt-sola-petra-energi` · sumber prediksi = **mirror
> Cloud SQL live** (`solamax-pg`, `system_identifier 7650126488674766864`).

## Desain eksperimen — BERPASANGAN (lebih ketat dari KR)

Struktur pecahan `SUM(nsubtotal)` harian diperiksa **lebih dulu**, lalu tanggal dipilih
sebagai **4 pasang berdekatan**, tiap pasang = 1 treatment (`.5`) + 1 kontrol (`.0`)
pada **hari berikutnya**. Penjodohan D/D+1 ini mengendalikan efek spesifik-hari
(volume, shift, hari pasar) yang tidak dikendalikan oleh set acak seperti di KR.

| Pasangan | Treatment (pecahan `.5`) | Kontrol (pecahan `.0`) |
| --- | --- | --- |
| 1 | 2026-07-05 | 2026-07-06 |
| 2 | 2026-07-09 | 2026-07-10 |
| 3 | 2026-07-13 | 2026-07-14 |
| 4 | 2026-07-18 | 2026-07-19 |

**Dikecualikan dengan alasan yang dinyatakan di muka:**
- **2026-07-22** — **HARI PARSIAL**: 60 detail / 2 header, sedangkan hari lengkap di
  unit ini konsisten **90 detail / 3 header** (3 shift). Memasukkannya akan mencampur
  "hari belum selesai" dengan "data hilang".
- 2026-07-23 (hari ini) — belum selesai.

**Hipotesis yang diuji:** selisih ±1 Rp pada OMSET adalah **artefak pembulatan
setengah-rupiah**, bukan gejala data hilang. Prediksinya jatuh **hanya** pada tanggal
treatment; kontrol harus eksak. Kalau `.0` ikut meleset, hipotesis pembulatan **gugur**
dan itu gap nyata.

## Prediksi — SETIAP SEL, dari mirror

`probe10` mencetak `ROUND(SUM(NSUBTOTAL),1)` per `DTGLJUAL`, jadi pecahan `,5` harus
tampak **persis di empat tanggal treatment dan tidak di satu pun kontrol**.

### 1. OMSET — `ROUND(SUM(NSUBTOTAL),1)` + `n` (baris detail)

| Tanggal | Jenis | OMSET diprediksi | n |
| --- | --- | --- | --- |
| 2026-07-05 | **treatment** | **484.772.075,5** | 90 |
| 2026-07-06 | kontrol | 633.476.212,0 | 90 |
| 2026-07-09 | **treatment** | **494.440.579,5** | 90 |
| 2026-07-10 | kontrol | 432.511.714,0 | 90 |
| 2026-07-13 | **treatment** | **601.664.074,5** | 90 |
| 2026-07-14 | kontrol | 594.057.814,0 | 90 |
| 2026-07-18 | **treatment** | **561.177.088,5** | 90 |
| 2026-07-19 | kontrol | 428.353.816,0 | 90 |

### 2. PELANGGAN — `ROUND(SUM(t),0)` (vw_jualplg ⊎ vw_usevouc, non-batal)

| Tanggal | Pelanggan diprediksi |
| --- | --- |
| 2026-07-05 | 109.617.757 |
| 2026-07-06 | 80.882.307 |
| 2026-07-09 | 74.495.258 |
| 2026-07-10 | 59.499.324 |
| 2026-07-13 | 82.938.439 |
| 2026-07-14 | 77.283.802 |
| 2026-07-18 | 63.789.849 |
| 2026-07-19 | 81.730.267 |

### 3. EDC non-blank — `ROUND(SUM(TotalHarga),0)` + `n`

> ⚠️ **`n` = BARIS TRANSAKSI, bukan jumlah channel.** Koreksi kanonik dari KR: di sana
> saya sempat melaporkan kolom `n` sebagai distinct channel padahal probe10 mencetak
> baris. Kedua besaran didaftarkan di bawah dengan nama eksplisit — yang **dibandingkan
> ke probe10 adalah `rows`**; `ch` hanya karakterisasi mirror.

| Tanggal | EDC diprediksi | **rows** (= `n` probe10) | *ch* (mirror saja) |
| --- | --- | --- | --- |
| 2026-07-05 | 38.883.858 | **76** | *7* |
| 2026-07-06 | 80.931.959 | **83** | *5* |
| 2026-07-09 | 62.290.729 | **64** | *5* |
| 2026-07-10 | 46.943.219 | **36** | *6* |
| 2026-07-13 | 78.300.628 | **107** | *6* |
| 2026-07-14 | 88.796.048 | **58** | *7* |
| 2026-07-18 | 64.935.180 | **61** | *6* |
| 2026-07-19 | 48.069.539 | **64** | *7* |

### 4. EDC BLANK-CARD — `ROUND(SUM(TotalHarga),0)` + `n` (rows)

| Tanggal | Blank diprediksi | rows |
| --- | --- | --- |
| 2026-07-05 | 21.146.917 | 48 |
| 2026-07-06 | 4.701.887 | 13 |
| 2026-07-09 | 13.191.402 | 23 |
| 2026-07-10 | 3.280.925 | 5 |
| 2026-07-13 | 2.215.077 | 15 |
| 2026-07-14 | 24.919.250 | 33 |
| 2026-07-18 | 4.997.558 | 20 |
| 2026-07-19 | 6.462.143 | 20 |

### 5. DEPOSIT — `ROUND(SUM(NTOTAL),0)` + `n` (non-batal)

**Ketiadaan ikut diprediksi** — dua tanggal harus TIDAK muncul sama sekali di seksi ini.
Kalau justru muncul, itu meleset, sama seriusnya dengan angka yang salah.

| Tanggal | Deposit diprediksi | n |
| --- | --- | --- |
| 2026-07-05 | 25.000.000 | 1 |
| 2026-07-06 | 4.000.000 | 2 |
| 2026-07-09 | 25.000.000 | 1 |
| **2026-07-10** | **TIDAK ADA BARIS** | — |
| 2026-07-13 | 6.000.000 | 3 |
| **2026-07-14** | **TIDAK ADA BARIS** | — |
| 2026-07-18 | 800.000 | 1 |
| 2026-07-19 | 25.000.000 | 1 |

## Toleransi yang dinyatakan di muka

- **OMSET**: harus **EKSAK** sampai 0,1 Rp untuk kedelapan tanggal. Pecahan `,5` hanya
  di 4 treatment. Selisih ±1 Rp **hanya sah** saat membandingkan nilai rupiah bulat
  dashboard vs oracle di tanggal treatment — bukan di perbandingan 1-desimal ini.
- **Seksi lain**: harus **EKSAK**, tanpa toleransi.
- **Baris detail**: 90/hari untuk kedelapan tanggal (bukti hari lengkap).
- Meleset di mana pun = **STOP dan diagnosa**, bukan penyesuaian narasi.

## Perintah yang akan dijalankan owner

```bat
cd C:\solamax-agent
node solamax-agent.cjs --probe10 2026-07-05 2026-07-06 2026-07-09 2026-07-10 2026-07-13 2026-07-14 2026-07-18 2026-07-19 --config config.local.json
```

## Pemeriksaan lanjutan (setelah sweep)

Setelah `--resync-sales` + deep-sweep, **minimal satu tanggal gold-check diverifikasi
ulang tidak bergerak** (OMSET sampai 0,1 Rp + jumlah baris). Bergerak = resync mengubah
data yang sudah diklaim lengkap → temuan.

---

# HASIL — ditulis SESUDAH `--probe10` dijalankan (2026-07-23)

> **Angka prediksi di atas TIDAK diubah sedikit pun.** Seksi ini ditambahkan
> (*append*), bukan menyunting. Pre-registrasi yang diam-diam disunting berhenti
> menjadi bukti; termasuk ketika ia membuat penulisnya terlihat buruk.

## Ringkasan verdict

| Seksi | Hasil | Catatan |
| --- | --- | --- |
| OMSET (rp + n) | **EKSAK 8/8** | `,5` di persis 4 treatment, tanpa pecahan di persis 4 kontrol; n=90 semua |
| EDC non-blank (rp + **rows**) | **EKSAK 8/8** | rows 76/83/64/36/107/58/61/64 |
| EDC blank-card (rp + rows) | **EKSAK 8/8** | |
| DEPOSIT (rp + n) | **EKSAK 8/8** | termasuk **KEDUA prediksi ketiadaan** (07-10 & 07-14) terbukti |
| PELANGGAN | **PREDIKSI MELESET 8/8** | **data BENAR**; lihat post-mortem di bawah |

**Hipotesis pembulatan TERKONFIRMASI:** pecahan `,5` muncul persis di empat tanggal
treatment dan **tidak di satu pun kontrol**. Karena tiap kontrol bersebelahan (D+1)
dengan treatment-nya, efek spesifik-hari ikut terserap — desain berpasangan ini
bekerja sebagaimana dimaksud.

## Post-mortem PELANGGAN — kesalahan METODE, bukan gap pipeline

Nilai tersegel kurang **28–66 juta/hari di kedelapan tanggal, selalu kurang, tak
pernah lebih**. Query ulang mirror terhadap oracle `probe10` yang sama: **selisih = 0
di kedelapan tanggal** (140.685.507 / 120.444.207 / 103.008.308 / 93.605.868 /
115.354.089 / 143.257.602 / 96.827.749 / 122.085.867; rows 223/205/181/145/208/194/
160/181). Mirror `pelanggan_sale`: 68.080 baris, 2024-12-06 → 2026-07-22.

**Penyebab:** nilai pelanggan disegel **saat backfill domain `pelanggan` masih
berjalan**. Yang tersegel bukan prediksi atas pipeline, melainkan **potret mirror yang
belum lengkap** — lalu mirror menyusul dan "prediksi" itu otomatis meleset. Arah
selisih yang **selalu kurang, tak pernah lebih** adalah tanda tangan khas kondisi ini,
dan seharusnya saya kenali sendiri sebelum menyegel.

**Kegagalan penalarannya spesifik dan patut dinamai:** pada siklus yang sama saya
menandai `real_tank = 0` sebagai "mid-cycle, akan diverifikasi ulang" — penerapan yang
benar dari aturan *zero mid-cycle bukan gap*. Lalu saya menyegel prediksi pelanggan
**dari state mid-cycle yang persis sama**. Aturan itu saya terapkan pada **penafsiran
keluaran**, tetapi tidak pada **kelayakan masukan**. Aturan `sync_state` dibaca dua
kali pun mestinya menggerbangi langkah pra-registrasi, bukan cuma diagnosa stall.

### PRASYARAT BARU (mengikat untuk unit berikutnya — tak ada unit #8, jadi ini untuk pipeline apa pun)

> **Pra-registrasi hanya boleh dilakukan setelah SELURUH domain SELESAI backfill.**
> Verifikasi sebelum menyegel: tiap domain hadir di `sync_state` dengan `last_run_at`
> yang stabil pada **dua pembacaan berjarak**, dan census sumber-vs-mirror sudah tutup.
> Menyegel dari mirror yang belum lengkap **memproduksi miss palsu**: ia menuduh
> pipeline atas keterlambatan yang dibuat oleh metode.

## Gerbang STOP pasca-sweep — LULUS

`--resync-sales 2025-01-01 2026-07-23` **menulis ulang seluruh rentang, termasuk
kedelapan tanggal gold-check**, jadi ini bukan formalitas.

Mirror pasca-sweep vs nilai tersegel, **kedelapan tanggal** (bukan hanya dua minimum):
**delta 0,0 Rp dan n=90 identik, 8/8 IDENTIK.** Resync terbukti idempoten dan tidak
merusak apa pun yang sudah dinyatakan benar.

## Temuan pendukung dari sweep

- **Cakupan shift SEMPURNA:** nol hari non-3-shift sepanjang 2025-01-01 → 2026-07-21,
  dan **567 hari terliput dari 567 hari kalender** — tak ada satu hari pun bolong.
  Ekor `2026-07-22` = 2 shift (1,2) sebab resync jalan 02:14 WIB dan shift 3 belum
  tutup — tafsiran terkonfirmasi dari `sales_header`, bukan diasumsikan.
- **Progresi 234 → 262 → 270 = penambahan nozzle**, terkunci dari data: nozzle
  **26 → 30 pada persis 2026-02-13**, satu-satunya perubahan dalam 18+ bulan.
  78/hari = 26×3 shift; 90/hari = 30×3; hari transisi 02-13 = 82 (26+26+30).
- **Window 300 = hari PERUBAHAN HARGA**, bukan anomali: pada hari tsb tiap nozzle
  terdampak menulis baris detail kedua (mis. 2026-06-30 NZ-03 20.150 → 23.500).
  `104 = 78 + 26` (26 nozzle diubah harganya), `120 = 90 + 30`. 14 dari 19 hari
  elevated adalah akhir bulan (penyesuaian harga Pertamina).
