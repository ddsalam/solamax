# FASE 1 — Rencana Build "Rincian Penjualan" (5 seksi)

> Status: **RANCANGAN — menunggu approval**. Tidak ada kode ditulis sampai disetujui.
> Sumber data TERKUNCI by probe live (lihat [`ADR-001`](ADR-001-rincian-data-sources.md)).
> Berfase dengan gate; tiap fase berhenti minta approve. Staging-first, jangan sentuh `main`.

## Ringkasan sumber (terbukti eksak ×2 tanggal di mesin SPBU)

| Seksi | Verdikt | Sumber EasyMax (read-only) | Business-date | Rp section |
|---|---|---|---|---|
| 2 Pelanggan | AUTO | `vw_jualplg` ⊎ `vw_usevouc`, SUM per `CKDPLG`; nama `tm_plg` | `DTGL` | 111.502.580 / 155.113.552 ✓ |
| 3 EDC | AUTO | `vw_edc3` per `ctgl`+`CKDKARTU` (≠''); nama `tm_card` | `ctgl` | 90.974.097 / 116.565.499 ✓ |
| 5 Pendapatan Non Tunai | AUTO | `tr_deposit` by `DTGL` | `DTGL` | 0 / 47.000.000 ✓ |
| 4 Pendapatan Lain | MANUAL | `app.manual_entry` | input pengawas | 11.284.400 / 23.041.400 |
| 6 Pengeluaran | MANUAL | `app.manual_entry` | input pengawas | 300.000 / 536.040 |

Prinsip tak bisa dinegosiasi: **EasyMax read-only mutlak** (user SELECT-only, guard kode), tiap query
dashboard lewat `ScopedUnitId`, `pnpm check` hijau (+negative-access tests), jangan echo secret,
domain `cash` dorman JANGAN dihapus.

---

## F1a — AGENT (domain baca-saja baru)  ·  gate: dry-run rekon 14–18 Jun di mesin SPBU

Tambah 3 domain mengikuti pola domain existing (`apps/agent/src/domains.ts`), + 2 master.
**Watermark pakai business-date `DTGL`/`ctgl` (date-level) + rescan window** (seperti domain `cash`),
BUKAN `TanggalJam` — karena detail (`tr_djualplg`/`tr_dusevouc`) bisa ber-`TanggalJam` korup; header
`DTGL`/`ctgl` bersih.

### Domain `deposit` ✅ SELESAI (gate dry-run LULUS 2026-06-20)
- Sumber: `tr_deposit` (PK `CKDDEPO`). Kolom: `DTGL,CKDPLG,NTOTAL,NSALDO,SBATAL,VCKET`.
- **FULL SYNC** (bukan windowed) — tabel kecil (~6k); nol gap SBATAL-flip telat. Natural key `(unit_id, ckddepo)`.
- **Rekon dry-run EKSAK 5 hari** vs PDF "Pendapatan Non Tunai" (non-batal): 14/6 absen (0); 15/6 131.084.492·7;
  16/6 4.000.000·2; 17/6 47.000.000·6; 18/6 76.601.236·3. Filter `sbatal` terbukti benar (16/18 Jun nomor
  mulai #4/#3 = baris batal terkecuali). `pnpm check` hijau.

### Domain `edc` ✅ SELESAI (gate dry-run LULUS 2026-06-20)
- Sumber: `vw_edc3` (`business_date` dari `ctgl`); channel via master `card` (`tm_card`, CKDKARTU→CKDCARD).
- Incremental per `ctgl` + rescan window (`edcRescanDays`=5). **PK: surrogate `id` + REPLACE per
  `(unit_id, business_date)`** (komposit global 51 tabrakan/269k → bukan UNIQUE; jangan collapse). EDC tanpa
  `SBATAL` → replace yang menangkap koreksi. Baris `CKDKARTU=''` (blank-card) **disinkron + di-flag**,
  dikecualikan dari channel-sum laporan.
- **Rekon dry-run EKSAK 5 hari** (channel_sum=PDF D, +per-channel, +jumlah channel): 14/6 90.974.097·11;
  15/6 136.027.430·7; 16/6 78.681.558·11; 17/6 116.565.499·9; 18/6 86.920.121·8.
- **Contoh kasus flag kepatuhan (UI nanti):** blank-card 13/6 = **33.513.052 (51 txn)** — outlier besar vs
  ~3–6 jt hari lain. Decision #3 (sync+flag) HARUS menampilkannya, jangan sembunyikan.

### Domain `pelanggan` (dua sub-sumber, union) ✅ SELESAI (gate dry-run LULUS 2026-06-20)
- **Rekon EKSAK 4 hari** (14/16/17/18) + 15 Jun = PDF + drift benign PLG2952 (+235.705/+10,03 L, ADR-001).
  overlap_ckdplg=0 tiap hari; voucher hard-gate eksak (14/6 1.103,91 L/9.763.788; 17/6 1.575,4 L/16.744.213).
- **Latensi:** dry-run window 8-hari = 36 dtk/1457 baris; **steady-state 3-hari ≈ 13 dtk** @ poll 15 mnt.
- **✅ RESOLVED (bukan residual):** dugaan awal "MySQL 5.0 MyISAM → SELECT READ-lock blok INSERT pompa"
  TERBANTAH oleh probe FASE05g (2026-06-21): `tr_djualplg`/`tr_hjualplg` ternyata **InnoDB** (MVCC, row-lock)
  → SELECT tak pernah blok INSERT. SELECT pelanggan ~12–64s TIDAK ganggu pompa. Window 3-hari + poll 15-mnt
  dipertahankan sebagai higiene-beban (bukan mitigasi lock). Lihat Hardening item 1.

- Sub-A `vw_jualplg`: `DTGL,CKDPLG,VCNMPLG,Liter,TotalHarga,CKDJUALPLG,NSHIFT,SBATAL,CKDDEPO,CKDBBM`.
- Sub-B `vw_usevouc`: `DTGL,CKDPLG,VCNMPLG,liter,NJUMLAHUSE,CKDUSEVOUC,NSHIFT,SBATAL,CKDBBM`.
- **Nama `VCNMPLG` DI-DENORMALISASI dari view** (kedua view sudah membawa nama) → TIDAK perlu master
  `tm_plg` terpisah (hindari mismatch format CKDPLG dotted vs PLG####). Beda dari EDC yang butuh `tm_card`
  karena `vw_edc3` hanya punya `CKDKARTU`.
- Watermark: **`DTGL` (header, bersih)** + rescan window (`pelangganRescanDays`=5). JANGAN `TanggalJam`
  (detail bisa korup). Detail tanpa PK bersih → **surrogate `id` + REPLACE per `(unit_id, business_date)`**
  (konsisten EDC; menangkap SBATAL-flip & koreksi). Dua tabel: `pelanggan_sale`, `voucher_sale`.
- **Anti-double-count (hard-check gate):** transaksi disjoint (JP vs UV) TAPI agregasi per `CKDPLG` lintas
  kedua view → pelanggan yang punya sale+voucher hari sama ter-SUM benar (sekali, gabungan). Cetak
  `overlap_ckdplg` per hari — bukti, bukan asumsi. (Terbukti dry-run: overlap=0 tiap hari, rekon eksak.)
- **⚠️ LATENSI `vw_jualplg` (terukur FASE 0.5f):** view BERAT di MySQL 5.0 — windowed 14-hari **64 dtk**,
  5-hari 19 dtk, 1-hari 4 dtk (≈4 dtk/hari; join `tr_hjualplg⋈tr_djualplg` = lantai, detail tak punya
  business-date). **Base-table BUKAN obat** (base 14-hari 53 dtk ≈ view; base = view EKSAK 14–18 → swap
  valid tapi tak mempercepat). **Lever = lebar window.** Keputusan: `pelangganRescanDays=3` (~12 dtk,
  tutup shift-3 lewat-malam + margin) + **`pelangganIntervalMs`=15 mnt** (poll jarang; pelanggan berat,
  laporan harian tak butuh real-time). Net beban DB POS: ~12 dtk tiap 15 mnt = ringan. `MAX(DTGL)` atas
  view DILARANG (materialisasi penuh = hang 64 dtk; dry-run bound pakai tanggal sistem).
- **Limitasi pilot:** window 3 hari → koreksi/pembatalan pelanggan >3 hari lampau tak ter-recapture
  (REPLACE per business_date hanya pada window). F1b/monitoring boleh tambah sapuan-lebar harian (low-freq).
- **Drift snapshot:** rekon historis = as-of PDF; tanggal-bisnis berjalan boleh sedikit lebih tinggi (akru
  shift-3 setelah cetak). Contoh 15/6: PLG2952 +10,03 L/+235.705 = benign (lihat ADR-001).

### Master baru
- `tm_plg` (`CKDPLG`→`VCNMPLG`,`VCALAMAT`) — nama pelanggan. Full-sync (pola `masters`).
- `tm_card` (`CKDCARD`→`VCNMCARD`,`CKDBANK`,`CGL`) — nama channel EDC. Full-sync.

### Perubahan shared
- `packages/shared/src/domains.ts`: tambah `pelanggan|edc|deposit` ke enum domain.
- `packages/shared/src/ingest.ts`: tambah tabel payload + skema zod (per-tabel, batas 5000 baris).

**Gate F1a:** `pnpm --filter @solamax/agent typecheck && test` hijau; `--dry-run` di mesin SPBU cetak agregat
yang rekon ke PDF 14–18 Jun (Pelanggan vol+Rp+jumlah, EDC Rp+channel, deposit). Konfirmasi voucher
`SUM(vw_usevouc.liter)` 14 Jun = 1.103,91 L. **Berhenti minta approve.**

---

## F1b — BACKEND / PRISMA (migrasi + /ingest)  ·  gate: E2E staging

Migrasi `0006_rincian_domains` (schema `public`) + `0007_manual_entry` (schema `app`).

### Progres F1b (loop lokal, 2026-06-20)
- [x] **1. Migrasi `0006`** mirror `public` (deposit, edc, pelanggan_sale, voucher_sale, **card**) + GRANT SELECT
  dashboard_app. **TANPA `master_pelanggan`** — keputusan terkunci: `vcnmplg` di-denormalisasi dari view
  (lihat F1a; hindari mismatch CKDPLG). Gate ✅: 6 migrasi apply bersih (Docker pg16); tabel+index dibuat;
  privileges `dashboard_app` = SELECT=t, INSERT/UPDATE/DELETE=f utk kelima tabel; `prisma migrate diff`
  applied-DB↔schema = "No difference"; `pnpm check` hijau (shared 3 / dashboard 38 / agent 38 / backend 12).
- [x] **2. Migrasi `0007`** `app.manual_entry` (PK uuid `gen_random_uuid()`; TANPA unique urut; `urut` int
  ordering; enum `manual_entry_section`=pendapatan_lain/pengeluaran; audit created_by/created_at/updated_at/
  void/voided_by_user_id/voided_at). Gate ✅: apply bersih; tabel+enum dibuat; `dashboard_app` =
  SELECT/INSERT/UPDATE=t, **DELETE=f** (void via UPDATE); drift "No difference"; `pnpm check` hijau.
  **+REVOKE DELETE** (0007) menutup kebocoran `ALTER DEFAULT PRIVILEGES ...,DELETE` (B1): diuji vs
  default-priv aktif → `manual_entry` DEL=f sedangkan tabel kontrol DEL=t (REVOKE menang).
- [x] **3. Negative-access test** `apps/dashboard/src/lib/grant.integration.test.ts` (gated `GRANT_LIVE_DB=1`
  + `DASHBOARD_APP_DATABASE_URL`; skip tanpa DB). Buktikan `dashboard_app`: SELECT-only di 5 tabel public,
  RW-no-DELETE di `app.manual_entry`. Gate ✅: HIJAU (6 test) saat grant benar; sengaja `GRANT INSERT` →
  MERAH (deposit gagal); REVOKE → HIJAU lagi. `pnpm check` hijau (test ter-skip tanpa env: 12 skipped).
- [x] **4. Wiring `/ingest`** — `table-config` + `buildReplace` (DELETE business_date → INSERT) utk
  edc/pelanggan_sale/voucher_sale; UPSERT (deposit/card); zod `IngestPayload.safeParse` (controller, shared);
  cap `MAX_ROWS_PER_TABLE=5000`. **Agent whole-date batching** (`batchByBusinessDate`) → satu business_date
  tak terpisah antar payload (cegah DELETE payload-2 menghapus insert payload-1). Gate ✅:
  `ingest.idempotency.test.ts` (gated `INGEST_LIVE_DB=1`) HIJAU — deposit UPSERT 0-dup+update; edc REPLACE
  0-dup/0-drop + koreksi bersih + lintas-tanggal aman; multi-tanggal/payload. +2 unit `batchByBusinessDate`.
  `pnpm check` hijau (agent 40 / backend 12+3skip / dashboard 38+12skip / shared 3).
- [x] **5. Checklist deploy+E2E staging** ditulis (§ "Checklist DEPLOY + E2E STAGING" di bawah). Eksekusi =
  OUTWARD (Dion). **SEMUA sub-tugas lokal F1b ✅ — loop berhenti, handoff ke Dion.**

### Tabel `public` (mirror EasyMax, dashboard_app SELECT-only)
- `pelanggan_sale` — id bigserial, unit_id, ckdjualplg, dtgl(date,idx), ckdplg(idx), liter, total, ckdbbm,
  nshift, sbatal, ckddepo, jrnkey, nonozle. UNIQUE natural-key (lihat F1a).
- `voucher_sale` — id bigserial, unit_id, ckdusevouc, dtgl, ckdplg, liter, njumlahuse, ckdbbm, nshift, sbatal,
  cnovouc, jrnkey. UNIQUE.
- `edc` — id bigserial, unit_id, business_date(date,idx), cshift, tanggaljam, ckdkartu, total, liter, jenis,
  cnotrace, nonozle, ckdbbm, jrnkey. UNIQUE (atau surrogate-only + strategi `ctgl`).
- `deposit` — unit_id, ckddepo, dtgl(idx), ckdplg, ntotal, nsaldo, sbatal, vcket. PK `(unit_id,ckddepo)`.
- `master_pelanggan` — unit_id, ckdplg, vcnmplg, vcalamat. PK `(unit_id,ckdplg)`.
- `master_card` — unit_id, ckdcard, vcnmcard, ckdbank, cgl. PK `(unit_id,ckdcard)`.
- Semua: `GRANT SELECT ... TO dashboard_app` (ikut pola migrasi 0004).

### Tabel `app` (RW oleh dashboard_app)
- `manual_entry` — id uuid, unit_id int, business_date date, section enum(`pendapatan_lain`,`pengeluaran`),
  urut int, keterangan text, amount numeric(17,2), void boolean default false,
  created_by_user_id, created_at, updated_at. Idempoten per `(unit_id,business_date,section,urut)`.
  v1 minimal (audit: created_by + updated_at + void). `GRANT SELECT,INSERT,UPDATE` ke dashboard_app.

### /ingest
- `ingest.controller`/`service` + `table-config.ts`: tambah domain & tabel; UPSERT by natural key; transaksi
  atomik dgn `sync_state` (pola existing). Validasi zod dari shared.

**Gate F1b (idempotensi + COMPLETENESS — wajib, jangan lolos):**
- Deploy staging; agent kirim domain baru; data muncul di Cloud SQL; idempoten (kirim ulang nol dup).
- **Pagination full-sync deposit:** log dry-run cetak `total:6170` (rekon, benar) tapi payload preview
  `counts:{deposit:1000}` = HANYA halaman-pertama logging. Buktikan jalur KIRIM mem-paginasi & mengirim
  SEMUA 6170 baris (~7 batch), bukan cap 1000. Batas zod payload **5000 baris/tabel** → 6170 > 5000 WAJIB
  di-chunk ≤ batas (batch 1000 < 5000 → aman ASAL benar-benar batch, bukan satu payload 6170).
- **Completeness test:** kirim ulang full-sync → Cloud SQL = 6170 baris, **nol dup, nol drop**.
- **EDC replace-per-business_date:** backend DELETE rows `(unit_id, business_date)` lalu insert window;
  uji koreksi (rerun window) tak menggandakan & menangkap perubahan.
- **EDC backfill completeness:** backfill awal ~266k baris → WAJIB paginasi & kirim SEMUA (batch ≤ cap zod
  5000); preview `edc:1000` = logging halaman-pertama, BUKAN cap kirim. Kirim ulang → nol dup/drop.
**Berhenti minta approve.**

### CHECKLIST E2E STAGING TERKONSOLIDASI (Dion — OUTWARD, berurut, satu sumber)
> Semua OUTWARD (deploy/live-send/PR). Loop lokal BERHENTI; Dion eksekusi berurut. Gate lokal sudah lulus
> (Docker pg16: migrasi apply bersih; negative-access HIJAU→MERAH→HIJAU; idempotensi 0-dup/0-drop; REVOKE
> DELETE manual_entry terbukti vs default-priv; lock-gate CLOSED = InnoDB). JANGAN `main`; jangan echo secret.

1. **Migrasi Cloud SQL staging:** `DATABASE_URL=<staging> pnpm --filter @solamax/backend exec prisma migrate deploy`
   → terapkan `0006_rincian_domains` + `0007_manual_entry`. (`0007` REVOKE DELETE menutup kebocoran DELETE dari
   `ALTER DEFAULT PRIVILEGES` B1 → `manual_entry` void-only.)
2. **Deploy backend** ke Cloud Run staging (image `/ingest` REPLACE/UPSERT). Lihat `apps/backend/DEPLOY-GCP.md`.
3. **Re-test idempotensi DB-gated lawan staging** (buktikan cap re-export resolve runtime):
   `INGEST_LIVE_DB=1 DATABASE_URL=<staging> pnpm --filter @solamax/backend exec vitest run src/ingest/ingest.idempotency.test.ts` → HIJAU.
4. **Agent LIVE (mesin SPBU):** re-bundle (`pnpm --filter @solamax/agent bundle`) → swap `solamax-agent.cjs` →
   `node solamax-agent.cjs --once` **(non-dry, live-send)**. Kirim deposit/edc/pelanggan/card.
5. **Verifikasi Cloud SQL (unit 6478111, per business_date 14–18 Jun) vs PDF:**
   - `deposit` Σntotal non-batal = PDF Pendapatan Non Tunai; **total 6170 baris** (completeness, nol drop).
   - `edc` Σtotal per (business_date, ckdkartu≠'') = PDF EDC (90.974.097/116.565.499/…); blank-card tersimpan+ter-flag.
   - `pelanggan_sale ⊎ voucher_sale` Σ per business_date = PDF Pelanggan (Rp+liter+jumlah plg: 111.502.580/7.583,30/18 dst).
   - **Idempoten:** `--once` 2× → hitungan identik (UPSERT 0-dup; REPLACE 0-dup/0-drop; koreksi bersih).
6. **Negative-access lapis-DB lawan Cloud SQL staging:** `GRANT_LIVE_DB=1 DASHBOARD_APP_DATABASE_URL=<dashboard_app staging>
   pnpm --filter @solamax/dashboard exec vitest run src/lib/grant.integration.test.ts` → HIJAU (dashboard_app:
   SELECT-only `public.*`; `manual_entry` SELECT/INSERT/UPDATE, **DELETE=false**).
7. **Deploy dashboard** ke Cloud Run staging (`apps/dashboard/Dockerfile` + `cloudbuild.yaml`).
8. **Verifikasi VISUAL Chrome staging:** `/unit/6478111/rincian/2026-06-14..18` — tiap seksi cocok PDF
   (Pelanggan/EDC/Deposit angka, blank-card flag terlihat, Summary A–I `E=A−(B+C+D)`/`H=E+F−G`), + form
   manual Pendapatan Lain/Pengeluaran: tambah + batalkan (void) round-trip.
9. **PR ke `staging`** (JANGAN `main`) setelah 1–8 hijau.

---

## F1c — DASHBOARD (isi 5 seksi)  ·  gate: review tampilan

### Progres F1c (loop lokal, 2026-06-20)
> Dependensi: verifikasi ANGKA seksi menunggu data F1b di staging (E2E Dion). Kode lokal dibangun
> terhadap skema terkunci; `pnpm check` (typecheck+unit) hijau.
- [x] **1. Query** `queries.ts`: `getPelangganForDate` (UNION `public.pelanggan_sale`∪`public.voucher_sale`
  SUM per ckdplg non-batal), `getEdcForDate` (`public.edc` per ckdkartu, `IS NOT NULL AND <>''`, JOIN `public.card`),
  `getEdcBlankCard` (flag blank-card terpisah, keputusan #3), `getDepositForDate` (`public.deposit` non-batal),
  `getManualEntries` (`app.manual_entry` NOT void, section enum). SEMUA `unit: ScopedUnitId`, schema-qualified.
  Gate ✅: `queries.rincian.test.ts` 5/5 (mock `q`, assert SQL+`$1`=unit+filter); typecheck hijau; grep: nol query baru tanpa ScopedUnitId.
- [x] **2+3. Wire `page.tsx`** seksi 2/3/5 (auto) + 4/6 (`getManualEntries` pendapatan_lain/pengeluaran),
  buang `naDomain` (auto-heal via `hideEmpty` filter), blank-card flag di meta seksi 3. Summary A–I:
  `C=Σpelanggan`, `D=Σedc`, `F=Σpend.lain`, `G=Σpengeluaran`, `E=A−(B+C+D)`, `H=E+F−G` (B Terra & I Setoran
  null/di luar lingkup v1). `getCashForDate` dilepas dari halaman (domain `cash` agent tetap utuh). Gate ✅: `pnpm check` hijau.
- [x] **4. Form manual (seksi 4&6)** — `manual-entry-actions.ts` server actions `addManualEntry`/`voidManualEntry`:
  `unit_id` SELALU dari `scope.requireUnit(code)` (notFound di luar scope), `created_by_user_id`=user sesi,
  edit = void+re-create (`voided_by/voided_at`); UPDATE void ber-`unit_id=$3` (lapis-2). `DataScope.userId`
  diekspos. UI `ManualEntryForm.tsx` (no-print) di seksi 4&6. Gate ✅: `manual-entry-actions.test.ts` 4/4
  (in-scope bind scoped unit_id; out-of-scope notFound→tak-tulis; void scoped; validasi) — **dibuktikan
  HIJAU→(bypass requireUnit)MERAH→(revert)HIJAU**. `pnpm check` hijau (dashboard 47 / +negative-access lapis-DB F1b).

**SEMUA sub-tugas F1c lokal ✅ — loop berhenti. Sisa = verifikasi-visual live (Dion, butuh data F1b staging).**

`apps/dashboard/src/lib/queries.ts` — fungsi baru, SEMUA `unit: ScopedUnitId`, schema-qualified `public.*`:
- `getPelangganForDate(unit,date)` → SUM(liter,rp) per ckdplg atas (`pelanggan_sale` ∪ `voucher_sale`)
  WHERE `dtgl=date AND NOT sbatal`, JOIN `master_pelanggan`. Urut rp desc.
- `getEdcForDate(unit,date)` → SUM(total) per ckdkartu atas `edc` WHERE `business_date=date AND ckdkartu<>''`,
  JOIN `master_card`. (Blank-card dikecualikan di sini; tersedia utk flag kepatuhan terpisah.)
- `getDepositForDate(unit,date)` → baris `deposit` WHERE `dtgl=date AND NOT sbatal`, JOIN `master_pelanggan`.
- `getManualEntries(unit,date,section)` → dari `app.manual_entry` WHERE `NOT void`.

`page.tsx`:
- Seksi 2 (Pelanggan), 3 (EDC), 5 (Pendapatan Non Tunai) ← query auto; hapus `naDomain` saat data mengalir.
- Seksi 6 (Pengeluaran): ganti `getCashForDate` (dorman) → `getManualEntries(...,'pengeluaran')`.
- Seksi 4 (Pendapatan Lain): `getManualEntries(...,'pendapatan_lain')`.
- Summary A–I: `C=Σ Pelanggan`, `D=Σ EDC`, `F=Σ Pendapatan Lain`, `G=Σ Pengeluaran`; `E=A−(B+C+D)`,
  `H=E+F−G`. (B/Terra & I/Setoran di luar lingkup tugas ini — biarkan; Terra punya sumber `tera` utk nanti.)

Form input manual (seksi 4 & 6): **server action** tulis ke `app.manual_entry`, di-scope `ScopedUnitId`
(`getDataScope().requireUnit`), hanya pengawas unit ybs; catat `created_by_user_id`; edit = void + re-create.

**Gate F1c:** `pnpm check` hijau (termasuk negative-access). Review tampilan oleh user.

---

## F1d — VERIFIKASI LIVE (staging, Chrome)  ·  gate: bukti kecocokan

Buka staging, bandingkan tiap seksi vs PDF per tanggal 14–18 Jun (unit 6478111). Tunjukkan kecocokan
angka (bukan klaim "selesai"). PR ke `staging` (bukan `main`).

---

## Temuan uji manual — perbaikan AKAR (lokal, 2026-06-21)
- **T1 "Omset §1 selalu kosong" = BUKAN bug kode (artefak data + gejala T2).** Paritas: Rincian & Operasional
  panggil `getSalesByProduct(unit.unit_id, date, date)` IDENTIK (rincian page:59 = laporan page:62), `dtgljual`
  = DATE (tanpa tz/off-by-one), ber-scope. DB lokal: `sales_header` hanya 01/14/15-Jun → §1 kosong di 16–18 Jun
  itu BENAR (tak ada sales). "Selalu kosong" = picker tampil tanggal cookie (mis. 18-Jun, tanpa sales) utk
  Rincian sementara Operasional di 14/15 → ilusi. **Sembuh otomatis oleh T2.** ⏳ konfirmasi visual staging Dion.
- **T2 picker (unit+tanggal) tak sinkron URL = BUG NYATA, diperbaiki di akar.** Akar: nilai TAMPIL picker dari
  cookie (`getSelection`, layout `(app)/layout.tsx:28`) bukan URL otoritatif; layout grup tak re-render saat
  pindah sub-rute → `<input value>` controlled basi. **Fix:** `deriveTopbarSelection(path,seed)`
  (`selection-keys.ts`) → di rute laporan picker cermin URL (`usePathname`); dipakai `TopbarPicker.tsx`
  (display+apply base) & `Sidebar.tsx:109` (link laporan↔rincian ikut tanggal URL). Grup-wide tetap pakai seed
  cookie. Test pengunci `selection-keys.test.ts` 5/5 (URL menang di laporan, seed di grup-wide). ⏳ visual Dion.
- **T3 mata uang negatif tanpa minus = BUG NYATA, fix akar.** Akar: `rp()` `Math.abs(n)` (`format.ts:6`) jatuhkan
  tanda → Summary H (=E+F−G, bisa sah negatif) tampil positif menyesatkan. **Fix:** `rp()` render `−Rp …` utk
  negatif (+normalisasi `-0`→`0`). Repro before: `rp(-5000)`="Rp 5.000"; after: "−Rp 5.000". Test `format.test.ts`
  4/4. Rumus TAK diubah. `page.tsx` sudah pakai `rp(H)` → otomatis tampil minus.

## Hardening lokal (loop, 2026-06-20)
- [x] **1. MyISAM go-live — base-table DICOBA lalu DI-REVERT ke view (path proven).** Premis "base-table
  sub-detik" SALAH: bottleneck = join `tr_djualplg` tanpa index `CKDJUALPLG` (tak bisa ditambah di EasyMax
  read-only); probe FASE05f ukur base≈view (14h 53s vs 64s, ~15% saja). `PELANGGAN.saleSql` **dikembalikan ke
  `vw_jualplg`** (tervalidasi penuh dry-run 14–18 Jun; base hanya via probe). Gate ✅: test `saleSql`=view; `pnpm check` hijau.
  - **Lock-gate go-live diformulasi ulang ke pertanyaan SEBENARNYA** (probe **FASE05g**, `--probe8`, SELECT/SHOW
    only): `concurrent_insert` + `SHOW TABLE STATUS` (Engine, Data_free) `tr_djualplg`/`tr_hjualplg`. MyISAM +
    concurrent_insert≥1 + Data_free=0 → SELECT TAK blok append-INSERT → **lock-gate CLOSED** (window+interval cukup);
    Data_free>0 → blocking nyata → window 3d + interval 15–30 mnt/off-peak. Harness cetak verdict otomatis.
  - ✅ **LOCK-GATE CLOSED (probe FASE05g dijalankan 2026-06-21, mesin SPBU).** Verdict: `tr_djualplg` &
    `tr_hjualplg` = **InnoDB** (BUKAN MyISAM — asumsi awal SALAH), Data_free=0, concurrent_insert=1.
    InnoDB MVCC + row-lock → **SELECT tak pernah memblok INSERT** (reader tak blok writer). SELECT pelanggan
    ~12–64s **TIDAK** ganggu INSERT pompa. **Kekhawatiran lock-pompa MOOT sejak awal** (salah duga engine).
    → Konsekuensi: window 3-hari + poll 15-mnt turun status dari "mitigasi lock kritis" jadi **higiene-beban
    biasa** (tetap dipertahankan: murah, mengurangi beban DB POS; bukan blocker go-live).
  - ✅ Re-export `MAX_ROWS_PER_TABLE` (item 2) terbukti **resolve runtime**: idempotency DB-gated 3/3 hijau (Docker pg16).
- [x] **2. Guard >5000 baris/business_date** di `batchByBusinessDate`. `MAX_ROWS_PER_TABLE=5000` dipindah ke
  `@solamax/shared` (sumber tunggal; backend re-export). Satu business_date > cap → **error keras + log**
  (lewat runCycle catch) — REPLACE per-date butuh satu payload utuh; pecah = DELETE-2 hapus INSERT-1.
  Praktis mustahil di SPBU (~370 baris/hari). Gate ✅: unit test date sintetis 5001 → throw, 5000 → aman;
  `pnpm check` hijau (agent 43).
- [x] **3. Defensive lain** — ditinjau: deposit UPSERT chunk ≤1000<cap (aman); EDC name fallback
  `COALESCE(vcnmcard, kode)`; manual urut non-unique by-design (tie-break created_at); REPLACE empty-date
  tak relevan (EasyMax flag-batal, baris tak hilang). Tak ada item lokal baru yang clean+unit-testable.

## Keputusan TERKUNCI (user, 2026-06-20)
1. **PK `edc`** → **surrogate `id` + replace-per-`(unit_id, business_date)`** (hapus-ganti semua baris satu
   `ctgl` tiap rescan). Natural-idempoten, kebal "tanpa row-key bersih", tangkap koreksi tanpa under-count.
   Komposit-UNIQUE HANYA bila langkah-1 F1a buktikan bebas-tabrakan; ragu → replace-per-business_date.
   **JANGAN collapse baris** (under-count).
2. **Volume pelanggan-voucher** → tampilkan `vw_usevouc.liter`, **HARD-GATE di F1a**: liter Pelanggan WAJIB
   rekon eksak ke PDF (sama standar dgn Rp) sebelum F1c. Non-blocking hanya utk math A–I (Rp-only).
3. **EDC blank-card** → sync + flag, exclude dari breakdown channel; total blank-card **WAJIB muncul**
   (chip/flag kepatuhan), jangan lenyap diam-diam.
4. **`app.manual_entry`** → APPROVED dgn revisi: **(a) TANPA UNIQUE** `(unit_id,business_date,section,urut)` —
   ini input manusia, bukan replay EasyMax; identitas = `id uuid` saja, `urut` = kolom ordering int biasa.
   **(b) audit void lengkap:** `voided_by_user_id` + `voided_at` (selain created_by/created_at/updated_at/void)
   — siapa menghapus/ubah angka kas = sinyal kepatuhan utama. Selebihnya v1 minimal.
5. **Terra (B) & Setoran (I)** → di luar 5 seksi; biarkan kosong v1 (Terra sumber `tera` utk fase lain).

## Penegasan gate F1a (user)
- Mulai domain `deposit`, BERHENTI di dry-run gate.
- Dry-run rekon **kelima hari 14–18 Jun** (bukan hanya 14/17): Pelanggan vol+Rp+jumlah, EDC Rp+channel,
  deposit, + voucher liter eksak.
- **Anti-double-count Pelanggan** (CKDPLG di kedua view pada DTGL sama) = hard-check numerik.
- **SBATAL-flip:** baris dibatalkan SETELAH tersync (deposit/sale/voucher) WAJIB ter-update saat rescan;
  pastikan window menangkapnya (analog SUBAH/SEDIT sales). Uji 1 kasus bila ada.
