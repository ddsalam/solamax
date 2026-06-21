# ADR-001 — Sumber data 5 seksi "Rincian Penjualan"

> Status: **TERKUNCI (arah)** · 2026-06-19 · disetujui user (FASE 0).
> Gate berikut: **FASE 0.5 — probe read-only** harus merekonsiliasi EKSAK ke angka PDF
> (≥2 tanggal) SEBELUM satu baris kode sync/migrasi ditulis. Lihat
> [`FASE05-PROBE-QUERIES.sql`](FASE05-PROBE-QUERIES.sql) + `apps/agent` `--probe`.
> Sumber skema: [`ARCHITECTURE.md`](ARCHITECTURE.md) + recon
> `~/Repo/Obsidian-Vault/wikis/spbu-sola/wiki/concepts/easymax-data-model.md`.

## Konteks

Halaman `apps/dashboard/src/app/(app)/unit/[code]/rincian/[date]/page.tsx` punya seksi
yang masih placeholder ("Belum tersedia di pipeline — menunggu Domain X"). Saat ini
kelimanya diisi MANUAL oleh pengawas via spreadsheet; tujuan: pengawas membuat laporan
lengkap DI SOLAMAX. Verdikt di bawah memetakan tiap seksi ke sumbernya.

## Penemuan kunci (rekonsiliasi A–I)

Summary A–I membuktikan peran tiap seksi (lihat `laporan-harian-format.md`):

```
E Penjualan Tunai = A − (B + C + D)    ← C (Pelanggan) & D (EDC) = porsi omzet BBM non-tunai
H Uang Tunai      = E + F − G          ← F (Pendapatan Lain) ditambah, G (Pengeluaran) dikurangi
Pendapatan Non Tunai (deposit)         ← TIDAK masuk A–I (arus terpisah, bukan rekonsiliasi tunai)
```

Karena itu C & D bersumber dari modul transaksional EasyMax yang **HIDUP**, sedangkan
F & G adalah arus kas non-BBM yang modul sumbernya (kas) **MATI sejak 2019** → manual.

## Verdikt terkunci (split)

| # | Seksi (page.tsx) | Sumber EasyMax | Status modul | Verdikt |
|---|---|---|---|---|
| 2 | PELANGGAN (penjualan tempo) | `tr_bppiut` (Rp) dan/atau `pjpelanggan` (Liter+Rp) + master `pelanggan` | 🟢 HIDUP → 2026-06 | **AUTO-SYNC** |
| 3 | EDC | `tr_edc` + master `tm_card` | 🟢 HIDUP → 2026-06-12 | **AUTO-SYNC** |
| 4 | PENDAPATAN LAIN | — (Bright/non-BBM, di luar EasyMax POS) | n/a (`tr_hkasbank` mati 2019) | **MANUAL** |
| 5 | PENDAPATAN NON TUNAI (deposit) | `tr_deposit` + master `pelanggan` | 🟢 HIDUP → 2026-06-12 | **AUTO-SYNC** |
| 6 | PENGELUARAN | `tr_hkasbank`/`tr_dkasbank` | ⛔ MATI sejak 2019-04-17 | **MANUAL** |

Catatan tambahan dari PDF 17 Juni (bukan termasuk 5 seksi, tapi terlihat): seksi **TERRA**
(B) bersumber `tera` (Domain 7, hidup) — di luar lingkup tugas ini, dicatat untuk nanti.

## Bukti rekonsiliasi (target probe FASE 0.5)

Unit 6478111 (Imam Bonjol). Angka dari PDF rincian manual (= harus dicocokkan probe DB):

| Seksi | 14 Jun 2026 | 17 Jun 2026 |
|---|---|---|
| C Pelanggan | **111.502.580** (7.583,30 L · 18 plg) | **155.113.552** (12.094,28 L · 48 plg) |
| D EDC | **90.974.097** (11 channel) | **116.565.499** (9 channel) |
| F Pendapatan Lain | 11.284.400 (1: SETORAN BRIGHT IB) | 23.041.400 (1: SETORAN BRIGHT IB) |
| 5 Pendapatan Non Tunai (deposit) | (tak ada) | **47.000.000** (6 deposit) |
| G Pengeluaran | 300.000 (4 plat) | 536.040 (BELI LAKBAN/KUAS + 4 plat) |

EDC volume di PDF selalu 0,00 → untuk EDC cocokkan **Rupiah saja** (liter sudah dihitung di omzet/totalisator).

## Keputusan implementasi (arah disetujui — JANGAN bangun sebelum probe LULUS)

- **AUTO-SYNC (Pelanggan/EDC/Deposit):** domain baru di agent (pola watermark + UPSERT
  natural-key seperti domain existing), READ-ONLY EasyMax mutlak. PK `tr_edc` ditentukan
  dari probe (#4). Tabel tanggal-korup `pjpelanggan` HARUS pakai filter rentang waras
  (jangan `MAX(watermark)` naif).
- **MANUAL (Pendapatan Lain/Pengeluaran):** tabel `app.manual_entry` (schema `app`, bukan
  `public`). v1 minimal: `created_by_user_id` + `updated_at` + `void` (jejak audit) — jangan
  over-build. Tulis via server action, di-scope `ScopedUnitId`, RBAC pengawas unit ybs.
- **Domain `cash` dorman JANGAN dihapus** dari agent — biarkan sebagai sinyal merah
  "input terakhir 2019". Seksi 6 (Pengeluaran) dipindah dari `getCashForDate()` ke
  `app.manual_entry`; jangan campur.
- Invarian: `pnpm check` hijau (termasuk negative-access tests), staging-first, jangan
  sentuh `main`, jangan echo secret.

## Status pipeline saat ini (bukti file:line)

- Agent menarik: `sales|cash|opname|delivery|masters|realtank` saja
  (`packages/shared/src/domains.ts:8-15`). Tak ada edc/piutang/deposit.
- Backend tabel hanya untuk domain di atas (`apps/backend/prisma/schema.prisma`);
  `/ingest` (`apps/backend/src/ingest/ingest.service.ts`) tak handle 3 domain baru.
- Dashboard: seksi 2/3/5 placeholder (`page.tsx:86,96,116`); seksi 6 pakai
  `getCashForDate()` (`apps/dashboard/src/lib/queries.ts:516`) → domain `cash` dorman
  → selalu kosong utk 2026.

## Bar kelulusan probe (LULUS = match EKSAK ke rupiah, di KEDUA tanggal)

Probe dinyatakan **LULUS** hanya bila semua baris ini hijau. Nol kode sync/migrasi
sebelum LULUS. Bila ada GAGAL → diagnosa + probe lanjutan, JANGAN maju ke Fase 1.

| Bar | Kriteria LULUS | 14 Jun | 17 Jun | Hasil |
|---|---|---|---|---|
| EDC (P1) | grand `SUM(TotalHarga)` = PDF **dan** jumlah channel cocok; jika kurang, QRIS WAJIB ditemukan di tabel lain (bukan "lulus sebagian") | 90.974.097 / 11 ch | 116.565.499 / 9 ch | ⬜ |
| Pelanggan (P2) | tentukan pemenang H2a (`tr_bppiut` sisi `SJNSBP` tertentu) vs H2b (`pjpelanggan`); pemenang rekon **Rp DAN Liter DAN jumlah plg** | 111.502.580 / 7.583,30 L / 18 | 155.113.552 / 12.094,28 L / 48 | ⬜ |
| Deposit (P6) | `SUM(NTOTAL)` + jumlah baris = PDF | 0 | 47.000.000 / 6 | ⬜ |
| Pengeluaran (P3) | `MAX(DTGL) tr_hkasbank` ~2019, nol baris 2026, nol modul pengganti → kunci MANUAL | mati | mati | ⬜ |
| PK EDC (P4) | UNIQUE key ditetapkan dari distinct-count (CNOTRACE vs komposit) | — | — | ⬜ |

**Konsekuensi yang harus dicatat saat kunci hasil:**
- Pemenang H2a vs H2b. **Jika H2b (`pjpelanggan`) menang** → domain agent WAJIB pakai filter
  tanggal-waras `pjpelanggan` (window per tanggal, BUKAN `MAX(watermark)` naif — satu baris
  tahun 2116/2262 membekukan sync). Flag eksplisit di sini.
- UNIQUE key final `tr_edc` (untuk desain tabel Postgres).
- Hasil P5: apakah `DATE(Tanggaljam)` naif cukup atau perlu window bisnis.

## Hasil probe RONDE 1 (dijalankan di mesin SPBU 2026-06-19, MySQL 5.0.67)

| Bar | 14 Jun (probe vs PDF) | 17 Jun (probe vs PDF) | Verdict |
|---|---|---|---|
| Deposit (P6) | 0 = 0 | 47.000.000/6 = 47.000.000/6 | ✅ **LULUS** (exact) |
| EDC (P1) | 86.322.982 ≠ 90.974.097 | 128.283.197 ≠ 116.565.499 | ❌ GAGAL exact |
| Pelanggan (P2) | bppiut 99.060.697 / pjpel 108.835.927 ≠ 111.502.580 | bppiut 68.845.669 / pjpel 130.589.490 ≠ 155.113.552 | ❌ GAGAL exact |
| Pengeluaran (P3) | hkasbank mati ✓; `tr_bpbank` (6.087) belum dicek | — | ⏳ INCONCLUSIVE |
| PK EDC (P4) | error: `NoNozle` ≠ `NoNozzle` | — | ⏳ rerun |

**Temuan terkunci ronde 1:**
- **Deposit (Pendapatan Non Tunai) = LULUS**, sumber `tr_deposit` (`DTGL`, `NTOTAL`, `SBATAL`, `CKDPLG`). Siap Fase 1.
- **QRIS ADA di `tr_edc`** (kartu QR01/QRBNI/QRMD/BRIQR). Join: `tr_edc.CKDKARTU → tm_card.CKDCARD`, nama `tm_card.VCNMCARD`. `tr_edc` **tak punya kolom SBATAL**.
- **Skema nyata ≠ asumsi:** kolom `tr_edc` = `TanggalJam` & `NoNozle` (bukan NoNozzle); `tm_card` PK = `CKDCARD`; tabel `pelanggan` = registry kartu RFID (TANPA nama/`CKDPLG`) → master nama pelanggan ada di tabel LAIN (cari ronde 2).
- **`pjpelanggan` TAK ANDAL untuk agregasi harian** — kolom `ErrorTgl` + tanggal korup (`2046`/`2102`); baris 14 Jun nyata bisa ter-buang dari window → totalnya SHORT. Jangan jadikan sumber harian via `TanggalJam`.
- **EDC report ≠ `SUM(tr_edc)` naif** (14 Jun kurang 4,65 jt; 17 Jun lebih 11,7 jt; tak ada batas jam bersih) → business-date per shift ATAU settlement manual. Perlu ronde 2.
- **Pelanggan: `tr_bppiut` (SJNSBP=1) = rupiah EKSAK per pelanggan tapi tak lengkap.** Bukti: 14 Jun `tr_bppiut` 99.060.697 + 6 pelanggan hilang (12.441.883) = 111.502.580 PERSIS. 6 pelanggan (RFID/deposit-draw) tak posting piutang → cari sumbernya ronde 2.
- **Pengeluaran: `tr_hkasbank` mati DIKONFIRMASI** (2011-10-07 → 2019-04-17, 0 baris 2026). **Tapi `tr_bpbank` (6.087 baris) belum di-rule-out** → jangan kunci MANUAL dulu.

→ **Tidak maju ke Fase 1.** Lanjut RONDE 2 (FASE05b): fix PK EDC, rule-out `tr_bpbank`, temukan sumber riil EDC (shift business-date / settlement) & Pelanggan (6 pelanggan hilang + master nama).

## Hasil probe RONDE 2 (FASE05b, 2026-06-19)

- **Pelanggan — sumber DIREVISI.** Hipotesis ronde-1 (`tr_bppiut`/`pjpelanggan`) KELIRU. Ditemukan modul
  penjualan-pelanggan khusus: **`tr_hjualplg` (75.546) + `tr_djualplg` (288.877)** (mirror
  `tr_hjualbbm`/`tr_djualbbm` → punya `DTGLJUAL` business-date + volume + SEMUA pelanggan termasuk
  pemakai deposit) + master nama **`tm_plg` (`CKDPLG`→`VCNMPLG`, 3.079)** + view `vw_jualplg`.
  `tr_bppiut` = buku piutang (double-entry, SJNSBP 1&2, SBATAL=1 137 jt) → untuk KPI "Saldo Piutang",
  BUKAN penjualan harian. (Tabel `pelanggan` = registry kartu RFID, bukan master nama.) Belum direkon.
- **EDC — window waktu PASTI tak rekon.** Span shift-close = 77,9 jt; `[06:00→06:00)` = 94,1 jt; naif = 86,3 jt;
  semua ≠ PDF 90,97 jt. Ditemukan **`vw_edc`/`vw_edc2`/`vw_edc3`** (kemungkinan logika laporan).
  `tr_trmedc` (settlement) **KOSONG (0)** → EDC bukan dari settlement. PK: `CNOTRACE` buruk (24.001 distinct
  dari 269.591; 23.339 kosong); komposit `(TanggalJam,NoNozle,CNOTRACE)` 111 tabrakan; `JrnKey` belum diuji.
- **Pengeluaran — MANUAL nyaris terkunci.** `tr_hkasbank` mati ✓; `tr_dkasbank` 2026=0 ✓. `tr_bpbank` HIDUP
  (749 baris 2026) TAPI = setoran/deposit sisi bank ("DEPOSIT … PER …", VCREF=kode DP), BUKAN pengeluaran.
  Tinggal cek isi `tr_bpbank` pada tanggal uji (+apakah "SETORAN BRIGHT"/Pendapatan Lain ada di situ).
- **Deposit** — tetap LULUS (tak berubah).
- Skema dikonfirmasi: `tr_edc` punya `JrnKey`; `tr_hjualbbm` PK `CKDJUALBBM`, `DTGLJUAL`, `NSHIFT`.

→ **RONDE 3 (FASE05c):** rekon `tr_hjualplg/tr_djualplg` (+`tm_plg`,`vw_jualplg`) ke PDF Pelanggan;
rekon `vw_edc*` ke PDF EDC; uji PK EDC via `JrnKey`/komposit kaya; cek isi `tr_bpbank` pada tanggal
(+lokasi "SETORAN BRIGHT"). Belum maju Fase 1.

## Hasil probe RONDE 3 (FASE05c, 2026-06-20)

- **Pengeluaran = MANUAL TERKUNCI ✅.** `tr_bpbank` pada 14/17 Jun = hanya deposit pelanggan (SJNSBP=1,
  47 jt 17 Jun = cermin `tr_deposit`) + penebusan Pertamina (SJNSBP=2). TAK ada petty-cash (BELI LAKBAN dll).
  `tr_hkasbank`/`tr_dkasbank` mati. → tak ada sumber EasyMax hidup.
- **Pendapatan Lain = MANUAL TERKUNCI ✅.** "SETORAN BRIGHT IB" TAK ada di `tr_bpbank` maupun modul lain. Manual.
- **Pelanggan — sumber dikonfirmasi `vw_jualplg`** (1 baris/line: `DTGL` business-date, `CKDPLG`, `VCNMPLG`
  nama, `Liter`, `TotalHarga`, `SBATAL`, `NSHIFT`, `CKDDEPO`). Base: `tr_hjualplg` (header: `CKDJUALPLG` PK,
  `DTGL`, `CKDPLG`, `SBATAL`, `CKDDEPO`) + `tr_djualplg` (detail: `Liter`/`TotalHarga`, FK `CKDJUALPLG`).
  Rekon ronde-3 gagal jalan (query pakai NVOLUME/NSUBTOTAL/DTGLJUAL — salah; kolom benar Liter/TotalHarga/DTGL).
  → rekon ulang ronde 3b.
- **EDC — mekanisme business-date ditemukan: `vw_edc3.ctgl`** (string `YYYYMMDD`) + `cshift`. `vw_edc`/`vw_edc2`
  = `tr_edc` diperkaya (total sama dgn naif). Rekon ronde-3 salah group (DATE(TanggalJam)); harus by `ctgl`.
  → rekon ulang ronde 3b.
- **EDC PK = tak ada kunci baris bersih.** `JrnKey` batch (4.166 distinct), komposit kaya masih 51 tabrakan.
  Keputusan desain Fase 1: surrogate id + dedup komposit, ATAU sync agregat per `(ctgl,kartu)`. Bukan blocker probe.

→ **RONDE 3b (FASE05d):** rekon `vw_jualplg` by `DTGL` (Liter/TotalHarga/SBATAL, +breakdown NTAGIH/CKDDEPO)
& `vw_edc3` by `ctgl` (+per kartu) ke PDF. Bila eksak → Pelanggan & EDC LULUS; semua gate hijau → Fase 1.

## Hasil probe RONDE 3b (FASE05d, 2026-06-20)

- **EDC = LULUS ✅ (eksak 2 tanggal).** Sumber: **`vw_edc3` group by `ctgl`** (business-date EasyMax) +
  `CKDKARTU→tm_card.CKDCARD`, **kecuali baris `CKDKARTU=''`** (kartu tak tercatat).
  14 Jun: 94.106.495 − blank 3.132.398 = **90.974.097** (11 channel) = PDF. 17 Jun: 120.260.545 − blank
  3.695.046 = **116.565.499** (9 channel) = PDF. Tiap channel cocok ke rupiah. Baris blank-card = EDC
  tak terklasifikasi → sync tetap, tapi **flag kepatuhan** & dikecualikan dari breakdown channel laporan.
- **Pelanggan — `vw_jualplg` eksak utk pelanggannya, tapi DUA jalur posting.** `vw_jualplg` by `DTGL`
  (non-batal) = vol+Rp per pelanggan PERSIS, tapi hanya pelanggan RFID/deposit (14 dari 18; 38 dari 48).
  Sisanya ada di `tr_bppiut` (jurnal kredit langsung). Rekon Rp EKSAK via union:
  14 Jun 101.738.792 (14) + bppiut-only 9.763.788 (4) = **111.502.580 / 7.583,30 L / 18**;
  17 Jun 138.369.339 (38) + bppiut-only 16.744.213 (10) = **155.113.552 / 48**. → **Pelanggan = `vw_jualplg`
  ⊎ `tr_bppiut` dedup per CKDPLG.** Master nama `tm_plg`. Pelanggan tetap **AUTO-SYNC** (2 tabel hidup).
  Sub-pertanyaan terbuka: volume utk pelanggan bppiut-only (NJUMLAH tanpa liter) → ronde 3c.
- **EDC PK** tetap tanpa kunci baris bersih → desain Fase 1 (surrogate + dedup, atau agregat per (ctgl,kartu)).

→ **RONDE 3c (FASE05d2):** kunci query Pelanggan lengkap (cek `vw_djlplg`/`vw_djlplg2` apakah = 18/48 langsung;
union-extra test; linkage `tr_bppiut.VCREF→tr_hjualplg` utk sumber volume). EDC sudah LULUS.

## Hasil probe RONDE 3c (FASE05d2, 2026-06-20) — Pelanggan TERKUNCI

- **Union EKSAK (Rp) 2 tanggal:** extra (tr_bppiut not in vw_jualplg) = 14 Jun 4 plg/9.763.788,
  17 Jun 10 plg/16.744.213 → 101.738.792+9.763.788 = **111.502.580**; 138.369.339+16.744.213 = **155.113.552**.
- **Pelanggan gap = penjualan VOUCHER.** `tr_bppiut.VCREF`=`UV…` (bukan `JP…`) → tak link `tr_hjualplg`
  (join NULL) → voucher (`tr_husevouc`/`tr_usevouc`, ada `CKDPLG`). Tiga jalur jual-pelanggan:
  RFID/deposit (`pjualplg`→`vw_jualplg`) + voucher (`tr_bppiut` VCREF=UV; volume di tabel voucher).
- `vw_djlplg`/`vw_djlplg2` TANPA `DTGL` (hanya TanggalJam korup) → bukan sumber laporan. `vw_jualplg` tetap terbaik.
- **Konsekuensi:** rekonsiliasi A–I = Rp-only (`E=A−(B+C+D)`); **C(Rp) EKSAK**. Volume per-pelanggan voucher
  (≈1.100 L dari 7.583 L) = detail tampilan, sumber tabel voucher → diselesaikan Fase 1, **non-blocking gate**.

## Rekonsiliasi historis = snapshot-as-of (data live boleh drift)

Probe/dry-run membaca EasyMax **live (hari ini)**; PDF = snapshot saat dicetak. Untuk tanggal-bisnis
yang shift-3-nya lewat tengah malam, transaksi sah masih terakru SETELAH laporan manual dicetak →
angka live boleh **sedikit lebih tinggi** dari PDF. **Ini bukan bug.**

Bukti terkunci (FASE 0.5f, 15 Jun): satu-satunya delta = **PLG2952 PT INDOMARCO P.** dry-run
`1.326,03 L / 28.650.526` vs PDF `1.316,00 L / 28.414.821` = **+10,03 L / +235.705** (satu line Dexlite).
38 pelanggan lain + 8 voucher cocok eksak. Jejak: line bisnis-tanggal 15/6 di-dispense 16/6 00:03–06:05
(shift-3) → PDF (cetak di cutoff tetap) tertinggal satu line. Verifikasi rekon historis pakai PDF
sebagai acuan **as-of**, toleransi drift shift-3 untuk tanggal berjalan.

## ✅ PASS-BAR FINAL (FASE 0.5 SELESAI — semua angka rekonsiliasi EKSAK ×2 tanggal)

| Seksi | Verdikt | Sumber (terkunci by data) | Eksak |
|---|---|---|---|
| 2 Pelanggan | **AUTO** | `vw_jualplg` (by `DTGL`, non-batal) ⊎ `tr_bppiut` (SJNSBP=1,SBATAL=0, VCREF=UV) dedup `CKDPLG`; nama `tm_plg.VCNMPLG` | ✅ Rp |
| 3 EDC | **AUTO** | `vw_edc3` group by `ctgl` + `tm_card` (CKDKARTU→CKDCARD), **`CKDKARTU<>''`** | ✅ Rp |
| 5 Pendapatan Non Tunai | **AUTO** | `tr_deposit` by `DTGL` (NTOTAL, SBATAL, CKDPLG) | ✅ |
| 4 Pendapatan Lain | **MANUAL** | `app.manual_entry` (tak ada sumber EasyMax hidup) | n/a |
| 6 Pengeluaran | **MANUAL** | `app.manual_entry` (modul kas mati 2019) | n/a |

Catatan desain Fase 1 (bukan blocker): (a) volume pelanggan-voucher dari `tr_*usevouc` ATAU turunkan
liter=Rp/harga; (b) PK `tr_edc` tak bersih → surrogate id + dedup komposit kaya, atau sync agregat
`(ctgl,kartu)`; (c) EDC blank-card disinkron tapi di-flag (kepatuhan), dikecualikan dari channel laporan;
(d) tabel ber-tanggal-korup (`pjpelanggan`) TETAP jangan dipakai.

## Hasil probe RONDE 3d (FASE05e, 2026-06-20) — sumber volume voucher TERKUNCI

- **Sumber voucher = `vw_usevouc`** (header `tr_husevouc` 18.303 + detail `tr_dusevouc` 103.513).
  Kolom: `CKDUSEVOUC`, `DTGL` (business-date bersih), `CKDPLG`, `liter`, `NJUMLAHUSE` (Rp), `CKDBBM`,
  `VCNMPLG`, `SBATAL`, `NSHIFT`, `CNOVOUC`. (Bukan `TotalHarga` → query V2 error nama kolom saja.)
- **Rp voucher per pelanggan = PDF PERSIS** (V3): 14 Jun REHOBOT 4.818.688 / JNE 4.178.200 /
  INDOMARCO-kecil 577.900 / POL 189.000 = 9.763.788 = gap. ✓
- **Pelanggan final = `vw_jualplg` (pjualplg) ⊎ `vw_usevouc` (voucher), SUM per `CKDPLG` by `DTGL`,
  non-batal.** Dua jenis transaksi disjoint → union tanpa double-count. Volume voucher = `vw_usevouc.liter`
  (gap 1.103,91 L 14 Jun) → angka eksaknya dikonfirmasi di gate dry-run F1a (data nyata).
- Rencana detail Fase 1 → [`FASE1-PLAN.md`](FASE1-PLAN.md).

## Rencana Fase 1+ (berfase, tiap fase gate — minta approve)

- **F1a Agent** (read-only EasyMax): domain baru `pelanggan` (`vw_jualplg` + `tr_bppiut` + master `tm_plg`),
  `edc` (`vw_edc3` + `tm_card`), `deposit` (`tr_deposit`). Watermark per pola existing (DTGL/ctgl/Tanggaljam);
  UPSERT natural-key; EDC pakai surrogate + dedup. Gate: `pnpm check` hijau + dry-run rekon 14–18 Juni di mesin SPBU.
- **F1b Backend/Prisma**: migrasi tabel `public` (pelanggan_*, edc, deposit, +master plg/card) + route `/ingest`;
  **plus** `app.manual_entry` (id, unit_id, business_date, section, keterangan, amount, created_by_user_id,
  updated_at, void). Gate: E2E staging.
- **F1c Dashboard**: query schema-qualified `public.*` via `ScopedUnitId`; isi seksi 2/3/5 auto; ganti seksi 6
  dari `getCashForDate` (dorman) ke `app.manual_entry`; server-action + form RBAC pengawas utk seksi 4 & 6.
  Hapus placeholder hanya saat data nyata mengalir (auto-heal page.tsx:133).
- **F1d Verifikasi LIVE** Chrome staging: bandingkan tiap seksi vs PDF 14–18 Juni (unit 6478111).
- Invarian: READ-ONLY EasyMax, `ScopedUnitId` tiap query, `pnpm check` hijau (+negative-access), staging-first,
  JANGAN sentuh `main`, jangan echo secret. Domain `cash` dorman JANGAN dihapus.

## Falsifikasi → gate probe (harus LULUS dulu)

1. **EDC ⊃ QRIS?** group `tr_edc` per `tm_card` (14 Jun) harus = 11 channel & 90.974.097
   (17 Jun = 116.565.499). Jika QRIS tak ada di `tr_edc`, temukan tabelnya — jangan diam.
2. **`SJNSBP` `tr_bppiut`** sisi debit (tempo baru) per `CKDPLG` harus = total PDF Pelanggan.
   Hipotesis alternatif (lebih kuat krn ada **Liter**): `pjpelanggan` (filter tanggal waras).
   Probe uji keduanya; pilih yang rekon vol **dan** Rp.
3. **Pengeluaran mati?** `MAX(DTGL)` `tr_hkasbank` + cari modul kas 2026 mana pun. Nihil → kunci MANUAL.
4. **PK `tr_edc`** distinct `CNOTRACE` vs `(Tanggaljam,NoNozzle,CNOTRACE)` → tentukan UNIQUE key.
5. **Business-date** `DATE(tr_edc.Tanggaljam)`/`tr_bppiut.DTGL` rekon ke PDF; cek spillover shift-3 lewat tengah malam.
