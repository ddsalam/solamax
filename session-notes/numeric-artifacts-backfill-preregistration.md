# Pra-registrasi backfill artefak floating-point — APPEND-ONLY

Berkas ini ditulis **sebelum** langkah tulis apa pun ke `solamax-pg`. Aturannya:
**append-only** — angka dan prediksi yang sudah tertulis tidak diedit; hasil ditambahkan
di bawah. Kalau sebuah prediksi meleset, yang ditulis adalah **kenyataannya**, bukan
prediksinya yang disesuaikan.

Setiap pemeriksaan di sini dirancang **bisa berbunyi MERAH**. Pemeriksaan yang tak punya
kondisi gagal bukan pemeriksaan.

Konteks & sebab: [`2026-08-06-artefak-float-numeric-ingest.md`](2026-08-06-artefak-float-numeric-ingest.md).
Skrip: [`apps/backend/scripts/backfill-numeric-artifacts.sql`](../apps/backend/scripts/backfill-numeric-artifacts.sql).

## Kenapa backfill ini dijalankan — supaya tidak salah dibaca

**BUKAN demi angkanya.** Materialitasnya nihil dan itu terukur: deviasi maksimum satu sel
**0,00001**, deviasi **total seluruh ±243.800 sel = 0,0000746**, hanya **2** sel yang
menyimpang lebih dari 1e-6. Tak ada angka laporan yang bisa bergeser satu rupiah pun.
Siapa pun yang membaca backfill ini sebagai **perbaikan korektness** salah baca.

Alasannya **permukaan laten**: pola `GREATEST(0, a − b)` di Sisa DO
([`queries.ts:693-694`](../apps/dashboard/src/lib/queries.ts#L693), `:778`) membandingkan
**selisih dua kolom**, dan perbandingan eksak-nol adalah tempat epsilon menggigit. Hari ini
kedua kolomnya (`tebus_detail.nvolume`, `delivery.nvoldo`) **kebetulan** bersih — kebetulan,
bukan desain. Backfill mengubah **"kebetulan bersih"** menjadi **"tidak mungkin kotor"**.

## T0 — baseline, diukur SEBELUM fix live

Diambil **2026-08-06 22:30:21 WIB** sebagai `dashboard_app` (SELECT-only), detektor
`scale(kolom) >= 5`, GUC `app.unit_ids = 1..7`.

| kolom | u1 | u2 | u3 | u4 | u5 | u6 | u7 | total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `bppiut.njumlah` | 1 | – | – | – | – | – | – | **1** |
| `cash_detail.njumlah` | 1 | – | – | 1 | – | – | – | **2** |
| `cash_header.ntotal` | 1 | – | – | 1 | – | – | – | **2** |
| `delivery.nvolreal` | – | – | – | – | 1 | – | – | **1** |
| `delivery.nvolselisih` | – | – | – | – | 1 | – | – | **1** |
| `edc.liter` | 2326 | 3139 | 114 | 4327 | 1885 | 284 | 7941 | **20016** |
| `opname.nstockbk` | 1037 | 2147 | – | 3914 | 3846 | 1928 | 3745 | **16617** |
| `opname.nstockop` | 1005 | 2047 | – | 3663 | 3366 | 1844 | 3688 | **15613** |
| `opname.nvolselisih` | 1355 | 1949 | – | 3035 | 2115 | 1038 | 2804 | **12296** |
| `pelanggan_sale.liter` | 16227 | 6 | – | 115 | 310 | 304 | 1673 | **18635** |
| `real_tank.ntinggi` | – | – | – | – | – | – | 1 | **1** |
| `real_tank.nvolume` | – | – | – | – | 1 | – | – | **1** |
| `sales_detail.nstandakhir` | 8533 | 10333 | – | 14010 | 13555 | 2171 | 7822 | **56424** |
| `sales_detail.nstandawal` | 8531 | 10336 | – | 14013 | 13563 | 2168 | 7822 | **56433** |
| `sales_detail.nsubtotal` | 27 | 4 | – | 12 | 6 | 4 | 23 | **76** |
| `sales_detail.nvolume` | 7581 | 7274 | – | 13292 | 5081 | 3714 | 9201 | **46143** |
| `tera.liter` | 7 | – | – | 27 | 5 | 10 | 11 | **60** |
| `terra_resmi.nvolume` | 4 | 1 | – | 15 | 6 | 2 | 3 | **31** |
| `voucher_sale.liter` | 285 | 332 | 52 | 650 | 39 | 143 | 5 | **1506** |
| **TOTAL** | **46921** | **37568** | **166** | **57075** | **43780** | **13610** | **44739** | **243859** |

Catatan: sapuan pertama sesi ini (21:50 WIB) mencatat **243.829**. Empat puluh menit
kemudian **243.859** — naik **30**. Itu bukan kebisingan pengukuran, itu jalur tulis lama
yang **masih memproduksi artefak** karena fix belum live. Angka T0 karena itu **bukan**
target; target diukur ulang tepat sebelum tiap unit dijalankan (lihat P4).

## Prediksi — semua bisa MERAH

### P1 · Sebelum fix live, hitungan MASIH NAIK
Pengukuran berikutnya sebelum promosi live ≥ 243.859.
**MERAH bila**: turun tanpa ada yang menjalankan backfill (berarti ada jalur tulis lain yang
tak dipahami).

### P2 · Setelah fix live, produksi artefak BARU berhenti
Dua pengukuran berjarak ≥ 60 menit setelah revisi backend baru serve → **selisih 0**.

**Kontrol wajib (inilah yang membuatnya bisa merah):** pada jendela yang sama, buktikan
data baru memang masuk — `max(ingested_at)` pada `sales_detail`/`edc` maju dan jumlah baris
bertambah. Tanpa kontrol ini, "0 artefak baru" bisa saja berarti "0 data baru", dan itu
bukan bukti apa-apa.
**MERAH bila**: hitungan naik meski revisi baru sudah serve → fix tidak bekerja di prod dan
backfill **dibatalkan**.

### P3 · Baris pemicu sembuh sendiri — kontrol jalur tulis
`bppiut PP2022100101473` (unit 1) berubah `73867616.45999999` → **`73867616.46`** pada sync
penuh pertama domain `piutang` setelah fix live. Ini kontrol yang membuktikan jalur tulis
sudah benar **sebelum** menyentuh 243.800 sel lain.
**MERAH bila**: masih `73867616.45999999` setelah `sync_state` domain `piutang` menunjukkan
`last_run_at` maju melewati waktu deploy → jangan lanjut ke backfill.

### P4 · Backfill per unit: unit yang dikerjakan → 0, unit lain → TIDAK BERGERAK
Urutan: **3 → 6 → 5 → 2 → 7 → 1 → 4** (kecil dulu; unit besar terakhir).

Untuk tiap unit U, tepat sebelum dijalankan, ukur ulang **T1_U** (hitungan sel `scale ≥ 5`
per tabel untuk unit U) **dan** hitungan untuk semua unit yang belum disentuh. Lalu:
- sesudah run: unit U = **0** sel;
- unit yang belum disentuh: **persis sama** dengan angka T1 yang baru diukur itu.

**MERAH bila**: unit U ≠ 0 (skrip sendiri sudah `EXCEPTION` + rollback), **atau** angka unit
lain bergerak — yang kedua berarti `-v units` tidak mengurung sasaran seperti yang diyakini,
dan itu **berhenti total**, bukan lanjut.

### P5 · Angka yang TAMPIL tidak bergerak
Satu tanggal per unit, diambil **sebelum & sesudah**, pada Laporan Operasional dan Rincian
Penjualan. Keduanya harus identik.
**MERAH bila**: ada satu angka bergeser → itu temuan (berarti ada jalur baca yang membaca
`numeric` tanpa cast, berlawanan dengan hasil investigasi) → **berhenti**, jangan lanjut ke
unit berikutnya.

## Pagar yang berlaku saat menjalankan

- `-v units="<U>"` **eksplisit** per unit — tanpa itu skrip ABORT sebelum menulis apa pun.
- `round(k, 4)`, **bukan** 2 desimal: `tera.liter` punya **10 nilai sah** ber-3/4 desimal.
- Pembersihan tak tuntas → `WARNING` + `EXCEPTION` + **rollback** (nol ter-commit).
- Dijalankan sebagai role pemilik `ingest` (FORCE RLS berlaku juga bagi pemilik).
- MySQL EasyMax **tidak disentuh**.
- Meleset di tengah = **berhenti**. Backfill separuh jalan yang konsisten per-unit jauh
  lebih mudah dipulihkan daripada tujuh unit yang setengah tersentuh.

---

# HASIL (append-only — ditambahkan setelah tiap langkah)

_(belum ada langkah tulis yang dijalankan)_
