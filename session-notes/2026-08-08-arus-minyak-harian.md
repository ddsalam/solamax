# Arus Minyak Harian — decision log

Sesi otonom, mulai 2026-08-09. Section baru "Arus Minyak Harian" di Laporan Operasional Harian.
Berkas ini ditulis **sambil jalan**, bukan direkonstruksi. Owner mengaudit SESUDAH.

Unit oracle: Imam Bonjol (kode `6478111`), 6 tanggal 01–06 Agustus 2026.
Oracle sah: blok **ARUS MINYAK** pada "LAPORAN RESUME OPERASIONAL" EasyMax
(`~/Desktop/ArusMinyak/ArusMinyak_IB_0{1..6}Agustus2026.png`).
BUKAN "Laporan Penjualan Harian" (preseden Saldo Hutang/Piutang: oracle beda-definisi
melahirkan hantu selisih).

---

## 1. Ekspektasi tersegel — transkripsi 6 PNG (ditulis SEBELUM SQL apa pun)

Stempel waktu: transkripsi ini diselesaikan sebelum satu pun query dijalankan pada sesi ini.
Kolom, urut apa adanya di EasyMax:
`Awal | Penerimaan | Persediaan | Penjualan | Teori | Fisik | Losses | %`
(kolom **Persediaan** ikut ditranskripsi untuk keperluan pembuktian identitas,
tapi **TIDAK akan dirender** — keputusan owner, final.)

Urutan baris EasyMax: Premium, Pertamax, Solar, P. Turbo, Pertalite, Dexlite, Pertamina Dex, Total.

### 01-08-2026
| Bahan Bakar | Awal | Penerimaan | Persediaan | Penjualan | Teori | Fisik | Losses | % |
|---|---|---|---|---|---|---|---|---|
| Premium | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| Pertamax | 13.981,84 | 8.000,00 | 21.981,84 | 2.650,35 | 19.331,49 | 19.145,08 | -186,41 | -7,03 |
| Solar | 2.122,45 | 24.000,00 | 26.122,45 | 22.280,63 | 3.841,82 | 4.080,56 | 238,74 | 1,07 |
| P. Turbo | 5.702,87 | 0,00 | 5.702,87 | 178,92 | 5.523,95 | 5.534,63 | 10,68 | 5,97 |
| Pertalite | 21.598,26 | 16.000,00 | 37.598,26 | 20.070,91 | 17.527,35 | 17.692,40 | 165,05 | 0,82 |
| Dexlite | 15.357,23 | 0,00 | 15.357,23 | 3.731,45 | 11.625,78 | 11.675,79 | 50,01 | 1,34 |
| Pertamina Dex | 9.628,00 | 8.000,00 | 17.628,00 | 5.167,57 | 12.460,43 | 9.740,66 | -2.719,77 | -52,63 |
| **Total** | 68.390,65 | 56.000,00 | 124.390,65 | 54.079,83 | 70.310,82 | 67.869,12 | -2.441,70 | -4,51 |

### 02-08-2026
| Bahan Bakar | Awal | Penerimaan | Persediaan | Penjualan | Teori | Fisik | Losses | % |
|---|---|---|---|---|---|---|---|---|
| Premium | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| Pertamax | 19.145,08 | 8.000,00 | 27.145,08 | 8.852,38 | 18.292,70 | 18.253,20 | -39,50 | -0,45 |
| Solar | 4.080,56 | 24.000,00 | 28.080,56 | 15.896,76 | 12.183,80 | 12.315,45 | 131,65 | 0,83 |
| P. Turbo | 5.534,63 | 0,00 | 5.534,63 | 94,68 | 5.439,95 | 5.446,29 | 6,34 | 6,70 |
| Pertalite | 17.692,40 | 24.000,00 | 41.692,40 | 20.383,49 | 21.308,91 | 21.411,04 | 102,13 | 0,50 |
| Dexlite | 11.675,79 | 8.000,00 | 19.675,79 | 3.801,75 | 15.874,04 | 15.824,79 | -49,25 | -1,30 |
| Pertamina Dex | 9.740,66 | 8.000,00 | 17.740,66 | 3.879,98 | 13.860,68 | 13.860,68 | 0,00 | 0,00 |
| **Total** | 67.869,12 | 72.000,00 | 139.869,12 | 52.909,68 | 86.960,08 | 87.111,45 | 151,37 | 0,29 |

### 03-08-2026
| Bahan Bakar | Awal | Penerimaan | Persediaan | Penjualan | Teori | Fisik | Losses | % |
|---|---|---|---|---|---|---|---|---|
| Premium | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| Pertamax | 18.253,20 | 8.000,00 | 26.253,20 | 9.167,34 | 17.085,86 | 16.983,85 | -102,01 | -1,11 |
| Solar | 12.315,45 | 24.000,00 | 36.315,45 | 34.024,29 | 2.291,16 | 2.712,12 | 420,96 | 1,24 |
| P. Turbo | 5.446,29 | 0,00 | 5.446,29 | 60,99 | 5.385,30 | 5.388,62 | 3,32 | 5,44 |
| Pertalite | 21.411,04 | 16.000,00 | 37.411,04 | 21.542,86 | 15.868,18 | 16.112,68 | 244,50 | 1,13 |
| Dexlite | 15.824,79 | 0,00 | 15.824,79 | 3.470,27 | 12.354,52 | 12.321,03 | -33,49 | -0,97 |
| Pertamina Dex | 13.860,68 | 0,00 | 13.860,68 | 10.745,24 | 3.115,44 | 3.115,44 | 0,00 | 0,00 |
| **Total** | 87.111,45 | 48.000,00 | 135.111,45 | 79.010,99 | 56.100,46 | 56.633,74 | 533,28 | 0,67 |

### 04-08-2026
| Bahan Bakar | Awal | Penerimaan | Persediaan | Penjualan | Teori | Fisik | Losses | % |
|---|---|---|---|---|---|---|---|---|
| Premium | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| Pertamax | 16.983,85 | 8.000,00 | 24.983,85 | 3.191,14 | 21.792,71 | 21.713,07 | -79,64 | -2,50 |
| Solar | 2.712,12 | 16.000,00 | 18.712,12 | 12.167,89 | 6.544,23 | 6.750,38 | 206,15 | 1,69 |
| P. Turbo | 5.388,62 | 0,00 | 5.388,62 | 64,69 | 5.323,93 | 5.331,65 | 7,72 | 11,93 |
| Pertalite | 16.112,68 | 24.000,00 | 40.112,68 | 22.857,04 | 17.255,64 | 16.806,80 | -448,84 | -1,96 |
| Dexlite | 12.321,03 | 8.000,00 | 20.321,03 | 4.777,94 | 15.543,09 | 15.564,36 | 21,27 | 0,45 |
| Pertamina Dex | 3.115,44 | 8.000,00 | 11.115,44 | 2.024,63 | 9.090,81 | 9.090,81 | 0,00 | 0,00 |
| **Total** | 56.633,74 | 64.000,00 | 120.633,74 | 45.083,33 | 75.550,41 | 75.257,07 | -293,34 | -0,65 |

### 05-08-2026
| Bahan Bakar | Awal | Penerimaan | Persediaan | Penjualan | Teori | Fisik | Losses | % |
|---|---|---|---|---|---|---|---|---|
| Premium | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| Pertamax | 21.713,07 | 0,00 | 21.713,07 | 3.109,72 | 18.603,35 | 18.685,01 | 81,66 | 2,63 |
| Solar | 6.750,38 | 24.000,00 | 30.750,38 | 27.142,81 | 3.607,57 | 3.930,38 | 322,81 | 1,19 |
| P. Turbo | 5.331,65 | 0,00 | 5.331,65 | 172,51 | 5.159,14 | 5.167,93 | 8,79 | 5,10 |
| Pertalite | 16.806,80 | 16.000,00 | 32.806,80 | 20.223,03 | 12.583,77 | 12.834,83 | 251,06 | 1,24 |
| Dexlite | 15.564,36 | 0,00 | 15.564,36 | 5.108,36 | 10.456,00 | 10.498,83 | 42,83 | 0,84 |
| Pertamina Dex | 9.090,81 | 8.000,00 | 17.090,81 | 8.777,81 | 8.313,00 | 2.766,43 | -5.546,57 | -63,19 |
| **Total** | 75.257,07 | 48.000,00 | 123.257,07 | 64.534,24 | 58.722,83 | 53.883,41 | -4.839,42 | -7,50 |

### 06-08-2026
| Bahan Bakar | Awal | Penerimaan | Persediaan | Penjualan | Teori | Fisik | Losses | % |
|---|---|---|---|---|---|---|---|---|
| Premium | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| Pertamax | 18.685,01 | 8.000,00 | 26.685,01 | 2.859,71 | 23.825,30 | 23.635,74 | -189,56 | -6,63 |
| Solar | 3.930,38 | 16.000,00 | 19.930,38 | 12.433,15 | 7.497,23 | 7.550,50 | 53,27 | 0,43 |
| P. Turbo | 5.167,93 | 0,00 | 5.167,93 | 113,56 | 5.054,37 | 5.060,54 | 6,17 | 5,43 |
| Pertalite | 12.834,83 | 24.000,00 | 36.834,83 | 23.422,46 | 13.412,37 | 13.219,91 | -192,46 | -0,82 |
| Dexlite | 10.498,83 | 8.000,00 | 18.498,83 | 6.742,22 | 11.756,61 | 11.738,93 | -17,68 | -0,26 |
| Pertamina Dex | 2.766,43 | 8.000,00 | 10.766,43 | 3.003,39 | 7.763,04 | 13.310,00 | 5.546,96 | 184,69 |
| **Total** | 53.883,41 | 64.000,00 | 117.883,41 | 48.574,49 | 69.308,92 | 74.515,62 | 5.206,70 | 10,72 |

### 1b. Identitas yang sudah TERBUKTI dari gambar saja (tanpa DB)

Diperiksa manual di seluruh 6×7 baris produk + 6 baris Total:

- **Persediaan = Awal + Penerimaan** (persis, semua sel). Ini yang membuat kolom Persediaan
  redundan secara informasi — mendukung keputusan owner untuk tidak merendernya.
- **Teori = Awal + Penerimaan − Penjualan** = Persediaan − Penjualan (persis, semua sel).
- **Losses = Fisik − Teori** (persis, semua sel).
- **% = Losses / Penjualan × 100**, dibulatkan 2 desimal. Bukan Losses/Persediaan.
  Bukti pemisah paling tajam — 04 Agu P. Turbo: 7,72/64,69 = 11,93 % ✓
  (kalau /Persediaan → 7,72/5.388,62 = 0,14 ✗). Dan 06 Agu P. Dex: 5.546,96/3.003,39 = 184,69 ✓
  (angka >100 % mustahil bila penyebutnya Persediaan).
- **Penjualan = 0 → % = 0,00** (bukan NaN/∞/—). Semua baris Premium, 6 tanggal. Baris Premium
  memang seluruhnya nol, jadi kasus "Losses ≠ 0 sementara Penjualan = 0" TIDAK terwakili di
  oracle → penanganannya jadi keputusan kita (lihat **D-9**).
- **Baris Total** = penjumlahan kolom apa adanya; **% Total = ΣLosses / ΣPenjualan**, bukan
  rata-rata persen. Bukti: 01 Agu −2.441,70/54.079,83 = −4,514 → −4,51 ✓ (rata-rata dari
  ketujuh persen = −7,49, jauh berbeda).
- **Rantai carry-in** (fisik hari-N = awal hari-N+1): berlaku persis untuk ketujuh produk pada
  kelima transisi 01→02→03→04→05→06. Konsekuensi: verifikasi 01 Agu menuntut opname 31 Juli.
- **Premium** tampil dengan seluruh nol pada keenam tanggal → baris berasal dari master produk,
  bukan dari produk yang bertransaksi. (akan dikonfirmasi ke DB)

### 1c. Anomali yang sudah terlihat di oracle (wajib dijelaskan, bukan dihaluskan)

- **Pertamina Dex 05 Agu Losses −5.546,57 lalu 06 Agu +5.546,96** — nyaris berkebalikan, beda
  0,39 L. Berbau opname/penerimaan yang tercatat di hari yang salah.
- P. Dex punya **Losses tepat 0,00** pada 02, 03, 04 Agu — Fisik = Teori persis. Mencurigakan:
  berbau opname yang tidak diinput sehingga sistem memakai teori sebagai fisik, atau fisik
  memang di-copy dari teori.
- 01 Agu P. Dex Losses −2.719,77 (−52,63 %) — juga besar.

---

## 2. Keputusan

(diisi sambil jalan; format: **D-n** — pilihan / alternatif / bukti pemutus / apa yang membatalkan)

### D-1 — Oracle sah = blok ARUS MINYAK "LAPORAN RESUME OPERASIONAL"
- **Pilihan**: hanya keenam PNG itu yang jadi wasit.
- **Alternatif**: memakai "Laporan Penjualan Harian" atau angka G/L RESUME dashboard sebagai acuan.
- **Bukti pemutus**: preseden Saldo Hutang/Piutang (CLAUDE.md) — oracle mirip-tapi-beda-definisi
  melahirkan selisih hantu 19,7 miliar. Instruksi owner juga menyebut ini eksplisit.
- **Membatalkannya**: bukti bahwa blok ARUS MINYAK sendiri yang cacat (mis. tidak konsisten
  dengan dirinya sendiri). Sudah diuji di §1b — konsisten sempurna secara aritmetika.

### D-2 — Kolom Persediaan tidak dirender
- **Pilihan**: 7 kolom (Produk + 7 numerik), tanpa Persediaan.
- **Alternatif**: ikut 8 kolom EasyMax.
- **Bukti pemutus**: keputusan owner, final, eksplisit di brief. Diperkuat §1b:
  Persediaan = Awal + Penerimaan, jadi nol informasi baru.
- **Membatalkannya**: hanya instruksi owner berikutnya.

### D-3 — 🔑 Penjualan = jual KOTOR − tera RESMI (cabang **(b)**), jadi Losses ≡ `gl`
- **Pilihan**: `Penjualan = sales_gross − tera` → `Losses` identik `DailyGlRow.gl`; section ini
  MENGURAI G/L RESUME yang sudah dipakai papan direksi & PDF, bukan angka baru.
- **Alternatif (a)**: `Penjualan = sales_gross` → `Losses = gl + tera`, angka BARU yang berbeda
  dari G/L di panel tepat di atasnya pada halaman yang sama.
- **Bukti pemutus — ORACLE, bukan selera.** Di seluruh rentang oracle hanya ADA SATU sel dengan
  `tera ≠ 0`: **2 Agu 2026, Dexlite, tera 0,64 L** (`terra_resmi`). Terukur di DB pilot:
  `sales_gross = 3.802,39`. Oracle mencetak `Penjualan = 3.801,75` = 3.802,39 − 0,64 → **(b)**.
  Dikonfirmasi sel KEDUA yang bebas: `Teori` oracle 15.874,04 = 19.675,79 − 3.801,75
  (dengan kotor seharusnya 15.873,40). Kedua sel dibaca ulang pada perbesaran 3× (crop PNG)
  karena inilah satu-satunya sel yang memutuskan.
  Sapuan 336 sel: cabang **(a) → 6 MISMATCH**, cabang **(b) → 0** (selain D-5).
- **Membatalkannya**: satu hari dengan tera besar yang justru cocok dengan kotor. Bukti berlawanan
  akan tampak sebagai MISMATCH di `arus-minyak.render.test.tsx` (yang menyimpan ekspektasi 6 hari).
- **Konsekuensi ke §6 daftar eskalasi butir 2**: G/L RESUME yang sudah dipakai **TIDAK** terbukti
  keliru — justru sebaliknya, oracle mengonfirmasinya. Tidak ada yang perlu dihentikan.

### D-4 — Pakai ulang `getDailyGlByProduct`, tanpa query baru
- **Pilihan**: section memakai `glRows` yang SUDAH ditarik halaman Laporan (satu fetch
  bulan-berjalan), difilter `d === date`. Nol query tambahan, nol beban DB tambahan,
  `GL_LOOKBACK_DAYS`/cache G/L tak tersentuh.
- **Alternatif**: query sendiri per-tanggal. Ditolak: menduplikasi definisi `fisik`/garbage-guard/
  jendela celah — dua definisi yang bisa menyimpang diam-diam, persis kelas kesalahan yang paling
  mahal di proyek ini.
- **Bukti pemutus**: D-3. Karena Losses ≡ `gl`, query terpisah akan menghitung ulang angka yang
  sama; satu-satunya hasilnya adalah risiko divergensi.
- **Membatalkannya**: kalau kelak Arus Minyak butuh komponen yang tak ada di `DailyGlRow`.
- **Biaya yang diterima**: baris = produk yang punya opname PENUTUP hari itu (lihat D-6).

### D-5 — ⚠️ TOTAL Penjualan = jumlah kolom (SENGAJA beda dari oracle, 1 sel)
- **Temuan**: laporan EasyMax **tidak konsisten dengan dirinya sendiri**. 2 Agu, kolom Penjualan
  per-produk bersih-tera (Σ = 52.909,04) tetapi baris TOTAL mencetak **52.909,68** = Σ KOTOR.
  Selisih 0,64 L = tera. (TOTAL `Teori` 86.960,08 tetap = Σ Teori per-produk, jadi memang
  hanya sel Penjualan yang diambil dari sumber lain.)
- **Pilihan**: TOTAL selalu = jumlah kolom yang tercetak → 52.909,04.
- **Alternatif**: meniru EasyMax → TOTAL yang tidak sama dengan jumlah kolom di atasnya.
- **Alasan**: dashboard pengawasan kepatuhan yang barisnya tak menjumlah akan dilaporkan sebagai
  bug oleh pemakai pertama yang menjumlahkannya, dan membela "EasyMax juga begitu" lebih mahal
  daripada selisih 0,64 L pada 1 dari 6 hari. Fidelitas dilanggar sekali, TERCATAT, dan dijaga
  sebagai pengecualian BERNAMA di tes (`DEVIASI_SAH`) — bukan sebagai toleransi umum: kalau
  muncul di sel lain tes tetap MERAH.
- **Membatalkannya**: instruksi owner untuk cermin-sempurna EasyMax.

### D-6 — Baris = produk yang punya opname PENUTUP hari itu (hipotesis "dari master" GUGUR)
- **Yang ditanyakan owner**: "Premium tampil seluruh-nol → barisnya dari master `product`.
  Konfirmasi." → **TIDAK terkonfirmasi.**
- **Bukti**: master `product` unit 1 punya **8** baris (BB-01…BB-08). Oracle mencetak **7** —
  memuat PREMIUM (BB-01, seluruh nol) tapi **membuang BIO SOLAR (BB-05)**. Jadi baris oracle
  bukan "dari master" dan juga bukan "yang bertransaksi"; tampaknya daftar TETAP di dalam
  laporan EasyMax (label pun beda dari master: "P. Turbo" vs `PERTAMAX TURBO`).
- **Pilihan**: baris digerakkan data = produk dengan opname penutup pada tanggal-bisnis itu
  (persis himpunan baris `getDailyGlByProduct`). Di IB → 6 baris.
- **Alternatif ditolak**: (i) meniru daftar tetap 7 slot — **salah untuk unit lain**: BB-01
  benar-benar HIDUP sampai 2021 di unit 2/4/5/6/7 (mis. unit 4: 51.264 baris jual 2011–2018), jadi
  daftar tetap ala-IB akan salah-nama/salah-hilang di sana, dan tanggal historis akan rusak;
  (ii) seluruh master 8 baris — menambah DUA baris mati permanen di setiap unit setiap hari
  (BB-01 & BB-05 nol sejak 2021), persis jenis kebisingan yang membuat owner membuang kolom
  Persediaan.
- **Akibat yang diukur, bukan dihaluskan**: 42 sel (baris PREMIUM × 6 hari) ADA di oracle dan
  TIDAK ADA di SolaMax. Semuanya nol → **TOTAL tidak berubah satu digit pun**. Tes menegaskan ini
  eksplisit: baris yang absen hanya sah bila SELURUH sel oracle-nya nol; kalau tidak → MISMATCH.
- **Membatalkannya**: owner ingin baris mati tetap tercetak demi cermin-sempurna.

### D-7 — Urutan produk = `orderBy` halaman ini, bukan urutan EasyMax
- **Pilihan**: Pertalite → Pertamax → P. Turbo → Solar → Dexlite → Pertamina Dex
  (`CLASS_RULES.order`, `config.ts`) — sama dengan panel Omset/G-L, Target, dan Harga di halaman
  yang sama.
- **Alternatif**: urutan EasyMax (Premium, Pertamax, Solar, P. Turbo, **Pertalite, Dexlite**,
  P. Dex) — perhatikan Pertalite mendahului Dexlite, jadi urutan itu bukan urutan kode `ckdbbm`
  dan tak bisa diturunkan dari data mana pun yang kita punya; ia harus di-hardcode.
- **Alasan**: pembaca membanding-bandingkan panel dalam SATU halaman jauh lebih sering daripada
  membandingkan baris-per-baris dengan cetakan EasyMax; urutan yang berbeda-beda antar-panel di
  satu halaman adalah beban kognitif tiap hari. Nilai selnya sendiri tidak berubah.
- **Membatalkannya**: owner meletakkan cetakan EasyMax berdampingan dengan layar sebagai
  prosedur harian.

### D-8 — Masuk ekspor PDF
- **Pilihan**: ikut, duduk di antara Alokasi/DO dan Harga (sama dengan layar), hanya pada mode
  **Lengkap** seperti section detail tetangganya.
- **Alasan**: sumbernya `LaporanModel` yang sama, jadi PDF & layar tak bisa menyimpang; section
  tetangga kiri-kanannya sudah ada di PDF — absennya justru akan terbaca sebagai cacat.
- **Membatalkannya**: keluhan panjang PDF.

### D-9 — % saat Penjualan = 0
- **Pilihan**: `Losses = 0` → cetak **0,00** (persis perilaku oracle di baris Premium);
  `Losses ≠ 0` → **"—"** dengan tooltip "rasio tak terdefinisi".
- **Alternatif**: selalu 0,00 (meniru oracle secara membuta).
- **Alasan**: oracle HANYA pernah memperlihatkan kasus Penjualan 0 **bersamaan** Losses 0, jadi
  tidak ada perilaku yang wajib ditiru untuk kasus satunya; dan "0,00 %" di sebelah Losses −500 L
  adalah pernyataan yang aktif SALAH ("tidak ada losses").
- **Membatalkannya**: ditemukan cetakan EasyMax dengan Penjualan 0 & Losses ≠ 0 yang mencetak 0,00.

### D-10 — Komponen terpisah `<ArusMinyakSection>`, bukan JSX inline
- **Pilihan**: satu-satunya section Laporan yang diekstrak jadi komponen.
- **Alasan**: itulah yang membuat syarat verifikasi "#4 baca dari DOM yang dirender" bisa
  dipenuhi tanpa menyentuh token sesi — harness merender KOMPONEN PRODUKSI yang sama.
  Halaman `/unit/[code]/laporan/[date]` terkunci Google OAuth (sesi DB); mengambil
  `sessionToken` dari DB untuk membuka halaman = menangani kredensial → tidak dilakukan.
  Preseden yang sama sudah ada: `harian.render.test.tsx`.
- **Alternatif**: JSX inline + assert model saja → pembanding membandingkan kode dengan dirinya
  sendiri. Ditolak.

### D-11 — Debu float dinormalkan di FORMATTER, bukan di perhitungan
- `num2()` memetakan |x| < 0,005 → 0. Losses lahir dari pengurangan berantai, jadi selisih sah 0
  bisa muncul sebagai −1,8e−12 dan tercetak "−0,00" — terbaca sebagai kerugian kecil padahal nol.
  Angka yang dihitung TIDAK dibulatkan (biar identitas tetap eksak); hanya tampilannya.

---

## 3. Verifikasi

### 3.1 Hasil 336 sel — IB, 1–6 Agustus 2026

Dibaca dari **HTML hasil render `<ArusMinyakSection>`** (bukan dari fungsi query), lewat
`buildLaporanModel` — `arus-minyak.render.test.tsx`.

| Vonis | Sel | Keterangan |
| --- | ---: | --- |
| **EKSAK** (≤ 0,005 L / 0,005 %) | **293** | seluruh 6 produk × 7 kolom × 6 hari + TOTAL |
| **DEVIASI SAH** (bernama) | **1** | 2 Agu TOTAL Penjualan — D-5, Δ 0,64 L |
| **ABSEN ≡ NOL** | **42** | baris PREMIUM × 6 hari — D-6; seluruh sel oracle-nya nol, TOTAL tak berubah |
| **MISMATCH** | **0** | — |
| total | **336** | |

Tidak ada sel berkategori "beda-pembulatan": yang cocok, cocok **eksak**.

### 3.2 Uji MERAH — pembanding sudah dibuktikan bisa gagal

Setiap pembanding dijalankan dalam keadaan sengaja dirusak, lalu dipulihkan:

| # | Yang dirusak | Hasil |
| --- | --- | --- |
| 1 | ekspektasi 1 sel (Solar 3 Agu Losses 420,96 → 421,96) | MISMATCH 1, tes MERAH |
| 2 | komponen: kolom Teori merender Fisik | MISMATCH 33, tes MERAH |
| 3 | `arus-minyak.ts`: % memakai Persediaan sbg penyebut | 2 tes MERAH |
| 4 | `arus-minyak.ts`: Penjualan = kotor (cabang a) | 2 tes MERAH |
| 5 | `arus-minyak.ts`: % TOTAL = rata-rata persen | 1 tes MERAH |
| 6 | PDF: `arusSection` dicabut dari perakitan | 3 tes MERAH |
| 7 | PDF: kolom Persediaan ditambahkan | 1 tes MERAH |
| — | dipulihkan | 16/16 HIJAU |

Kontrol tambahan yang harus tetap bisa berbunyi: harness lintas-unit meng-assert
`got.size > 1` — nol baris tidak boleh lolos sebagai "lulus".

### 3.3 Rantai carry-in — DARI DATA, bukan dari gambar

`fisik(hari-N) === fisik_prev(hari-N+1)`, dicek langsung pada baris DB:
**30/30 pasangan** cocok (6 produk × 5 transisi 01→02→…→06), toleransi 1e−6.
Verifikasi 1 Agu memang menuntut opname 31 Juli — anchor-nya ADA (`fisik_prev` 1 Agu terisi
untuk keenam produk, `provisional = false`).

### 3.4 Anomali Pertamina Dex 5–6 Agustus — sebabnya, bukan penghalusannya

Oracle: 5 Agu Losses **−5.546,57**, 6 Agu **+5.546,96** (beda 0,39 L). SolaMax mereproduksi
keduanya persis. Baris mentah T-05 (satu-satunya tangki P. Dex):

| dtaglopn | opname diambil | NSTOCKOP |
| --- | --- | ---: |
| 2026-08-04 | 05 Agu 06:02 | 9.090,81 |
| 2026-08-05 | 06 Agu 06:11 | **2.766,43** |
| 2026-08-06 | 07 Agu 06:32 | 13.310,00 |

Penerimaan 8.000 L/hari (05 Agu 23:33, 06 Agu 20:22); penjualan 8.777,81 lalu 3.003,39.

**Sebab: SATU pembacaan opname penutup 5 Agu yang salah (terlalu rendah ±5.546,6 L), bukan
kehilangan minyak.** Yang membuktikannya: agregat DUA hari bersih —
`13.310,00 − [9.090,81 + 16.000 − (8.777,81 + 3.003,39)] = **+0,39 L**` untuk dua hari penuh,
yaitu G/L normal. Kalau minyak benar-benar hilang 5.546 L lalu "kembali", dua-hari tidak akan
menutup ke 0,39 L. Kesalahan pembacaan membalik sendiri di hari berikutnya — itulah tanda
tangannya.

Konteks pendukung (tidak dipakai sbg bukti utama): baris opname ~21:00 pada 04/05/06 Agu
ketiganya bernilai **tepat 9.628,00** — angka yang juga muncul sebagai `NVOLREAL` dua
pengiriman. Nilai konstan berulang = besar dugaan sesi itu diisi dari angka DO, bukan dari
tongkat ukur. Baris-baris itu **tidak** menyentuh perhitungan (bukan penutup), tapi menjelaskan
mengapa pembacaan pagi bisa meleset.

**Ini BUKAN regresi & bukan hal baru**: angka yang sama sudah tampil di panel "Omset Penjualan,
Gain (Losses) & Tera" hari ini (Losses ≡ `gl`). Section baru hanya membuat komponennya kelihatan.

### 3.5 Sanity lintas-unit (akurasi TIDAK diklaim)

Adisucipto `6478101` (kelas DTGLJAM NULL-by-default, tanpa ATG) dan 28 Oktober `63781002`
(kode POS 8 digit, tenant terpisah), tanggal 2026-08-06. Diperiksa pada **angka yang tercetak**:
render jadi & baris > 1; `Teori = Awal + Penerimaan − Penjualan`; `Losses = Fisik − Teori`;
`% = Losses/Penjualan`; TOTAL = jumlah tiap kolom; tak ada stok negatif / ≥ 200.000 L.
Semua lulus. **Akurasi terhadap cetakan EasyMax unit-unit itu belum diverifikasi** — tidak ada
oracle PNG-nya.

### 3.6 Pemeriksaan mata

`arus-minyak.render.test.tsx` menulis `/tmp/arus-minyak-render.html` (CSS produksi disematkan);
di-screenshot pada 1400 px lewat Chrome headless. Urutan kolom sesuai permintaan, TOTAL di
tempatnya, tanpa kolom Persediaan, angka tak terpotong / tak pecah baris, Losses negatif merah
& positif hijau.

---

# PUTARAN KONFIRMASI (2026-08-10) — pengerasan bukti

Owner menahan merge sampai putaran ini bersih. Bukan revisi: tiga titik bukti yang
masih tipis + satu koreksi.

## K-0 — KOREKSI yang diterima: "CI hijau" adalah klaim yang salah

Laporan sebelumnya menulis "CI hijau" setelah membaca `gh pr checks` SEKALI, tepat
sesudah push, sebelum semua workflow selesai terpicu. Yang sebenarnya: workflow
**`arsip` MERAH** (PR menyentuh `session-notes/` → menuntut label `arsip-siklus-kedua`
dari owner), status PR **UNSTABLE**.

**Aturan tetap sejak sekarang: jangan pernah menulis klaim agregat tentang CI.**
Sebutkan SETIAP workflow dengan namanya + kesimpulannya, satu baris masing-masing,
dari `gh pr checks`. Klaim agregat menyembunyikan tepat kelas kegagalan ini — satu
workflow merah di antara yang hijau.

## K-1 — §2 UJI MERAH: penilai bisa membedakan "absen karena nol" dari "absen karena hilang"

Kekhawatiran owner: 42 sel diskor cocok PADAHAL tak ada yang diperiksa.

**Dijalankan lebih dulu, sebelum apa pun yang lain.** Baris **SOLAR** (oracle jelas
bukan nol) dibuang dari keluaran render, harness dijalankan:

```
ARUS MINYAK vs ORACLE — EKSAK 251 · DEVIASI SAH 1 · ABSEN≡NOL 42 · MISMATCH 42
  2026-08-01 | SOLAR | Awal | oracle 2122.45 | ABSEN
  … (7 kolom × 6 tanggal)
```

`ABSEN≡NOL` **tetap 42** (hanya PREMIUM) dan 42 sel SOLAR masuk **MISMATCH**. Penilai
tidak menghijaukan ketiadaan.

**Tapi mutasi manual bukan penjaga.** Diskriminasi itu sekarang dipindah ke modul
murni [`arus-minyak.grade.ts`](../apps/dashboard/src/lib/arus-minyak.grade.ts) dan
diuji **tanpa DB, di setiap commit** (`arus-minyak.test.ts`, 6 tes baru): absen-nol →
`absen_nol`; absen-bukan-nol → `mismatch`; **satu** sel 0,01 sudah cukup untuk
mismatch; tanggal yang hilang seluruhnya → mismatch; deviasi bernama hanya sah pada
NILAI yang ditentukan (bukan pintu belakang); sel "—" tidak dihitung cocok dengan 0.

Uji merah penjaganya sendiri: `seluruhNol = true` → 3 tes MERAH · deviasi jadi
"apa pun boleh" → 1 tes MERAH · dipulihkan → hijau.

## K-2 — §3 baris TOTAL 2 Agustus, sel per sel

| kolom | oracle | SolaMax | selisih | Σ kolom oracle sendiri |
|---|---:|---:|---:|---:|
| Awal | 67.869,12 | 67.869,12 | 0,00 | 67.869,12 |
| Penerimaan | 72.000,00 | 72.000,00 | 0,00 | 72.000,00 |
| Persediaan | 139.869,12 | *(tak dirender)* | — | 139.869,12 |
| **Penjualan** | **52.909,68** | **52.909,04** | **−0,64** | **52.909,04** ← TOTAL ≠ Σ kolomnya |
| Teori | 86.960,08 | 86.960,08 | 0,00 | 86.960,08 |
| Fisik | 87.111,45 | 87.111,45 | 0,00 | 87.111,45 |
| Losses | 151,37 | 151,37 | 0,00 | 151,37 |
| % | 0,29 | 0,29 | 0,00 | — |

**Tetap SATU sel** yang menyimpang. Angka 293/1 tidak berubah.

**Mekanismenya** (hipotesis owner "TOTAL Teori = ΣPersediaan − ΣPenjualan" **GUGUR**):

| sel TOTAL oracle | kandidat (a) Σ kolom per-produk | kandidat (b) turunan baris TOTAL |
|---|---|---|
| Teori 86.960,08 | **86.960,08 COCOK** | ΣPersediaan − TOTAL Penjualan = 86.959,44 ✗ (Δ −0,64) |
| Losses 151,37 | 151,37 COCOK | TOTAL Fisik − TOTAL Teori = 151,37 COCOK (tak membedakan) |
| Persediaan 139.869,12 | 139.869,12 COCOK | TOTAL Awal + TOTAL Penerimaan = COCOK (tak membedakan) |
| Penjualan 52.909,68 | 52.909,04 ✗ | **Σ jual KOTOR = 52.909,68 COCOK** |

Jadi baris TOTAL EasyMax adalah **penjumlahan kolom per-produk untuk SETIAP kolom**,
kecuali **Penjualan** yang sendirian diambil dari angka jual KOTOR. Karena Teori dan
Losses dijumlah dari kolomnya sendiri — bukan diturunkan dari TOTAL Penjualan —
inkonsistensinya **terkurung di satu sel**. Itu sebabnya ia tidak merambat.

⚠️ **Kejujuran soal kolom %**: ia cocok, tapi bukan bukti.
151,37/52.909,68 = 0,286091 dan 151,37/52.909,04 = 0,286095 — **keduanya tampil 0,29**.
Kolom % TIDAK MAMPU membedakan kotor dari bersih pada presisi 2 desimal; kecocokannya
kebetulan pembulatan, bukan konstruksi.

## K-3 — §1 cabang (b): dari n=1 menjadi argumen yang tak lagi bergantung padanya

**(a) Tera di IB bukan peristiwa langka.** Sapuan seluruh riwayat `terra_resmi`:
**340 hari** ber-tera (2022-09-02 … 2026-08-02), total 31.423,77 L, hari terbesar
1.537,90 L. Rentang oracle 1–6 Agu kebetulan hanya memuat satu tera kecil (0,64 L) —
itu properti JENDELA-nya, bukan properti fenomenanya.

Tanggal yang PALING BERGUNA bila owner bisa mengekspor RESUME EasyMax-nya:

| prioritas | tanggal | tera hari itu | kenapa |
|---|---|---:|---|
| 1 | **2026-02-10** | 283,00 L (10 baris) | hari ber-tera terbesar di 2026 — era & format laporan sama; magnitudo ±440× sel penentu sekarang |
| 2 | **2025-11-21** | 1.000,00 L, SATU produk (Dexlite) | pembeda terbersih: selisih kotor-vs-bersih terlihat di SATU baris, tanpa penjumlahan |
| 3 | 2026-02-02 | 220,00 L | cadangan 2026 |

**(b) Lintas unit**: tera rutin di **6 dari 7** unit — 28 Oktober 378 hari (hari
terbesar 4.703 L), Bundaran Kotabaru 621 hari (3.471 L), Korek 226 (3.502 L),
Batu Layang 224 (2.200 L), Bakau 201 (1.047 L), IB 340 (1.538 L).
**Adisucipto: nol baris `terra_resmi`** — di sana cabang (a) dan (b) identik, jadi
unit itu tak bisa dipakai membedakan.

**(c) ARGUMEN PEWARISAN — SAH, dengan batas yang dinamai.**

*Rantai 1 — kode tak bisa berperilaku per-unit.* Bukan hasil grep melainkan
**tanda tangan tipe**: `buildArusMinyak(glRows: DailyGlRow[])` **tidak menerima unit
sama sekali**, begitu pula `<ArusMinyakSection arus={…}>`. Sesuatu yang tak pernah
menerima unit tak bisa bercabang atasnya. Grep memastikan tak ada jalan belakang:
nol kemunculan `6478|6378|unitCode|unit_id|switch` di kedua berkas. Di
`laporan-model.ts` sambungannya satu baris tanpa cabang, dan `getDailyGlByProduct`
memakai unit hanya sebagai parameter SQL terikat `$1`. Ambang (`GARBAGE_*`) dan urutan
(`CLASS_RULES`) global & berbasis NAMA produk.

*Rantai 2 — Losses ≡ `gl` adalah identitas*, bukan kebetulan numerik: substitusi
Teori ke Losses memberi `fisik − (fisik_prev + pen_do − (sales_gross − tera))`, persis
ekspresi `gl`. Dijaga tes pada 1e−6.

*Rantai 3 — `gl` sudah pernah diadu dengan EasyMax untuk KETUJUH unit.* Gold-check
[`laporan-harian-goldcheck-preregistration.md`](laporan-harian-goldcheck-preregistration.md)
(Juli 2026): **G/L harian 178/196 sel cocok** (7 unit × 7 produk × 4 hari, 19–22 Jul).
Melesetnya terkarakterisasi: terbesar 28 Oktober 22 Jul (−10.202) **sebab penutup
opname T-05 tercatat 0 — SolaMax benar terhadap sumbernya**; dua lainnya justru
**PDF acuan yang salah** (Dexlite ⇄ Pertalite tertukar di AS 21 Jul, dibuktikan tiga
pembacaan independen); sisanya 5–160 L.

**Kesimpulan**: akurasi Arus Minyak di unit non-IB **bukan lagi lubang menganga** —
kolom **Losses** mewarisi verifikasi lintas-7-unit itu lewat rantai kode yang terbukti
unit-agnostik.

**Batas yang TETAP terbuka, dinamai:** gold-check Juli mengadu **nilai `gl`**, bukan
komponennya. Sepasang galat yang saling menghapus di dalam `gl` (mis. `fisik_prev`
terlalu tinggi dan `pen_do` terlalu rendah sebesar sama) akan meninggalkan Losses benar
sementara kolom **Stock Awal / Penerimaan / Stock Fisik** salah di layar. Untuk
non-IB, keempat kolom penguraian itu belum pernah diadu satu-per-satu dengan EasyMax.
Yang MENYEMPITKAN risiko itu: volume jual per-produk per-unit MEMANG ikut diadu di
gold-check yang sama (kelas cacat E4/E5 lahir dari sana), jadi kolom Penjualan
sebagian tertutup.

## K-4 — §4 PDF dibuka dengan mata (bukan `docDefinition`)

PDF sungguhan dibuat lewat pdfmake dari data live, IB 2 & 6 Agu, lalu dirender jadi
gambar dan dilihat. Perkakasnya dijadikan **tes ber-gerbang**
([`laporan-doc.pdf-eye.test.ts`](../apps/dashboard/src/lib/export/laporan-doc.pdf-eye.test.ts))
alih-alih skrip lepas — skrip `.mts` di `scripts/` TIDAK ikut ter-typecheck
(`tsconfig` hanya menyapu `**/*.ts`), jadi ia akan membusuk diam-diam.

Yang terlihat: **posisi benar** (Alokasi/DO → **Arus Minyak** → Harga Jual) · 8 kolom
urut sesuai permintaan, tanpa Persediaan · angka rata kanan, tak terpotong, tak pecah
baris (termasuk `184,69` dan `5.546,96`) · baris TOTAL utuh dengan latar · warna
merah/hijau bertahan ke PDF · TOTAL Penjualan tercetak **52.909,04** (deviasi D-5
terlihat di berkas akhir).

**Yang ditemukan HANYA dengan melihat:** tabelnya **terbelah di batas halaman 2→3**.
Baris header berulang (`headerRows: 1` bekerja) tapi **judul section tidak** — pembaca
di halaman 3 melihat tabel tanpa judul. Diperiksa apakah ini bawaan dokumen atau
bawaan section baru: **halaman 2 pun sudah dibuka oleh lanjutan tabel tanpa judul**
dari section sebelumnya. Jadi ini **pola dokumen yang sudah ada**, bukan yang saya
bawa. Tidak diubah — memberi `unbreakable` hanya pada section ini justru membuatnya
menyimpang sendiri. Dicatat sebagai usul terpisah.

## K-5 — §5 lintas unit: satu temuan yang lebih penting dari screenshot-nya

Dirender & dilihat: Adisucipto `6478101` dan 28 Oktober `63781002`, masing-masing
2026-08-06 (hari selesai) dan 2026-08-09 (hari berjalan → penanda "belum final").

🔴 **TEMUAN — PENUTUP-NOL tampil sebagai kerugian raksasa.**
Adisucipto 2026-08-09: seluruh kolom Stock Fisik **0,00**, sehingga Losses
−24.993 / −8.079 / −8.570 / −12.490 / −5.009 dan % sampai **−10.222,45**.
Sebabnya pasti (baris mentah): sesi opname **21:36:03** mencatat `NSTOCKOP = 0` untuk
SEMUA tangki padahal `NSTOCKBK` wajar (8.497 / 8.079 / 24.912 / 12.817 / 5.009), dan
sesi itulah yang terakhir → jadi penutup.

**Ini bukan formula Arus Minyak dan bukan regresi** — `gl` yang sama sudah tampil di
panel "Omset Penjualan, Gain (Losses) & Tera" hari ini. Tapi Arus Minyak
**memamerkannya**: satu kolom penuh nol.

**Fenomenanya sudah dikenal DAN sudah punya detektor tertala**: `getZeroClosingEvents`
(aturan v2 dengan syarat DO, diukur 12 bulan × 7 unit) — **terpasang di
`/laporan-harian` & feed anomali, TIDAK terpasang di halaman Laporan per-unit.**

**Kasus yang paling berbahaya bukan hari berjalan.** Diverifikasi pada kejadian
historis dari gold-check (28 Oktober, 22 Juli): di sana penutup-nol hanya mengenai
SATU tangki dari dua tangki produk yang sama, jadi hasilnya bukan 0 melainkan
**19.254,70 (kurang ±10.000 L)** — dan `provisional = FALSE`. Artinya penutup-nol pada
hari yang sudah selesai tampil sebagai angka **final dan meyakinkan**, tanpa penanda.

**Tidak saya perbaiki di putaran ini** (mengubah angkanya akan memutus `Losses ≡ gl`
— fondasi argumen pewarisan K-3c, dan menyentuh semantik G/L bersama).
**Usul ke owner**: sambungkan `getZeroClosingEvents` ke halaman Laporan dan tandai
produk terdampak di KEDUA panel sekaligus. Keputusan owner.

**Harness-nya sendiri terbukti buta pada kelas ini**: pemeriksaan "nilai mustahil"
memakai `>= 0`, dan **0 memang >= 0**. Sudah diperbaiki — harness kini mendeteksi
`awal > 1.000 ∧ fisik = 0`, mencetak daftarnya, dan menuntut baris seperti itu
TIDAK tampil final. Uji merahnya: `provisional: false` dipaksa → tes MERAH.

Sisanya bersih: identitas berlaku pada angka yang TERCETAK di keempat render, TOTAL =
jumlah kolom, tak ada stok negatif/≥200.000 L, tak ada NaN.

Catatan: `excludedTanks` **tak pernah tersentuh data 2026** (sapuan 7 unit: nol hari
dengan baris di luar batas wajar), jadi jalur itu dikunci tes komponen
(`ArusMinyakSection.test.tsx`), bukan pemeriksaan mata.

## K-6 — §6 higiene secret

**Rotasi DITUNDA — keputusan owner 2026-08-10**, alasan: transkrip tidak meninggalkan
mesin owner. Dicatat sebagai utang terbuka di vault. Tidak ada secret yang dirotasi.

**Pemicu yang MEMBATALKAN penundaan** (salah satu cukup):
1. transkrip sesi tersinkron/terunggah ke mana pun di luar mesin ini;
2. mesin berpindah tangan / dipinjamkan / diservis;
3. OAuth consent naik dari **Testing** ke **Published**.

**Sapuan jejak** — 7 nilai (AUTH_SECRET, AUTH_GOOGLE_SECRET, db-app/ro/ingest/postgres,
agent-api-key) dicari sebagai substring; skrip penyapunya hanya mencetak PANJANG,
tak pernah nilai:

| artefak | hasil |
|---|---|
| diff `origin/staging...HEAD` | BERSIH |
| isi commit branch | BERSIH |
| pesan commit | BERSIH |
| `session-notes/2026-08-08-arus-minyak-harian.md` | BERSIH |
| badan + judul PR #253 | BERSIH |
| komentar & review PR #253 | BERSIH |
| memory `solamax-arus-minyak.md` + `MEMORY.md` | BERSIH |
| 24 berkas kerja scratchpad | BERSIH |
| `/tmp/arus-minyak-*.html` | BERSIH |

**Aturan permanen: JANGAN PERNAH mencetak isi `.env.local`.** Untuk memastikan sebuah
key ada, uji **keberadaan/panjangnya**, bukan nilainya — persis pola skrip sapuan ini.

## K-7 — §7 baris digerakkan data: KEPUTUSAN OWNER, nol perubahan kode

Dipertahankan apa adanya. Alasannya (analisis BIO SOLAR yang menggugurkan hipotesis
"baris dari master `product`") tetap di **D-6**. Konsekuensi yang membuat K-1 wajib:
karena baris nol memang sengaja absen, penilai HARUS bisa membedakan absen-karena-nol
dari absen-karena-hilang — itulah yang kini dijaga di setiap commit.

## Keputusan baru putaran ini

### D-12 — Tabel Arus Minyak dibiarkan boleh terbelah antar-halaman PDF
- **Bukti pemutus**: halaman 2 dokumen yang sama sudah dibuka lanjutan tabel tanpa
  judul dari section lain → memberi `unbreakable` hanya di sini membuatnya menyimpang.
- **Membatalkannya**: keputusan menyeluruh untuk semua section PDF sekaligus.

### D-13 — Penutup-nol TIDAK ditambal di Arus Minyak
- **Alternatif**: menampilkan "—" saat `fisik = 0 ∧ awal > 1.000`.
- **Alasan**: itu memutus `Losses ≡ gl` — dua panel di satu halaman jadi berbeda, dan
  argumen pewarisan K-3c runtuh. Perbaikan yang benar ada di HULU (`getZeroClosingEvents`
  disambungkan) dan berlaku untuk kedua panel.
- **Membatalkannya**: owner memilih menyambungkan detektor itu.

### D-14 — Perkakas pemeriksaan mata = tes ber-gerbang, bukan skrip `.mts`
- **Bukti pemutus**: `tsconfig.include` = `**/*.ts` → `.mts` tak pernah ter-typecheck.
