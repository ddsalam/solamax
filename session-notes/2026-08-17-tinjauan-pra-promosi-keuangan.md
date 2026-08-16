# Tinjauan pra-promosi — 15 migrasi K1/K2 → `solamax-pg` (PRODUKSI)

**17 Agustus 2026 · read-only · tidak ada satu pun yang diubah.**
Dijalankan sebagai role `dashboard_app` lewat `cloud-sql-proxy` ke
`solamax:asia-southeast2:solamax-pg`; proxy dihentikan setelah selesai.

> ⛔ **Saya tidak mempromosikan apa pun.** Promosi butuh gerbang owner
> (GitHub Environment `pilot`).

## Ringkasan: TIDAK ADA PENGHALANG yang saya temukan

Empat butir yang diminta terjawab, dan tiga premis dalam permintaannya perlu
dikoreksi — semuanya ke arah yang **lebih ringan**, bukan lebih berat.

| # | butir | hasil |
|---|---|---|
| 1 | backfill `0024` | **1.174 baris**, 80 di antaranya `void=true` — masuk akal, lihat §1 |
| 2 | `unit_id = 2` = Bakau? | ✅ **BENAR, diverifikasi di produksi** |
| 3 | apa yang berubah bagi pengawas | **tidak ada** — dibuktikan, bukan dinyatakan |
| 4 | migrasi tak idempoten | **nihil**; satu kecurigaan diperiksa dan gugur |

---

## 0 · Keadaan produksi apa adanya

`_prisma_migrations`: **19 migrasi applied**, terakhir `0019_rbac_scope_alignment`
(26 Jul 2026). Yang akan berjalan saat promosi: **`0020`–`0034` = 15 migrasi**,
bukan 14 — `0034_manual_entry_source_door` lahir di blok 4, sesudah relay ditulis.

Tabel `app.*` yang sudah ada: `accounts · audit_log · manual_entry · membership ·
sessions · tenant · user_role · user_unit · users · usulan_so ·
verification_token`. **Tak satu pun** nama tabel yang akan dibuat 0020–0034
bertabrakan dengan daftar itu.

Peran pengguna produksi: `pengawas 15 · direksi 3 · admin_perusahaan 2 ·
super_admin 1` (total **21**, cocok dengan yang relay sebut).

---

## 1 · `0024_manual_entry_workflow` — satu-satunya yang menyentuh data hidup

Ia menambah `status` **NOT NULL DEFAULT 'submitted'**, jadi SELURUH baris yang
ada ikut mendapat nilai itu.

| | jumlah |
|---|---|
| total baris `app.manual_entry` | **1.174** |
| di antaranya `void = true` | **80** |
| aktif | 1.094 |
| rentang tanggal | **2026-06-20 … 2026-08-15** |

Per section: `pengeluaran` 757 (32 void) · `pendapatan_lain` 222 (21 void) ·
`setoran_tunai` 195 (27 void).

### 🔧 Koreksi premis: bukan "bertahun-tahun"

Relay menyebut `app.manual_entry` berisi data pengawas **bertahun-tahun**.
Sebenarnya **delapan minggu** (20 Juni – 15 Agustus 2026) — panel Rincian baru
hidup pertengahan tahun ini. Ini menurunkan risiko dua hal sekaligus: durasi
kunci saat `ADD CONSTRAINT` memvalidasi tabel, dan jumlah baris yang perlu
diperiksa manusia bila ada yang aneh.

### Apakah `void=true` + `status='submitted'` masuk akal?

**Ya**, dan alasannya struktural: `void` dan `status` adalah **dua sumbu
berbeda**. `void` menjawab "apakah baris ini dibatalkan"; `status` menjawab "di
tahap mana ia berada dalam daur hidup §2.2". Baris yang **diajukan lalu
dibatalkan** memang `submitted` + `void` — itu riwayat yang benar, bukan
keadaan yang mustahil.

Yang perlu dijaga adalah **tampilannya**, dan sudah dijaga:

- `menungguTinjauan()` menyaring `!void` — 80 baris itu tidak akan muncul
  sebagai "menunggu tinjauan";
- panel blok 4 menampilkan `dibatalkan` untuk baris void, bukan `submitted`.

⚠️ **Yang TIDAK dijaga, dan saya sebut:** trigger `manual_entry_no_void_after_close`
menolak void bila `OLD.status='closed'`. Hari ini **tak ada satu pun jalan kode
yang menyetel `'closed'`** (dibuktikan: pencarian `'closed'` di seluruh
`apps/*/src` tak menemukan penulisan status), sebab `day_close` belum
tersambung. Jadi trigger itu **tidak bisa menggigit pengawas** setelah promosi.
Ia baru punya gigi ketika Layar 4 dibangun.

### Konsekuensi operasional yang perlu diketahui tim keuangan

Seluruh 1.174 baris punya `operational_category = NULL` dan
`accounting_account = NULL` — pemilih kategori di Rincian Penjualan memang
dikecualikan dari lingkup K2. Setelah promosi, blok 4 akan menampilkan baris
lama sebagai **"belum berkategori"** dan **"belum dipetakan"**. Itu keadaan yang
benar dan terlihat, bukan cacat; per hari jumlahnya belasan baris, bukan ribuan.

---

## 2 · `unit_id = 2` di produksi — ✅ BENAR

Diverifikasi, tidak diasumsikan:

| unit_id | code | nama |
|---|---|---|
| 1 | 6478111 | Imam Bonjol |
| **2** | **6378301** | **Bakau** |
| 3 | 6478101 | Adisucipto |
| 4 | 6478106 | Bundaran Kotabaru |
| 5 | 6478201 | Batu Layang |
| 6 | 6478311 | Korek |
| 7 | 63781002 | 28 Oktober |

Seed tujuh akun kas di `0029_cash_ledger` mematok `unit_id = 2`, dan di
produksi itu **Bakau** — unit yang memang jadi model K0/K1. Kekhawatiran relay
tepat sasaran; jawabannya kebetulan aman.

⚠️ **Enam unit lain tidak akan punya akun kas** setelah promosi. Layar 3 blok 2
menyatakannya eksplisit ("Belum ada akun kas untuk unit ini"); daftar rekening
riilnya pekerjaan data (paket serah-terima §2b).

---

## 3 · Apa yang berubah bagi pengawas — **tidak ada**, dan ini buktinya

Bukan pernyataan. Diff `origin/main…origin/staging` pada seluruh permukaan
pengawas:

```
apps/dashboard/src/app/(app)/unit/*/rincian/*
apps/dashboard/src/components/rincian/*
apps/dashboard/src/lib/manual-entry-actions.ts
apps/dashboard/src/lib/rincian-model.ts
```

→ **nol berkas berubah.**

Sisi DB-nya juga aman: kolom yang ditambahkan 0024 (dan 0034) semuanya
**nullable atau ber-DEFAULT**, jadi `INSERT` milik pengawas yang tidak
menyebutnya tetap sah. Satu-satunya CHECK baru di tabel itu —
`manual_entry_returned_reason` — berbunyi `(status='returned') = (alasan
terisi)`; untuk baris pengawas `status='submitted'` dan alasan NULL ⇒
`false = false` ⇒ **lolos**.

---

## 4 · Idempotensi — nihil temuan, dan satu kecurigaan yang gugur

Ketiga pemindaian bersih:

- **`CREATE TABLE/INDEX/TYPE` tanpa `IF NOT EXISTS`**: tiga kecocokan
  (`0024`, `0026`, `0029`) semuanya **`CREATE TYPE` di dalam penjaga
  `IF NOT EXISTS (SELECT 1 FROM pg_type …)`** — grep saya yang kasar, bukan
  temuan.
- **`ADD CONSTRAINT`**: sembilan migrasi memakainya, **semuanya** berpasangan
  dengan `DROP CONSTRAINT IF EXISTS` atau penjaga `pg_constraint`.
- **Nama tabel bertabrakan**: nihil (§0).

### 🔴 Kecurigaan yang saya kejar sampai tuntas

`_prisma_migrations` memuat `0003_membership_constraints` dengan
`rolled_back_at` terisi dan `finished_at` NULL. Kalau itu satu-satunya barisnya,
`prisma migrate deploy` akan **mencoba menerapkannya ulang** — dan 0003
menambahkan `membership_role_check` **tanpa** penjaga, sehingga akan gagal
`42710 duplicate_object` dan **menghentikan seluruh promosi**.

**Bukan penghalang.** Ada **DUA** baris untuk 0003:

| mulai | selesai | rolled_back | keterangan |
|---|---|---|---|
| 16 Jun 10:19 | — | **16 Jun 10:28** | gagal, lalu di-`resolve --rolled-back` |
| 16 Jun 10:28 | **16 Jun 10:28** | — | penerapan ulang yang BERHASIL |

Prisma menganggap sebuah migrasi sudah diterapkan bila **ada** baris ber-`finished_at`
yang tidak di-rollback. Baris pertama tinggal artefak sejarah pemulihan Juni.
Tidak ada migrasi lain yang belum selesai atau ter-rollback.

Kedua CHECK peran memang ada di DB dengan daftar **empat peran** — persis yang
akan di-`DROP`/`ADD` ulang oleh `0032` menjadi lima.

---

## 5 · Temuan tambahan yang tidak diminta

### 🔴 `HEAD_OF_FINANCE_EMAILS` BELUM dipasang di layanan pilot

`solamax-dashboard-staging` hanya punya `SUPERADMIN_EMAILS`. Akibatnya, setelah
promosi:

- `isHeadOfFinance()` **selalu false** ⇒ tak seorang pun jadi HoF;
- tangga §3.2 tingkat kedua (Rp 10.001–100.000) **tidak punya pemegang**;
- **penjaga irisan §10.12 tidak punya subjek** — ia benar, tetapi tak menjaga
  siapa-siapa sampai env-nya diisi.

Ini bukan cacat kode; ia pekerjaan konfigurasi yang belum dilakukan. Saya
sebutkan karena penjaga tanpa subjek adalah hal yang paling mudah disangka
sudah bekerja.

### Biaya penguncian saat migrasi — kecil

`ADD CONSTRAINT` pada `manual_entry` memvalidasi **1.174 baris**; `ADD COLUMN`
ber-DEFAULT tidak menulis ulang tabel sejak PG 11 (produksi: **PostgreSQL 16**).
Tabel lain yang disentuh 0020–0034 semuanya BARU. Jendela kunci: sesaat.

---

## Yang masih belum terbukti — sebut apa adanya

1. **Migrasi belum pernah dijalankan terhadap `solamax-pg`.** Yang saya periksa
   adalah keadaan awalnya dan bentuk migrasinya, bukan hasilnya. Pembuktiannya
   tetap `prisma migrate deploy` di gerbang `pilot`.
2. **Layar 3 belum pernah dibuka manusia** — belum ada pemegang peran
   `keuangan`. Seluruh jalur tulis modul ini belum pernah dijalankan terhadap
   RLS sungguhan.
3. **`solamax-pg-rlsstg` berisi 3 unit sintetis**, sementara produksi 7 unit —
   jadi hijau di tier testing tidak pernah menguji tujuh-unit.
