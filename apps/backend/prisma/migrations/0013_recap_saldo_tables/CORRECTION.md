# ⚠️ Komentar "Formula terkunci" di `migration.sql` sudah TIDAK BERLAKU

`migration.sql` baris 5–8 memuat komentar:

```
-- Formula terkunci vs oracle (probe ronde 11-13, EKSAK 27-Jun):
--   Piutang = Σ njumlah·sign(sjnsbp:1=+,2=−), sbatal=0, dtgl<tanggal; Lokal=SJENIS{1,5},
--             Online=SJENIS 3, SJENIS 4 dikecualikan.
--   Hutang Lokal = −Σ njumlah·sign(sjnsbp:2=+,1=−), sbatal=0, dtgl<tanggal.
```

**Komentar itu salah di tiga hal** dan dikoreksi 2026-08-06. Berkas `migration.sql`
**sengaja TIDAK disunting** — ia sudah ter-apply di `solamax-pg` *dan* `solamax-pg-rlsstg`,
dan `prisma migrate deploy` memvalidasi checksum tiap migrasi yang sudah dijalankan.
Menyunting satu karakter pun akan **menghentikan pipeline CD** (migrate-before-serve) demi
perubahan yang murni dokumentatif. Karena itu koreksinya ditaruh di berkas terpisah ini;
Prisma hanya membaca `migration.sql` per direktori, jadi berkas ini inert.

## Yang benar

| klaim di komentar | status | yang benar |
| --- | --- | --- |
| batas `dtgl < tanggal` | ❌ salah | Ada **dua** batas yang sah. `<` = saldo **awal** hari (dipakai EasyMax "Laporan Penjualan Harian"); `<=` = saldo **akhir** hari (dipakai EasyMax "Daftar Saldo Hutang Piutang"). Dashboard kini menyajikan **keduanya** berlabel. Probe ronde 13 sendiri memakai `DTGL <= ?` — jadi `<` di kode adalah salah-salin dari probe, bukan keputusan. |
| `Online = SJENIS 3` | ❌ salah | Online = **kode BERTITIK** (`NN.999.NNNN`), **tanpa** filter SJENIS. Filter `sjenis = 3` membuang `21.999.0014` (SJENIS 4) → Piutang Online unit 28 Oktober kurang **Rp36.084 setiap hari** di produksi. |
| `SJENIS 4 dikecualikan` | ⚠️ separuh | Benar untuk SJENIS 4 **non-bertitik** (737 pelanggan, ±74,45 mrd di unit 7, nol dicetak EasyMax). Salah untuk SJENIS 4 **bertitik**, yang justru masuk Online. Dua sumbu, bukan satu. |
| `EKSAK 27-Jun` | ⚠️ tak reproducible | Oracle-nya adalah PDF *"Laporan Penjualan Harian"* **Imam Bonjol** Juni 2026 — laporan yang **berbeda jenis** dari yang dipakai memeriksa 28 Oktober. Angka Piutang Lokal IB tidak dapat direproduksi dari ledger Postgres dengan kombinasi filter apa pun (selisih ±19,7 miliar, masih terbuka). |

## Aturan yang berlaku sekarang

| baris | aturan (terbukti 9/9 sel, 28 Oktober 2–4 Ags 2026) |
| --- | --- |
| Piutang Lokal | `bppiut`, `SJENIS ∈ {1,5}` **DAN** kode tanpa titik |
| Piutang Online | `bppiut`, kode **bertitik**, tanpa filter SJENIS |
| Hutang Lokal | seluruh `bphut`, dinegatifkan |

Semua `COALESCE(sbatal,0)=0`, masing-masing dihitung pada dua batas (`<` dan `<=`).

**Sumber kebenaran implementasi:** `getSaldoPelanggan` di
`apps/dashboard/src/lib/queries.ts` (komentarnya lengkap dan dijaga test).
**Dikunci oleh:** `apps/dashboard/src/lib/queries.saldo.test.ts` (CI tiap commit) dan
`apps/dashboard/src/lib/saldo.oracle.integration.test.ts` (DB-live, `SALDO_LIVE_DB=1`).
**Bukti & metode:** `session-notes/2026-08-05-saldo-hutang-piutang-28oktober.md`.
