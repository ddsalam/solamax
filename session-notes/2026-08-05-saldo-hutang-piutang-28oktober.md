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
- **GERBANG C — kode SELESAI, bukti DB TERTUNDA.** Implementasi + test + mutasi merah semua
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
