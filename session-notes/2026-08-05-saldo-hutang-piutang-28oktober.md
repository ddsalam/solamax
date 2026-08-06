# Saldo Hutang/Piutang 28 Oktober — investigasi selisih vs EasyMax

Unit **7 · 28 Oktober · `63781002`** (tenant PT Sola Petra Energi). DB pilot LIVE
`solamax:asia-southeast2:solamax-pg`, akses read-only role `dashboard_ro` via cloud-sql-proxy.
Status: **GERBANG A selesai** (pengukuran). Menunggu keputusan owner sebelum menyentuh kode.

---

## 0. Kebenaran-dasar (oracle) — diparse ulang sendiri sebagai kontrol

Skrip parse independen (`openpyxl`, tanpa melihat tabel di relay) atas 3 berkas
`SaldoHutangPiutang{02,03,04}Agustus2026.xlsx`:

| Tanggal | Seksi | n baris | Σ DEBET | Σ KREDIT | D−K | Σ SALDO |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 02 Ags | Piutang Lokal | 49 | 134.812.082.058 | 122.779.044.019 | 12.033.038.039 | 12.033.038.039 |
| 02 Ags | Piutang Online | 4 | 10.796.518 | 0 | 10.796.518 | 10.796.518 |
| 02 Ags | Hutang Lokal | 34 | 56.159.023.882 | 56.009.691.552 | 149.332.330 | 149.332.330 |
| 03 Ags | Piutang Lokal | 49 | 134.896.464.957 | 122.779.044.019 | 12.117.420.938 | idem |
| 03 Ags | Hutang Lokal | 34 | 56.165.611.204 | 56.024.691.552 | 140.919.652 | idem |
| 04 Ags | Piutang Lokal | 49 | 135.018.154.758 | 122.779.044.019 | 12.239.110.739 | idem |
| 04 Ags | Hutang Lokal | 34 | 56.173.217.721 | 56.049.691.552 | 123.526.169 | idem |

Σ SALDO ≡ Σ(DEBET−KREDIT) di **kesembilan** sel → total memang aljabar, bukan Σ-positif.
Angka ini **identik** dengan tabel yang diberikan di relay → oracle terkonfirmasi ganda.

## 1. Jebakan metodologi yang hampir menyesatkan (dicatat karena mahal)

Percobaan pertama menyetel GUC RLS sebagai literal array Postgres `'{1,2,3,4,5,6,7}'`.
Hasil: **unit 1 dan unit 7 tampak KOSONG** (0 baris di `bppiut`/`bphut`/`pelanggan_master`),
unit 2–6 berisi. Nyaris disimpulkan "28 Oktober belum ter-backfill".

Sebabnya ada di policy `unit_scope` (`pg_policies`): ia mem-*split* `app.unit_ids` **pada koma**
lalu menyaring token dengan regex `^-?[0-9]+$`. Untuk `{1,2,...,7}` token pertama `{1` dan
terakhir `7}` gagal regex → **tepat unit pertama dan terakhir hilang senyap**. Format yang benar
adalah daftar polos: `7`.

Yang menyelamatkan: **kasus kontrol** — Imam Bonjol mustahil kosong. Nol keluaran bukan sinyal.

Kontrol yang dipasang sejak itu, dan harus tetap MERAH:

| Kontrol | Harapan | Hasil |
| --- | --- | --- |
| tanpa GUC sama sekali | 0 baris (fail-closed) | 0 ✓ |
| GUC salah-format `'{7}'` | 0 baris | 0 ✓ |
| GUC `'99'` (unit tak ada) | 0 baris | 0 ✓ |
| GUC `'7'` | ada data | 762.839 `bppiut` (2018-05-28…2026-08-05), 104.682 `bphut`, 852 master ✓ |

Kelengkapan ingest 28 Oktober untuk 2–4 Agustus **tidak** jadi masalah (H4 gugur, lihat §3).

## 2. GERBANG A — tabel 9 sel

SolaMax = replika persis `getSaldoPelanggan` ([queries.ts:1271](../apps/dashboard/src/lib/queries.ts#L1271)),
dijalankan langsung di DB pilot, `unit_id=7`.

| Tanggal | Baris | Oracle EasyMax | SolaMax | Selisih | % | Arah |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 2026-08-02 | Piutang Lokal | 12.033.038.039 | 11.924.610.543 | −108.427.496 | −0,901% | SolaMax KURANG |
| 2026-08-02 | Piutang Online | 10.796.518 | 10.760.434 | −36.084 | −0,334% | SolaMax KURANG |
| 2026-08-02 | Hutang Lokal | 149.332.330 | 135.973.546 | −13.358.784 | −8,946% | SolaMax KURANG |
| 2026-08-03 | Piutang Lokal | 12.117.420.938 | 12.033.038.039 | −84.382.899 | −0,696% | SolaMax KURANG |
| 2026-08-03 | Piutang Online | 10.796.518 | 10.760.434 | −36.084 | −0,334% | SolaMax KURANG |
| 2026-08-03 | Hutang Lokal | 140.919.652 | 149.332.330 | +8.412.678 | +5,970% | SolaMax LEBIH |
| 2026-08-04 | Piutang Lokal | 12.239.110.739 | 12.117.420.938 | −121.689.801 | −0,994% | SolaMax KURANG |
| 2026-08-04 | Piutang Online | 10.796.518 | 10.760.434 | −36.084 | −0,334% | SolaMax KURANG |
| 2026-08-04 | Hutang Lokal | 123.526.169 | 140.919.652 | +17.393.483 | +14,081% | SolaMax LEBIH |

Perhatikan **arah Hutang berbalik** antar tanggal (kurang, lalu lebih dua kali). Itu bukan
kekacauan data — itu tanda tangan pergeseran satu hari pada deret yang sedang turun.

## 3. Putusan hipotesis

### H1 — batas tanggal off-by-one → **TERKONFIRMASI** (Piutang Lokal + Hutang Lokal)

`getSaldoPelanggan` memakai `dtgl < $date` = **saldo AWAL hari** D. Laporan
"Daftar Saldo Hutang Piutang" = **saldo AKHIR hari** D.

Uji langsung, SolaMax(D) vs Oracle(D−1):

| D | Baris | SolaMax(D) `<` | Oracle(D−1) | Putusan |
| --- | --- | ---: | ---: | --- |
| 03 Ags | Piutang Lokal | 12.033.038.039 | 12.033.038.039 | **EKSAK** |
| 03 Ags | Hutang Lokal | 149.332.330 | 149.332.330 | **EKSAK** |
| 04 Ags | Piutang Lokal | 12.117.420.938 | 12.117.420.938 | **EKSAK** |
| 04 Ags | Hutang Lokal | 140.919.652 | 140.919.652 | **EKSAK** |

Dan dengan `<=` (saldo akhir), keenam sel Piutang-Lokal/Hutang-Lokal mendarat **EKSAK ke rupiah**
pada oracle tanggal yang sama:

```
2026-08-02|<=|12033038039|10760434|149332330   ← oracle 12.033.038.039 / 149.332.330
2026-08-03|<=|12117420938|10760434|140919652   ← oracle 12.117.420.938 / 140.919.652
2026-08-04|<=|12239110739|10760434|123526169   ← oracle 12.239.110.739 / 123.526.169
```

Jadi **tidak ada kerusakan data** pada dua baris ini. Yang berbeda adalah **definisi**: saldo awal
vs saldo akhir. Apakah ini "bug" tergantung laporan mana yang blok ini dimaksudkan mencerminkan —
lihat §4, ini keputusan bisnis, bukan teknis.

### H2 — bucket SJENIS bocor → **TERKONFIRMASI** (Piutang Online), sebab terpisah

Selisih Online **konstan −36.084 di ketiga tanggal dan di kedua batas tanggal** → bukan soal
tanggal sama sekali. Rekonsiliasi per-pelanggan seksi Online (4 baris × 3 tanggal, semuanya cocok
nilainya):

| Kode | Nama | SJENIS di `pelanggan_master` | Masuk hitungan SolaMax? |
| --- | --- | ---: | --- |
| 18.999.0010 | JOVIAL ONLINE | 3 | ya |
| 18.999.0011 | WULING MOTORS | 3 | ya |
| 18.999.0013 | KAPUAS LESTARI | 3 | ya |
| **21.999.0014** | **HERWIN** | **4** | **TIDAK** |

`21.999.0014` bersaldo tepat **36.084** — persis selisihnya. Filter `m.sjenis = 3` membuangnya.
Inilah item **D3** yang sudah terdaftar terbuka di
[bakau-parity-verdict.md:40](bakau-parity-verdict.md#L40) — sekarang terbukti **menimbulkan salah
angka nyata di produksi**, bukan sekadar risiko teoretis.

⚠️ **Perbaikan naif "tambahkan SJENIS 4 ke Online" BERBAHAYA.** Di unit 7 ada **758** pelanggan
SJENIS 4; 737 di antaranya bersaldo piutang ≠ 0 dan **tidak dicetak sama sekali** oleh oracle —
totalnya miliaran (mis. `PLG0009` = 4.686.742.763, `PLG0011` = 5.853.728). Menyapu SJENIS 4 ke
Online akan meledakkan baris itu ~400×.

Diskriminator sebenarnya tampaknya **format kode**, bukan SJENIS. Seluruh 13 master berkode
bertitik (`NN.999.NNNN`, bukan `PLG####`) di unit 7 — dan **tepat 4 di antaranya** yang bersaldo
≠ 0 adalah persis 4 baris seksi Online:

```
[11.999.0002] sj=1 HERWIN            net=0
[11.999.0003] sj=1 HENDRA SALAM      net=0
[11.999.0004] sj=3 KARYAWAN SPBU     net=0
[11.999.0005] sj=1 SALAM GROUP       net=0
[11.999.0006] sj=3 -                 net=0
[12.999.0007] sj=3 FERRY             net=0
[12.999.0008] sj=3 FERI.@RT          net=0
[16.999.0009] sj=5 SALAM ONLINE      net=0
[18.999.0010] sj=3 JOVIAL ONLINE     net=3.951.595   ← Online
[18.999.0011] sj=3 WULING MOTORS     net=300.000     ← Online
[18.999.0012] sj=4 YNCI PONTIANAK    net=0
[18.999.0013] sj=3 KAPUAS LESTARI    net=6.508.839   ← Online
[21.999.0014] sj=4 HERWIN            net=36.084      ← Online
```

Aturan kandidat ini **belum diuji lintas unit** dan **belum diuji terhadap `tm_plg` di MySQL**
(kolom master yang sebenarnya dipakai EasyMax mungkin bukan SJENIS sama sekali). Jangan dikunci
sebelum GERBANG B menuntaskannya.

### H3 — INNER JOIN membuang baris → **GUGUR** di unit 7

Anti-join `bppiut` tanpa pasangan master: **0 baris, 0 rupiah**. Casing/whitespace tidak menggigit
di sini (`trim()` sudah cukup). Bukan berarti aman di unit lain — belum diuji fleet-wide.

### H4 — ledger Postgres tidak lengkap / lubang outage 05-08 → **GUGUR**

Rekonsiliasi **per-pelanggan** atas 261 titik data (87 baris × 3 tanggal):

| Seksi | n oracle | nilai cocok EKSAK | tidak ada di PG | nilai beda |
| --- | ---: | ---: | ---: | ---: |
| Piutang Lokal | 49 | 44 | 5 | **0** |
| Piutang Online | 4 | 4 | 0 | **0** |
| Hutang Lokal | 34 | 33 | 1 | **0** |

**Nol** ketidakcocokan nilai. Enam kode yang "tidak ada di PG" (`PLG0007`, `PLG0670`, `PLG0834`,
`PLG0877`, `PLG0879`, `PLG0360`) semuanya bersaldo **0,00** di oracle dan memang tak punya baris
`bppiut`/`bphut` sama sekali — pelanggan nol yang tetap dicetak EasyMax. Kontribusi rupiah = 0.
Ingest 28 Oktober untuk periode ini **lengkap**.

### H5 — semantik `sbatal` → **GUGUR**

Total dengan filter `sbatal=0` mendarat eksak di oracle (via `<=`). Tak ada ruang untuk definisi
pembatalan yang berbeda; setiap perubahan filter akan merusak kecocokan yang sudah eksak.

### H8 — `bphut` perlu difilter → **GUGUR**

Anti-arah: pelanggan `bphut` bersaldo ≠ 0 yang **tidak** ada di 34 baris oracle = **0**. Semua
yang punya saldo hutang muncul di laporan. Hutang memang **tanpa** filter SJENIS — benar apa adanya.
(SJENIS pelanggan hutang di PG ternyata {3: 31, 2: 2} — sekaligus membuktikan SJENIS 3 **tidak**
berarti "online": pelanggan SJENIS 3 bisa berada di buku hutang. Diskriminator bucket adalah
**tabel sumber** `bppiut` vs `bphut`, bukan SJENIS.)

### H7 — konvensi tanda hutang → **GUGUR**

Formula menghasilkan **+149.332.330** untuk unit 7 (positif, sama dengan oracle) dan **−711.193.196**
untuk IB (negatif, sama dengan `(711.193.196)` di PDF IB). Tandanya mengikuti data, tidak dibalik.

### H6 — cache menyajikan angka basi → **BELUM DIUJI**

Perlu membandingkan angka yang benar-benar terender di halaman vs DB pada saat yang sama.
Ditunda ke GERBANG B; tidak mengubah temuan di atas karena semua pengukuran §2 diambil langsung
dari DB.

## 4. Temuan yang mengubah bentuk perbaikan — dua laporan EasyMax, dua definisi

Oracle yang mengunci formula saat ini **bukan** laporan yang owner pakai sekarang:

- `SALDO_EXPECTED` ([probe.ts:948](../apps/agent/src/probe.ts#L948)) = PDF **"Laporan Penjualan
  Harian"** unit **Imam Bonjol**, Juni 2026.
- Oracle kali ini = **"Daftar Saldo Hutang Piutang"** unit **28 Oktober**, Agustus 2026.

Diuji langsung di data IB (unit 1), oracle Juni vs kedua batas tanggal. Selisih `oracle − SolaMax`:

| Tanggal | offset dengan `<` | offset dengan `<=` |
| --- | ---: | ---: |
| 2026-06-17 | 19.725.329.748 | 19.656.484.079 |
| 2026-06-18 | 19.725.329.748 | 19.673.815.880 |
| 2026-06-21 | 19.725.680.963 | 19.611.621.593 |
| 2026-06-22 | 19.725.660.563 | 19.648.461.834 |
| 2026-06-23 | 19.725.939.043 | 19.563.589.939 |
| 2026-06-24 | 19.726.638.938 | 19.666.567.735 |
| 2026-06-26 | 19.726.161.183 | 19.661.778.544 |
| 2026-06-27 | 19.725.273.933 | 19.675.191.581 |

Dengan `<` offsetnya **nyaris konstan** (rentang 1,3 juta atas basis 19,7 miliar = 0,007%);
dengan `<=` ia berayun liar (rentang 112 juta). Deret yang konstan adalah deret yang sejajar.
→ **Untuk laporan IB, `<` (saldo awal) memang batas yang benar.** Hutang IB bahkan mendarat
**eksak tanpa offset** dengan `<` pada 7 dari 9 tanggal.

**Kesimpulan: `<` dan `<=` dua-duanya "benar" — untuk laporan yang berbeda.** Karena itu
mengganti `<` → `<=` secara global **akan merusak kesejajaran dengan Laporan Penjualan Harian**
yang selama ini jadi acuan. Ini keputusan bisnis untuk owner, bukan pilihan teknis.

## 5. Temuan sampingan yang berdiri sendiri — IB kurang ±19,7 miliar

Offset ~19.725.000.000 di atas **bukan** artefak batas tanggal: ia bertahan pada `<`. Delta
harian SolaMax cocok persis dengan delta harian oracle (mis. 17→18 Juni = +68.845.669 di kedua
sisi), tetapi **basisnya** lebih rendah 19,7 miliar.

Sebabnya konsisten dengan riwayat yang terpotong: `bppiut` IB di Postgres hanya bermula
**2022-09-01** (`bphut` 2022-08-31), sementara 28 Oktober punya riwayat sejak **2018-05-28**.
Saldo pembuka pra-2022-09 tidak ada di ledger yang kita tarik.

Artinya **Piutang Lokal Imam Bonjol yang tampil di dashboard hari ini understated ±19,7 miliar**
terhadap laporan EasyMax-nya sendiri. Ini **pra-ada**, tidak berkaitan dengan keluhan 28 Oktober,
dan belum pernah dilaporkan. Perlu keputusan terpisah.

Konsekuensi metodologis: **IB tidak bisa dipakai sebagai kasus kontrol "pernah eksak"** seperti
diasumsikan di relay — untuk Piutang Lokal ia tidak eksak sekarang. Untuk Hutang dan Online, IB
masih kontrol yang sah.

## 6. GERBANG B — keputusan owner & pendalaman

Keputusan owner (2026-08-06):

1. **Tampilkan keduanya** — blok menyajikan saldo **awal hari** DAN **akhir hari**, berlabel jelas.
   Dengan begitu pengawas menemukan angka yang cocok apa pun laporan EasyMax yang ia pegang.
2. **Beri akses mesin SPBU** untuk mengunci diskriminator Online dari `tm_plg` (menunggu detail).
3. **Investigasi IB ±19,7 miliar sekarang.**

### 6a. H3 (INNER JOIN membuang baris) — GUGUR untuk KETUJUH unit

Anti-join `bppiut` tanpa pasangan `pelanggan_master`, `sbatal=0`, `dtgl ≤ 2026-08-04`:
**nol baris di semua unit**. Kontrol menyalak (query yang sama mengembalikan baris saat predikat
`m.ckdplg IS NULL` dilepas: unit 1=58.943 … unit 7=168.627). Jadi masalah casing/whitespace ala
CNOSO **tidak** menggigit di permukaan ini di unit mana pun.

### 6b. Ingest saldo SEHAT di ketujuh unit

`sync_state` (`last_run_at` 2026-08-05 ±17:00 UTC = 2026-08-06 dini WIB) terisi untuk
`piutang`/`hutang`/`pelanggan` di **unit 1–7**. Tidak ada unit yang tertinggal. Ini juga
mengoreksi pembacaan awal yang keliru (§1) yang sempat menyimpulkan unit 1 & 7 tak pernah sync.

### 6c. IB ±19,7 miliar — dipersempit, belum tuntas (butuh MySQL)

Yang sudah bisa dipastikan dari sisi Postgres:

- **Bukan backfill terpotong di ujung baru.** `syncSaldoLedger`
  ([sync.ts:468](../apps/agent/src/sync.ts#L468)) menarik `SELECT … FROM tr_bppiut` **tanpa WHERE**,
  `ORDER BY DTGL ASC`, lalu batch dari indeks 0. Bila sebuah run putus di tengah
  (`if (status !== "ok") break`), yang hilang adalah baris **terbaru**, bukan terlama. IB justru
  kehilangan yang **terlama** → mekanisme ini tidak menjelaskannya.
- **Bukan hard-delete tak tersinkron.** Tak ada jalur DELETE pada full-sync; baris yang dihapus di
  MySQL akan **tertinggal** di Postgres (Postgres jadi LEBIH banyak). IB justru KURANG.
- **Bukan `sbatal`.** Baris `sbatal=1` IB ber-net **0** (339.532 baris, net Rp0) — membuangnya benar.
- **Bukan bucket SJENIS.** Net IB seluruh SJENIS digabung pun hanya 38,29 mrd per 27-Jun
  (sj1 24,47 + sj5 7,41 + sj4 6,41 + sj3 0,0012). Oracle Lokal **saja** 51,61 mrd. Tak ada
  himpunan SJENIS yang bisa mencapainya.
- **Lantai riwayat IB rapat di dua tabel**: `bppiut` mulai 2022-09-01, `bphut` mulai 2022-08-31 —
  selaras, mirip tanggal go-live EasyMax, bukan pemotongan sembarang. Bandingkan unit 7 (2018-05-28),
  unit 4 (2011-10-06), unit 2 (2015-10-26).

**Temuan penting yang mengubah tafsir §4:** probe ronde 13
([probe.ts:1194](../apps/agent/src/probe.ts#L1194)) yang "mengunci" formula memakai **`DTGL <= ?`**
di SELURUH query-nya — sementara dashboard mengimplementasikan **`dtgl < $date`**, dan komentar
migrasi [0013:5-8](../apps/backend/prisma/migrations/0013_recap_saldo_tables/migration.sql#L5)
menuliskan `dtgl<tanggal`. **Probe dan implementasi tidak sama.** Jadi ada dua bukti independen
yang menunjuk `<=`:

1. probe ronde 13 memakai `<=` dan melaporkan EKSAK vs oracle IB;
2. oracle 28 Oktober mendarat eksak pada `<=` di 6/6 sel.

Sementara bukti untuk `<` hanya observasi "offset IB nyaris konstan" (§4) — yang **terkontaminasi**
oleh 19,7 miliar yang hilang itu sendiri, sehingga tidak bisa dipakai memutus.

→ **Buntu di Postgres. Perlu query read-only ke `tr_bppiut` MySQL IB** untuk tahu apakah MySQL
memang memuat ~19,7 mrd lebih banyak (berarti ingest IB kehilangan baris) atau tidak (berarti
klaim "EKSAK" probe tidak reproducible dan perlu ditinjau ulang).

### 6d. Biaya query untuk "tampilkan keduanya" — TIDAK naik

Diukur di DB pilot, unit 7, 3 kali jalan berurutan:

| Varian | run 1 | run 2 | run 3 |
| --- | ---: | ---: | ---: |
| Sekarang (3 subquery, hanya awal hari) | 1.185 ms | 1.124 ms | 1.064 ms |
| Usulan (satu pass `FILTER`, awal **dan** akhir) | 1.400 ms | 986 ms | 996 ms |

Sebabnya: bentuk sekarang memindai `bppiut` **dua kali** (subquery Lokal + Online); bentuk satu-pass
memindainya **sekali** sambil menghitung empat angka lewat `FILTER`. Kerja bertambah, pemindaian
berkurang — saling menutup. Optimasi 104 dtk → 1,47 dtk **tidak** dikorbankan.

## 7. GERBANG C — aturan final & implementasi

### 7a. Diskriminator Online TERPECAHKAN — pemisahan sempurna

Probe `tm_plg` di mesin 28 Oktober (Q11) menarik **13** pelanggan berkode bertitik beserta
jumlah baris ledgernya s/d 2026-08-02. **Empat** yang dicetak EasyMax = persis empat yang
punya baris ledger, dan jumlahnya tepat total oracle:

```
18.999.0010 JOVIAL ONLINE   SJENIS 3   13 baris   3.951.595
18.999.0011 WULING MOTORS   SJENIS 3    2 baris     300.000
18.999.0013 KAPUAS LESTARI  SJENIS 3   25 baris   6.508.839
21.999.0014 HERWIN          SJENIS 4    1 baris      36.084
                                                 ──────────
                                                 10.796.518  = oracle ✓
```

Sembilan sisanya (SJENIS 1, 3, 4, 5 bercampur) **nol baris, nol saldo**.

→ **Piutang Online = Σ atas seluruh pelanggan berkode bertitik, `SJENIS` DIBUANG.**
Kandidat "punya ≥1 baris" vs "saldo ≠ 0" **tidak terpisahkan** oleh data ini — tetapi untuk
angka yang ditampilkan selisihnya **nol** (pelanggan bersaldo nol menyumbang nol). Dicatat
sebagai **batas yang diketahui**; ia hanya menyentuh daftar rinci, bukan total. Karena itu
**tidak ada** syarat keanggotaan tambahan yang dipasang.

### 7b. `emax2` — diperiksa, GUGUR

Isinya hanya `globall` dan `tangki`; `emax2.tr_bppiut` tidak ada (*Table 'emax2.tr_bppiut'
doesn't exist*). Tidak berkaitan dengan saldo. Ditutup.

### 7c. Aturan final (diimplementasikan)

| baris | aturan terbukti |
| --- | --- |
| **Piutang Lokal** | `SJENIS ∈ {1,5}` **DAN** kode **tanpa** titik · `dtgl <= tanggal` |
| **Piutang Online** | kode **bertitik** · **tanpa** filter SJENIS · `dtgl <= tanggal` |
| **Hutang Lokal** | seluruh `bphut` · `dtgl <= tanggal` · dinegatifkan |

Semua `COALESCE(sbatal,0)=0`. `CKDPLG` = `char(12)` dipadding spasi → `trim()` wajib di kedua
sisi; deteksi bertitik memakai `position('.' in trim(...)) > 0`, **bukan** prefiks `PLG`
(tidak stabil) dan **bukan** SJENIS (sumbu yang berbeda).

Filter `SJENIS ∈ {2,3}` + non-bertitik untuk Hutang **sengaja TIDAK dipasang** — `bphut`
tanpa filter sudah mendarat eksak, dan menambah syarat yang belum diverifikasi per unit
adalah menambah risiko tanpa bukti. Terdaftar sebagai pertanyaan (a) di pra-registrasi.

### 7d. Yang berubah di kode

| berkas | perubahan |
| --- | --- |
| `apps/dashboard/src/lib/queries.ts` | `getSaldoPelanggan` → mengembalikan `{awal, akhir}`; aturan bucket baru; satu CTE per tabel (dari 3 subquery, 2 pindaian `bppiut` → 1) |
| `apps/dashboard/src/lib/saldo-cache.ts` | `shouldBypassEmptySaldo` memeriksa **kedua** batas |
| `apps/dashboard/src/lib/laporan-model.ts` | `saldoRows` membawa `awal` + `akhir` |
| `.../laporan/[date]/page.tsx` | tabel 3 kolom berjudul "Awal hari" / "Akhir hari" |
| `apps/dashboard/src/styles/app.css` | `cols-saldo` → `cols-saldo2` (3 track, min-width 700px) |
| `apps/dashboard/src/lib/export/laporan-doc.ts` | PDF: kolom Awal hari + Akhir hari |
| `apps/dashboard/src/lib/queries.saldo.test.ts` | **baru** — 13 test pengunci semantik |
| `apps/dashboard/src/lib/saldo.oracle.integration.test.ts` | **baru** — kunci oracle DB-live |
| `.../0013_recap_saldo_tables/CORRECTION.md` | **baru** — koreksi komentar "formula terkunci" |

`pnpm check` (typecheck + test seluruh monorepo): **HIJAU** — dashboard 479 lulus/108 skip,
agent 66, backend 26, shared 8.

### 7e. ⚠️ `migration.sql` 0013 SENGAJA tidak disunting

Relay meminta komentar "formula terkunci" di
`0013_recap_saldo_tables/migration.sql:5-8` diperbarui. **Tidak dilakukan** — migrasi itu
sudah ter-apply di `solamax-pg` **dan** `solamax-pg-rlsstg`, dan `prisma migrate deploy`
memvalidasi checksum tiap migrasi yang sudah dijalankan. Menyunting satu karakter pun akan
**menghentikan pipeline CD** (migrate-before-serve) demi perubahan yang murni dokumentatif.

Koreksinya ditaruh di `CORRECTION.md` di direktori yang sama (Prisma hanya membaca
`migration.sql`, jadi berkas itu inert), memuat tabel "klaim vs yang benar" untuk keempat
kesalahan: batas `<`, `Online = SJENIS 3`, `SJENIS 4 dikecualikan` (hanya separuh benar),
dan klaim `EKSAK 27-Jun` yang tak reproducible.

### 7f. Test pengunci — dibuktikan bisa MERAH

Suite pertama **LOLOS pada 2 dari 3 mutasi** — assertion `toContain` cocok ke kemunculan
*lain* setelah satu baris disunting. Itu bukan pagar, itu hiasan. Assertion diperketat jadi
**per-tabel dan ber-hitungan**. Batere mutasi setelah diperketat:

| mutasi | hasil |
| --- | --- |
| baseline (tanpa mutasi) | 13 lulus ✅ |
| batas `<=` → `<` di CTE `piut` saja (edit satu baris) | **1 gagal** 🔴 |
| batas `<=` → `<` di kedua CTE | **1 gagal** 🔴 |
| Online difilter `sjenis = 3` (bug lama) | **1 gagal** 🔴 |
| Lokal lupa `NOT dotted` (satu baris) | **1 gagal** 🔴 |
| Lokal lupa `NOT dotted` (semua) | **2 gagal** 🔴 |
| `LEFT JOIN` → `INNER JOIN` | **1 gagal** 🔴 |

Sumber dipulihkan utuh setelah tiap mutasi (diverifikasi `git diff --stat`).

## 8. Imam Bonjol — buku tagihan TIDAK mendarat

`tr_htagihan` nyata dan besar (2.426 faktur, 2.266 hidup, 2022-09-02 → 2026-08-06; keluarga
`tr_dtagihan` = jembatan ke penjualan, `tr_byrtagih` = pembayaran). **Tapi tak satu pun
potongannya mendarat** pada target 19.675.191.581 (per 27-Jun, `SBATAL=0`):

| potongan | NGATOT | selisih vs target |
| --- | ---: | ---: |
| NSTATUS 0 (belum lunas), 784 faktur | 22.998.111.024 | **+3.322.919.443** |
| NSTATUS 0 — kolom `NLASTSALDO` | 22.854.043.870 | +3.178.852.289 |
| SJENISTAG 1 / NSTATUS 0, 354 faktur | 16.570.209.714 | −3.104.981.867 |
| SJENISTAG 2 / NSTATUS 0, 430 faktur | 6.427.901.310 | jauh |
| NSTATUS 1 (lunas), 1.399 faktur | 80.708.355.031 | jauh |
| seluruh faktur | 103.706.466.055 | jauh |

Target kedua (51.608.248.203) juga tak didekati potongan mana pun. Catatan teknis: `NTOTAL`
identik `NGATOT` di **semua** kelompok → `NADM` nol di seluruh buku; keduanya bukan dua
kandidat berbeda. Yang belum dihitung: **pembayaran** — bila piutang = faktur belum lunas
dikurangi pembayaran parsial, pembayarannya harus tepat **3.322.919.443** (PACK-6).

### Koreksi bukti

Klaim lama "probe reproducible untuk Online (IB)" **diturunkan bobotnya**. Angka Online IB
adalah **1.200.000 — bulat dan konstan di kesembilan tanggal oracle**. Angka bulat yang statis
jauh lebih mudah cocok secara kebetulan daripada angka 12 digit yang bergerak; itu bukan
konfirmasi kuat dan tidak dipakai menopang kesimpulan apa pun.

Yang **tetap tegak**: Postgres = MySQL (jalur ingest bersih), dan `tr_bppiut` IB **tidak**
memuat 51,6 miliar dengan kombinasi filter apa pun.

### Rekomendasi: GANTI ORACLE

Sudah tiga putaran query untuk satu angka di satu unit. PACK-6 adalah putaran terakhir.
Terlepas dari hasilnya, langkah yang benar bukan menebak tabel keempat melainkan **meminta
ekspor "Daftar Saldo Hutang Piutang" IB untuk 2–4 Agustus 2026** — laporan yang sama, tanggal
yang sama, sehingga IB diuji dengan aturan yang sudah terbukti di 28 Oktober, bukan dengan
oracle warisan berjenis lain yang asal-usulnya tak bisa direkonstruksi. Permintaan itu
diajukan **bersamaan** dengan PACK-6, bukan menunggu PACK-6 gagal.

Bila IB ternyata **memang** perlu buku tagihan ditarik, itu **menambah domain ingest baru** =
keputusan owner, bukan konsekuensi otomatis. Tak ada migrasi ditulis.

## 9. Status gerbang

- **GERBANG A — SELESAI.** Tabel 9 sel di §2, arah selisih tercatat, tiap hipotesis diputus.
- **GERBANG B — SELESAI.** Akar Online = SJENIS dipakai sebagai proksi format kode (D3, §7a).
  Akar Piutang & Hutang Lokal = beda definisi awal/akhir hari, bukan kerusakan data.
- **GERBANG C — SELESAI & TERBUKTI DI DB (2026-08-06).** 8/9 sel eksak; sel ke-9
  (04-08 Piutang Lokal) meleset +604.500 dan **melesetnya benar** — ledger dikoreksi
  pengawas pukul 09:23 WIB setelah oracle diekspor; rekonstruksi mendarat di oracle
  dengan selisih **nol rupiah**. Aturan LAMA pun mengembalikan angka baru itu, jadi
  yang berubah data, bukan aturan. Biaya query **turun** jadi 0,89× dari bentuk lama
  (setelah satu putaran perbaikan: bentuk CTE pertama sempat 1,50× = MERAH terhadap
  ambang yang disegel, sebabnya sortir 343.769 baris pada merge join; diperbaiki
  dengan prafilter sisi master → hash join). Rincian di
  `saldo-rule-goldcheck-preregistration.md` §5–§7.
- **GERBANG D — SELESAI.** Ketujuh unit diperiksa: Piutang Lokal **tidak berubah di
  satu unit pun**; Piutang Online berubah di **dua** unit — 28 Oktober (+36.084) dan
  **Bundaran Kotabaru (+700.040)**, keduanya oleh pelanggan berkode **sama**
  `21.999.0014` HERWIN (SJENIS 4, bertitik). Satu akar, dua unit → bukan kalibrasi ke
  sampel. Tiga pertanyaan armada terjawab: (a) nol pelanggan bertitik di `bphut` di
  semua unit → hutang benar tanpa filter; (b) nol pelanggan bertitik ber-SJENIS {1,5}
  yang bersaldo → syarat "tanpa titik" tak memindahkan rupiah mana pun (**prediksi
  saya SALAH di sini**, tercatat di pra-registrasi); (c) tak ada format kode ketiga
  di unit mana pun.
- ~~**GERBANG C — kode SELESAI, bukti DB TERTUNDA.**~~ Implementasi + test + mutasi merah semua
  beres dan `pnpm check` hijau. **Pembuktian 9 sel di DB dan verifikasi 7 unit belum bisa
  dijalankan**: kredensial ADC (`gcloud auth application-default login`) kedaluwarsa di tengah
  sesi dan butuh login interaktif owner. Prediksinya sudah **disegel lebih dulu** di
  `saldo-rule-goldcheck-preregistration.md` (append-only), jadi pembuktiannya tetap sah saat
  dijalankan nanti.
- **GERBANG D — tertunda**, alasan sama. IB **bukan** kasus kontrol untuk Piutang Lokal
  sampai urusan buku tagihan tuntas; pengganti yang diusulkan = **unit 4 Bundaran Kotabaru**
  (ledger terbesar, 927.130 baris) — tetapi ia pun **belum punya oracle**, jadi kontrol yang
  sah hanya tersedia setelah ekspor "Daftar Saldo Hutang Piutang" unit pembanding diminta.

## 7. Risiko yang sudah terlihat untuk perbaikan nanti

1. Diskriminator Online harus dikunci dari **`tm_plg` di MySQL** (kolom aslinya), bukan ditebak
   dari pola kode di Postgres. Butuh akses mesin SPBU atau probe read-only.
2. Perbaikan apa pun harus diuji atas **ketujuh unit**, dan IB kini bukan kontrol bersih (§5).
3. Query saldo baru turun 104 dtk → 1,47 dtk; setiap perubahan predikat `dtgl` mengubah
   selektivitas indeks → **wajib ukur ulang** sebelum/sesudah.


---

# BAGIAN III — Imam Bonjol: hantunya bubar (2026-08-06)

## 10. PENCABUTAN status IB — tertulis, sebagaimana pencabutan sebelumnya

Di §5 catatan ini saya menulis bahwa **Piutang Lokal IB understated ±19,7 miliar** dan bahwa
**IB tidak lagi layak jadi kasus kontrol**. Kedua pernyataan itu **DICABUT**.

Buktinya berbalik, dan pencabutannya harus setegas penetapannya:

- Owner mengekspor **"Daftar Saldo Hutang Piutang" IB** 1–5 Agustus 2026 — laporan **sejenis**
  dengan yang dipakai memeriksa 28 Oktober.
- Terhadap oracle setara itu, **15 dari 15 sel EKSAK**, tanpa penyesuaian apa pun.
- Rekonsiliasi per-pelanggan: **1.640 titik data, nol ketidakcocokan**.

→ **Tidak ada data IB yang hilang. Formulanya benar sejak awal.** Angka 19,7 miliar adalah
artefak membandingkan ke **"Laporan Penjualan Harian"** (saldo AWAL hari) — laporan berjenis
lain yang kesetaraannya tak pernah dibuktikan.

→ **IB kembali menjadi kasus kontrol yang sah untuk Piutang Lokal**, dan kini ia kasus kontrol
yang lebih kuat daripada sebelumnya: ia menguji dua jalur yang 28 Oktober tak bisa uji —
**kredit pada bucket Online** dan **pecahan ½ rupiah**.

Buku tagihan (`tr_htagihan`/`tr_dtagihan`/`tr_byrtagih`) **GUGUR** sebagai hipotesis: PACK-6
menunjukkan seluruh-faktur − seluruh-pembayaran = 21.264.348.386 (+1,59 mrd dari target) dan
faktur-belum-lunas − pembayarannya = 22.854.043.870 (+3,18 mrd). Satu temuan struktural tetap
disimpan: **`NLASTSALDO` = sisa per faktur** (22.998.111.024 − 144.067.154 = 22.854.043.870).
Tidak ada domain ingest baru yang perlu ditambahkan.

## 11. Yang IB uji dan 28 Oktober tidak

| jalur | 28 Oktober | Imam Bonjol |
| --- | --- | --- |
| kredit pada bucket **Online** | tak ada (kredit nol) | **ADA** — 10.505.841 − 9.305.841 = 1.200.000 |
| **pecahan ½ rupiah** | tak ada (bulat semua) | **ADA** — 4 pelanggan hutang, total tetap bulat |
| **tanda** Hutang | positif (+149 jt) | **negatif** (−770 jt) |
| SJENIS 2 di buku hutang | 2 pelanggan | **22 pelanggan** |

Ketiganya kini terkunci test. Tanpa IB, tiga jalur ini tak pernah tereksekusi sama sekali.

## 12. PELAJARAN METODE — layak disimpan di luar sesi ini

Sesi ini menghabiskan tiga putaran query mengejar "kehilangan data 19,7 miliar" yang
**tidak pernah ada**. Penyebabnya satu: **oracle-nya tidak pernah diverifikasi setara dengan
laporan yang dipakai memeriksa.** Komentar `migration.sql` menyatakan formula "terkunci
EKSAK" — dan klaim itu **benar, terhadap laporan yang salah**.

Bentuk umumnya:

> **Pemeriksaan yang LULUS terhadap pembanding yang keliru terbaca persis seperti pemeriksaan
> yang benar.**

Yang membubarkannya bukan query yang lebih pintar, melainkan **meminta pembanding yang
setara** — tersedia sejak awal dengan biaya satu ekspor.

Kembarannya muncul di sesi yang sama, di sel ke-9 (28 Oktober, +604.500):

> **Pemeriksaan yang GAGAL terhadap pembanding yang sudah basi terbaca persis seperti cacat.**

Kedua arah butuh obat yang sama: **periksa dulu apakah pembandingnya masih layak
dibandingkan** — sebelum menyalahkan kode, dan sebelum mempercayai kecocokan.

Turunan praktisnya, sudah dimasukkan ke runbook gold-check:
1. Sebut **nama laporan** oracle secara eksplisit, bukan "laporan EasyMax".
2. Cek tanggal ekspor vs `ingested_at` sebelum menyimpulkan selisih.
3. Saat selisih muncul, uji dulu apakah aturan **lama** pun menghasilkannya.

## 13. Empat item penutup

| # | item | status |
| --- | --- | --- |
| 1 | Pensiunkan `SALDO_EXPECTED` (probe.ts) | ✅ diganti nama jadi `SALDO_EXPECTED_LPH_DEPRECATED` + banner ⛔ di komentar DAN di keluaran probe |
| 2 | Komentar formula terkunci di `0013/migration.sql:5-8` | ⚠️ **berkas SQL sengaja tidak disunting** — checksum Prisma; koreksi lengkap di `CORRECTION.md` sebelahnya (lihat §14) |
| 3 | Tutup D3 (`bakau-parity-verdict.md`) | ✅ ditutup dgn jawaban dua-sumbu; diperkuat data IB (SJENIS 2 muncul di buku hutang, 22 pelanggan) |
| 4 | Runbook gold-check | ✅ blok Saldo WAJIB + 5 kontrol + **instruksi tegas memakai "Daftar Saldo Hutang Piutang", bukan "Laporan Penjualan Harian"** + prosedur "periksa pembanding dulu" |

## 14. Kenapa `migration.sql` tetap tidak disunting — sekarang dengan bukti

Bukan keengganan; ada invarian yang bisa diukur. Prisma menyimpan checksum tiap migrasi yang
sudah dijalankan, dan `prisma migrate deploy` memvalidasinya. Diperiksa langsung di DB pilot:

```
_prisma_migrations.checksum (0013) = f8f28d862dccae5205ac4bf75de8886ff6f570febc730126235c7ede741d0593
sha256 apps/backend/.../0013_recap_saldo_tables/migration.sql
                                  = f8f28d862dccae5205ac4bf75de8886ff6f570febc730126235c7ede741d0593
```

**Identik.** Mengubah satu karakter pun membuat keduanya berbeda, dan CD menjalankan
`migrate deploy` **sebelum** serve di kedua tier — artinya deploy berikutnya berhenti, demi
perubahan yang murni dokumentatif.

Keputusan ini milik owner, jadi kedua jalannya disiapkan:
- **(A) sekarang** — `migration.sql` utuh; koreksi lengkap di `CORRECTION.md` di direktori yang
  sama (Prisma hanya membaca `migration.sql`), plus komentar penuh di `getSaldoPelanggan`.
- **(B) bila owner tetap ingin berkasnya disunting** — sunting boleh, tapi **harus disertai**
  pembaruan checksum tersimpan di **kedua** DB (`solamax-pg` dan `solamax-pg-rlsstg`), sebagai
  langkah tulis yang disetujui terpisah. Tanpa itu, pipeline berhenti pada deploy berikutnya.


---

# BAGIAN IV — Ringkasan yang bisa dipakai ulang

## 15. Ketiga aturan + bukti aritmetiknya

| baris | aturan | 28 Oktober | Imam Bonjol |
| --- | --- | ---: | ---: |
| Piutang Lokal | `bppiut`, `SJENIS ∈ {1,5}` **DAN** kode tanpa titik | **49** pelanggan | **136** pelanggan |
| Piutang Online | `bppiut`, kode **bertitik**, **tanpa** filter SJENIS | **4** | **1** |
| Hutang Lokal | seluruh `bphut`, dinegatifkan | **34** | **191** |
| | **total baris laporan** | **87** | **328** |

Semua `COALESCE(sbatal,0)=0`, dua batas (`<` awal hari, `<=` akhir hari).

**Aritmetika yang menutupnya — 28 Oktober, 02 Ags:**
```
Piutang Lokal  134.812.082.058 − 122.779.044.019 = 12.033.038.039 ✓
Piutang Online      10.796.518 −             0   =      10.796.518 ✓
   = 3.951.595 + 300.000 + 6.508.839 + 36.084   (empat pelanggan bertitik)
Hutang Lokal    56.159.023.882 −  56.009.691.552 =     149.332.330 ✓
```

**Imam Bonjol, 01 Ags:**
```
Piutang Lokal  118.183.449.515 −  82.805.910.588 = 35.377.538.927 ✓
Piutang Online      10.505.841 −       9.305.841 =      1.200.000 ✓   ← jalur KREDIT
Hutang Lokal    51.732.360.497,5 − 52.502.362.877,5 =  −770.002.380 ✓ ← pecahan ½ & tanda negatif
```

Σ(D−K) per baris ≡ baris `TOTAL SALDO …` ≡ blok `Summary` di dalam berkas — tiga sumber
independen, cocok di **kedua puluh empat** sel.

## 16. Hipotesis yang GUGUR — dan kenapa (sama berharganya dgn yang bertahan)

| hipotesis | putusan | bukti yang menjatuhkannya |
| --- | --- | --- |
| **H3 case-sensitivity ala CNOSO** (`trim()` tanpa `lower()` membuang baris) | **GUGUR** | Anti-join `bppiut` ⟂ `pelanggan_master` = **0 baris di ketujuh unit**; kontrol menyalak (58.943…168.627 baris saat predikatnya dilepas) |
| **H4 ledger Postgres ≠ MySQL** (hard-delete, backfill bolong, lubang outage 05-08) | **GUGUR** | Rekonsiliasi per-pelanggan 261 titik (28 Okt) + 1.640 titik (IB) → **nol** ketidakcocokan nilai. Full-sync `SELECT … FROM tr_bppiut` tanpa `WHERE`, urut terlama dulu → run yang putus kehilangan baris **terbaru**, bukan terlama |
| **H5 semantik `sbatal` berbeda** | **GUGUR** | Total dgn `sbatal=0` mendarat eksak; IB `sbatal=1` bernet **Rp0** (339.532 baris) |
| **H8 `bphut` perlu difilter** (`SJENIS {2,3}` / non-bertitik) | **GUGUR** | Pelanggan `bphut` bersaldo yang tak ada di oracle = **0** (kedua unit). SJENIS di buku hutang justru bercampur — IB {2: 22, 3: 166} → filter SJENIS **salah** |
| **H7 konvensi tanda hutang dibalik** | **GUGUR** | Formula sama menghasilkan 28 Okt **+**149 jt dan IB **−**770 jt; tanda mengikuti data |
| **"IB kehilangan 19,7 miliar"** | **GUGUR — tak pernah ada** | Oracle setara ("Daftar Saldo Hutang Piutang" IB) → **15/15 eksak** tanpa penyesuaian |
| **Buku tagihan `tr_htagihan`** sumber piutang IB | **GUGUR** | PACK-6: seluruh-faktur − seluruh-pembayaran = 21.264.348.386 (+1,59 mrd); faktur-belum-lunas − pembayarannya = 22.854.043.870 (+3,18 mrd). Tak ada potongan yang mendarat, di dua tanggal kontrol. Disimpan: **`NLASTSALDO` = sisa per faktur** |
| **DB `emax2`** memuat ledger tandingan | **GUGUR** | Isinya hanya `globall` + `tangki`; `emax2.tr_bppiut` tidak ada |
| **H6 cache menyajikan angka basi** | **tak terbukti & tak relevan** | Seluruh pengukuran diambil langsung dari DB, melewati cache |

**Yang BERTAHAN:** H1 (batas tanggal — beda definisi, bukan cacat) dan H2 (bucket — SJENIS
dipakai sebagai proksi format kode).

## 17. Prediksi saya yang MELESET

Di pra-registrasi §3(b) saya menulis: *"ADA pelanggan bertitik ber-SJENIS {1,5} yang bersaldo,
di setidaknya satu unit selain 28 Oktober."*

**Salah.** Nol di **ketujuh** unit. Konsekuensinya melegakan — syarat "tanpa titik" pada Lokal
tidak memindahkan rupiah mana pun, ia murni pagar terhadap masa depan — tapi prediksinya tetap
meleset dan dicatat apa adanya, bukan disunting menjadi benar.

## 18. PENCABUTAN tertulis

Dua pernyataan saya sendiri, dicabut:

1. ~~"Piutang Lokal Imam Bonjol understated ±19,7 miliar terhadap laporan EasyMax-nya sendiri"~~
   → **SALAH.** 15/15 sel eksak terhadap oracle setara. Tak ada data yang hilang.
2. ~~"IB tidak bisa dipakai sebagai kasus kontrol untuk Piutang Lokal"~~
   → **DICABUT.** IB kembali sah, dan kini kontrol **terkuat** yang dimiliki armada.

Keduanya ditetapkan atas bukti yang saat itu memang mengarah ke sana; keduanya dicabut atas
bukti yang lebih baik. Pencabutannya ditulis setegas penetapannya.

## 19. SATU pola, dua arah — bukan dua anekdot

Sesi ini memuat dua peristiwa yang tampak berlawanan. Keduanya **pola yang sama**:

> **Pembanding yang tidak layak dibandingkan menghasilkan sinyal yang tidak bisa dibedakan
> dari kebenaran.**

| arah | peristiwa | tampak seperti | sebenarnya |
| --- | --- | --- | --- |
| **lulus palsu** | komentar 0013 "EKSAK 27-Jun" vs *Laporan Penjualan Harian* | formula terverifikasi | benar terhadap **laporan yang salah** → melahirkan hantu 19,7 miliar |
| **gagal palsu** | sel ke-9 28 Oktober, +604.500 vs berkas oracle 05-Agu | cacat aturan | oracle **sudah basi**; ledger dikoreksi 06-Agu 09:23 WIB |

Obat yang sama untuk keduanya, dan sudah masuk runbook gold-check:

1. Sebut **nama laporan** oracle secara eksplisit — bukan "laporan EasyMax".
2. Bandingkan **tanggal ekspor oracle** dengan `ingested_at` sebelum menyimpulkan selisih.
3. Saat selisih muncul, uji dulu apakah aturan **LAMA** pun menghasilkannya. Kalau ya →
   yang berubah **data**, bukan rumus.
4. Saat kecocokan muncul, tanyakan apakah pembandingnya memang mengukur hal yang sama.

## 20. Jebakan alat yang nyata (ketiganya menghasilkan sinyal palsu tanpa error)

| jebakan | gejalanya | yang menyelamatkan |
| --- | --- | --- |
| **Format GUC `app.unit_ids`** — literal array `'{1,…,7}'` di-split pada koma lalu disaring regex `^-?[0-9]+$`, sehingga token pertama (`{1`) & terakhir (`7}`) gugur | unit **pertama dan terakhir** tampak **kosong**; 0 baris, **bukan error** — identik dgn "tidak ada data" | kasus kontrol: IB mustahil kosong. Format benar = daftar polos (`7`) |
| **Frasa seksi muncul ulang** di baris `TOTAL SALDO …` dan blok `Summary` → parser substring **me-reset akumulator** | berkas IB terbaca **0 baris di semua seksi**; mudah disimpulkan "layout IB beda" | buka strukturnya, bukan menebak; lalu pasang TOTAL + Summary sbg cek silang. (Baris JUDUL laporan juga berawalan `DAFTAR SALDO` → sempat bikin seksi hantu `null`) |
| **`information_schema` disaring privilege** — `dashboard_ro` tak punya akses schema `app`, jadi `information_schema.tables` mengembalikan **nol baris** untuk `app` | terbaca seperti "schema `app` tidak punya tabel" — persis saat menjawab "apakah ada angka saldo yang tersimpan?", di mana nol = jawaban yang **menyenangkan** dan karenanya paling berbahaya | kontrol: `public` → 26 tabel (menyalak). Lalu baca `pg_class`/`pg_namespace` yang **tidak** disaring privilege → 11 tabel `app` muncul |
| **Timeout test 5 dtk** pada invarian yang menyentuh DB 8× | test MERAH; sangat mudah dijual sebagai temuan data | invarian itu benar **secara aljabar** — mustahil gagal karena nilai. Baca pesan gagalnya, jangan hanya warnanya |

**TIGA dari empat jebakan di atas menghasilkan NOL TANPA ERROR** — GUC salah format, parser
yang ter-reset, dan `information_schema` yang disaring privilege. Tiga instans **pola yang sama
dalam satu sesi**, di tiga lapis alat yang berbeda (DB, parser berkas, katalog DB). Itu bukan
kebetulan; itu frekuensi dasarnya. Aturan praktisnya:

> **Nol tak pernah menjadi jawaban sampai ada kasus kontrol yang membuktikan query-nya bisa
> mengembalikan bukan-nol.**

Yang keempat (timeout) adalah cerminnya: **merah tanpa cacat**. Arahnya berlawanan, keluarganya
sama — dan berbahaya justru ketika nol/merah itu **jawaban yang kita harapkan**. Dalam sesi ini
"schema `app` kosong" adalah kabar baik (berarti tak ada angka lama tersimpan), dan itulah momen
paling mudah berhenti bertanya.

Keempatnya satu keluarga dengan §19: **sinyal yang tidak bisa dibedakan dari kebenaran**, dan
hanya kasus kontrol yang memisahkannya.


## 21. Jebakan PKCE dua-host — TERBUKTI, bukan lagi dugaan

Awalnya dicatat sebagai pengamatan ("dua host satu layanan, alurnya jalan"). **Naik status jadi
mode gagal nyata dengan bukti log** pada hari yang sama.

Masuk lewat URL otomatis Cloud Run `solamax-dashboard-rlsstg-wn6i64kvza-et.a.run.app` **GAGAL**:

```
[auth][error] InvalidCheck: pkceCodeVerifier value could not be parsed
```

Sebabnya `AUTH_URL` menunjuk host lain
(`solamax-dashboard-rlsstg-113869564052.asia-southeast2.run.app`), sehingga **cookie PKCE di-set
di satu host lalu callback dibaca di host yang berbeda**. Masuk lewat host `AUTH_URL` **berhasil**.

Yang membuatnya mahal bila terulang: pesan gagalnya berbicara tentang **parsing verifier**, bukan
tentang konfigurasi host — jadi ia mengarahkan pembacanya ke kode auth, bukan ke penyebabnya.

### ⚠️ KHUSUS TIER TESTING — jangan digeneralisasi ke pilot

Konfigurasi auth kedua tier **berbeda BENTUK, bukan sekadar berbeda nilai**:

| | `-rlsstg` (testing) | `-staging` (pilot) |
| --- | --- | --- |
| `AUTH_URL` | **dipatok** ke satu host Cloud Run | **tidak dipatok** |
| `AUTH_TRUST_HOST` | — | **`true`** |
| domain | dua host Cloud Run | **domain kustom `solamax.solagroup.co`** |

Karena pilot memakai `AUTH_TRUST_HOST=true` tanpa `AUTH_URL` yang dipatok, dan berdomain kustom,
**bentuk kegagalan ini tidak ada di sana**. Ditulis sebagai satu mode gagal umum, catatan ini akan
mengirim orang berikutnya mengejar hantu di pilot — persis kesalahan yang membuat sesi ini mahal
(§19). Jadi: **temuan ini milik tier testing.** Kalau login pilot bermasalah, penyebabnya
kemungkinan besar bukan ini, dan diagnosanya mulai dari nol.

---

## 22. Status akhir sesi (2026-08-06)

PR [#187](https://github.com/ddsalam/solamax/pull/187) **ter-merge ke `staging`**. Ketiga workflow
sukses: CI `pnpm check` (44 dtk), deploy backend (3m08s), deploy dashboard (3m14s).

Revisi yang serve di tier **testing**:
- dashboard `solamax-dashboard-rlsstg-00039-lgz` (100% traffic)
- backend `solamax-ingest-rlsstg-00011-zw8`

**`main` tidak disentuh** — pilot (`-staging`) masih menjalankan kode lama. Promosi ke pilot adalah
keputusan terpisah yang belum diambil, dan menunggu dua hal di sisi owner: verifikasi tampilan
dua-kolom di `-rlsstg`, dan keputusan apakah penerima cetakan PDF perlu diberitahu lebih dulu
(usulan: satu kalimat yang menyebut **Hutang Lokal** — baris dengan pergeseran persentase terbesar,
12,3% di 28 Oktober / 5,9% di IB karena basisnya kecil — dan bahwa **angka lama = kolom "Awal hari"**).

Di luar cakupan dan tetap terbuka sebagai tugas terpisah milik owner: artefak float
`PP2022100101473` (`73867616.45999999`, jalur `num()` JS → JSON → `numeric`).


## 23. CELAH YANG DIKETAHUI — tier testing tak bisa memvalidasi UI berbasis data

Ditemukan 2026-08-06 saat hendak memverifikasi tata letak dua-kolom di `-rlsstg`.

**DB tier testing (`solamax-pg-rlsstg`) sintetis dan kosong** untuk domain saldo. Akibatnya
`hasSaldo` bernilai false dan **seluruh blok "Saldo Hutang/Piutang & Recap Harian" tidak dirender
sama sekali**. Diperiksa pada dua tanggal (2026-08-04 dan 2026-07-15): nol penjualan, nol ledger,
blok Saldo absen.

Konsekuensi yang harus diingat, karena berlaku umum:

> **CI hijau + deploy sukses di `-rlsstg` TIDAK berarti tampilannya pernah dilihat.**
> Untuk setiap perubahan UI yang render-nya bergantung pada ada-tidaknya data, tier testing
> memberi sinyal **kosong** — dan kosong di sini, sekali lagi, tak bisa dibedakan dari "aman".
> (Ini instans keempat dari pola §20 — kali ini di lapis lingkungan, bukan query.)

Ini **struktural**, bukan insiden: akan berulang pada setiap perubahan tampilan berbasis data.
Untuk perubahan ini, owner memilih **promosi ke pilot lalu verifikasi di sana dengan data asli**,
secara sadar menerima urutan terbalik — dan mengamankannya dengan **jalur mundur yang disiapkan
sebelum promosi** (revisi rollback direkam + perintah traffic-split siap salin-tempel di badan
PR #188).

Opsi yang sempat dipertimbangkan, dicatat agar keputusan berikutnya tidak mulai dari nol:

| opsi | isi | catatan |
| --- | --- | --- |
| **Seed DB testing** | isi `solamax-pg-rlsstg` dengan fixture saldo (bppiut/bphut/pelanggan_master) untuk ≥1 unit & beberapa tanggal | menutup celah untuk semua perubahan UI berikutnya; biayanya membuat & merawat fixture yang realistis (termasuk kasus pecahan ½ & bucket bertitik) |
| **Dev lokal → DB pilot read-only** | jalankan dashboard lokal dgn `DATABASE_URL` role `dashboard_ro` via cloud-sql-proxy | data asli, nol risiko tulis; tapi butuh login OAuth dan tak cocok dijalankan agen — verifikasi tetap manual oleh owner |
| **Terima & mitigasi** (dipilih kali ini) | promosi ke pilot + rollback siap sebelum promosi | murah dan cepat pulih, tapi angka salah bisa sempat terlihat direksi |

**Bukan pekerjaan PR ini.** Dicatat sebagai celah yang diketahui beserta pilihannya.


## 24. HASIL VERIFIKASI VISUAL DI PILOT (2026-08-06) — keadaan akhir

Promosi ke pilot selesai: dashboard `solamax-dashboard-staging-00080-vdp` → **`00081-nvg`**.
Verifikasi dilakukan owner **di pilot dengan data asli** — satu-satunya tempat yang bisa (§23).

### ✅ Hijau

Blok render dengan sub-judul *"saldo awal & akhir hari per tanggal bisnis"* dan dua kolom berlabel
**Awal hari** / **Akhir hari** — tidak bisa salah baca.

**28 Oktober · 2026-08-04**

| baris | Awal hari | Akhir hari |
| --- | ---: | ---: |
| Piutang Pelanggan Lokal | Rp 12.117.420.938 | Rp 12.239.715.239 |
| Piutang Pelanggan Online | Rp 10.796.518 | Rp 10.796.518 |
| Hutang Pelanggan Lokal | (Rp 140.919.652) | (Rp 123.526.169) |

Kolom **Awal hari** = oracle 03-08 persis di ketiga baris; **Akhir hari** = oracle 04-08 persis,
kecuali Piutang Lokal +604.500 — **koreksi ledger yang sudah terdokumentasi** (§7/§5 pra-registrasi),
bukan cacat. Footer aplikasi mengonfirmasinya sendiri: *"⟳ = angka pernah dikoreksi (90 revisi hari
ini)"*.

**Imam Bonjol · 2026-08-04** — Hutang: Awal `(Rp 734.439.355)`, Akhir `(Rp 751.284.145)`; magnitudo
cocok oracle IB 03-08 & 04-08 persis.

### 🔴 Satu temuan — tanda Hutang tidak terbedakan

Kedua unit menampilkan Hutang **dalam kurung**, padahal 28 Oktober **+123.526.169 (positif)** dan
IB **−751.284.145 (negatif)**. Untuk 28 Oktober, tanda di layar **berbeda dari EasyMax**.

**Bukan regresi**: flag `danger: true` di `laporan-model.ts` sudah ada sebelum perubahan sesi ini;
ia hanya menjadi terlihat saat dua unit bertanda berlawanan akhirnya diperiksa berdampingan.
Keputusan owner: **jangan rollback, perbaiki di PR susulan** — dampaknya kosmetik-tapi-menyesatkan,
bukan angka yang salah hitung.

Ditangani di PR susulan (branch `claude/saldo-tanda-hutang`): prediksi disegel lebih dulu, query
dijalankan → **nilai tersimpan terbukti BENAR** (28 Okt `+123526169`, IB `−751284145`), cacat murni
di lapis tampilan; diperbaiki dengan satu formatter bersama `rpParen()`/`isNegative()` untuk layar
**dan** PDF, dikunci 5 mutasi merah.

### Pelajaran yang menutup lingkaran §23

Celah tier testing **terbukti mahal dalam satu putaran**: cacat ini mustahil terlihat di `-rlsstg`
(blok Saldo tak dirender), dan hanya muncul ketika **dua unit dengan tanda berlawanan** dilihat
berdampingan. Bahkan pilot pun tak cukup kalau hanya satu unit diperiksa — IB sendirian tampak
benar, 28 Oktober sendirian tampak masuk akal.

> **Cacat yang butuh DUA kasus berlawanan untuk terlihat tidak akan pernah muncul dari satu
> sampel** — sekeras apa pun sampel itu diperiksa.

Itu sebabnya test perbaikannya memuat kedua tanda dalam satu berkas, bukan satu kasus per berkas.

## 25. Status penutup sesi

| item | status |
| --- | --- |
| PR #187 → `staging` | ✅ merged, CD `-rlsstg` sukses |
| PR #188 → `main` (promosi pilot) | ✅ merged, pilot `solamax-dashboard-staging-00081-nvg` |
| Verifikasi visual pilot | ✅ dilakukan owner; 1 temuan (tanda Hutang) |
| PR #189 tanda Hutang → `staging` | terbuka, CI hijau |
| PR docs-only (berkas ini) | terbuka |
| Artefak float `PP2022100101473` | tugas terpisah owner — **di luar cakupan** |
| `migration.sql` 0013 | final, tidak dibuka lagi |
| Seed DB testing (§23) | opsi tercatat, **belum diputuskan** |


## 26. USULAN (belum dikerjakan) — fixture minimal untuk tier testing

Ditulis atas permintaan owner sebagai **usulan bentuk**, bukan implementasi. Menjawab §23: seed
adalah satu-satunya opsi yang membuat `-rlsstg` mampu menangkap kelas cacat yang **sudah lolos dua
kali** — blok yang tak dirender (kosong), dan tanda yang tak terbedakan.

### Prinsip: fixture dirancang dari MODE GAGAL, bukan dari "data yang realistis"

Data realistis tidak akan menangkap apa pun di sini. Kedua cacat butuh **pasangan yang berlawanan**
hadir bersamaan (§24). Jadi fixture-nya sengaja kecil dan sengaja ekstrem.

**Dua unit sintetis** — dua unit, bukan satu, adalah inti usulan ini:

| unit | Hutang | Piutang Online | pecahan | tujuan |
| --- | --- | --- | --- | --- |
| `TEST-A` | **POSITIF** | pelanggan **bertitik** ber-`SJENIS 4` | bulat | meniru 28 Oktober |
| `TEST-B` | **NEGATIF** | pelanggan bertitik ber-`SJENIS 3` + baris **kredit** | **½ rupiah** | meniru Imam Bonjol |

**Isi minimal per unit** (~20 baris total, bukan ribuan):

- `pelanggan_master`: 1 × `SJENIS 1`, 1 × `SJENIS 5`, 1 × `SJENIS 4` **non**-bertitik (harus
  dikecualikan), 1 × bertitik `SJENIS 3`, 1 × bertitik `SJENIS 4` (harus **masuk** Online),
  1 × `SJENIS 2` hanya di buku hutang.
- `bppiut`: debet **dan** kredit (`sjnsbp` 1 & 2) untuk tiap bucket; ≥1 baris `sbatal=1` bernilai
  besar yang **harus** terbuang.
- `bphut`: nilai yang menghasilkan total **positif** di A dan **negatif** di B; di B, empat baris
  ber-pecahan `,5` yang **saling meniadakan** sehingga totalnya bulat.
- **Dua tanggal berurutan** dengan mutasi di antaranya — tanpa ini, kolom *Awal hari* dan
  *Akhir hari* identik dan pergeseran batas tanggal tak teruji.

### Yang membuat fixture ini bisa MERAH

| cacat | tertangkap oleh |
| --- | --- |
| blok tak dirender (`hasSaldo` false) | ada saldo ≠ 0 → blok wajib muncul |
| tanda tak terbedakan | A positif vs B negatif, dirender berdampingan |
| `SJENIS` dipakai sbg proksi format kode | bertitik-`SJENIS 4` wajib masuk Online; non-bertitik-`SJENIS 4` wajib keluar |
| kredit diabaikan | bucket Online B punya kredit |
| pecahan hilang / dibulatkan | empat baris `,5` di B |
| batas tanggal tertukar | dua tanggal dgn mutasi |
| `sbatal` diabaikan | baris `sbatal=1` bernilai besar |

### Pagar yang WAJIB, bukan opsional

Seed ini **menulis ke DB**. Karena `-staging` (pilot LIVE) dan `-rlsstg` (testing) hanya beda
sufiks — jebakan nama yang sudah tercatat — skripnya harus **menolak jalan** kecuali targetnya
terbukti DB testing:

1. Tegaskan **`system_identifier`** (atau nama instance) DB testing sebelum satu pun `INSERT` —
   pelajaran Batu Layang, dan satu-satunya guard yang tak bisa ditipu oleh salah-ketik host.
2. Pakai `unit_id` di rentang khusus test (mis. ≥ 900) supaya tak pernah bertabrakan dgn unit nyata.
3. Idempoten (UPSERT by PK), aman dijalankan tiap deploy.
4. Jalan **sesudah** `migrate-test`, **sebelum** `deploy-test`.

### Biaya vs manfaat

Kecil (~20 baris seed + satu skrip ber-guard) dibanding dua putaran yang sudah hilang. Tapi ia
**menambah jalur tulis ke DB di CD** — permukaan yang selama ini nol. Karena itu ini **usulan**,
dan keputusannya milik owner.

**Batasnya jujur:** fixture menangkap cacat *render* dan *format*, **bukan** kebenaran angka
terhadap EasyMax. Yang terakhir tetap butuh oracle nyata + `saldo.oracle.integration.test.ts`
terhadap DB pilot. Seed bukan pengganti gold-check; ia hanya menutup celah "tampilan tak pernah
dilihat".


## 27. KEADAAN AKHIR — terverifikasi di pilot (2026-08-06)

### Revisi final

| layanan | revisi | catatan |
| --- | --- | --- |
| `solamax-dashboard-staging` (**pilot**) | **`00082-ww5`** | `deploy-pilot` ✅ |
| `solamax-ingest-staging` (**pilot**) | `00031-tk9` — **tidak berubah** | lihat di bawah |

**`migrate-pilot` tidak berjalan pada promosi terakhir (#191) — dan itu BENAR.** Workflow backend
ber-path-filter `apps/backend/**`, `packages/shared/**`, `pnpm-lock.yaml`; #191 hanya menyentuh 5
berkas dashboard + 2 catatan sesi, jadi ia memang tidak terpicu. Konsisten dengan klaim "nol migrasi
baru" di badan PR.

Yang membuktikan itu **bukan** kerusakan senyap: pada promosi sebelumnya (#188, yang memang menyentuh
backend) `migrate-pilot` **berjalan dan sukses**. Jadi jalurnya hidup. "Tidak jalan" ≠ "rusak" —
tapi keduanya terlihat sama sampai ada pembanding yang menyalak. (Kembali ke §20: nol/absen tak
pernah jadi jawaban tanpa kontrol.)

### Verifikasi tanda — kedua unit BERDAMPINGAN

Diperiksa owner di `solamax.solagroup.co`, revisi `00082-ww5`, tanggal bisnis 2026-08-04:

| unit · baris Hutang | Awal hari | Akhir hari | EasyMax | putusan |
| --- | ---: | ---: | --- | --- |
| **28 Oktober** | `Rp 140.919.652` | `Rp 123.526.169` | positif | ✅ **tanpa** kurung |
| **Imam Bonjol** | `(Rp 734.439.355)` | `(Rp 751.284.145)` | negatif | ✅ **dengan** kurung |

Dua posisi ekonomi berlawanan kini **terbedakan di layar**, dan tandanya sejalan dengan EasyMax di
kedua arah. Sebelum #189 keduanya tampil identik — dan hanya terlihat karena diperiksa berdampingan,
persis seperti yang dirumuskan di §24.

### ⚠️ BATAS YANG HARUS TERCATAT JUJUR: PDF struktural, BUKAN visual

**Yang diverifikasi owner adalah LAYAR. Ekspor PDF belum pernah dilihat.**

Keyakinan pada PDF bertumpu pada **bentuk perbaikannya**, bukan pada pengamatan:
- satu formatter bersama (`rpParen()` + `isNegative()` di `format.ts`) dipakai **layar dan**
  `export/laporan-doc.ts` — keduanya memanggil kode yang sama, jadi tak bisa menyimpang;
- test e2e menelusuri `docDefinition` yang benar-benar dibangun dan memeriksa teks **serta**
  warna/tebal sel Hutang, memuat **kedua tanda dalam satu berkas**, dengan kontrol
  `cells.length > 0` agar "tidak ketemu" tak lolos sebagai hijau;
- batere mutasi 5/5 merah, termasuk regresi aslinya persis.

Itu jaminan **struktural**, dan untuk kelas cacat ini lebih kuat daripada sekali melihat — sekali
melihat tidak mencegah divergensi besok. **Tetapi struktural ≠ terlihat.**

Ditulis begitu dengan sengaja: menutupnya dengan "PDF konsisten" akan terbaca seolah sudah dilihat,
dan itu **persis kelas kesalahan yang membuat sesi ini mahal** — klaim yang benar terhadap sesuatu
yang tak pernah diperiksa. Kalau suatu saat PDF perlu dipercaya sebagai *terlihat*, ia harus dibuka
dan dilihat.
