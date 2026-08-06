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

> Menunggu ADC (`gcloud auth application-default login`) dipulihkan owner.
> Belum dijalankan per 2026-08-06.

## 6. HASIL — armada 7 unit

> Menunggu ADC.

## 7. HASIL — biaya query

> Menunggu ADC. Angka pembanding bentuk LAMA yang sudah terukur (unit 7, DB pilot,
> 3× berurutan): **1.185 / 1.124 / 1.064 ms**.
