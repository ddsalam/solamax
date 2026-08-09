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

---

# PUTARAN 3 (2026-08-10)

## P3-0 — ORACLE KEDUA: 21 November 2025 (tera 1.000 L) — TERSEGEL SEBELUM QUERY

Berkas `~/Desktop/ArusMinyak/ArusMinyak_IB_21November2025.png` sudah ada saat putaran ini
dimulai. Transkripsi di bawah ditulis **sebelum** satu pun query tentang tanggal ini
dijalankan. (Yang sudah diketahui lebih dulu hanyalah `terra_resmi`: 1.000,00 L pada
Dexlite — itu yang membuat owner memilih tanggal ini. Nilai sel laporannya belum pernah
dilihat.)

| Bahan Bakar | Awal | Penerimaan | Persediaan | Penjualan | Teori | Fisik | Losses | % |
|---|---|---|---|---|---|---|---|---|
| Premium | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 | 0,00 |
| Pertamax | 21.857,98 | 0,00 | 21.857,98 | 2.228,96 | 19.629,02 | 19.658,07 | 29,05 | 1,30 |
| Solar | 17.126,28 | 16.000,00 | 33.126,28 | 29.151,78 | 3.974,50 | 4.529,13 | 554,63 | 1,90 |
| P. Turbo | 5.184,48 | 0,00 | 5.184,48 | 260,80 | 4.923,68 | 4.944,65 | 20,97 | 8,04 |
| Pertalite | 25.756,15 | 16.000,00 | 41.756,15 | 19.942,27 | 21.813,88 | 22.080,17 | 266,29 | 1,34 |
| **Dexlite** | 12.901,22 | 8.000,00 | 20.901,22 | **10.142,88** | 10.758,34 | 10.920,69 | 162,35 | 1,46 |
| Pertamina Dex | 6.348,55 | 8.000,00 | 14.348,55 | 7.176,37 | 7.172,18 | 6.952,36 | -219,82 | -3,06 |
| **Total** | 89.174,66 | 48.000,00 | 137.174,66 | **69.903,06** | 68.271,60 | 69.085,07 | 813,47 | **1,16** |

### Prediksi yang disegel (sebelum query)

1. **Cabang (b) benar** → `sales_gross` Dexlite 21 Nov 2025 = 10.142,88 + 1.000,00 =
   **11.142,88**. Kalau ternyata 10.142,88, cabang (b) SALAH dan seluruh section harus
   ditinjau ulang.
2. **Deviasi TOTAL berulang, kini 1.563× lebih besar.** Σ kolom Penjualan yang tercetak
   = 68.903,06, sedangkan TOTAL tercetak 69.903,06 → selisih **tepat 1.000,00** = tera.
   Mekanisme K-2 (TOTAL Penjualan diambil dari jual KOTOR) berlaku ulang.
3. **⚠️ KOLOM % KINI IKUT MENYIMPANG — dan itu MEMPERBAIKI pemahaman K-2.**
   813,47/69.903,06 = 1,1637 → **1,16** (yang dicetak oracle);
   813,47/68.903,06 = 1,1806 → **1,18** (yang akan dihitung SolaMax).
   Di 2 Agu kedua penyebut membulat ke 0,29 sehingga kolom % tak bisa membedakan; di
   sini ia bisa, dan jawabannya: **% TOTAL EasyMax memakai penyebut KOTOR juga.**
   Jadi baris TOTAL EasyMax = jumlah kolom untuk setiap kolom KECUALI Penjualan (kotor),
   dan % mewarisi angka kotor itu. → **DUA sel menyimpang** pada tanggal ini, akar sama.
4. Teori TOTAL = 68.271,60 = Σ kolom Teori; kalau diturunkan dari Persediaan − TOTAL
   Penjualan hasilnya 67.271,60 (meleset 1.000) → konfirmasi ketiga mekanisme K-2.

## P3-1 🔴 CACAT NYATA yang ditangkap oracle kedua — rumus % SALAH

Oracle 21 Nov 2025 tidak sekadar mengonfirmasi cabang (b); ia **menemukan cacat** yang
lolos 336 sel selama dua putaran.

**Verifikasi ke DB lebih dulu** (jangan percaya PNG begitu saja): `terra_resmi` Dexlite IB
21-11-2025 = **1000** tepat (1 baris, tanpa ekor desimal), jual kotor = **11142.88**
(18 baris), dan Dexlite adalah SATU-SATUNYA produk ber-tera hari itu. Bacaan owner
terkonfirmasi.

### Enumerasi lengkap: sel mana yang bisa membedakan kotor vs bersih?

Dari **56 sel**, **8** berbeda antara kedua konvensi. Vonis oracle per sel:

| baris | kolom | bersih | kotor | oracle | ikut |
|---|---|---:|---:|---:|---|
| DEXLITE | Penjualan | 10.142,88 | 11.142,88 | 10.142,88 | **BERSIH** |
| DEXLITE | Teori | 10.758,34 | 9.758,34 | 10.758,34 | **BERSIH** |
| DEXLITE | Losses | 162,35 | 1.162,35 | 162,35 | **BERSIH** |
| DEXLITE | **%** | 1,60 | 10,43 | **1,46** | **TIDAK KEDUANYA** |
| TOTAL | **Penjualan** | 68.903,06 | 69.903,06 | **69.903,06** | **KOTOR** |
| TOTAL | Teori | 68.271,60 | 67.271,60 | 68.271,60 | **BERSIH** |
| TOTAL | Losses | 813,47 | 1.813,47 | 813,47 | **BERSIH** |
| TOTAL | **%** | 1,18 | 2,59 | **1,16** | **TIDAK KEDUANYA** |

48 sel yang TIDAK terdiskriminasi: **cocok semua, meleset 0** → tak ada salah lain
bersembunyi. Ini jawaban §0.5: sel yang berbeda hanya delapan, tiga di antaranya salah
di implementasi lama, dan **tak ada yang keempat**.

Kedua sel "TIDAK KEDUANYA" bukan misteri: keduanya **Losses BERSIH di atas penyebut
KOTOR** — 162,35/11.142,88 = 1,46 dan 813,47/69.903,06 = 1,16.

### Aturan lengkap (kini dikodekan)

> EasyMax mengurangkan tera **di kolom**, tidak di **dua turunan**:
> **TOTAL Penjualan** dan **penyebut %** (per baris maupun TOTAL) memakai jual KOTOR.
> Semua yang lain — Penjualan, Teori, Losses, per baris maupun di TOTAL — bersih-tera.

Konsekuensi yang diterima owner: tabel **sengaja tidak menjumlah dirinya sendiri** pada
kolom Penjualan di hari ber-tera → **catatan kaki wajib**, menyebut liter teranya, di
layar DAN di PDF.

### Uji merah terbersih dari seluruh proyek ini

Bukan mutasi buatan — cacat nyata, oracle nyata. Implementasi LAMA vs oracle 21-11:

```
ARUS MINYAK vs ORACLE — EKSAK 339 · DEVIASI SAH 1 · ABSEN≡NOL 49 · MISMATCH 3 (total 392)
2025-11-21 | DEXLITE | %         | oracle 1.46     | render 1.6
2025-11-21 | TOTAL   | Penjualan | oracle 69903.06 | render 68903.06
2025-11-21 | TOTAL   | %         | oracle 1.16     | render 1.18
```

Persis tiga sel yang diprediksi enumerasi. Setelah diperbaiki: **MISMATCH 0**.

### 🎓 PELAJARAN — beri nama: **HIJAU KARENA JENDELANYA BUTA**

Sepupu langsung dari [[bukti-harus-bisa-merah]], dan lebih licin darinya.

336 sel LULUS selama dua putaran dengan rumus % yang salah. Bukan karena penilaiannya
lemah — penilaiannya justru diperketat di putaran 2 — melainkan karena **rentang datanya
tak mampu membedakan hipotesis yang benar dari yang salah**. Tera di jendela Agustus
maksimum 0,64 L; pada besaran itu kedua penyebut membulat ke angka yang sama di
SETIAP sel. Pemeriksaannya sempurna; yang buta adalah datanya.

Yang menyelamatkan: **kalimat yang ditulis sendiri di K-2** — *"kolom % cocok TAPI bukan
bukti; 0,286091 vs 0,286095, keduanya tampil 0,29"*. Peringatan itu ditulis sebagai
kejujuran, lalu owner memakainya sebagai petunjuk untuk memilih tanggal yang bisa
membedakan. **Mencatat batas daya-beda sebuah pemeriksaan ternyata lebih berharga
daripada hasil pemeriksaannya.**

Aturan yang dibawa keluar: **saat sebuah pemeriksaan HIJAU, tanyakan "berapa besar
perbedaan yang MAMPU ia lihat?"** Kalau jawabannya lebih besar dari efek yang sedang
diuji, hijau itu tidak berarti apa-apa. Cari data yang membuat kedua hipotesis berbeda
**lebih besar dari presisi tampilan**, atau nyatakan pemeriksaan itu tak berdaya.

## P3-2 — D-5 PENSIUN

Deviasi bernama "TOTAL Penjualan 2 Agu" **dihapus**, bukan disimpan sebagai catatan
sejarah. Ia lahir dari kesimpulan yang salah: bahwa EasyMax tidak konsisten dengan
dirinya sendiri. Ternyata itu **definisinya** — TOTAL Penjualan memang kotor. Setelah
dicerminkan, SolaMax cocok persis dan daftar deviasi KOSONG. Angka Agustus naik dari
293 EKSAK + 1 deviasi → **294 EKSAK + 0 deviasi**.

Mekanisme deviasi-bernama tetap ada di `arus-minyak.grade.ts` dan tetap diuji — yang
hilang hanya isinya.

## P3-3 — BADGE penutup-nol (perubahan kode kedua; NOL perubahan angka)

`getZeroClosingEvents` disambungkan ke halaman Laporan → `LaporanRaw.zeroClosing` →
`buildArusMinyak`. `getDailyGlByProduct` TIDAK disentuh; `Losses ≡ gl` tetap hijau 1e−6.

**Dua kelas, sebab dua kelas memang ada:**
- **kelas 2** — detektor tertala (op=0 ∧ prev>1.000 ∧ next>1.000 ∧ ΣDO besok < next).
  Inilah yang berbahaya: pada hari SELESAI ia bisa mengenai sebagian tangki saja →
  angkanya bukan nol, hanya kurang ±10.000 L, dan `provisional = FALSE`.
- **kelas 1** — penutup 0 pada hari yang belum punya jangkar hari-berikutnya, sehingga
  aturan tertala belum bisa menyala sama sekali (terbukti: query pada jendela
  01–09 Agu mengembalikan **0 baris** untuk Adisucipto). Dikenali dari `fisik = 0 ∧
  Teori > 1.000` — syarat Teori penting supaya tangki yang memang terjual habis
  (Teori ≈ 0) tidak ikut tertandai.

Tanpa kelas 1, badge hanya menyala pada yang sudah kelihatan. Tanpa kelas 2, ia
melewatkan yang justru menipu.

**Bukti PASANGAN** (menyala DAN padam):

| kasus | hasil |
|---|---|
| 28 Oktober 2026-07-22 (kelas 2, `provisional=FALSE`) | **MENYALA**, tangki T-05, Losses −10.199,73 |
| Adisucipto 2026-08-09 (kelas 1) | **MENYALA**, 5 produk |
| **7 tanggal oracle bersih** (6 Agu 2026 + 21 Nov 2025) | **PADAM**, `zeroClosingCount = 0` |

Uji merah: jalur kelas 2 dimatikan → 1 tes MERAH · jalur kelas 1 dimatikan → 1 tes
MERAH · badge dibuat selalu menyala → 2 tes MERAH (termasuk tes PADAM).

Teksnya menyebut **tindakan**: "Ralat opname hari itu di EasyMax, lalu muat ulang" —
dan pada kelas 2 menyebut nomor tangkinya, karena di situlah ralatnya dilakukan.
Ikut tercetak di PDF (blok PERINGATAN + penanda `[opname 0]` pada nama produk).

## P3-4 — §3 celah komponen: MENYEMPIT, tidak tertutup

Diperiksa langsung di berkas gold-check, bukan diasumsikan:

| komponen | bukti lintas-unit | status |
|---|---|---|
| **Penjualan** (`sales_gross`) | `laporan-harian-goldcheck-preregistration.md` **B4**: rincian per-produk harian 7 unit × 7 produk — **56/56 eksak** (19 Jul) & **56/56** (20 Jul); 52/56 pada 21 Jul, keempat selisihnya **cacat PDF acuan** (E4, dibuktikan tiga pembacaan independen) | **TERTUTUP** |
| **Losses** (`gl`) | G/L harian **178/196 sel**, 7 unit × 4 hari | **TERTUTUP** |
| **Penerimaan** (`pen_do`) | dicari di seluruh `session-notes/` — tak ada gold-check yang mengadu volume penerimaan per produk per unit dgn EasyMax. Yang ada (`do-sisa-bakau/LEDGER.md`) membandingkan **Sisa DO per-SO** lewat popup F12 — besaran LAIN | **TERBUKA** |
| **Stock Fisik / Awal** | tak ada gold-check stok/opname/RECAP sama sekali | **TERBUKA** |

**Jangan mengarang jembatan** — tapi ada penyempitan yang SAH dan bisa dinyatakan:
identitas `Losses = Fisik − (Awal + Penerimaan − Penjualan)` dengan Losses dan Penjualan
sudah terverifikasi mengikat kombinasi `Fisik − Awal − Penerimaan`. Ditambah rantai
carry-in `Awal(N) = Fisik(N−1)` (terbukti dari data: 30/30 di jendela oracle, 0
pelanggaran di 120 hari), Awal bukan lagi derajat kebebasan terpisah. **Sisa risiko yang
tepat: `Fisik` dan `Penerimaan` sama-sama salah dengan besaran yang sama dan konsisten.**
Itu sempit, tapi bukan nol — dan tidak akan tertutup tanpa gold-check komponen.

## P3-5 — §4 sapuan konsistensi internal, 120 hari IB

`2026-04-09 … 2026-08-06` · **120 hari · 720 baris · 0 pelanggaran.**
Diperiksa: identitas Teori & Losses tiap baris; rantai carry-in tak putus tanpa penanda;
Awal/Fisik tak mustahil (<0 atau ≥200.000). Dua baris ber-|%|>1.000 —
**23 Jun & 21 Jul, Pertamina Dex** — bukan pelanggaran melainkan **penyebut kecil**:
jual 666,67 & 555,25 L melawan penerimaan 8.000 L (keluarga yang sama dengan anomali
5–6 Agu: kiriman tak tercermin di pembacaan penutup).

**CATATAN METODE — batas yang salah dibuang, bukan datanya.** Percobaan pertama memakai
"|Losses| ≤ Awal + Penerimaan" dan menyala **9×** pada data yang sah. Batas itu keliru:
ia hanya berlaku pada arah RUGI (dan di sana vakum, tersirat oleh Fisik ≥ 0), sedangkan
arah UNTUNG memang boleh melebihinya (tangki terisi lebih dari yang terbuku). Yang
diperbaiki adalah pemeriksaannya.

**Batas sapuan ini, disebut sendiri:** nol pelanggaran atas 120 hari **BUKAN** bukti
akurasi. P3-1 baru saja memperagakan kenapa — rumus % yang salah akan melewati sapuan
ini tanpa satu pun pelanggaran, sebab ia SALAH SECARA KONSISTEN. Sapuan ini hanya
menangkap kerusakan struktural.

## P3-6 — §6 `excludedTanks`

Nol hari di seluruh data 2026 lintas 7 unit. Tidak ada data yang dikarang untuk
menyalakannya. Cabang itu terkunci **tes komponen** (`ArusMinyakSection.test.tsx`) dan
**belum pernah dilihat mata pada data nyata** — batas yang jujur, bukan kegagalan.

## Keputusan putaran 3

### D-15 — Cermin EasyMax pada % & TOTAL Penjualan, + catatan kaki wajib
- **Pilihan**: penyebut % kotor; TOTAL Penjualan kotor; kolom Penjualan tetap bersih.
- **Alternatif**: tetap konsisten-internal (semua bersih) dan menyatakan oracle salah.
- **Bukti pemutus**: 8 sel terdiskriminasi 21-11, oracle memilih kotor di tepat dua
  turunan; 48 sel lain cocok → oracle konsisten dengan dirinya, kitalah yang salah.
- **Membatalkannya**: hari ber-tera lain yang memperlihatkan pola berbeda.

### D-16 — Badge dua kelas, bukan satu
- **Bukti pemutus**: detektor tertala mengembalikan **0 baris** untuk hari berjalan
  (butuh jangkar hari-berikutnya) — satu kelas saja meninggalkan lubang di sisi yang
  justru paling sering dilihat pengawas (hari ini).
- **Membatalkannya**: perbaikan hulu yang mengoreksi angka → badge kelas 1 jadi mubazir.

---

# PUTARAN 4 — verifikasi armada (2026-08-10)

## P4-0 — PRASYARAT: backfill diperiksa SEBELUM menyegel (pelajaran 28 Oktober)

🔴 **TEMUAN: domain `terra_resmi` TIDAK tersinkron untuk Adisucipto (unit 3).**
Ia ada di 6 unit lain. Akibatnya `tera = 0` di ADIS bukan FAKTA melainkan
KETIADAAN DATA — dan itu justru salah satu kolom yang sedang diuji. Tabel `tera`
MENTAH punya 17 baris di ADIS (2025-12-29 … 2026-05-21, terbesar 518,45 L
Pertalite 30 Des), jadi tera memang TERJADI di sana.

**Batas dampaknya**: tak ada satu pun kejadian tera ADIS di jendela 1–8 Agustus
2026 → oracle ADIS Agustus TETAP SAH untuk menguji Penerimaan/Fisik/Awal.
Yang TIDAK bisa diuji dari ADIS: konvensi tera. Di luar Agustus, G/L & Arus
Minyak ADIS pada 12 tanggal itu berpotensi salah — dilaporkan sebagai temuan
terpisah, BUKAN diperbaiki di sini (menyentuh domain sync = pekerjaan agent).

Domain lain yang tak lengkap (konteks, tak menyentuh Arus Minyak):
`cash` absen di unit 3 & 5; `deposit`/`realtank` absen di unit 3.
Ketujuh unit: 8/8 hari opname untuk 1–8 Agustus; sinkron terakhir ±02:00 WIB 10 Agu.

## P4-1 — Daftar belanja: 3 unit yang oracle-nya BELUM ada

Kriteria berurut: tera terbesar · bukan hari penutup-nol · `provisional=FALSE` ·
penerimaan ≠ 0 · ada opname H−1 (jangkar Stock Awal) · tanpa baris garbage.
Ketiganya memenuhi SELURUH kriteria — tak ada trade-off yang perlu ditawar.

| unit | kode SPBU | tanggal usul | tera (L) | penerimaan (L) | alasan | berkas yang diharapkan |
|---|---|---|---:|---:|---|---|
| Bakau | 6378301 | **2026-03-04** | 789,10 | 16.000,00 | tera terbesar 2026 di unit ini; 6× lipat dari yang menemukan cacat % | `ArusMinyak_BAKAU_04MARET2026.png` |
| Batu Layang | 6478201 | **2026-02-13** | 421,31 | 53.000,00 | tera terbesar 2026; penerimaan terbesar dari semua kandidat → menguji kolom Penerimaan paling keras | `ArusMinyak_BL_13FEBRUARI2026.png` |
| Korek | 6478311 | **2026-04-30** | 660,63 | 28.000,00 | tera terbesar 2026 di unit ini | `ArusMinyak_KOREK_30APRIL2026.png` |

Adisucipto TIDAK masuk daftar ini: oracle-nya sudah diberikan (1–8 Agustus), dan
karena `terra_resmi`-nya tak tersinkron, tanggal ber-tera di sana tak akan
mengadu konvensi tera melainkan hanya memperlihatkan gap sinkronnya.

## P4-2 — Oracle yang SUDAH diberikan owner (belum dibuka saat segel ditulis)

| unit | kode | tanggal | jumlah berkas |
|---|---|---|---:|
| 28 Oktober | 63781002 | 1–8 Agustus 2026 | 8 |
| Adisucipto | 6478101 | 1–8 Agustus 2026 | 8 |
| Bundaran Kotabaru | 6478106 | 7–8 Agustus 2026 | 2 |

**18 unit-tanggal.** Nama berkasnya dibaca dari `ls`; ISI PNG belum disentuh.

## P4-3 — PREDIKSI TERSEGEL

Dihasilkan `arus-minyak.prediksi.test.ts` dari jalur PRODUKSI `buildArusMinyak`,
ditulis SEBELUM satu pun PNG dibuka. 21 unit-tanggal (18 yang oracle-nya ada +
3 usulan daftar belanja). Status backfill ikut tersegel di kepala berkasnya.

<details><summary>Isi segel (jangan dibaca sebelum membandingkan)</summary>

## Prasyarat backfill (tersegel bersama prediksi)

| unit | kode | domain ter-sync | sync terakhir |
|---|---|---:|---|
| Imam Bonjol | 6478111 | 0/14 | null |
| Bakau | 6378301 | 0/14 | null |
| Adisucipto | 6478101 | 0/14 | null |
| Bundaran Kotabaru | 6478106 | 0/14 | null |
| Batu Layang | 6478201 | 0/14 | null |
| Korek | 6478311 | 0/14 | null |
| 28 Oktober | 63781002 | 0/14 | null |

### 28 Oktober (63781002) — 2026-08-01
tera hari ini **0,00 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 28.298,49 | 0,00 | 1.544,04 | 26.754,45 | 26.765,29 | 10,84 | 0,70 |
| SOLAR | 7.764,38 | 16.000,00 | 21.242,88 | 2.521,50 | 2.687,86 | 166,36 | 0,78 |
| PERTAMAX TURBO | 7.878,49 | 0,00 | 199,91 | 7.678,58 | 7.685,33 | 6,75 | 3,38 |
| DEXLITE | 26.565,83 | 0,00 | 2.338,70 | 24.227,13 | 24.238,83 | 11,70 | 0,50 |
| PERTALITE | 23.140,28 | 24.000,00 | 20.908,53 | 26.231,75 | 26.585,82 | 354,07 | 1,69 |
| PERTAMINA DEX | 9.036,26 | 0,00 | 5.269,52 | 3.766,74 | 3.896,46 | 129,72 | 2,46 |
| TOTAL | 102.683,73 | 40.000,00 | 51.503,58 | 91.180,15 | 91.859,59 | 679,44 | 1,32 |

### Adisucipto (6478101) — 2026-08-01
tera hari ini **0,00 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 10.089,00 | 0,00 | 206,00 | 9.883,00 | 9.857,00 | -26,00 | -12,62 |
| SOLAR | 8.055,00 | 8.000,00 | 8.367,00 | 7.688,00 | 7.703,00 | 15,00 | 0,18 |
| DEXLITE | 15.724,00 | 0,00 | 2.644,00 | 13.080,00 | 14.082,00 | 1.002,00 | 37,90 |
| PERTALITE | 18.831,00 | 8.000,00 | 8.183,00 | 18.648,00 | 18.585,00 | -63,00 | -0,77 |
| PERTAMINA DEX | 6.688,00 | 0,00 | 134,00 | 6.554,00 | 6.554,00 | 0,00 | 0,00 |
| TOTAL | 59.387,00 | 16.000,00 | 19.534,00 | 55.853,00 | 56.781,00 | 928,00 | 4,75 |

### 28 Oktober (63781002) — 2026-08-02
tera hari ini **0,00 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 26.765,29 | 0,00 | 1.459,27 | 25.306,02 | 25.325,04 | 19,02 | 1,30 |
| SOLAR | 2.687,86 | 24.000,00 | 8.421,40 | 18.266,46 | 18.316,88 | 50,42 | 0,60 |
| PERTAMAX TURBO | 7.685,33 | 0,00 | 102,58 | 7.582,75 | 7.587,89 | 5,14 | 5,01 |
| DEXLITE | 24.238,83 | 0,00 | 2.790,68 | 21.448,15 | 21.556,13 | 107,98 | 3,87 |
| PERTALITE | 26.585,82 | 24.000,00 | 20.107,22 | 30.478,60 | 30.565,73 | 87,13 | 0,43 |
| PERTAMINA DEX | 3.896,46 | 8.000,00 | 2.308,23 | 9.588,23 | 9.552,03 | -36,20 | -1,57 |
| TOTAL | 91.859,59 | 56.000,00 | 35.189,38 | 112.670,21 | 112.903,70 | 233,49 | 0,66 |

### Adisucipto (6478101) — 2026-08-02
tera hari ini **0,00 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 9.857,00 | 0,00 | 190,00 | 9.667,00 | 9.652,00 | -15,00 | -7,89 |
| SOLAR | 7.703,00 | 8.000,00 | 7.765,00 | 7.938,00 | 7.915,00 | -23,00 | -0,30 |
| DEXLITE | 14.082,00 | 0,00 | 1.956,00 | 12.126,00 | 12.108,00 | -18,00 | -0,92 |
| PERTALITE | 18.585,00 | 8.000,00 | 7.570,00 | 19.015,00 | 18.962,00 | -53,00 | -0,70 |
| PERTAMINA DEX | 6.554,00 | 0,00 | 125,00 | 6.429,00 | 6.425,00 | -4,00 | -3,20 |
| TOTAL | 56.781,00 | 16.000,00 | 17.606,00 | 55.175,00 | 55.062,00 | -113,00 | -0,64 |

### 28 Oktober (63781002) — 2026-08-03
tera hari ini **0,00 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 25.325,04 | 0,00 | 1.376,20 | 23.948,84 | 23.968,57 | 19,73 | 1,43 |
| SOLAR | 18.316,88 | 16.000,00 | 26.045,60 | 8.271,28 | 8.566,27 | 294,99 | 1,13 |
| PERTAMAX TURBO | 7.587,89 | 0,00 | 116,51 | 7.471,38 | 7.473,45 | 2,07 | 1,78 |
| DEXLITE | 21.556,13 | 8.000,00 | 2.855,57 | 26.700,56 | 26.662,77 | -37,79 | -1,32 |
| PERTALITE | 30.565,73 | 16.000,00 | 20.339,78 | 26.225,95 | 26.373,66 | 147,71 | 0,73 |
| PERTAMINA DEX | 9.552,03 | 0,00 | 6.288,50 | 3.263,53 | 3.417,38 | 153,85 | 2,45 |
| TOTAL | 112.903,70 | 40.000,00 | 57.022,16 | 95.881,54 | 96.462,10 | 580,56 | 1,02 |

### Adisucipto (6478101) — 2026-08-03
tera hari ini **0,00 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 9.652,00 | 0,00 | 238,00 | 9.414,00 | 9.396,00 | -18,00 | -7,56 |
| SOLAR | 7.915,00 | 16.000,00 | 11.044,00 | 12.871,00 | 12.877,00 | 6,00 | 0,05 |
| DEXLITE | 12.108,00 | 0,00 | 3.652,00 | 8.456,00 | 8.437,00 | -19,00 | -0,52 |
| PERTALITE | 18.962,00 | 8.000,00 | 9.045,00 | 17.917,00 | 17.823,00 | -94,00 | -1,04 |
| PERTAMINA DEX | 6.425,00 | 0,00 | 288,00 | 6.137,00 | 6.137,00 | 0,00 | 0,00 |
| TOTAL | 55.062,00 | 24.000,00 | 24.267,00 | 54.795,00 | 54.670,00 | -125,00 | -0,52 |

### 28 Oktober (63781002) — 2026-08-04
tera hari ini **0,00 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 23.968,57 | 0,00 | 965,85 | 23.002,72 | 23.011,53 | 8,81 | 0,91 |
| SOLAR | 8.566,27 | 8.000,00 | 13.719,30 | 2.846,97 | 2.996,53 | 149,56 | 1,09 |
| PERTAMAX TURBO | 7.473,45 | 0,00 | 76,48 | 7.396,97 | 7.398,84 | 1,87 | 2,45 |
| DEXLITE | 26.662,77 | 0,00 | 3.710,66 | 22.952,11 | 22.998,99 | 46,88 | 1,26 |
| PERTALITE | 26.373,66 | 24.000,00 | 20.393,12 | 29.980,54 | 30.090,60 | 110,06 | 0,54 |
| PERTAMINA DEX | 3.417,38 | 8.000,00 | 3.630,46 | 7.786,92 | 7.802,61 | 15,69 | 0,43 |
| TOTAL | 96.462,10 | 40.000,00 | 42.495,87 | 93.966,23 | 94.299,10 | 332,87 | 0,78 |

### Adisucipto (6478101) — 2026-08-04
tera hari ini **0,00 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 9.396,00 | 0,00 | 170,00 | 9.226,00 | 9.215,00 | -11,00 | -6,47 |
| SOLAR | 12.877,00 | 8.000,00 | 13.716,00 | 7.161,00 | 7.133,00 | -28,00 | -0,20 |
| DEXLITE | 8.437,00 | 8.000,00 | 4.980,00 | 11.457,00 | 11.443,00 | -14,00 | -0,28 |
| PERTALITE | 17.823,00 | 8.000,00 | 9.321,00 | 16.502,00 | 16.435,00 | -67,00 | -0,72 |
| PERTAMINA DEX | 6.137,00 | 0,00 | 412,00 | 5.725,00 | 5.721,00 | -4,00 | -0,97 |
| TOTAL | 54.670,00 | 24.000,00 | 28.599,00 | 50.071,00 | 49.947,00 | -124,00 | -0,43 |

### 28 Oktober (63781002) — 2026-08-05
tera hari ini **0,00 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 23.011,53 | 0,00 | 1.323,01 | 21.688,52 | 21.698,20 | 9,68 | 0,73 |
| SOLAR | 2.996,53 | 16.000,00 | 16.653,00 | 2.343,53 | 2.456,14 | 112,61 | 0,68 |
| PERTAMAX TURBO | 7.398,84 | 0,00 | 100,38 | 7.298,46 | 7.302,70 | 4,24 | 4,22 |
| DEXLITE | 22.998,99 | 0,00 | 2.876,15 | 20.122,84 | 20.234,65 | 111,81 | 3,89 |
| PERTALITE | 30.090,60 | 24.000,00 | 20.055,42 | 34.035,18 | 34.061,89 | 26,71 | 0,13 |
| PERTAMINA DEX | 7.802,61 | 8.000,00 | 4.753,38 | 11.049,23 | 11.045,33 | -3,90 | -0,08 |
| TOTAL | 94.299,10 | 48.000,00 | 45.761,34 | 96.537,76 | 96.798,91 | 261,15 | 0,57 |

### Adisucipto (6478101) — 2026-08-05
tera hari ini **0,00 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 9.215,00 | 0,00 | 224,00 | 8.991,00 | 8.982,00 | -9,00 | -4,02 |
| SOLAR | 7.133,00 | 8.000,00 | 7.260,00 | 7.873,00 | 7.858,00 | -15,00 | -0,21 |
| DEXLITE | 11.443,00 | 0,00 | 2.070,00 | 9.373,00 | 9.345,00 | -28,00 | -1,35 |
| PERTALITE | 16.435,00 | 8.000,00 | 8.263,00 | 16.172,00 | 16.093,00 | -79,00 | -0,96 |
| PERTAMINA DEX | 5.721,00 | 0,00 | 115,00 | 5.606,00 | 5.606,00 | 0,00 | 0,00 |
| TOTAL | 49.947,00 | 16.000,00 | 17.932,00 | 48.015,00 | 47.884,00 | -131,00 | -0,73 |

### 28 Oktober (63781002) — 2026-08-06
tera hari ini **0,00 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 21.698,20 | 0,00 | 1.556,72 | 20.141,48 | 20.158,54 | 17,06 | 1,10 |
| SOLAR | 2.456,14 | 16.000,00 | 16.257,07 | 2.199,07 | 2.362,41 | 163,34 | 1,00 |
| PERTAMAX TURBO | 7.302,70 | 0,00 | 84,47 | 7.218,23 | 7.220,27 | 2,04 | 2,42 |
| DEXLITE | 20.234,65 | 0,00 | 3.318,47 | 16.916,18 | 17.092,42 | 176,24 | 5,31 |
| PERTALITE | 34.061,89 | 16.000,00 | 17.985,56 | 32.076,33 | 32.209,75 | 133,42 | 0,74 |
| PERTAMINA DEX | 11.045,33 | 0,00 | 4.822,41 | 6.222,92 | 6.329,41 | 106,49 | 2,21 |
| TOTAL | 96.798,91 | 32.000,00 | 44.024,70 | 84.774,21 | 85.372,80 | 598,59 | 1,36 |

### Adisucipto (6478101) — 2026-08-06
tera hari ini **0,00 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 8.982,00 | 0,00 | 158,00 | 8.824,00 | 8.803,00 | -21,00 | -13,29 |
| SOLAR | 7.858,00 | 8.000,00 | 9.638,00 | 6.220,00 | 6.181,00 | -39,00 | -0,40 |
| DEXLITE | 9.345,00 | 0,00 | 2.925,00 | 6.420,00 | 6.391,00 | -29,00 | -0,99 |
| PERTALITE | 16.093,00 | 8.000,00 | 8.286,00 | 15.807,00 | 15.721,00 | -86,00 | -1,04 |
| PERTAMINA DEX | 5.606,00 | 0,00 | 164,00 | 5.442,00 | 5.442,00 | 0,00 | 0,00 |
| TOTAL | 47.884,00 | 16.000,00 | 21.171,00 | 42.713,00 | 42.538,00 | -175,00 | -0,83 |

### 28 Oktober (63781002) — 2026-08-07
tera hari ini **5,00 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 20.158,54 | 0,00 | 2.061,11 | 18.097,43 | 18.106,68 | 9,25 | 0,45 |
| SOLAR | 2.362,41 | 16.000,00 | 14.969,43 | 3.392,98 | 3.647,18 | 254,20 | 1,70 |
| PERTAMAX TURBO | 7.220,27 | 0,00 | 137,54 | 7.082,73 | 7.088,29 | 5,56 | 4,04 |
| DEXLITE | 17.092,42 | 8.000,00 | 4.102,27 | 20.990,15 | 20.780,58 | -209,57 | -5,11 |
| PERTALITE | 32.209,75 | 16.000,00 | 16.831,22 | 31.378,53 | 31.587,67 | 209,14 | 1,24 |
| PERTAMINA DEX | 6.329,41 | 8.000,00 | 3.743,56 | 10.585,85 | 9.582,29 | -1.003,56 | -26,77 |
| TOTAL | 85.372,80 | 48.000,00 | 41.850,13 | 91.527,67 | 90.792,69 | -734,98 | -1,76 |

### Adisucipto (6478101) — 2026-08-07
tera hari ini **0,00 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 8.803,00 | 0,00 | 217,00 | 8.586,00 | 8.578,00 | -8,00 | -3,69 |
| SOLAR | 6.181,00 | 16.000,00 | 14.761,00 | 7.420,00 | 7.420,00 | 0,00 | 0,00 |
| DEXLITE | 6.391,00 | 8.000,00 | 5.204,00 | 9.187,00 | 9.187,00 | 0,00 | 0,00 |
| PERTALITE | 15.721,00 | 16.000,00 | 8.203,00 | 23.518,00 | 23.453,00 | -65,00 | -0,79 |
| PERTAMINA DEX | 5.442,00 | 0,00 | 319,00 | 5.123,00 | 5.101,00 | -22,00 | -6,90 |
| TOTAL | 42.538,00 | 40.000,00 | 28.704,00 | 53.834,00 | 53.739,00 | -95,00 | -0,33 |

### 28 Oktober (63781002) — 2026-08-08
tera hari ini **0,00 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 18.106,68 | 8.000,00 | 1.308,55 | 24.798,13 | 24.692,70 | -105,43 | -8,06 |
| SOLAR | 3.647,18 | 16.000,00 | 14.535,21 | 5.111,97 | 5.300,67 | 188,70 | 1,30 |
| PERTAMAX TURBO | 7.088,29 | 0,00 | 76,85 | 7.011,44 | 7.011,33 | -0,11 | -0,14 |
| DEXLITE | 20.780,58 | 0,00 | 2.034,94 | 18.745,64 | 18.835,39 | 89,75 | 4,41 |
| PERTALITE | 31.587,67 | 24.000,00 | 22.053,29 | 33.534,38 | 33.487,80 | -46,58 | -0,21 |
| PERTAMINA DEX | 9.582,29 | 0,00 | 4.786,86 | 4.795,43 | 5.959,08 | 1.163,65 | 24,31 |
| TOTAL | 90.792,69 | 48.000,00 | 44.795,70 | 93.996,99 | 95.286,97 | 1.289,98 | 2,88 |

### Adisucipto (6478101) — 2026-08-08
tera hari ini **0,00 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 8.578,00 | 0,00 | 207,00 | 8.371,00 | 8.343,00 | -28,00 | -13,53 |
| SOLAR | 7.420,00 | 8.000,00 | 8.913,00 | 6.507,00 | 6.510,00 | 3,00 | 0,03 |
| DEXLITE | 9.187,00 | 0,00 | 3.172,00 | 6.015,00 | 6.005,00 | -10,00 | -0,32 |
| PERTALITE | 23.453,00 | 8.000,00 | 8.460,00 | 22.993,00 | 22.911,00 | -82,00 | -0,97 |
| PERTAMINA DEX | 5.101,00 | 0,00 | 40,00 | 5.061,00 | 5.058,00 | -3,00 | -7,50 |
| TOTAL | 53.739,00 | 16.000,00 | 20.792,00 | 48.947,00 | 48.827,00 | -120,00 | -0,58 |

### Bundaran Kotabaru (6478106) — 2026-08-07
tera hari ini **0,00 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 9.737,63 | 8.000,00 | 3.861,20 | 13.876,43 | 13.083,60 | -792,83 | -20,53 |
| SOLAR | 11.861,92 | 8.000,00 | 7.824,59 | 12.037,33 | 11.555,15 | -482,18 | -6,16 |
| PERTAMAX TURBO | 6.628,88 | 0,00 | 243,65 | 6.385,23 | 6.423,42 | 38,19 | 15,67 |
| DEXLITE | 7.339,25 | 0,00 | 2.389,35 | 4.949,90 | 4.934,50 | -15,40 | -0,64 |
| PERTALITE | 48.558,02 | 32.000,00 | 30.764,49 | 49.793,53 | 45.018,30 | -4.775,23 | -15,52 |
| PERTAMINA DEX | 5.720,13 | 0,00 | 659,97 | 5.060,16 | 4.848,28 | -211,88 | -32,10 |
| TOTAL | 89.845,83 | 48.000,00 | 45.743,25 | 92.102,58 | 85.863,25 | -6.239,33 | -13,64 |

### Bundaran Kotabaru (6478106) — 2026-08-08
tera hari ini **0,00 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 13.083,60 | 0,00 | 3.534,04 | 9.549,56 | 9.587,86 | 38,30 | 1,08 |
| SOLAR | 11.555,15 | 8.000,00 | 9.207,67 | 10.347,48 | 10.419,47 | 71,99 | 0,78 |
| PERTAMAX TURBO | 6.423,42 | 0,00 | 230,81 | 6.192,61 | 6.122,49 | -70,12 | -30,38 |
| DEXLITE | 4.934,50 | 0,00 | 2.748,22 | 2.186,28 | 2.163,27 | -23,01 | -0,84 |
| PERTALITE | 45.018,30 | 24.000,00 | 30.119,14 | 38.899,16 | 38.863,03 | -36,13 | -0,12 |
| PERTAMINA DEX | 4.848,28 | 0,00 | 571,79 | 4.276,49 | 4.320,19 | 43,70 | 7,64 |
| TOTAL | 85.863,25 | 32.000,00 | 46.411,67 | 71.451,58 | 71.476,31 | 24,73 | 0,05 |

### Bakau (6378301) — 2026-03-04
tera hari ini **789,10 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 17.993,88 | 0,00 | 2.252,36 | 15.741,52 | 15.767,43 | 25,91 | 1,11 |
| SOLAR | 28.507,38 | 0,00 | 5.029,39 | 23.477,99 | 23.440,40 | -37,59 | -0,71 |
| PERTAMAX TURBO | 12.977,87 | 0,00 | 152,25 | 12.825,62 | 12.825,06 | -0,56 | -0,29 |
| DEXLITE | 2.892,99 | 0,00 | 2.163,68 | 729,31 | 730,41 | 1,10 | 0,05 |
| PERTALITE | 13.530,39 | 16.000,00 | 11.481,41 | 18.048,98 | 17.791,19 | -257,79 | -2,20 |
| PERTAMINA DEX | 8.145,26 | 0,00 | 241,87 | 7.903,39 | 7.903,39 | 0,00 | 0,00 |
| TOTAL | 84.047,77 | 16.000,00 | 22.110,06 | 78.726,81 | 78.457,88 | -268,93 | -1,22 |

### Batu Layang (6478201) — 2026-02-13
tera hari ini **421,31 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 12.357,31 | 0,00 | 1.257,63 | 11.099,68 | 11.252,64 | 152,96 | 12,16 |
| SOLAR | 4.474,45 | 16.000,00 | 12.636,62 | 7.837,83 | 7.926,32 | 88,49 | 0,70 |
| PERTAMAX TURBO | 8.492,84 | 0,00 | 283,75 | 8.209,09 | 8.213,53 | 4,44 | 1,56 |
| DEXLITE | 8.321,60 | 8.000,00 | 2.949,47 | 13.372,13 | 13.305,55 | -66,58 | -2,23 |
| PERTALITE | 37.770,44 | 24.000,00 | 19.838,64 | 41.931,80 | 41.572,54 | -359,26 | -1,79 |
| PERTAMINA DEX | 6.425,33 | 5.000,00 | 1.412,70 | 10.012,63 | 9.982,09 | -30,54 | -2,10 |
| TOTAL | 77.841,97 | 53.000,00 | 38.800,12 | 92.463,16 | 92.252,67 | -210,49 | -0,54 |

### Korek (6478311) — 2026-04-30
tera hari ini **660,63 L** · provisional false · penutup-nol 0 · tangki dikecualikan 0

| Produk | Stock Awal | Penerimaan | Penjualan | Stock Teori | Stock Fisik | Losses | % |
|---|---:|---:|---:|---:|---:|---:|---:|
| PERTAMAX | 15.785,36 | 4.000,00 | 1.035,49 | 18.749,87 | 18.511,12 | -238,75 | -20,31 |
| SOLAR | 14.176,37 | 0,00 | 3.517,44 | 10.658,93 | 10.658,93 | 0,00 | 0,00 |
| PERTAMAX TURBO | 7.258,82 | 0,00 | 1,60 | 7.257,22 | 7.192,22 | -65,00 | -18,45 |
| DEXLITE | 7.709,21 | 0,00 | 1.372,25 | 6.336,96 | 6.336,96 | 0,00 | 0,00 |
| PERTALITE | 16.932,42 | 24.000,00 | 20.784,31 | 20.148,11 | 20.424,85 | 276,74 | 1,33 |
| PERTAMINA DEX | 6.423,72 | 0,00 | 1.108,20 | 5.315,52 | 5.238,96 | -76,56 | -5,99 |
| TOTAL | 68.285,90 | 28.000,00 | 28.479,92 | 68.466,61 | 68.363,04 | -103,57 | -0,36 |

</details>

## P4-4 🔴 TEMUAN BESAR — aturan pemilihan opname PENUTUP menyimpang dari EasyMax

Ditemukan saat oracle Bundaran Kotabaru 07 Agu MELESET 24 sel. Polanya bersih: **hanya
kolom Stock Awal** yang salah (Teori/Losses/% ikut karena turunan); Penerimaan,
Penjualan, dan Stock Fisik cocok EKSAK. Dan **08 Agu cocok sempurna** — jadi bukan unit
yang rusak, melainkan satu hari.

**Sebabnya, terbukti sel demi sel.** Untuk tanggal-bisnis 2026-08-06 di KB, tiap tangki
punya pembacaan penutup pagi (07 Agu ±06:0x) DAN lima tangki punya pembacaan TAMBAHAN
pada **07 Agu 10:20:49**. `getDailyGlByProduct` memakai `row_number() … ORDER BY dtgljam
DESC` → ia mengambil yang 10:20. EasyMax memakai yang 06:0x — **keenam produk cocok**:

| produk | tangki | 06:0x (dipakai EasyMax) | 10:20 (dipakai SolaMax) | oracle Awal(07) |
|---|---|---:|---:|---:|
| PERTAMAX | T-04 | 8.957,49 | 9.737,63 | **8.957,49** |
| P. TURBO | T-08 | 6.633,66 | 6.628,88 | **6.633,66** |
| PERTAMINA DEX | T-05 | 5.503,46 | 5.720,13 | **5.503,46** |
| SOLAR | T-03+T-07 | 5.499,89+6.046,25 = 11.546,14 | +6.362,03 = 11.861,92 | **11.546,14** |
| PERTALITE | T-01+T-02 | 21.042,25+22.527,93 = 43.570,18 | +27.515,77 = 48.558,02 | **43.570,18** |
| DEXLITE | T-06 | 7.339,25 | *(tak ada entri telat)* | **7.339,25** ✓ juga di SolaMax |

6 dari 6 memilih batch pagi. Ini aturan, bukan kebetulan.

**Siapa yang salah: KITA.** Diuji dua arah sesuai preseden gold-check (di sana dua
selisih ternyata PDF-nya yang salah). Di sini oracle konsisten dengan dirinya —
rantai carry-in oracle 07→08 utuh (Fisik 07 = Awal 08), dan batch 10:20 adalah entri
SESUDAH operasi hari berikutnya dimulai; memakainya sebagai "penutup hari kemarin"
memang tak masuk akal secara operasional.

### Blast radius — 2026 YTD, 221 hari-bisnis, seluruh armada

Dihitung sebagai: baris TERAKHIR per (unit, hari, tangki) yang **nilainya berbeda** dari
baris penutup pagi (D+1 sebelum 08:00).

| unit | tangki-hari beda | hari beda | % hari |
|---|---:|---:|---:|
| **Imam Bonjol** | **0** | **0** | **0 %** |
| Bakau | 4 | 1 | 0,5 % |
| Bundaran Kotabaru | 6 | 2 | 0,9 % |
| Batu Layang | 24 | 7 | 3 % |
| Adisucipto | 104 | 25 | 11 % |
| 28 Oktober | 40 | 26 | 12 % |
| **Korek** | **117** | **51** | **23 %** |

**IB = NOL.** Itulah sebabnya 343/392 sel oracle IB cocok sempurna dan cacat ini tak
pernah terlihat selama empat putaran: unit pilot adalah satu-satunya unit yang aturannya
tak pernah menyimpang. Kebutaan jendela, lagi — kali ini jendelanya UNIT, bukan tanggal.

⚠️ **Ini bukan cacat Arus Minyak.** `getDailyGlByProduct` adalah G/L RESUME bersama:
papan direksi, PDF, alarm, Laporan Harian. **Eskalasi butir 2** (angka G/L yang sudah
dipakai ternyata keliru) → BERHENTI & LAPOR, dan §Batas putaran ini melarang
menyentuhnya. Tidak diperbaiki di sini.

### PREDIKSI TERSEGEL atas 18 tanggal oracle yang sudah ada

Ditulis SEBELUM membuka PNG 28 Oktober. Hari divergen di jendela itu tepat tiga:
KB 06 Agu (5 tangki), 28 Okt 31 Jul (1 tangki), 28 Okt 02 Agu (1 tangki). Maka:

| unit | tanggal | prediksi |
|---|---|---|
| Adisucipto | 1–8 Agu | **8 tanggal BERSIH** (nol hari divergen) |
| Bundaran Kotabaru | 07 Agu | **MELESET pada Stock Awal** (terbukti) |
| Bundaran Kotabaru | 08 Agu | BERSIH (terbukti) |
| 28 Oktober | 01 Agu | **MELESET pada Stock Awal** (imbas 31 Jul) |
| 28 Oktober | 02 Agu | **MELESET pada Stock Fisik** (+ Losses/%) |
| 28 Oktober | 03 Agu | **MELESET pada Stock Awal** (imbas 02 Agu) |
| 28 Oktober | 04–08 Agu | **5 tanggal BERSIH** |

Kalau prediksi ini meleset, diagnosis di atas salah dan harus ditinjau ulang.
