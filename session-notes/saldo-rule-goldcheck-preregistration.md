# Pra-registrasi — aturan Saldo Piutang/Hutang (28 Oktober + armada 7 unit)

**APPEND-ONLY.** Baris prediksi di §2–§4 **tidak boleh disunting** setelah disegel.
Hasil ditambahkan di §5 ke bawah.

Disegel: **2026-08-06**, sebelum satu pun query verifikasi dijalankan.

## 0. Kelayakan masukan (pelajaran 28 Oktober: jangan menyegel di tengah backfill)

Menyegel prediksi saat mirror belum lengkap **memproduksi miss palsu**. Karena itu
kelengkapan dibuktikan **lebih dulu**, bukan diasumsikan:

- `sync_state` untuk `piutang`/`hutang`/`pelanggan` terisi di **ketujuh** unit,
  `last_run_at` 2026-08-05 ±17:00 UTC (= 2026-08-06 dini WIB). Tidak ada unit tertinggal.
- Rekonsiliasi **per-pelanggan** 28 Oktober untuk 2–4 Ags 2026 (87 baris × 3 tanggal =
  261 titik): **nol** ketidakcocokan nilai. Enam kode yang absen di Postgres semuanya
  bersaldo Rp0 di oracle.
- Anti-join `bppiut` ⟂ `pelanggan_master`: **nol baris di ketujuh unit**.

→ Masukan layak. Prediksi boleh disegel.

## 1. Aturan yang diuji

| baris | aturan |
| --- | --- |
| Piutang Lokal | `bppiut`, `SJENIS ∈ {1,5}` **DAN** kode **tanpa** titik |
| Piutang Online | `bppiut`, kode **bertitik**, **TANPA** filter SJENIS |
| Hutang Lokal | seluruh `bphut`, dinegatifkan |

Semua `COALESCE(sbatal,0)=0`; dua batas: `dtgl < D` (awal hari) & `dtgl <= D` (akhir hari).

## 2. PREDIKSI — 28 Oktober, 9 sel (batas AKHIR hari)

Sengaja dituliskan sebagai angka pasti. **Meleset satu rupiah = MERAH.**

| tanggal | Piutang Lokal | Piutang Online | Hutang Lokal |
| --- | ---: | ---: | ---: |
| 2026-08-02 | 12.033.038.039 | 10.796.518 | 149.332.330 |
| 2026-08-03 | 12.117.420.938 | 10.796.518 | 140.919.652 |
| 2026-08-04 | 12.239.110.739 | 10.796.518 | 123.526.169 |

**Prediksi tambahan (harus benar bersamaan):**

- P2.1 — Piutang Lokal **tidak berubah** oleh syarat baru "tanpa titik", sebab keempat
  pelanggan bertitik ber-SJENIS {1,5} di unit 7 bersaldo nol. Nilai akhir-hari 04-08 dengan
  dan tanpa syarat titik: **sama persis**.
- P2.2 — Saldo **awal** hari D ≡ saldo **akhir** hari D−1, di ketiga baris, untuk
  D ∈ {03-08, 04-08}. Kalau kolom Awal dan Akhir keluar **identik**, batasnya salah pasang.
- P2.3 — Piutang Online **naik tepat 36.084** dibanding aturan lama (`sjenis = 3`), di
  ketiga tanggal, tak lebih dan tak kurang.

### Apa yang terlihat kalau aturannya SALAH

- Online meleset **kelipatan** 36.084 → deteksi "bertitik" salah (mis. lupa `trim()`).
- Online membengkak ke **miliaran** → syarat titik hilang; SJENIS 4 non-bertitik ikut masuk.
- Lokal **berkurang** → syarat "tanpa titik" salah memakan pelanggan `PLG####`.
- Ketiga baris meleset **searah, sebesar delta satu hari** → batas tanggal salah.

## 3. PREDIKSI — armada 7 unit (tiga pertanyaan)

Prediksi ini **boleh salah**; justru itu gunanya. Yang tidak boleh adalah tidak menuliskannya.

- **(a) `bphut` memuat pelanggan bertitik?**
  **Prediksi: TIDAK, di ketujuh unit** (0 pelanggan bertitik punya baris `bphut`).
  MERAH bila ada ≥1 — artinya "Hutang = seluruh `bphut`" mencampur pelanggan online ke baris
  hutang, dan aturan hutang butuh syarat tambahan.
  Kontrol: hitung juga pelanggan **non**-bertitik di `bphut` — harus **> 0** di tiap unit yang
  punya `bphut`, kalau tidak query-nya sendiri yang rusak.

- **(b) Ada pelanggan BERTITIK ber-SJENIS {1,5} yang BERSALDO?**
  **Prediksi: ADA di setidaknya satu unit selain 28 Oktober.** Di unit 7 keempatnya kebetulan
  nol — itu keberuntungan, bukan aturan.
  Konsekuensi bila ada: aturan baru **memindahkan** saldonya dari Lokal ke Online di unit itu.
  Itu perubahan angka yang **harus dilaporkan ke owner**, bukan diam-diam dianggap perbaikan,
  karena unit itu belum punya oracle.
  MERAH bila nilainya besar (> Rp1 juta) di unit mana pun tanpa oracle pembanding → berhenti,
  minta ekspor "Daftar Saldo Hutang Piutang" unit tersebut sebelum merilis.

- **(c) "Titik = online" berlaku di semua unit?**
  **Prediksi: TIDAK semua unit punya pelanggan bertitik** — sebagian akan nol (tak ada bisnis
  online). Itu **bukan** kegagalan aturan.
  MERAH bila ada unit dengan format kode **ketiga** (bukan `PLG####`, bukan `NN.999.NNNN`)
  yang bersaldo — artinya diskriminatornya bukan sekadar ada/tidaknya titik.

## 4. PREDIKSI — biaya query

- P4.1 — Bentuk baru (satu pemindaian per tabel, dua batas sekaligus) **tidak lebih lambat**
  dari bentuk lama pada unit terberat. Ambang: median 3× jalan **≤ 1,3×** median lama.
  MERAH bila > 1,3× — optimasi 104 dtk → 1,47 dtk tak boleh dikorbankan.
- P4.2 — Unit terberat untuk query ini adalah **unit 4** (Bundaran Kotabaru; 927.130 baris
  `bppiut`, terbanyak di armada), bukan unit 7.

## 5. HASIL — 28 Oktober, 9 sel

Dijalankan 2026-08-06 12:33–12:37 WIB, ADC dipulihkan owner. Dieksekusi lewat
`saldo.oracle.integration.test.ts` (implementasi SEBENARNYA, bukan salinan SQL).

**8 dari 9 sel EKSAK terhadap prediksi. 1 sel meleset — dan melesetnya BENAR.**

| tanggal | baris | prediksi | hasil | putusan |
| --- | --- | ---: | ---: | --- |
| 02-08 | Lokal / Online / Hutang | 12.033.038.039 / 10.796.518 / 149.332.330 | idem | ✅ EKSAK |
| 03-08 | Lokal / Online / Hutang | 12.117.420.938 / 10.796.518 / 140.919.652 | idem | ✅ EKSAK |
| 04-08 | Online / Hutang | 10.796.518 / 123.526.169 | idem | ✅ EKSAK |
| 04-08 | **Piutang Lokal** | 12.239.110.739 | **12.239.715.239** | ⚠️ **+604.500** |

### Sel ke-9: ledger bergerak setelah oracle diekspor — bukan aturan yang salah

Kontrol yang memutuskannya: **aturan LAMA pun kini mengembalikan 12.239.715.239**
untuk 04-08 (pagi ini ia mengembalikan 12.239.110.739). Jadi yang berubah adalah
DATA, bukan aturan.

Jejak audit dari kolom `ingested_at` — pukul **2026-08-06 02:23 UTC (09:23 WIB)**
pengawas 28 Oktober mengoreksi posting ber-tanggal 04-08. EasyMax mencatatnya
sebagai batal-dan-posting-ulang: 5 posting asli + 5 baris pembalik di-`SBATAL=1`,
lalu 5 posting pengganti dipasang. Empat pelanggan nilainya sama; **PLG0831 naik
30.081.000 → 30.685.500 = +604.500**.

Rekonstruksi keadaan ledger saat oracle dicetak:

```
saldo sekarang       12.239.715.239
− 5 posting pengganti     63.097.363
+ 5 posting asli          62.492.863
= rekonstruksi       12.239.110.739
  oracle             12.239.110.739
  selisih                         0   ← nol rupiah
```

→ **Aturannya benar; berkas oracle yang mendahului koreksi.** Prediksi P2.1, P2.2,
P2.3 semuanya ✅ (Lokal tak berubah oleh syarat "tanpa titik"; awal(D) ≡ akhir(D−1);
Online naik tepat 36.084).

Kontrol yang ikut menyalak: test "oracle digeser satu hari HARUS gagal" ✅ merah
sebagaimana mestinya; guard "KOREKSI nyata di ledger, bukan faktor pengepas"
menuntut kesepuluh baris ber-ID itu benar-benar ada dengan status & selisih yang
disebut — mengarang angka koreksi akan gagal di situ.

## 6. HASIL — armada 7 unit

Dijalankan 2026-08-06, `dtgl <= 2026-08-04`, ketujuh unit sekaligus.

### Dampak per unit

| unit | nama | Lokal lama | Lokal baru | Online lama | Online baru | Δ Online |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | Imam Bonjol | 35.687.985.717 | **sama** | 1.200.000 | 1.200.000 | — |
| 2 | Bakau | 1.598.414.685 | **sama** | 2.333.677 | 2.333.677 | — |
| 3 | Adisucipto | 332.136.624 | **sama** | 0 | 0 | — |
| 4 | Bundaran Kotabaru | 33.400.960.680 | **sama** | 19.034.234 | 19.734.274 | **+700.040** |
| 5 | Batu Layang | 4.187.751.063 | **sama** | 0 | 0 | — |
| 6 | Korek | 17.768.651.736 | **sama** | 450.000 | 450.000 | — |
| 7 | 28 Oktober | 12.239.715.239 | **sama** | 10.760.434 | 10.796.518 | **+36.084** |

**Piutang Lokal tidak berubah di satu unit pun.** Piutang Online berubah di dua unit.

🔎 **Kotabaru terkena defek yang SAMA** — penyebabnya `21.999.0014` HERWIN, SJENIS 4,
bertitik: **kode pelanggan yang persis sama** dengan di 28 Oktober. Jadi perbaikan ini
bukan kalibrasi ke satu sampel; ia memperbaiki dua unit lewat satu akar yang sama.
Kotabaru selama ini juga kurang 700.040 setiap hari.

### Jawaban tiga pertanyaan

- **(a) `bphut` memuat pelanggan bertitik?** → **TIDAK, nol di ketujuh unit.**
  Prediksi ✅ **BENAR**. Kontrol menyalak (pelanggan non-bertitik di `bphut`:
  188/13/2/74/12/2/33 per unit 1–7). → Hutang memang **tanpa** filter; syarat
  `SJENIS {2,3}` + non-bertitik **tidak perlu ditambahkan**, dan tidak ditambahkan.

- **(b) Ada pelanggan BERTITIK ber-SJENIS {1,5} yang BERSALDO?** → **TIDAK ADA,
  nol di ketujuh unit.**
  ❌ **PREDIKSI SAYA SALAH.** Saya memperkirakan "ADA di setidaknya satu unit selain
  28 Oktober". Ternyata di seluruh armada, master bertitik ber-SJENIS {1,5} (EVAN,
  HERWIN, HENDRA SALAM, SALAM GROUP, SALAM ONLINE) semuanya bersaldo **nol**.
  Konsekuensinya justru melegakan: syarat "tanpa titik" pada Lokal **tidak memindahkan
  rupiah satu pun** di unit mana pun — ia murni pagar terhadap masa depan. Tidak ada
  perubahan angka yang perlu dimintakan oracle pembanding.

- **(c) "Titik = online" berlaku di semua unit?** → **Ya; dan tak ada format ketiga.**
  Prediksi ✅ **BENAR**. Klasifikasi kode master per unit — `PLG####` vs bertitik vs
  **lainnya**: unit 1 = 2959/14/**0**, unit 2 = 616/13/**0**, unit 3 = 5/0/**0**,
  unit 4 = 1190/14/**0**, unit 5 = 531/6/**0**, unit 6 = 190/1/**0**, unit 7 = 839/13/**0**.
  Kolom "lainnya" **nol di mana-mana** → diskriminatornya memang biner. Unit 3
  (Adisucipto) tak punya pelanggan bertitik sama sekali — sesuai prediksi, itu bukan
  kegagalan aturan, hanya unit tanpa bisnis online.

## 7. HASIL — biaya query

❌ **P4.1 sempat MERAH, lalu diperbaiki sampai HIJAU.** Dicatat apa adanya karena
inilah gunanya ambang ditulis di muka.

Bentuk CTE yang pertama diimplementasikan, diukur di **unit 4** (927.170 baris
`bppiut` — terberat di armada, sesuai prediksi P4.2 ✅ **BENAR**), interleaved 4×:

| | run 1 | run 2 | run 3 | run 4 | median |
| --- | ---: | ---: | ---: | ---: | ---: |
| LAMA (3 angka, 1 batas) | 1.399 | 1.404 | 1.346 | 1.344 | **1.375 ms** |
| CTE v1 (6 angka, 2 batas) | 1.952 | 2.024 | 2.097 | 2.189 | **2.060 ms** |

Rasio **1,50×** — melewati ambang 1,3× yang disegel. Varian alternatif "enam
subquery terpisah" lebih buruk lagi (2.663–6.967 ms).

`EXPLAIN (ANALYZE)` menunjukkan penyebabnya, dan itu bukan materialisasi CTE:
planner memilih **merge join** dan **menyortir 343.769 baris — 1.798 ms sendirian**.
Bentuk lama lolos dari sortir itu karena `sjenis IN (1,5)` pada INNER JOIN memangkas
sisi master lebih dulu.

Perbaikannya: **prafilter sisi master di dalam subquery join** (`WHERE unit_id = $1
AND sjenis IN (1,5)`), sehingga sisi kanan menyusut dari 1.204 baris jadi puluhan dan
planner beralih ke **hash join**. Semantik identik — `lokal` = "cocok ke master
{1,5}" — dan Online tetap tak bergantung pada master.

| | run 1 | run 2 | run 3 | run 4 | median |
| --- | ---: | ---: | ---: | ---: | ---: |
| LAMA (3 angka, 1 batas) | 1.355 | 1.372 | 1.323 | 1.306 | **1.339 ms** |
| **BARU final (6 angka, 2 batas)** | 1.180 | 1.266 | 1.207 | 1.188 | **1.198 ms** |

Rasio **0,89×** — bentuk baru **lebih cepat dari yang lama** meski menghasilkan dua
kali lipat angka. ✅ P4.1 terpenuhi. Optimasi 104 dtk → 1,47 dtk tidak dikorbankan.

---

# BAGIAN II — Imam Bonjol (unit 1), oracle setara

Disegel **2026-08-06**, sebelum satu pun query IB dijalankan. Append-only.

## 8. Kelayakan masukan & verifikasi oracle

Oracle: **"DAFTAR SALDO HUTANG PIUTANG" IB**, 1–5 Agustus 2026 — laporan **sejenis** dengan
yang dipakai di 28 Oktober (inilah perbaikan metode yang membubarkan kebingungan lama).

Diparse ulang sendiri; tiap sel dikonfirmasi **tiga sumber independen di dalam berkas**:
Σ(DEBET−KREDIT) per baris · baris `TOTAL SALDO …` · blok `Summary`. **Ketiganya cocok di
kelima belas sel.** Jumlah baris: Piutang Lokal 136 · Online 1 · Hutang 191 = **328**, sama
dengan yang disebut owner.

Jebakan parser yang tertangkap (dicatat karena akan terulang): frasa seksi **muncul lagi** di
baris `TOTAL SALDO …` dan di blok `Summary`, sehingga parser 28 Oktober — yang mencocokkan
substring — **me-reset akumulator jadi kosong** dan melaporkan **0 baris di semua seksi**.
Nol yang terlihat seperti "berkas kosong". Ketahuan hanya karena mustahil IB nol.
Perbaikan: header seksi = baris ber-awalan `DAFTAR SALDO` **dan** cocok ke salah satu nama
seksi (baris JUDUL laporan juga berawalan `DAFTAR SALDO` — itu pun sempat menciptakan seksi
hantu `null`).

`sync_state` IB untuk `piutang`/`hutang`/`pelanggan` terisi & mutakhir → masukan layak.

## 9. PREDIKSI — IB, 15 sel (batas AKHIR hari)

| tanggal | Piutang Lokal | Piutang Online | Hutang Lokal |
| --- | ---: | ---: | ---: |
| 2026-08-01 | 35.377.538.927 | 1.200.000 | −770.002.380 |
| 2026-08-02 | 35.476.850.395 | 1.200.000 | −735.869.634 |
| 2026-08-03 | 35.563.341.030 | 1.200.000 | −734.439.355 |
| 2026-08-04 | 35.687.985.717 | 1.200.000 | −751.284.145 |
| 2026-08-05 | 35.770.675.661 | 1.200.000 | −707.071.775 |

**Prediksi utama (P9.0): kelima belas sel EKSAK, tanpa penyesuaian apa pun.** Yakni: formula
IB sudah benar sejak awal dan **tidak ada data yang hilang** — "kehilangan 19,7 miliar" itu
artefak membandingkan ke laporan berjenis lain.

Prediksi turunan:

- **P9.1** — `bppiut` SJENIS{1,5} @27-Jun = 31.933.056.622; oracle @01-Agu = 35.377.538.927.
  Selisih 3.444.482.305 ÷ 35 hari ≈ **98,4 juta/hari**, dan delta harian teramati 01→05 Agu
  ≈ 99,3 / 86,5 / 124,6 / 82,7 juta. Laju tersirat dan teramati **harus tetap sejalan**;
  kalau 15 sel eksak, ini otomatis terpenuhi.
- **P9.2 — kredit Online.** IB Online punya kredit (10.505.841 − 9.305.841 = 1.200.000),
  sedangkan 28 Oktober kreditnya nol. Jalur `sjnsbp=2` pada bucket Online **belum pernah
  tereksekusi** oleh test mana pun. Prediksi: ia benar, dan Online IB mendarat 1.200.000.
  MERAH bila Online IB keluar **10.505.841** → tanda kredit diabaikan pada bucket Online.
- **P9.3 — pecahan ½ rupiah.** Hutang IB memuat 4 pelanggan bernilai `,5`
  (`PLG2067` −653.265,5 · `PLG2068` −6.622.022,5 · `PLG2069` −21.516.390,5 ·
  `PLG2249` +4.100.949,5); totalnya `51.732.360.497,5 − 52.502.362.877,5` = **−770.002.380
  bulat** (pecahannya saling meniadakan). Prediksi: hasil **bulat eksak**, nol selisih.
  MERAH bila muncul ±0,5 atau ±1 → dan bila itu terjadi, **wajib dibuktikan** benign lewat
  kontrol (bandingkan `numeric` vs `float8` di jalur yang sama), bukan disebut "pembulatan"
  karena kecil.
- **P9.4 — aturan bertitik tegak tanpa penyesuaian.** Piutang Lokal IB: 136 pelanggan,
  **0 bertitik**. Online: 1 pelanggan, **1 bertitik** (`18.999.0010`). Hutang: 191, **0
  bertitik**. Prediksi: syarat "tanpa titik" pada Lokal tak memindahkan rupiah di IB, dan
  Online IB murni ditentukan format kode.
- **P9.5 — tanda Hutang.** IB **negatif** (−770 juta), 28 Oktober **positif** (+149 juta).
  Formula yang sama harus menghasilkan keduanya tanpa perlakuan khusus; tanda mengikuti data.
  MERAH bila IB keluar positif → ada pembalikan tanda yang tak semestinya.

### Risiko yang sudah diketahui sebelum dijalankan

Sama seperti sel ke-9 di 28 Oktober: ledger bisa **bergerak setelah oracle diekspor**
(koreksi back-dated). Bila ada sel meleset, **pemeriksaan pertama** bukan menyalahkan aturan
melainkan: (i) apakah aturan LAMA pun mengembalikan angka baru itu, dan (ii) apa kata
`ingested_at`. Baru setelah keduanya bersih, meleset = cacat aturan.

## 10. HASIL — IB 15 sel

Dijalankan 2026-08-06, via `saldo.oracle.integration.test.ts` (implementasi sebenarnya).

### ✅ P9.0 TERKONFIRMASI — 15 dari 15 sel EKSAK, tanpa penyesuaian apa pun

| tanggal | Piutang Lokal | Piutang Online | Hutang Lokal |
| --- | ---: | ---: | ---: |
| 2026-08-01 | 35.377.538.927 ✅ | 1.200.000 ✅ | −770.002.380 ✅ |
| 2026-08-02 | 35.476.850.395 ✅ | 1.200.000 ✅ | −735.869.634 ✅ |
| 2026-08-03 | 35.563.341.030 ✅ | 1.200.000 ✅ | −734.439.355 ✅ |
| 2026-08-04 | 35.687.985.717 ✅ | 1.200.000 ✅ | −751.284.145 ✅ |
| 2026-08-05 | 35.770.675.661 ✅ | 1.200.000 ✅ | −707.071.775 ✅ |

**"IB kehilangan 19,7 miliar" tidak pernah ada.** Formulanya benar sejak awal; yang salah
adalah pembandingnya. Tak satu pun baris data hilang, dan tak ada perbaikan yang diperlukan
untuk IB.

### Rekonsiliasi per-pelanggan — 1.640 titik data, NOL ketidakcocokan

328 pelanggan × 5 tanggal, tiap seksi, toleransi 0,001:

| seksi | n oracle | cocok EKSAK | beda | SJENIS di PG | bertitik |
| --- | ---: | ---: | ---: | --- | --- |
| Piutang Lokal | 136 | 136 | **0** | {5: 36, 1: 23} + 77 bersaldo nol | 0 |
| Piutang Online | 1 | 1 | **0** | {3: 1} | **1** |
| Hutang Lokal | 191 | 191 | **0** | {2: 22, 3: 166} | 0 |

Arah sebaliknya: `bphut` bersaldo yang **tak** ada di oracle = **0**. `bppiut` bersaldo yang
tak ada di oracle = **747** — pelanggan SJENIS 4 non-bertitik yang memang sengaja di luar
laporan, sama persis dengan pola 28 Oktober.

Catat: **SJENIS 2 muncul di buku hutang** (22 pelanggan). Ini menguatkan bahwa hutang memang
**tanpa** filter SJENIS, dan sekaligus menutup sisa keraguan item D3.

### Prediksi turunan

- **P9.1 ✅** — otomatis terpenuhi karena 15 sel eksak; laju ≈98 juta/hari cocok.
- **P9.2 ✅ KREDIT Online tereksekusi.** Online IB: debet 10.505.841 − kredit 9.305.841 =
  1.200.000. Jalur `sjnsbp=2` pada bucket Online — yang **tak pernah tersentuh** di 28
  Oktober (kreditnya nol) — terbukti benar. Kontrol dipasang: kalau kredit diabaikan,
  hasilnya 10.505.841; test menuntut **bukan** angka itu.
- **P9.3 ✅ pecahan ½ rupiah eksak.** Keempatnya cocok ke sen: `PLG2067` −653.265,5 ·
  `PLG2068` −6.622.022,5 · `PLG2069` −21.516.390,5 · `PLG2249` +4.100.949,5; total
  **−770.002.380 bulat** (pecahan saling meniadakan), identik antara `numeric` dan `float8`.
  Kontrol ikut dipasang: test menegaskan keempat nilai itu memang **bukan** bilangan bulat,
  supaya "cocok" tak bisa dicapai oleh pembulatan diam-diam.
- **P9.4 ✅** — Lokal 136 pelanggan, 0 bertitik; Online 1 pelanggan, 1 bertitik; Hutang 191,
  0 bertitik. Aturan tegak tanpa penyesuaian di unit kedua.
- **P9.5 ✅** — Hutang IB **negatif**, 28 Oktober **positif**, dari formula yang sama.

### Temuan sampingan: satu baris ber-residu float (bukan cacat tampilan)

Jumlah `numeric` Piutang Lokal IB keluar `35.377.538.927,00000001`. Sumbernya **satu baris**:
`PP2022100101473` (2022-10-01, `PLG2235`) dengan `njumlah = 73867616.45999999` — jelas
artefak float ganda dari jalur agent (`num(r.NJUMLAH)` JS → JSON → `numeric`), bukan nilai
EasyMax. Nilai aslinya hampir pasti `73.867.616,46`.

**Tidak berdampak pada angka tampil**: jalur asli meng-`cast ::float8`, dan residu 1e-8 jauh
di bawah resolusi double pada magnitudo 3,5e10 → hasilnya `35377538927` bulat, eksak sama
dengan oracle (dibuktikan, bukan diasumsikan). Kontrol: 28 Oktober punya **0** baris semacam
itu. Dicatat sebagai isu kesetiaan data ingest tersendiri — kelas "float JS masuk numeric" —
bukan bagian dari perbaikan ini.

### Kegagalan test yang menyamar sebagai temuan

Test "awal(D) ≡ akhir(D−1)" IB sempat MERAH — ternyata **timeout 5 dtk**, bukan angka:
5 tanggal → 8 query DB live @~0,9 dtk. Invarian itu benar secara aljabar dan tidak mungkin
gagal karena nilai. Timeout dinaikkan ke 60 dtk; sesudahnya hijau. Dicatat karena "merah"
yang sebabnya waktu sangat mudah disalahartikan sebagai cacat data.
