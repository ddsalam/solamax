# Artefak floating-point pada kolom `numeric` mirror — investigasi 2026-08-06

**Verdict singkat:** artefaknya nyata dan **sistematis** (±243.800 sel numeric di 7 unit),
tapi **penyebabnya bukan `num()` di agent**. Titik rusaknya ada di **backend**: Prisma
merender parameter JS `number` ke **16 angka penting**, bukan shortest-roundtrip.
Dampak nilai **nihil secara material** (deviasi total seluruh 243.800 sel = **0,0000746**),
jalur baca dashboard tak terpengaruh, dan tak satu pun perbandingan `<> 0` yang tersentuh.
Kelas isunya tetap layak ditutup karena **murah** dan mencegah kebisingan rekonsiliasi.

---

## 1. Premis awal yang GUGUR

Dugaan awal: `num()` ([`apps/agent/src/transform.ts:86`](../apps/agent/src/transform.ts#L86))
mengubah nilai MySQL → JS double → JSON → hilang presisi.

**Gugur oleh data dan oleh repro.** `num()` memang menghasilkan IEEE-754 double, tapi
`JSON.stringify` memakai **shortest-roundtrip**: double terdekat dari `67.26` dicetak
kembali persis `67.26`. Jadi payload agent BERSIH. Kontrol di data prod: ±50 nilai
2-desimal yang tak-representable biner (`.03`, `.87`, `.13`, `.17`, `.68`, `.92`, `.08`,
`.32`, `.07`, `.47`, `.48`, `.73`) tersimpan **eksak** di `bppiut` — lewat `num()` yang sama.

Postgres juga bukan pelakunya: `SELECT 73867616.46::float8::numeric` di `solamax-pg` (PG 16)
menghasilkan `73867616.46` — bersih.

## 2. Penyebab sebenarnya (terbukti, bukan penalaran)

Rantai:

1. Agent memetakan nilai ke JS `number` — mis. `njumlah: num(r.NJUMLAH)`
   ([`apps/agent/src/domains.ts:483`](../apps/agent/src/domains.ts#L483) piutang,
   [`:514`](../apps/agent/src/domains.ts#L514) hutang). **Lossless sejauh ini.**
2. Backend membangun `$n` **tanpa cast** untuk kolom numeric — `COLUMN_CAST`
   ([`apps/backend/src/ingest/sql.ts:8-19`](../apps/backend/src/ingest/sql.ts#L8-L19))
   hanya memuat `date`/`timestamptz`/`jsonb`; `buildValues` mendorong nilai apa adanya
   ([`sql.ts:34-40`](../apps/backend/src/ingest/sql.ts#L34-L40)).
3. Nilai di-bind lewat `tx.$executeRawUnsafe(sql, ...params)`
   ([`apps/backend/src/ingest/ingest.service.ts:105-107`](../apps/backend/src/ingest/ingest.service.ts#L105)).
   **Di sinilah presisi hilang**: Prisma merender double ke **16 angka penting**.

### Repro (Postgres 16 lokal throwaway, Prisma 5.22.0 — versi terpasang repo)

Lewat **kode produksi asli** (`TABLE_CONFIG.bppiut` → `buildUpsert` → `$executeRawUnsafe`):

| dikirim agent | tersimpan di `numeric` | = string di prod? |
| --- | --- | --- |
| `73867616.46` | `73867616.45999999` | ya — identik baris `PP2022100101473` |
| `67.26` | `67.26000000000001` | ya — pola `sales_detail.nvolume` |
| `99213863301.15` | `99213863301.14999` | ya — pola `cash_header.ntotal` |

Kontrol: parameter **string + `::numeric`** → semua nilai eksak. Driver `pg`
(dipakai dashboard) dengan parameter JS `number` yang sama → **juga eksak** — jadi ini
perilaku Prisma, bukan Postgres, bukan JS.

### Aturan konversinya, terkarakterisasi

Prisma menyimpan **`v.toPrecision(16)`** (nol ekor dibuang), bukan `String(v)`. Diuji
8/8 cocok, termasuk kasus kontrol yang justru BERSIH: `0.1+0.2` → `0.3`, `1/3` →
`0.3333333333333333`, `1.005` → `1.005`, `2^53+2` → utuh.

Konsekuensinya: sebuah nilai 2-desimal rusak **hanya bila** galat double-nya melewati
setengah-ulp pada angka penting ke-16 — itulah kenapa tingkat kerusakannya ~4–5%, bukan
100%, dan kenapa magnitudo besar lebih rentan (digit bulat memakan jatah 16 digit):
`bppiut` hanya 1 baris rusak karena 3,3 juta barisnya nyaris semua **bulat** (rupiah).

## 3. Luas kerusakan — 7 unit, seluruh kolom numeric

Detektor: `scale(kolom) >= 5` (artefak selalu berekor panjang; data sah ≤ 4 desimal).
Sapuan penuh atas 36 kolom numeric/float di 16 tabel ber-`unit_id` (`solamax-pg`, live).

**Per tabel (sel ber-artefak):**

| tabel | sel | kolom terdampak |
| --- | ---: | --- |
| `sales_detail` | 159.057 | `nstandawal`, `nstandakhir`, `nvolume`, `nsubtotal` |
| `opname` | 44.522 | `nstockbk`, `nstockop`, `nvolselisih` |
| `edc` | 20.013 | `liter` |
| `pelanggan_sale` | 18.633 | `liter` |
| `voucher_sale` | 1.505 | `liter` |
| `tera` | 60 | `liter` |
| `terra_resmi` | 31 | `nvolume` |
| `cash_header` / `cash_detail` | 2 / 2 | `ntotal` / `njumlah` |
| `delivery` | 2 | `nvolreal`, `nvolselisih` |
| `bppiut` | **1** | `njumlah` — baris yang memicu investigasi |
| `real_tank` | 1 | `nvolume` |
| **TOTAL** | **±243.800** | |

**Per unit:** 1 = 46.915 · 2 = 37.562 · 3 = 166 · 4 = 57.061 · 5 = 43.779 · 6 = 13.608 ·
7 = 44.738. Tak ada unit yang bersih — termasuk 28 Oktober (unit 7, 44.738 sel); klaim
"28 Oktober nol baris semacam ini" hanya benar **untuk `bppiut`/`bphut`**, tidak untuk
mirror secara keseluruhan.

Nol artefak di: `bphut`, `deposit`, `tebus_detail.nvolume`, `delivery.nvoldo`,
`sales_detail.nhargajual`, `product.nhrgjual`, `terra_resmi.ntotal/nharga`.

## 4. Materialitas — kecil, dan terukur

| ukuran | nilai |
| --- | --- |
| deviasi **maksimum** satu sel vs nilai 2-desimal sebenarnya | **0,00001** (`cash_header.ntotal`, magnitudo 9,9 × 10¹⁰) |
| deviasi **total** seluruh ±243.800 sel | **0,0000746** |
| sel dengan deviasi > 0,000001 | **2** (dari 243.800) |

Artinya: menjumlahkan SELURUH kerusakan di 7 unit menghasilkan kurang dari sepersepuluh
ribu rupiah/liter. Tak ada angka laporan yang bisa bergeser satu rupiah pun.

**Jalur baca aman (diverifikasi, bukan diasumsikan):**
- `queries.ts` memakai 75 cast `::float8`; agregat dijumlah eksak sebagai `numeric` lalu
  di-cast → double membulatkan balik ke nilai oracle.
- Perbandingan eksak-nol **tidak tersentuh**: `getOpnameAnomalies`
  ([`queries.ts:576`](../apps/dashboard/src/lib/queries.ts#L576)) menyaring
  `nvolselisih <> 0`; |nvolselisih| terkecil yang bukan nol di **setiap** unit = **0,01**
  — nol sejati tetap tersimpan eksak `0` (nol representable sempurna), jadi tak ada
  hantu epsilon. Nol dari 367.483 baris `opname`.
- Pola paling rentan (`GREATEST(0, a − b)` Sisa DO,
  [`queries.ts:693-694`](../apps/dashboard/src/lib/queries.ts#L693), `:778`) memakai
  `tebus_detail.nvolume` dan `delivery.nvoldo` — dua kolom yang **nol artefak** hari ini.
  Ini kebetulan yang menguntungkan, bukan desain: itulah permukaan gigitan bila artefak
  suatu saat masuk ke sana.

## 5. Keputusan & pelaksanaan

Owner memilih **fix + backfill** (2026-08-06): patch masuk PR ke `staging`; skrip backfill
disiapkan tapi **tidak dijalankan** — menunggu aba-aba terpisah setelah fix live.

Alasan tetap memperbaiki meski dampak nilai nihil:
1. Perbaikannya ~6 baris di satu berkas + satu unit test — jauh lebih murah dari biaya
   menjelaskan ulang artefak ini di setiap sesi rekonsiliasi berikutnya.
2. Setiap sync baru terus memproduksi ±5% sel kotor, selamanya, di 7 unit.
3. Rekonsiliasi berbasis kesamaan string/`IS DISTINCT FROM` lawan EasyMax akan
   melaporkan beda palsu — persis kelas kebisingan yang memakan waktu sesi ini.

### 5a. Fix (backend, `apps/backend/src/ingest/sql.ts`) — SUDAH DITULIS

`NUMERIC_COLUMNS` (22 nama kolom, diturunkan dari `@db.Decimal` di `schema.prisma`)
memberi cast `::numeric`, dan `buildValues` mengirim `String(v)` untuk nilai `number` di
kolom itu — `String()` memakai shortest-roundtrip, jadi desimal sumber pulih apa adanya.

Diverifikasi:
- **Unit test** `sql.test.ts` — "kolom numeric dikirim sbg TEKS ber-cast `::numeric`".
  **Uji merahnya dijalankan**: fix dimatikan sementara → tes itu (dan 4 tes lain) MERAH;
  fix dipulihkan → 27 lulus. Tes ini yang menahan kalau ada yang mengembalikan param
  numeric jadi `number`.
- **End-to-end di Postgres nyata** (lokal, kode produksi `buildUpsert` ter-patch):
  10 nilai — termasuk 3 string prod yang rusak, NULL, 0, negatif, bulat 11-digit, dan
  3-desimal — semuanya tersimpan **eksak**, dan UPSERT ulang payload sama tetap idempoten.

Prasyarat pendekatan ini — `COLUMN_CAST` berkunci **nama kolom**, bukan (tabel,kolom) —
sudah **diverifikasi aman**: query `information_schema` atas seluruh skema `public`
menemukan **0** nama kolom yang numeric di satu tabel tapi bertipe lain di tabel lain.
Jadi menandai `njumlah`/`nvolume`/`liter`/`total`/dst. sebagai `numeric` tak bisa salah
kena kolom non-numeric.

### 5b. Penyembuhan baris lama

- **Sembuh sendiri** setelah fix untuk domain `mode: "full"` (`bppiut`, `bphut`,
  `terra_resmi`, `real_tank`, `deposit`): agent mengirim ulang seluruh baris tiap cadence,
  nilai bersih `IS DISTINCT FROM` nilai kotor → `skipUnchanged` justru MENULIS ulang.
  Menutup 34 sel, termasuk baris `PP2022100101473` yang memicu investigasi.
- **Tidak sembuh sendiri** untuk domain berjendela/watermark (`sales_detail`, `opname`,
  `edc`, `pelanggan_sale`, `voucher_sale`, `tera`, `delivery`, `cash_*`) — ±243.800 sel
  historis. Untuk itu ada
  [`apps/backend/scripts/backfill-numeric-artifacts.sql`](../apps/backend/scripts/backfill-numeric-artifacts.sql):
  `SET k = trim_scale(round(k, 4)) WHERE scale(k) >= 5`, menyapu sendiri seluruh kolom
  numeric tabel ber-`unit_id` (tanpa daftar kolom hardcoded).

  Kenapa 4 desimal, bukan 2: artefak selalu di `scale ≥ 5`, sedangkan `tera.liter` punya
  **10 nilai SAH ber-3/4 desimal**. Membulatkan ke 4 memulihkan tiap nilai sebenarnya
  (deviasi artefak maks 0,00001 « 0,00005) dan tak bisa merusak data sah.

  **⛔ BELUM DIJALANKAN — menunggu gerbang owner terpisah, dan HARUS setelah fix live**
  (dijalankan sebelum fix hanya membersihkan baris yang akan dikotori sync berikutnya).

  Diuji di Postgres lokal berfixture, ketiga arah:
  - jalur benar: 4 sel artefak → nilai eksak (`73867616.46`, `67.26`, `90098.4`, `9.15`);
    nilai sah `12.3456` di `tera.liter` **tak tersentuh**; NULL & 0 tak tersentuh;
  - **idempoten**: jalan kedua = 0 baris ditulis;
  - **bisa berbunyi MERAH**: tanpa `-v units=…` skrip ABORT sebelum menulis apa pun; dan
    saat pembersihan sengaja dibuat tak tuntas → `WARNING` + `EXCEPTION` + **rollback**
    (nilai kotor terbukti tetap kotor, nol ter-commit).

### 5c. Yang tetap berlaku apa pun keputusannya

**Jangan** menambah query yang membandingkan kolom numeric mirror dengan `=`/`<> 0` atas
**selisih** dua kolom ber-artefak tanpa toleransi — itu permukaan gigitan sebenarnya,
bukan tampilan.

## 6. Cara reproduksi ulang

- **Sapuan luas** (read-only): blok BEFORE di
  [`backfill-numeric-artifacts.sql`](../apps/backend/scripts/backfill-numeric-artifacts.sql)
  adalah detektornya — hitung `scale(kolom) >= 5` per kolom numeric tabel ber-`unit_id`,
  self-adjusting lewat `information_schema`. Untuk sekadar mengukur, jalankan blok itu
  saja sebagai `dashboard_app` (SELECT-only) dengan GUC `app.unit_ids` diisi.
- **Repro sebab**: Postgres lokal throwaway + `buildUpsert` asli. Berkas probe
  (`fp-probe*.mjs|ts` di `apps/backend`) **sengaja tidak di-commit** — sekali pakai,
  dihapus setelah sesi; yang perlu bertahan sudah jadi unit test.

## 6b. Sisa pekerjaan

1. Merge PR fix ke `staging` → promosi ke `main` (pilot) mengikuti gerbang CD biasa.
2. **Setelah fix live**: minta gerbang owner untuk menjalankan backfill di `solamax-pg`
   (jalankan sebagai role `ingest`, jendela sepi, `-v units="1,2,3,4,5,6,7"`).
3. Sesudah backfill: ulangi sapuan → harus 0 sel, dan tetap 0 pada sync-sync berikutnya
   (itu bukti fix-nya bekerja di produksi, bukan cuma di lab).

## 7. Pagar yang dihormati sesi ini

MySQL EasyMax tak disentuh sama sekali. Semua kueri ke `solamax-pg` **read-only** sebagai
role `dashboard_app` (SELECT-only) dengan `default_transaction_read_only=on`. Nol tulisan
ke cloud; repro memakai Postgres lokal sekali pakai. Nol secret masuk git. Nol deploy/push.
