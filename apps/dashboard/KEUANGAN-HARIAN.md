# Keuangan Harian — keputusan yang mengikat

Model akuntansi penuh per unit: buku kas/bank/EDC → Cash Flow · Income Statement ·
Balance Sheet harian, dengan **penutupan hari** sebagai gerbang.

Model sasaran = workbook **`Finance SPBU 6378301 BK`** (Bakau).
Workbook **"NERACA <unit>"** (penaksir harta bersih, `Laba = Δ harta bersih`)
**bukan** model sasaran dan tidak boleh dipakai sebagai acuan definisi.

**Berkas ini bukan tutorial dan bukan kronologi.** Ia daftar keputusan yang
mengikat ke depan, alasannya, dan batas yang diketahui. Kalau kamu menyentuh
keuangan harian, baca ini lebih dulu.

Status: **K1 DIBUKA 12 Agustus 2026** — B1–B8 terjawab (**§10**), §9.1 tercentang.
Gerbang masuk K1: **§9**, dan ia tetap mengikat untuk setiap PR.

Bukti: [`session-notes/2026-08-10-keuangan-k0-t1-neraca-bakau.md`](../../session-notes/2026-08-10-keuangan-k0-t1-neraca-bakau.md) ·
[`…-t2-peta-masukan.md`](../../session-notes/2026-08-10-keuangan-k0-t2-peta-masukan.md) ·
[`…-t3-prareg.md`](../../session-notes/2026-08-10-keuangan-k0-t3-prareg.md) (segel) ·
[`…-t3-hasil.md`](../../session-notes/2026-08-10-keuangan-k0-t3-hasil.md) ·
[`…-k0b-oracle-saldo-bakau.md`](../../session-notes/2026-08-10-keuangan-k0b-oracle-saldo-bakau.md).

Untuk tim keuangan (bahasa non-teknis, bukan salinan berkas ini):
[`…-serah-terima-tim-keuangan.md`](../../session-notes/2026-08-10-keuangan-serah-terima-tim-keuangan.md).

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

> ### ⛔ Yang dinilai gerbang adalah LANGKAH HARIAN, bukan nilai kumulatifnya
>
> **Keputusan owner 10 Agustus 2026 — kunci.** Tangga toleransi §3 dan
> `day_close.difference_rp` (§4.6) mengukur **`BSCheck(d) − BSCheck(d−1)`**.
>
> **Kalau gerbang menilai nilai kumulatifnya:** satu residu lama yang belum
> dijurnal keluar akan **memerahkan setiap hari sesudahnya selamanya**, dan hari
> yang benar-benar rusak tenggelam di antaranya. Sebaliknya, satu hari yang rusak
> Rp 50 juta bisa lolos hanya karena kumulatifnya kebetulan mendekati nol.
>
> Bukti bahwa ini bukan kekhawatiran teoretis: Bakau membawa residu Rp 3,6 juta
> selama bertahun-tahun **sambil tetap sehat**, lalu patah pada 29-01-2026 dengan
> langkah −52.779.482 dalam satu hari. Gerbang berbasis-kumulatif akan menyalakan
> alarm sepanjang tahun-tahun sehat itu dan tetap menyalakan alarm yang sama pada
> hari patahnya — tak bisa dibedakan.

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
| selisih (NILAI MUTLAK) | predikat | tier |
|---|---|---|
| **≤ Rp 10.000** per hari per outlet | penutup operasional | `within_tolerance` |
| **Rp 10.001 – 100.000** | `direksi ∨ super_admin ∨ isHeadOfFinance` | `exception_hof` |
| **> Rp 100.000** | `direksi ∨ super_admin` — **TANPA HoF** | `override_direksi` |

Wewenang tingkat ketiga = **keputusan owner 13 Agustus 2026**. Syaratnya tetap:
tingkat 2 & 3 menuntut alasan, bukti terdokumentasi, dan persetujuan.

⛔ **Kedua predikat WAJIB berdiri sendiri**
([`keuangan-wewenang.ts`](src/lib/keuangan-wewenang.ts): `canCloseException` dan
`canOverrideAboveMax`). Bedanya hanya **satu suku** — `isHeadOfFinance` — dan
justru suku itulah yang membuat tangga ini punya arti. Menyatukannya "toh cuma
beda HoF", atau menulis tingkat 3 sebagai turunan tingkat 2, membuat tangganya
runtuh **tanpa satu pun tes merah**. Karena itu ada tes yang memerah bila HoF
bisa menutup selisih > Rp 100.000.

**Ambangnya pada NILAI MUTLAK**: toleransi soal besaran, bukan arah. Kurang
setor Rp 50.000 sama seriusnya dengan lebih setor Rp 50.000.

**`tier` adalah FUNGSI dari selisih, bukan pilihan.** Ditegakkan di DB (CHECK
`day_close_tier_matches_difference`, migrasi 0026) — tanpa itu selisih Rp 5 juta
bisa ditulis `within_tolerance` dan lolos tanpa persetujuan siapa pun.

**Selisih di bawah toleransi TIDAK boleh dinolkan atau diabaikan.** Ia dicatat
dengan `reason_code`-nya. Alasannya bukan kerapian: pola yang berulang hanya
terlihat kalau selisih kecil disimpan. Gerbang yang "membereskan" selisih dengan
membuangnya menghapus buktinya sendiri.

~~Bila RBAC tahap pertama hanya sanggup SATU peran…~~ — **tidak berlaku lagi**:
HoF ada sebagai **kapabilitas** (§10.4), jadi tangganya utuh sejak awal. Yang
tetap berlaku: **jangan menyederhanakan ke arah wewenang yang lebih longgar.**

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

| penjaga | perilaku | hasil uji sejarah |
|---|---|---|
| **P1** — harga beli > harga jual | **PERINGATAN WAJIB-DIAKUI** (keputusan owner 10 Agu 2026) | 436 sel / 336 hari terpicu |
| **P2** — harga jual berubah, harga beli tidak diperbarui dalam 7 hari | **TAGIH** | 128 sel terpicu |

#### P1 — peringatan wajib-diakui (keputusan owner, 10 Agustus 2026)

**P1 BUKAN `reject`.** Penyimpanan tetap berhasil; yang dituntut adalah perhatian
manusia. Alasannya: menjual di bawah harga tebus **secara operasional sah** pada
masa transisi harga, terutama produk non-subsidi.

Bentuk yang mengikat — ketiganya wajib, bukan pilihan:

1. **Centang wajib.** Penyimpanan ditolak selama kotak "saya sadar harga beli di
   atas harga jual" belum dicentang. Yang menghalangi adalah **pengakuan**, bukan
   nilainya.
2. **Alasan tertulis wajib**, teks bebas, tidak boleh kosong, **tersimpan bersama
   baris harga** — bukan hanya ditampilkan lalu hilang.
3. **Bisa dihitung frekuensinya per produk.** Simpan sebagai baris yang dapat
   diagregasi `(unit, produk, tanggal, selisih, alasan, siapa)`.
   **Kalau satu produk memicu terus-menerus, itu temuan — bukan kebisingan.**
   Peringatan yang tidak bisa dihitung akan berubah jadi refleks mencentang, dan
   pada titik itu ia berhenti menjaga apa pun.

Konsekuensi bentuk ini: `purchase_price` (§4.1) butuh kolom pendamping
`p1_acknowledged_by`, `p1_acknowledged_at`, `p1_reason` — terisi **hanya** saat P1
terpicu, dan wajib terisi seluruhnya bila terpicu.

#### P2 — tagih

Pasang apa adanya. Penjaga ini **akan menangkap kerusakan yang sedang berjalan**:
harga beli Bakau beku sejak Januari 2026 (Solar bahkan sejak 2024-12-01) sementara
harga jual terus bergerak sampai Juli 2026.

### 4.1b ⛔ ATURAN RLS untuk SETIAP tabel baru yang punya `unit_id`

Dua keputusan yang **wajib** diambil sadar, bukan diwarisi dengan menyalin:

**(a) Pasang RLS-nya sendiri.** `0016_rls_unit_scope` self-adjusting **hanya atas
tabel yang sudah ada saat ia dijalankan**; `prisma migrate deploy` tidak
menjalankannya ulang. Tabel unit-scoped yang lahir sesudahnya berdiri **tanpa
RLS** kalau bloknya lupa — dan **tidak ada yang berbunyi merah**.

**(b) Putuskan cabang `NULL`-nya, JANGAN menyalin predikat.**
Predikat 0016 adalah `unit_id = ANY (ARRAY(...))`. Untuk baris ber-`unit_id NULL`
ekspresi itu menghasilkan **NULL, bukan true** ⇒ **barisnya tak terlihat oleh
siapa pun, tanpa satu pun galat**.

| tabel punya baris berlaku-global? | predikat |
|---|---|
| **tidak** (mis. `day_close`, `purchase_price`) | salin PERSIS 0016 — **dan nyatakan** bahwa ketiadaan cabang NULL itu keputusan |
| **ya** (mis. `category_account_map`) | `unit_id IS NULL OR <predikat 0016>` |

Kalau memilih cabang `NULL`, ikut wajib: **indeks unik memakai
`COALESCE(unit_id, -1)`** — tanpa itu baris global bisa digandakan diam-diam,
sebab NULL ≠ NULL di indeks unik biasa.

⚠️ **Bahaya yang menyertai pilihan (b):** 0016 memakai
`DROP POLICY IF EXISTS unit_scope`. Menjalankannya ulang secara manual akan
mengganti policy bercabang-NULL dengan versi ketat, dan baris globalnya lenyap.
Jalankan ulang migrasi tabel itu bila terjadi.

Ini kelas kegagalan yang berulang di proyek ini: **bukan yang meledak, melainkan
yang hijau dan salah.** Karena itu ia aturan, bukan catatan.

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
  difference_rp     numeric      -- LANGKAH HARIAN BSCheck(d) − BSCheck(d−1),
                                 -- apa adanya, termasuk yang ≤ 10.000
  reason_code       text NULL    -- wajib bila difference_rp <> 0
  tier              enum(within_tolerance, exception_hof, override_direksi)
  closed_by, closed_at
  approved_by NULL, approved_at NULL   -- wajib utk tier ≠ within_tolerance
```

`difference_rp` adalah **langkah harian**, bukan nilai kumulatif (§1.2), disimpan
**apa adanya**, tidak dibulatkan dan tidak dinolkan.

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
5. **Piutang pelanggan Bakau lebih saji ± Rp 6,5 miliar — ke mana lawan-catat
   uang tagihannya pergi?** Pertanyaan "mana yang benar" **sudah terjawab**:
   `getSaldoPelanggan` kini CONFIRMED di Bakau (§8.4), jadi angka EasyMax
   Rp 0,66 miliar benar dan **workbook yang lebih saji**. Yang tersisa: buku
   workbook mencatat pengambilan kredit tetapi hampir tak pernah mencatat
   penagihan (Rp 1,83 juta sepanjang Sep-2025 → Jul-2026 melawan Rp 5,63 miliar
   piutang baru) — kalau uang itu masuk bank sebagai "Setoran Hasil Penjualan",
   maka **pendapatan ikut lebih saji** dan jurnal koreksinya menyentuh laba,
   bukan hanya neraca. **Ini harus dijawab sebelum saldo awal ditandatangani.**
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
4. ~~`getSaldoPelanggan` belum pernah diverifikasi terhadap oracle di Bakau.~~
   ✅ **DITUTUP 2026-08-10 — CONFIRMED, 15/15 sel eksak di 5 tanggal Bakau**
   ([bukti](../../session-notes/2026-08-10-keuangan-k0b-oracle-saldo-bakau.md)).
   Total lintas unit kini **39 sel di 3 unit**. Oracle yang sah tetap hanya
   **"DAFTAR SALDO HUTANG PIUTANG"** (`RPT_GLDFTSALDOHP.FRX`), jangan "Laporan
   Penjualan Harian". Sisa batas yang jujur: tanggal ujinya **2022** — yang
   terbukti adalah **formulanya**; kelengkapan data 2025–2026 diperiksa terpisah
   (kontinuitas `bppiut` bersih, 0 hari bolong) tetapi belum dicocokkan ke oracle
   2026. Ini **tidak** memblokir apa pun.
5. **Penjaga P1 (§4.1) menyentuh 436 sel / 336 hari (16,4 % dari 2.048 hari)
   sejarah Bakau** — hampir seluruhnya Pertamina Dex dan Pertamax Turbo. Itulah
   sebabnya ia peringatan wajib-diakui dan bukan `reject`: pada volume sebesar itu,
   penolakan keras akan memblokir pola yang secara operasional sah. Kalau kelak
   frekuensinya turun drastis, asumsi ini boleh ditinjau ulang.
6. **Mutu data EasyMax Bakau punya cacat yang diketahui**: `delivery.nvolreal`
   memuat dua pencilan ekstrem (25,5 juta dan 19,3 juta liter) dan 27 baris negatif
   (total −370.820.522). Jalur G/L aman karena memakai `nvoldo`; jalur lain belum
   diperiksa. **Laporkan, jangan perbaiki** — gerbang terpisah.
7. **Workbook Bakau berhenti dipelihara ± 27–28 Juli 2026.** Setiap perbandingan
   setelah tanggal itu membandingkan dengan sesuatu yang mati.
8. **Angka Rp 40,39 miliar (nilai penerimaan tak tercatat) adalah taksiran**, bukan
   rekonsiliasi. Ia cocok dalam 2,4 % dengan selisih neraca; jangan dikutip
   sebagai angka jurnal.
9. **Tidak ada satu pun dari ini yang sudah masuk kode.** Tidak ada tabel, tidak
   ada gerbang, tidak ada migrasi. K1 belum dimulai.

---

## 10 · Jawaban B1–B8 — keputusan owner 12 Agustus 2026

**K1 DIBUKA oleh keputusan ini.** Berkas inilah artefak §9.1; sebelum ada §10,
kedelapan kotak BLOKIR kosong dan tidak ada dasar menulis kode.

Tiap butir memuat **jawaban · alasan · konsekuensi**. Konsekuensinya yang mengikat
pelaksana — jawabannya saja tidak cukup untuk mencegah salah bangun.

### 10.1 B1 · Bagan akun SERAGAM untuk 7 unit

**Jawaban:** seragam. `category_account_map.unit_id` **tetap nullable**
(`NULL` = berlaku semua unit), dengan **nol** baris ber-unit saat mulai.

**Alasan:** yang menegakkan keseragaman **bukan skema, melainkan gerbang owner** —
menambah baris ber-unit butuh persetujuan. Kolom dibiarkan nullable supaya
pengecualian pertama nanti menjadi **satu baris data**, bukan migrasi `ALTER` di
tabel yang sudah berisi.

**Konsekuensi:** jangan "merapikan" kolom itu jadi `NOT NULL` karena sekarang
kosong. Kekosongannya adalah keadaan yang dijaga, bukan sisa yang belum diisi.

### 10.2 B2 · `reason_code` — 19 kode, daftar TERTUTUP

**`closing` (10)**

| kode | arti |
|---|---|
| `CLS-ROUND` | Pembulatan setoran |
| `CLS-CASH` | Selisih kas fisik |
| `CLS-EDC-TIMING` | EDC belum settle |
| `CLS-EDC-MDR` | Potongan MDR belum dibukukan |
| `CLS-BANK-TIMING` | Mutasi bank beda hari |
| `CLS-PURCH-PENDING` | Pembelian BBM belum diposting |
| `CLS-PRICE-PENDING` | Harga beli belum diperbarui |
| `CLS-AR-PENDING` | Pembayaran pelanggan belum diposting |
| `CLS-DO-PENDING` | Penerimaan/penebusan belum diinput |
| `CLS-INVESTIGATING` | Sedang ditelusuri — **tanggal target WAJIB** |

**`adjustment` (6)** — `ADJ-AMOUNT` Nominal salah · `ADJ-DATE` Tanggal salah ·
`ADJ-DUP` Entri ganda (dibalik) · `ADJ-MISSING` Transaksi terlewat · `ADJ-PARTY`
Salah pelanggan/akun lawan · `ADJ-LEGACY` Jurnal rekonsiliasi legacy
(persetujuan Direksi)

**`reclass` (3)** — `RCL-NATURE` Sifat pengeluaran berbeda · `RCL-SPLIT` Mestinya
terbagi dua akun · `RCL-MAPDEF` Pemetaan default keliru

⛔ **Tidak ada "Lain-lain" untuk penutupan hari.** Katup jujurnya
`CLS-INVESTIGATING`, dan katup itu **dijaga tanggal target wajib**: hari yang lewat
tanggal targetnya **naik sendiri ke Direksi**, tanpa perlu ada orang yang melapor.

**Alasan bentuk itu:** katup tanpa batas waktu berubah menjadi tempat sampah dalam
hitungan minggu. Eskalasi yang bergantung pada seseorang mengingat = eskalasi yang
tidak terjadi. Karena itu **waktulah** yang menaikkannya, bukan manusia.

**`RCL-MAPDEF` sengaja terpisah dari `RCL-NATURE`:** kalau ia sering muncul untuk
kategori yang sama, yang salah **tabel pemetaannya**, bukan transaksinya. Pemisahan
ini satu-satunya cara membedakan keduanya tanpa membaca satu per satu.

**Konsekuensi:** frekuensi tiap kode dihitung **per unit per bulan**. Kode yang
berulang adalah **temuan proses** — bukan alasan menaikkan toleransi §3.

### 10.3 B3 · Pemetaan 14 kategori → CoA, satu-ke-satu

Bagan: `5-` HPP · `6-1` personil · `6-2` operasional SPBU · `6-3` umum & admin ·
`6-4` pemasaran · `6-9` lain/taktis · `7-` beban keuangan · `8-` pendapatan lain.

| kategori operasional (milik pengawas) | CoA (milik Finance) |
|---|---|
| Iklan, Promosi, Spanduk | `6-4100` Promosi & Iklan |
| Transportasi / Kendaraan Milik Perusahaan | `6-2200` Kendaraan Operasional |
| **Supir Tangki** | **`6-2100` Supir Tangki** |
| Maintance Operasional SPBU (Tera, Cleaning Tank, Sabun) | `6-2300` Pemeliharaan Sarana |
| Sumbangan / Donasi | `6-3500` Sumbangan & Donasi |
| Komputer dan Internet | `6-3300` IT & Komunikasi |
| Sarana & Prasarana (Listrik, Air, Lampu, Tlpn, Genset, Jalan) | `6-2400` Utilitas & Prasarana |
| Konsumsi Makanan, Lembur, & Hiburan | `6-1300` Konsumsi & Lembur |
| Peralatan Kantor (ATK) | `6-3100` Perlengkapan Kantor |
| Biaya Taktis | `6-9100` Beban Taktis |
| Gaji Karyawan | `6-1100` Gaji & Tunjangan |
| Lain-Lain | `6-9900` Beban Lain-Lain |
| MDR | `7-1200` MDR |
| Biaya Admin | `7-1100` Administrasi Bank |

Sisi pendapatan: `8-1000` Pendapatan Lain-Lain.

🔴 **Supir Tangki / mobil tangki = beban operasional `6-2100`, BUKAN freight-in ke
HPP.** Keputusan owner.

**Konsekuensi yang menyelamatkan pekerjaan:** karena ongkos angkut **tidak** masuk
HPP, **Gross Profit tetap `Revenue + TeraValue + COGS` apa adanya** — dan angka GP
yang sudah **terbukti eksak 10/10 tanggal** (T3) tetap berlaku sebagai kasus emas.
Kalau jawabannya freight-in, seluruh 10 kasus emas itu harus dihitung ulang.

**Dua kategori membungkus dua hal** — #7 (utilitas + prasarana) dan #8 (lembur =
personil vs konsumsi = umum). Tangani **per kasus** dengan `RCL-SPLIT`. Kalau
sering, itu sinyal memecah **kategori operasionalnya** — dan kategori operasional
milik pengawas ⇒ **keputusan owner, bukan Finance** (§2.1).

**Konsekuensi pelaporan:** `Lain-Lain` dan `Biaya Taktis` **wajib muncul di laporan
bulanan dengan nilai DAN frekuensinya**, supaya "lain-lain" tidak diam-diam menjadi
pos terbesar ketiga.

### 10.4 B4 · Head of Finance = KAPABILITAS, bukan peran di `ROLE_RANK`

**Jawaban:** peran `Head of Finance` **ada**, pemegangnya `ddsalam@solagroup.co`.
**Direksi mewarisi seluruh akses HoF.**

🔴 **JANGAN sisipkan `head_of_finance` ke `ROLE_RANK`**
([`scope-rule.ts`](src/lib/scope-rule.ts): `pengawas 0 · direksi 1 ·
admin_perusahaan 2 · super_admin 3`).

**Alasan:** tangga itu mengatur **cakupan data**, bukan wewenang keuangan.
Menaruh HoF **di atas** `direksi` ⇒ HoF melihat lebih banyak data daripada Direksi.
Menaruhnya **di bawah** ⇒ Direksi kehilangan wewenang HoF. Keduanya salah, dan
keduanya baru ketahuan setelah kebijakan RLS ditulis.

**Bentuk yang dipakai — kapabilitas terpisah:**

```
canCloseException = role ∈ {direksi, super_admin} ∨ isHeadOfFinance
```

**Terverifikasi dari kode (12 Agu 2026):** invarian *satu peran per orang* bukan
konvensi melainkan **struktural** — `app.user_role.user_id` adalah **PRIMARY KEY**
([`schema.prisma`](../backend/prisma/schema.prisma) `model UserRole`). Jadi HoF
memang **tidak bisa** dijadikan peran kedua bagi orang yang sudah punya peran.
Ini mengunci: kapabilitas, bukan peran.

**Konsekuensi:** `day_close.tier` tetap tiga tingkat (§3.2). `canCloseException`
hidup di satu tempat dan dipakai baik oleh gerbang maupun layar — jangan
menduplikasi predikatnya.

### 10.5 B5 · `EDC Penampungan` = akun kliring riil, cair H+1

**Jawaban:** akun kliring riil, cair **H+1** berdasarkan data settlement.
**MDR dipotong di muka** (bank mentransfer neto). Settlement direkam di **rekapan
akhir shift**.

**Jurnal pencairan H+1:**

```
Kas Bank (neto yang masuk)          D
Beban MDR  7-1200                   D
    EDC Penampungan (bruto)             K
```

`7-1200` **terisi otomatis dari selisih bruto − neto, tidak diketik.** Angka yang
diketik ulang dari yang sudah diketahui sistem adalah angka yang bisa salah ketik.

**Yang perlu dibangun:** sisi **batch settlement** — nomor & tanggal settlement,
acquirer, total batch, potongan. Sisi transaksinya **sudah ada** di tabel `edc`.

**Jurnal pencairannya DITAWARKAN, bukan diposting** (pola §1.4). Selisih
transaksi-vs-settlement **berdiri sebagai selisih ber-`reason_code`**
(`CLS-EDC-TIMING` / `CLS-EDC-MDR`), tidak dibulatkan hilang.

**Kontrol gratis yang wajib ikut dibangun:** **MDR sebagai % omzet EDC, per
acquirer per bulan.** Persentase yang bergeser tanpa perubahan perjanjian adalah
temuan — dan kontrol ini tidak menambah data apa pun, hanya membaginya.

⚠️ **Konsekuensi jawaban ini terhadap Bakau:** kalau EDC adalah akun kliring yang
cair H+1, maka saldo **Rp 12.435.466.761** pada akun yang semestinya berisi ±satu
hari omzet non-tunai — turun hanya **78 dari 2.067 hari** — **bukan lagi pertanyaan
terbuka, melainkan kerusakan keempat Bakau**. Sudah dipromosikan di paket
serah-terima.

### 10.6 B6 · `SisaSO` = `sisa − sisa_macet`

**Jawaban:** `SOValue` memakai **`sisa − sisa_macet`** — "sisa yang masih bisa
digunakan". Definisi "macet" = **penandaan manual Finance**; ambang hari hanya
**mengusulkan kandidat**, tidak memutuskan.

**Alasan:** ambang otomatis yang memutuskan akan menghapus SO yang sebenarnya masih
ditagih, dan menghidupkan kembali SO mati begitu ambangnya digeser. Penandaan
manual membuat penghapusan itu **punya pemilik dan tanggal**.

**Konsekuensi:** yang dibangun adalah **penandaan `so_macet`-nya**, bukan ambangnya.
Ambang boleh dipakai untuk mengurutkan daftar kandidat — tidak boleh dipakai untuk
mengubah `SOValue` sendirian. Dua SO Solar Bakau 2023 (Rp 105.074.482) dan SO
PREMIUM 1,12 juta liter adalah kandidat pertama, **bukan** penghapusan otomatis.

### 10.7 B7 · Dua sumbu tanggal, bernama, tidak pernah dicampur

**Jawaban:**

| sumbu | dipakai untuk |
|---|---|
| **`dtgltrm`** (tanggal terima fisik) | **Inventory & COGS** |
| **tanggal SO ditutup** | **hanya** sisa DO / `SOValue` |

**Alasan:** keduanya menjawab pertanyaan berbeda — "liter ini sudah ada di tangki
hari mana" versus "pesanan ini masih menggantung hari mana". Selisih D3 di T3
(8.000 L Pertalite 2025-12-31) muncul justru karena workbook memakai satu sumbu
untuk dua pertanyaan.

**Konsekuensi:** beri **nama** pada kedua sumbu di kode dan jangan pernah
memberi satu fungsi parameter tanggal yang artinya bergantung pemanggil.

### 10.8 B8 · `ManualEntry` — aditif, semua kolom baru nullable, nol backfill nilai

```
operational_category  text NULL   -- pengawas; wajib utk section pengeluaran & pendapatan_lain
accounting_account    text NULL   -- DISIMPAN, diisi dari category_account_map saat submit, lalu beku
status                enum(draft, submitted, returned, closed) NOT NULL DEFAULT 'submitted'
submitted_at, reviewed_by_user_id, reviewed_at, returned_reason
```

Lima aturan, semuanya mengikat:

1. **`operational_category` NULL = "belum berkategori", bukan ditebak.**
   ⛔ Jangan pernah menurunkannya dari `keterangan` — itu menebak milik pengawas.
2. **`accounting_account` DISIMPAN, bukan diturunkan saat baca** (§2.1). Akun
   efektif = reklasifikasi non-void terakhir bila ada, kalau tidak nilai beku ini.
   Dengan begitu `reclassification` tetap append-only dan **tak pernah menyentuh
   baris asli**.
3. **Backfill `status` = `submitted`, BUKAN `closed`.** Immutabilitas datang
   bersama `day_close`; ia **tidak dipasang mundur** ke hari yang tak pernah
   melewati gerbangnya.
4. **`void` hanya berlaku pada `draft`/`submitted`.** Setelah hari ditutup hanya
   `Adjust/Reverse` (§2.3). Ditegakkan **di DB**, bukan hanya di aplikasi.
5. **`setoran_tunai` tidak ikut aturan kategori** — ia bukan beban.

⚠️ **Yang berisiko bukan migrasinya, melainkan LAYARNYA.** Pemilih kategori di
Rincian Penjualan menyentuh permukaan yang dipakai **7 unit tiap hari** ⇒ **gerbang
tersendiri**, dengan **mode transisi**: kategori **opsional dulu**, wajib setelah
pengawas terbiasa.

**Alasan mode transisi:** memaksa wajib di hari pertama menghasilkan pilihan asal,
dan **data asal lebih buruk daripada data kosong** — kosong jujur mengatakan "belum
berkategori", asal berbohong bahwa ia sudah.

### 10.10 Taksonomi "transaksi apa yang boleh dikoreksi" — SENGAJA BELUM DITUTUP

**Keputusan owner 12 Agustus 2026.** Taut ke transaksi asli pada
`correction_entry` dan `reclassification` bersifat **polimorfik: `source_kind`
eksplisit, TANPA foreign key.**

**Alasan — bukan "biar fleksibel":** model ini **sudah berkomitmen** pada buku
kas besar, lima buku bank, dan settlement EDC sebagai ledger terpisah (§1.3–§1.4).
Sumber kedua bukan kemungkinan, ia **jadwal**. FK ke `manual_entry` hari ini
berarti mencabutnya nanti — dan pencabutan itu migrasi di tabel yang sudah
berisi entri koreksi, persis kelas pekerjaan yang gerbang §9 dibuat mencegah.

**"Tanpa FK" TIDAK berarti "tanpa integritas".** Dua penjaga menggantikannya,
dan keduanya perlu — satu tidak menggantikan yang lain:

| penjaga | letak | mencegah |
|---|---|---|
| `source_kind` daftar tertutup | CHECK migrasi `0025` | salah ketik / jenis karangan |
| penjaga **yatim** | [`keuangan-integritas.ts`](src/lib/keuangan-integritas.ts) | taut yang menunjuk ke **ketiadaan** |

Perbedaan sifat yang harus disadari: FK **mencegah**, penjaga yatim **menemukan
setelah terjadi**. Karena itu ia harus benar-benar dijalankan — penjaga yang
tidak pernah dipanggil sama saja dengan tidak ada.

Hari ini `source_kind` berisi **tepat satu** nilai: `manual_entry`.

#### ⛔ Syarat yang membangunkannya

Begitu ledger kedua lahir (kas besar / bank / EDC), **dalam PR yang SAMA**:

1. perluas CHECK `source_kind` di migrasi baru;
2. tambahkan nilainya ke `SUMBER_SAH`;
3. tambahkan pengambil id-nya ke `SUMBER_ID_SQL`.

**Ketiganya bersamaan, bukan menyusul.** Penjaga yang tertinggal satu rilis
adalah penjaga yang buta terhadap justru sumber yang baru — dan sumber baru
adalah tempat kesalahan paling mungkin muncul. Ada unit test yang memaksa
langkah 2 dan 3 berjalan beriringan; langkah 1 dijaga oleh CHECK-nya sendiri.

**Menambah nilai = menambah sumber yang bisa dikoreksi = KEPUTUSAN OWNER**,
bukan keputusan pelaksana.

### 10.9 Yang BELUM terverifikasi dari keputusan ini

Ditulis supaya tidak dianggap sudah beres:

1. **Apakah `ddsalam@solagroup.co` sudah ada di `app.users`** — **belum bisa
   diperiksa**: kredensial `gcloud` (user maupun ADC) perlu reauth
   (`invalid_rapt`), sehingga cloud-sql-proxy tidak bisa tersambung pada sesi ini.
   Kalau belum ada, ia diundang lewat `/admin` — **tindakan owner**, bukan pelaksana.
2. **OAuth consent masih `Testing` dengan 4 test user** — status terdokumentasi di
   `CLAUDE.md`, **tidak diverifikasi ulang** sesi ini (alasan sama). Kalau HoF
   bukan salah satu dari 4 test user, ia tidak akan bisa login.
3. Keduanya **tidak memblokir** penulisan kode §9.3, tetapi **memblokir** pengujian
   `canCloseException` end-to-end.

---

## 9 · Gerbang masuk K1 — daftar periksa

**Ini gerbang, bukan aspirasi.** Kalau owner memutuskan menembus salah satu
BLOKIR, itu keputusan yang sah — tetapi **harus disebut** dan dicatat di sini,
bukan dilewati diam-diam.

Aturan pengisian: centang hanya kalau ada **artefak** yang bisa ditunjuk
(keputusan tertulis, berkas, atau commit). "Sudah dibahas" bukan centang.

**Status per 12 Agustus 2026: K1 BELUM DIBUKA — keputusan owner.** Termasuk §9.3.
Alasannya bukan kehati-hatian berlebihan: §9.3 memang aman secara bentuk, tetapi
membukanya sebelum B1–B8 terjawab membuat gerbang ini berhenti berarti apa adanya
pada hari yang sama ia ditulis. Jalur kritis proyek ini **bukan kode** — ia jawaban
B1–B8 dari tim keuangan. Menulis kode paralel hanya memindahkan antrean, bukan
memperpendeknya.

### 9.1 BLOKIR — apa yang diblokir, dan apa yang tidak

**Yang diblokir B1–B8 (selama satu saja belum tercentang):** setiap pekerjaan yang
**bentuk tabel atau bentuk gerbangnya bergantung pada jawaban B1–B8** — yaitu
migrasi/DDL untuk tabel yang bentuknya belum tetap, kebijakan RLS dan peran RBAC
penutupan, mesin `SOValue`, gerbang tutup hari beserta tiernya, serta perubahan
`app.ManualEntry`. Menebaknya lebih dulu berarti membangun lalu membongkar — dan
membongkarnya nanti dilakukan di tabel yang sudah berisi data produksi 7 unit.

**Yang TIDAK diblokir B1–B8:** hanya butir yang tercantum di **§9.3**, dan hanya
karena tiap butirnya **sudah diperiksa satu per satu** bahwa bentuknya tidak
berubah oleh jawaban B1–B8 mana pun. §9.3 adalah **daftar pengecualian tertutup**,
bukan kategori terbuka.

⛔ **Menambah butir ke §9.3 butuh gerbang owner tersendiri.** Pelaksana **tidak
boleh** memutuskan sendiri bahwa suatu pekerjaan "sebenarnya juga aman paralel",
sekalipun alasannya terdengar kuat. Gerbang yang bisa diperluas oleh yang
dijaganya bukan gerbang.

**Status B1–B8: SEMUA TERCENTANG — dijawab owner 12 Agustus 2026, artefaknya
commit `b8decb2` (§10). K1 DIBUKA.** Kotak di bawah tidak boleh dikosongkan
kembali tanpa keputusan owner yang mencabut §10.

Alasan tiap butir memblokir:

| # | Yang harus ada | Kenapa memblokir | Artefak | ☐ |
|---|---|---|---|---|
| B1 | **Bagan akun (CoA) diseragamkan 7 unit atau per-unit** (§7.1) | Menentukan apakah `category_account_map.unit_id` nullable dipakai atau `NOT NULL`; salah tebak = migrasi ulang di tabel yang sudah berisi | commit `b8decb2` §10.1 | ☑ |
| B2 | **Isi awal daftar `reason_code`** (§7.2) | Daftar tertutup harus punya isi sebelum gerbang §3 bisa menolak apa pun; gerbang dengan master kosong = gerbang yang selalu lolos | commit `b8decb2` §10.2 | ☑ |
| B3 | **Pemetaan 14 kategori operasional → CoA** (§7.3) | Tanpa ini `accounting_account` tak punya nilai awal, dan `Reclassify` tak punya titik berangkat | commit `b8decb2` §10.3 | ☑ |
| B4 | **Peran RBAC penutupan: Head of Finance ada, atau langsung Direksi** (§7.8) | Menentukan jumlah tier di `day_close.tier`; menambah peran belakangan berarti membongkar tabel + kebijakan RLS | commit `b8decb2` §10.4 | ☑ |
| B5 | **Perlakuan `EDC Penampungan`** (§7.4) | Ia salah satu dari tujuh akun kas. Kalau ternyata bukan akun riil, struktur `CashFlow` berubah | commit `b8decb2` §10.5 | ☑ |
| B6 | **`SisaSO`: `sisa` atau `sisa − sisa_macet`** (§7.9) | Mengubah definisi `SOValue`, yang masuk Balance Sheet. Ini satu-satunya pos T3 yang belum pernah cocok | commit `b8decb2` §10.6 | ☑ |
| B7 | **Batas tanggal kiriman: `dtgltrm` atau tanggal SO ditutup** (§7.10) | Menentukan hari mana suatu liter masuk persediaan — memengaruhi Inventory, SO Value, dan gerbang tutup hari sekaligus | commit `b8decb2` §10.7 | ☑ |
| B8 | **Keputusan owner atas bentuk `ManualEntry` + kategori** (§2.4) | Menambah kolom milik pengawas ke tabel yang **sudah dipakai produksi** di 7 unit; harus diputuskan sekali, bukan diiterasi | commit `b8decb2` §10.8 | ☑ |

**B1–B8 semuanya pertanyaan orang, bukan pekerjaan kode.** Tidak satu pun bisa
diselesaikan dengan menulis program lebih dulu.

### 9.2 BLOKIR bersyarat — hanya untuk unit yang di-cut-over

Bukan penghalang menulis kode, tetapi penghalang **menyalakan** unit tertentu.

| # | Yang harus ada | Berlaku saat | Artefak | ☐ |
|---|---|---|---|---|
| C1 | **Tanggal cut-over + penandatangan saldo awal** (§7.6) | sebelum unit itu ditutup-harinya pertama kali | ______ | ☐ |
| C2 | **Rekonsiliasi kas ke rekening koran**, termasuk 4 rekening dorman (§7.7) | idem | ______ | ☐ |
| C3 | **Jawaban ke mana lawan-catat piutang pergi** (§7.5) | idem — menentukan apakah koreksi menyentuh laba | ______ | ☐ |
| C4 | **Jurnal koreksi legacy disetujui Direksi** (§6) | idem | ______ | ☐ |

⚠️ **C1–C4 khusus Bakau tidak bisa dipenuhi sebelum tim keuangan mengisi ulang
pencatatan pembelian BBM 29 Jan → sekarang** (paket serah-terima, pekerjaan #1).
Selama itu belum dikerjakan, saldo awal Bakau apa pun akan lahir salah.

### 9.3 Daftar pengecualian TERTUTUP — bentuknya tidak bergantung pada B1–B8

**Bukan izin mulai.** Butir di bawah **tetap tertahan** selama K1 belum dibuka
owner (§9, status). Yang dinyatakan daftar ini hanyalah: bentuk butir-butir ini
**sudah diperiksa satu per satu** dan tidak berubah oleh jawaban B1–B8 mana pun —
jadi ketika K1 dibuka, ia tidak perlu menunggu tim keuangan lagi.

Daftar ini **tertutup**. Menambahinya butuh gerbang owner tersendiri (§9.1).

- `purchase_price` (§4.1) berikut penjaga **P1** & **P2** — bentuk & perilaku sudah
  diputuskan penuh, termasuk tiga syarat P1 dan kolom pendampingnya.
- `correction_entry` (§4.5) dengan tujuh field audit + penegakan
  `submitted_by ≠ approved_by`.
- `reclassification` (§4.4) — append-only, tak menyentuh transaksi asli.
- Mesin hitung `Revenue` / `COGS` / `TeraValue` / `Gross Profit` /
  `LossesGainValue` / `InventoryValue` — **terbukti eksak 10/10 tanggal**,
  definisinya tidak menunggu jawaban apa pun. (`SOValue` **tidak** termasuk: B6.)
- Pemisahan `Tera` dari `VolumePenjualan` (§1.1).
- Uji regresi yang memakai 10 tanggal T3 sebagai kasus emas.

### 9.4 Yang TIDAK boleh dikerjakan di K1 tanpa gerbang tersendiri

- Menyunting spreadsheet keuangan mana pun — termasuk memperbaiki `HargaBeli`
  Solar. Itu pekerjaan tim keuangan.
- Memperbaiki dua cacat mutu data EasyMax (§8.6).
- Memposting apa pun ke buku kas secara otomatis. Baris "Setoran Hasil Penjualan"
  **ditawarkan**, tidak diposting (§1.4).

### 9.5 Cara memakai gerbang ini

Berlaku setelah owner membuka K1 (§9, status). Sebelum itu tidak ada PR K1 apa pun.

Setiap PR K1 menyatakan lingkupnya di deskripsi, dan hanya ada **dua** bentuk yang sah:

1. **PR yang seluruh isinya ada di daftar §9.3** — sebut butir §9.3 yang mana.
   Tidak perlu kotak BLOKIR terisi. **Penulis PR tidak berwenang memperluas
   daftarnya**: kalau isinya menyentuh apa pun di luar butir yang disebut, PR ini
   otomatis jatuh ke bentuk 2.
2. **PR lainnya** — salin §9.1–§9.2 ke deskripsi dengan artefaknya terisi.
   PR yang meninggalkan kotak BLOKIR kosong **ditolak tanpa dibaca isinya** —
   bukan karena kodenya buruk, tetapi karena belum ada dasar untuk menilai
   kodenya benar.

Kalau ragu sebuah PR masuk bentuk 1 atau 2, **ia bentuk 2**. Keraguan diselesaikan
ke arah gerbang, bukan ke arah pelaksana.

#### ⚠️ Sisa yang diketahui — bentuk 1 masih dinilai sendiri

**BELUM DITELUSURI. Jangan dibangun sekarang** (catatan owner 12 Agu 2026).

"Kalau ragu ia bentuk 2" menutup sebagian besar celahnya, tetapi **tidak ada mata
kedua** yang menyatakan sebuah PR benar-benar bentuk 1 — penilaian itu masih
dilakukan oleh penulis PR-nya sendiri. Selama bentuk 1 jarang dipakai, risikonya
kecil dan tidak sepadan dengan biaya penandatangan tambahan.

**Syarat yang membangunkannya:** kalau K1 sudah berjalan dan **bentuk 1 mulai
sering dipakai**, di situ ia butuh penandatangan kedua. Ditulis di sini supaya
syaratnya terlihat lebih dulu, bukan ditemukan setelah ada PR bentuk 1 yang
ternyata bukan.
