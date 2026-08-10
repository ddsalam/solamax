# Keuangan Harian — keputusan yang mengikat

Model akuntansi penuh per unit: buku kas/bank/EDC → Cash Flow · Income Statement ·
Balance Sheet harian, dengan **penutupan hari** sebagai gerbang.

Model sasaran = workbook **`Finance SPBU 6378301 BK`** (Bakau).
Workbook **"NERACA <unit>"** (penaksir harta bersih, `Laba = Δ harta bersih`)
**bukan** model sasaran dan tidak boleh dipakai sebagai acuan definisi.

**Berkas ini bukan tutorial dan bukan kronologi.** Ia daftar keputusan yang
mengikat ke depan, alasannya, dan batas yang diketahui. Kalau kamu menyentuh
keuangan harian, baca ini lebih dulu.

Status: **K0 (investigasi) selesai. Belum ada kode, belum ada migrasi.**
Bukti: [`session-notes/2026-08-10-keuangan-k0-t1-neraca-bakau.md`](../../session-notes/2026-08-10-keuangan-k0-t1-neraca-bakau.md) ·
[`…-t2-peta-masukan.md`](../../session-notes/2026-08-10-keuangan-k0-t2-peta-masukan.md) ·
[`…-t3-prareg.md`](../../session-notes/2026-08-10-keuangan-k0-t3-prareg.md) (segel) ·
[`…-t3-hasil.md`](../../session-notes/2026-08-10-keuangan-k0-t3-hasil.md).

---

## 1 · Definisi setiap baris, sumbernya, siapa mengisi

Definisi diambil dari rumus workbook Bakau dan **sudah diuji**: Gross Profit
reproduksi **eksak sampai rupiah pada 10/10 tanggal** dari SolaMax (T3).

### 1.1 Rantai nilai (semuanya per hari per produk)

| baris | rumus | sumber masukan | pengisi |
|---|---|---|---|
| `RevenuePenjualan` | `Volume × HargaJual` | EasyMax | otomatis |
| `TeraValue` | `−Tera × HargaJual` | EasyMax (`terra_resmi`) | otomatis |
| `COGS` | `(Volume − Tera) × −HargaBeli` | EasyMax × **input** | campuran |
| **Gross Profit** | `Revenue + TeraValue + COGS` | — | turunan |
| `LossesGainValue` | `LossesGain × HargaBeli` | EasyMax (metode RESUME) × **input** | campuran |
| **Operating Profit** | `Gross Profit + LossesGainValue` | — | turunan |
| `InventoryValue` | `StockAkhirHari × HargaBeli` | EasyMax × **input** | campuran |
| `SOValue` | `SisaSO × HargaBeli` | EasyMax × **input** | campuran |
| **Net Profit** | `Operating Profit + BiayaOperasional + PendapatanLainLain + CashFlowAdjustment` | — | turunan |

**`Tera` WAJIB dipisah, tidak dinetokan ke volume.** Workbook Bakau sekarang
mengurangi tera dari `VolumePenjualan` dan mengosongkan sheet `Tera`. Gross Profit
tetap sama (Revenue turun `tera×jual`, TeraValue naik dari `−tera×jual` ke 0),
**tapi omzet kotor jadi salah** dan tera hilang sebagai objek yang bisa diaudit.
SolaMax memisahkannya; ikuti SolaMax. Sumber tera = ledger **`terra_resmi`**,
bukan tabel `tera` mentah.

### 1.2 Balance Sheet

`Total Asset = Cash On Hand + Inventory + SO Value + Temporary Investment +
Hutang Piutang Pelanggan EasyMax + Hutang Piutang Non-EasyMax`

`Total Equity = Opened RE + Net Income + Income Adjustment`, dengan
`Opened RE(d) = Total Equity(d−1) − ΔKontribusi/Devidend`

`Balance Sheet Check = Total Equity − Total Asset`

**Angka ini KUMULATIF.** Ia residu yang tak pernah dinolkan, bukan selisih harian.
Konsekuensinya mengikat: **satu kesalahan bertahan selamanya sampai dijurnal
keluar.** Jangan pernah membaca `BSCheck` hari-ini sebagai "kesalahan hari ini";
yang berarti adalah **selisihnya terhadap kemarin**.

`selisih harian = Net Income − ΔTotal Asset`, dan identitas yang terbukti cocok
sampai rupiah:

```
selisih harian = |penebusan| − COGS + G/L + Tera − ΔInventory − ΔSOValue
```

Pakai identitas ini untuk mendiagnosis, bukan mata telanjang.

### 1.3 Cash Flow

`Kas Awal (7 akun) + Omzet + Tera + Transaksi Piutang Pelanggan + Transaksi Hutang
Piutang Non-EasyMax + Penebusan SO + Pendapatan Lain-Lain − Biaya Operasional +
Devidend + Temporary Investment = Net Cash Change`, lalu
`CashFlow Check = Net Cash Change − ΔKas Akhir (dari buku)`.

**Tujuh akun kas**: Kas Besar · EDC Penampungan · BCA-5125036811 ·
BCA-5125978301 · BRI · Mandiri · BNI.

`CashFlow Check` menjaga hal **berbeda** dari `Balance Sheet Check`: ia menguji
apakah **arus** cocok dengan **saldo buku**. Ia tidak menguji apakah bukunya benar.
Contoh nyata di Bakau: 30-01-2026 `CashFlow Check = −915.007.430` — penebusan masuk
arus tapi tak pernah masuk buku bank. `BSCheck` hari itu justru **positif**.
**Dua pemeriksa, dua pertanyaan; jangan salah satu dianggap mewakili yang lain.**

### 1.4 Yang tidak punya sumber otomatis

Modul kas EasyMax (`tr_hkasbank`) **dorman sejak 2019** → `BukuKasBesar` dan kelima
buku bank tidak punya sumber otomatis. Tetap input.

**Satu pengecualian yang diizinkan**: baris kas besar **"Setoran Hasil Penjualan"**
boleh **DITAWARKAN** terisi, karena nilai setoran per shift sudah diketahui SolaMax
dari Rincian Penjualan. **Ditawarkan, bukan diposting.** Yang membedakan: baris itu
muncul sebagai usulan yang harus **disetujui** dan meninggalkan jejak siapa
menyetujui. Sistem yang memposting sendiri ke buku kas akan menghapus satu-satunya
titik di mana manusia melihat angka itu.

---

## 2 · Kepemilikan: fakta transaksi ≠ wewenang klasifikasi

Keputusan owner 10 Agustus 2026. **Ini yang paling mudah dirusak tanpa sadar** —
sekali ada satu tombol Edit generik, seluruh model ini bohong.

### 2.1 Dua konsep, WAJIB kolom terpisah

| konsep | milik | contoh |
|---|---|---|
| `operational_category` | **pengawas** | `Perbaikan`, `Biaya Taktis`, `Gaji Karyawan` |
| `accounting_account` (CoA) | **Finance** | `Beban Pemeliharaan Peralatan` |

**Jangan pernah menyatukannya menjadi satu kolom, dan jangan pernah menurunkan
yang satu dari yang lain saat baca.** Kalau CoA hanya turunan-saat-baca dari
kategori operasional, reklasifikasi jadi mustahil tanpa mengubah kategori
pengawas — dan itu persis yang dilarang.

### 2.2 Daur hidup transaksi sumber

1. **Draft** — pengawas bebas menyunting.
2. **Disubmit, hari belum ditutup** — Finance meninjau. Nominal / tanggal /
   uraian / metode pembayaran / informasi sumber salah → **Return for Correction**.
   **Yang memperbaiki tetap pengawas.**
3. **Setelah day closing disahkan** — transaksi asli **immutable** bagi pengawas
   **maupun** Finance.
4. **Salah ditemukan setelah closing** → **correction entry / reversal +
   corrected entry** yang bertaut ke transaksi asli.

### 2.3 Empat tindakan bernama — tidak ada yang lain

| tindakan | pelaku | mengubah transaksi asli? | kapan |
|---|---|---|---|
| `Review` | Finance | tidak | sebelum closing |
| `Return for Correction` | Finance | tidak (mengembalikan ke pengawas) | sebelum closing |
| `Reclassify` | Finance | tidak (hanya CoA) | kapan saja |
| `Adjust/Reverse` | Finance | tidak (entri baru bertaut) | setelah closing |

⛔ **Finance TIDAK punya tombol Edit generik atas transaksi dari Rincian Penjualan.**
Keputusan owner, bukan preferensi. Jangan merancang jalan pintas apa pun —
termasuk "edit selama hari belum ditutup", "edit khusus super_admin", atau
"perbaiki di layar Finance lalu sinkron balik".

**Reklasifikasi ≠ koreksi.** Contoh kanonik: pengawas mencatat Rp 500.000 sebagai
`Perbaikan`; Finance menilai akun yang benar `Beban Pemeliharaan Peralatan`.
Nominal, tanggal, dan kategori operasional **tidak berubah**; yang berpindah hanya
penyajian akuntansinya. Reklasifikasi teraudit, tidak perlu menyentuh pengawas.

### 2.4 Dua pintu, satu daftar

Biaya operasional & pendapatan lain-lain punya **dua pintu masuk**:
pengawas (Rincian Penjualan) dan Finance (yang tidak lewat pengawas).
**Daftar kategorinya satu** — 14 kategori `List!K`:

`Iklan, Promosi, Spanduk` · `Transportasi / Kendaraan Milik Perusahaan` ·
`Supir Tangki` · `Maintance Operasional SPBU (Tera, Cleaning Tank, Sabun)` ·
`Sumbangan / Donasi` · `Komputer dan Internet` ·
`Sarana & Prasarana (Listrik, Air, Lampu, Tlpn, Genset, Jalan)` ·
`Konsumsi Makanan, Lembur, & Hiburan` · `Peralatan Kantor (ATK)` ·
`Biaya Taktis` · `Gaji Karyawan` · `Lain-Lain` · `MDR` · `Biaya Admin`

**Lubang yang ada sekarang:** `app.ManualEntry` **belum punya kolom kategori** —
skemanya `(unitId, businessDate, section, urut, keterangan, amount, void, audit)`
dengan `section ∈ {pendapatan_lain, pengeluaran, setoran_tunai}`. Kategori harus
muncul **di layar Rincian Penjualan**, supaya biaya berkategori sejak awal dan
Finance tidak perlu menebak dari `keterangan`.

---

## 3 · Gerbang tutup hari — tangga toleransi

Keputusan owner, **jangan ditawar ulang**.

### 3.1 Akuntansi / GL: **Rp 0**

Neraca secara prinsip selalu balance. Tidak ada toleransi di lapis GL. Titik.

### 3.2 Penutupan operasional: tangga

| selisih | siapa boleh menutup | syarat |
|---|---|---|
| **≤ Rp 10.000** per hari per outlet | penutup operasional | `reason_code` **wajib**; selisih **tetap tercatat** |
| **Rp 10.001 – 100.000** | **Head of Finance** (exception close) | alasan **dan** bukti terdokumentasi |
| **> Rp 100.000** | **Direksi** saja (override) | alasan + bukti + persetujuan Direksi |

**Selisih di bawah toleransi TIDAK boleh dinolkan atau diabaikan.** Ia dicatat
dengan `reason_code`-nya. Alasannya bukan kerapian: pola yang berulang hanya
terlihat kalau selisih kecil disimpan. Gerbang yang "membereskan" selisih dengan
membuangnya menghapus buktinya sendiri.

**Bila RBAC tahap pertama hanya sanggup SATU peran untuk "close outside
tolerance", peran itu DIREKSI.** Jangan Head of Finance sebagai penyederhanaan —
menyederhanakan ke arah wewenang yang lebih longgar adalah pelonggaran diam-diam.

### 3.3 `reason_code` = daftar tertutup

Master baru, **bukan teks bebas**. Teks bebas membuat pola berulang tak terlihat —
sepuluh orang menulis sepuluh kalimat berbeda untuk sebab yang sama. Isi awal
daftar belum diputuskan (§7).

### 3.4 ⛔ Rp 132.000 BUKAN baseline toleransi

Selisih legacy Bakau **bukan** angka toleransi dan **tidak boleh** ditulis sebagai
konstanta di mana pun. Ia diselesaikan sekali-jalan (§6), lalu saldonya **Rp 0**.

**Dan angkanya bukan 132.268.** Residu sebenarnya per 28-01-2026 adalah
**Rp 3.635.936** — ada dua langkah setelah 132.267 terbentuk. Rinciannya di §6.

---

## 4 · Bentuk data

Bentuk, bukan DDL. Kolom audit standar (`created_by`, `created_at`, `void`,
`voided_by`, `voided_at`) diasumsikan ada di semua tabel di bawah.

### 4.1 Harga beli ber-berlaku-sejak

```
purchase_price
  unit_id           smallint      -- ter-scope RLS
  product_key       text          -- ckdbbm / kunci produk
  effective_from    date          -- BERLAKU-SEJAK, bukan deret harian
  price             numeric(14,4)
  source_note       text          -- rujukan dokumen tebus / SK harga
  + audit + void
  UNIQUE (unit_id, product_key, effective_from) WHERE NOT void
```

**Berlaku-sejak, bukan satu baris per hari.** Workbook sekarang mereplikasi nilai
yang sama ke ribuan baris; itu membuat "kapan harga berubah" tak terbaca dan
membuat sel kosong tak bisa dibedakan dari "belum diisi".

**Harga jual TIDAK diketik** — selalu dari EasyMax.

**Dua penjaga saat simpan** — dan keduanya sudah diuji terhadap 2.048 hari
sejarah Bakau (T3):

| penjaga | hasil uji | keputusan |
|---|---|---|
| beli > jual | **436 sel / 336 hari (16,4 %)** melanggar, hampir semua Pertamina Dex & Pertamax Turbo | **peringatan wajib-diakui + alasan**, BUKAN `reject` keras |
| jual berubah, beli tidak diperbarui 7 hari | **128 sel** terpicu | **tagih** — pasang apa adanya |

⚠️ **Kenapa penjaga pertama diturunkan dari `reject` ke peringatan:** `reject`
keras akan memblokir 16,4 % hari historis, dan yang terkena adalah produk
non-subsidi pada masa transisi harga — SPBU memang bisa menjual di bawah harga
tebus. Yang dicari adalah **perhatian manusia**, dan peringatan wajib-diakui
memberi itu tanpa membuat gerbang yang tak bisa dilewati pada kasus sah.
Sisakan `reject` untuk yang tak masuk akal (mis. beli > 1,5 × jual).
**Kalau owner tetap menghendaki `reject` keras, itu keputusan yang sah** — tapi
diambil dengan tahu bahwa ia menolak pola yang 336 kali nyata.

Penjaga kedua **akan menangkap kerusakan yang sedang berjalan**: harga beli Bakau
beku sejak Januari 2026 (Solar bahkan sejak 2024-12-01) sementara harga jual terus
bergerak.

### 4.2 `reason_code`

```
reason_code
  code              text PRIMARY KEY
  label             text
  applies_to        enum(closing, adjustment, reclass)
  active            boolean
```

Daftar **tertutup**. Isi awal = §7.

### 4.3 Pemetaan kategori operasional → CoA

```
category_account_map
  unit_id               smallint NULL   -- NULL = berlaku semua unit
  operational_category  text            -- 14 nilai List!K
  accounting_account    text            -- kode CoA
  effective_from        date
  + audit
```

`unit_id NULL` = pemetaan default; baris ber-unit menimpanya. Diperlukan karena
pertanyaan "apakah CoA diseragamkan 7 unit" belum dijawab (§7) — bentuk ini
sanggup untuk kedua jawaban tanpa migrasi ulang.

### 4.4 Entri reklasifikasi

```
reclassification
  id
  source_txn_id      -- taut ke transaksi asli (TIDAK diubah)
  from_account
  to_account
  reason_code
  note
  + created_by, created_at   -- append-only, tidak pernah di-UPDATE
```

Tidak menyentuh nominal, tanggal, maupun `operational_category`.

### 4.5 Entri koreksi / pembalik

**Tujuh field audit wajib** (§4 keputusan owner) — tidak ada yang opsional:

```
correction_entry
  id
  original_txn_id     -- 1. referensi transaksi asli
  reason_code         -- 2. alasan koreksi (daftar tertutup)
  value_before        -- 3. nilai sebelum
  value_after         -- 4. nilai sesudah
  submitted_by        -- 5. pengaju
  approved_by         -- 6. approver
  approved_at         -- 7. timestamp
  evidence_ref        -- bukti pendukung
  kind                enum(reversal, corrected_entry)
  + append-only
```

`submitted_by ≠ approved_by` harus ditegakkan. Approver yang sama dengan pengaju
membuat seluruh tangga di §3 jadi hiasan.

### 4.6 Penutupan hari

```
day_close
  unit_id, business_date        PRIMARY KEY
  status            enum(open, closed)
  difference_rp     numeric      -- selisih APA ADANYA, termasuk yang ≤ 10.000
  reason_code       text NULL    -- wajib bila difference_rp <> 0
  tier              enum(within_tolerance, exception_hof, override_direksi)
  closed_by, closed_at
  approved_by NULL, approved_at NULL   -- wajib utk tier ≠ within_tolerance
```

`difference_rp` disimpan **apa adanya**, tidak dibulatkan dan tidak dinolkan.

---

## 5 · Gerbang mana menjaga apa

Masing-masing menjaga hal **BERBEDA**. Jangan salah satu dianggap mewakili yang lain
— pelajaran yang sudah mahal di repo ini.

| gerbang | menjaga | TIDAK menjaga |
|---|---|---|
| `Balance Sheet Check = 0` | konsistensi internal aset vs ekuitas | apakah angkanya benar terhadap dunia luar |
| `CashFlow Check = 0` | arus cocok dengan saldo buku | apakah bukunya lengkap |
| rekonsiliasi bank ke rekening koran | buku cocok dengan **bank sungguhan** | apakah klasifikasinya benar |
| rekonsiliasi piutang ke EasyMax | buku pelanggan cocok dengan **POS** | apakah pelanggannya sanggup bayar |
| penjaga harga (§4.1) | harga beli waras & mutakhir | apakah harganya benar |
| `day_close` | ada manusia yang bertanggung jawab | benar-tidaknya angka |

**Bukti bahwa ini bukan teori.** Di Bakau, `BalanceSheet!N` bertahan di ±Rp 3,6 juta
selama bertahun-tahun sementara piutang pelanggan menyimpang **Rp 6,5 miliar** dari
EasyMax — karena penyimpangan itu konsisten **di dalam** workbook. Pemeriksa
konsistensi-diri tidak akan pernah melihatnya. **Karena itu rekonsiliasi ke sumber
luar (bank, EasyMax) wajib, bukan pelengkap.**

---

## 6 · Rencana rekonsiliasi sekali-jalan — selisih legacy Bakau

**Angka yang benar: Rp 3.635.936** (per 28-01-2026), bukan Rp 132.268.

Tersusun dari tiga langkah permanen — semua lonjakan lain (2022, 2023) berbalik
keesokan harinya dan **tidak** perlu dijurnal:

| tanggal | langkah | residu sesudahnya |
|---|---:|---:|
| 2024-01-05 | +135.133 | 132.267 |
| 2026-01-16 | +31.638 | 163.904 |
| 2026-01-19 | **+3.490.121** | **3.654.024** |
| (pergerakan kecil 20–28 Jan) | −18.088 | **3.635.936** |

Langkahnya:

1. **Selesaikan dulu kerusakan besar.** Rekonsiliasi legacy ini **tidak boleh**
   dikerjakan sebelum patah 29-01-2026 (Rp ±39,5 miliar) dan penyimpangan piutang
   (Rp ±6,5 miliar) ditangani — menjurnal Rp 3,6 juta di atas lubang Rp 46 miliar
   adalah teater.
2. Telusuri ketiga langkah di atas ke transaksi penyebabnya.
3. Susun **satu** correcting/adjusting journal dengan tujuh field audit (§4.5).
4. **Persetujuan Direksi** (di atas Rp 100.000 → §3.2).
5. Setelah cleanup, `Balance Sheet Check` harus **Rp 0**.
6. **Jangan** menulis 132.000 — atau 3.635.936 — sebagai konstanta toleransi
   di mana pun.

---

## 7 · Pertanyaan terbuka untuk tim keuangan

Toleransi (§3), wewenang penutupan (§3.2), dan kepemilikan transaksi (§2) **sudah
dijawab** — tidak ditanyakan lagi.

1. **Bagan akun (CoA) diseragamkan untuk 7 unit, atau per-unit?** Bentuk §4.3
   sanggup keduanya, tapi jawabannya menentukan siapa boleh menambah akun.
2. **Isi awal daftar `reason_code`** — minimal untuk: selisih pembulatan setoran,
   selisih kas fisik, selisih EDC settlement, koreksi salah kategori, koreksi
   salah tanggal, pembalikan entri ganda.
3. **Pemetaan awal 14 kategori operasional → CoA** (§2.4). Siapa yang menandatangani
   pemetaan pertama?
4. **`EDC Penampungan` — kapan dianggap cair?** Saldonya naik dari 0 (2021) ke
   **Rp 12.435.466.761**, turun hanya pada 78 dari 2.067 hari. Akun penampungan
   yang tak pernah cair adalah kemustahilan operasional (settlement T+1).
   Apakah ia rekening riil, atau selisih yang menumpuk?
5. **Piutang pelanggan Bakau: Rp 7,2 miliar (workbook) vs Rp 0,66 miliar (EasyMax)
   per 12-01-2026 — mana yang benar?** Buku workbook mencatat pengambilan kredit
   Rp 13,97 miliar seumur hidup tetapi pembayaran hanya Rp 2,61 miliar (dan
   **Rp 1,83 juta** sepanjang Sep-2025 → Jul-2026), sementara EasyMax menunjukkan
   pelanggan memang membayar (2025: masuk 3,34 M, bayar 3,06 M).
   **Ini harus dijawab sebelum saldo awal ditandatangani.**
6. **Tanggal cut-over per unit, dan siapa menandatangani saldo awal.**
7. **Empat rekening bank dorman** (`BCA-5125978301` terakhir 2022-08-18 ·
   `BRI` 2021-11-23 · `BNI` 2021-09-23 · `Mandiri` 2024-01-10) masih membawa
   ± Rp 94 juta di neraca. Masih ada, ditutup, atau perlu dihapusbukukan?
8. **Head of Finance sudah ada sebagai peran di RBAC, atau tahap pertama langsung
   ke Direksi?** (Kalau belum ada → §3.2 mengunci ke Direksi.)
9. **`SisaSO` untuk keuangan: `sisa` atau `sisa − sisa_macet`?** SolaMax membawa
   dua SO Solar mati sejak 2023 (Rp 105.074.482) plus SO PREMIUM 1,12 juta liter
   yang sudah dihapus Finance.
10. **Batas tanggal kiriman**: `dtgltrm` (SolaMax) atau tanggal SO ditutup
    (workbook)? Selisihnya nyata tapi saling menutup — perlu satu definisi.

---

## 8 · Batas yang DIKETAHUI

Ditulis supaya tidak ditemukan ulang sebagai kejutan.

1. **Gross Profit terbukti eksak 10/10 tanggal; Balance Sheet TIDAK diuji
   penuh.** Yang diuji: Revenue, COGS, TeraValue, Gross Profit, LossesGainValue,
   Inventory, SO Value. Yang **tidak** diuji: Cash On Hand, Temporary Investment,
   Kontribusi/Devidend, dan seluruh `CashFlow` per akun.
2. **Semua bukti berasal dari SATU unit (Bakau) dan SATU workbook.** Enam unit lain
   memakai workbook "NERACA <unit>" yang modelnya berbeda. Tidak ada dasar untuk
   mengklaim definisi di sini cocok untuk mereka.
3. **10 tanggal, bukan sampel acak.** Sengaja dipilih (5 akhir bulan, 4 hari ganti
   harga, 1 hari biasa) — bagus untuk menemukan kesalahan sistematis, **tidak**
   sahih untuk menaksir tingkat kesalahan populasi.
4. **`getSaldoPelanggan` belum pernah diverifikasi terhadap oracle di Bakau.**
   Aturannya terkunci dan terbukti 24 sel di **28 Oktober** dan **Imam Bonjol** —
   bukan Bakau. Selisih Rp 6,5 miliar di §7.5 karenanya belum bisa dibebankan
   sepenuhnya ke workbook. Oracle yang sah tetap hanya
   **"DAFTAR SALDO HUTANG PIUTANG"**, jangan "Laporan Penjualan Harian".
5. **Mutu data EasyMax Bakau punya cacat yang diketahui**: `delivery.nvolreal`
   memuat dua pencilan ekstrem (25,5 juta dan 19,3 juta liter) dan 27 baris negatif
   (total −370.820.522). Jalur G/L aman karena memakai `nvoldo`; jalur lain belum
   diperiksa. **Laporkan, jangan perbaiki** — gerbang terpisah.
6. **Workbook Bakau berhenti dipelihara ± 27–28 Juli 2026.** Setiap perbandingan
   setelah tanggal itu membandingkan dengan sesuatu yang mati.
7. **Angka Rp 40,39 miliar (nilai penerimaan tak tercatat) adalah taksiran**, bukan
   rekonsiliasi. Ia cocok dalam 2,4 % dengan selisih neraca; jangan dikutip
   sebagai angka jurnal.
8. **Tidak ada satu pun dari ini yang sudah masuk kode.** Tidak ada tabel, tidak
   ada gerbang, tidak ada migrasi. K1 belum dimulai.
