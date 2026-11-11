---
title: Penjelasan selisih Cash flow check (waktu pembayaran piutang EasyMax vs rekening) - Plan
type: fix
date: 2026-11-11
topic: keuangan-selisih-arus-kas-piutang-waktu
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Penjelasan selisih Cash flow check (waktu pembayaran piutang EasyMax vs rekening) - Plan

## Goal Capsule

- **Objective:** When Finance opens Tutup hari for a day whose Cash flow check is not Rp 0 (Bakau 26 Okt 2026: −123.196.354), the screen explains the number in rupiah. It shows how much comes from a customer payment recorded on different days in EasyMax and on the bank, names the nearby day that holds the other half, says what is left over, and says in plain Indonesian what Finance should do about it.
- **Means:** One pure decomposition function plus one scoped read query. A "Penjelasan selisih arus kas" block on `TutupHariPanel` renders their output (KTD1–KTD4). The check value, `day_close`, the tolerance ladder and journals stay byte-for-byte untouched.
- **Product authority:** Dion. `apps/dashboard/KEUANGAN-HARIAN.md` stays binding, especially R28/KTD5 (hari buku), R32/KTD15 (koreksi susulan), §10.21 (sebab kosong) and §10.57. The verified production diagnosis (Bakau 26 Okt, read-only, 11 Nov 2026 ~22:05 WIB) is the evidence base. It is reproduced in the Appendix.
- **Execution profile:** Standard. Additive, read-only code: no migration, no write path, no change to any number the system already produces.
- **Stop conditions:** Stop and ask Dion if (a) a migration or index turns out to be needed, (b) any existing number (check, `langkahHarian`, `difference_rp`, tier, `koreksiSusulan`, journal) would change, (c) the fix seems to need a write to `cash_ledger`, EasyMax, or any production/staging DB, or (d) a merge to `main` / the `pilot` gate is needed.
- **Who finishes:** `ce-work` on branch `claude/2026-11-11-selisih-arus-kas-piutang-waktu` (from `origin/staging`). It opens one PR to `staging` and does not merge or deploy. Finance/Dion carry out Part B in the app. The cashier carries out the EasyMax side.
- **Open blockers:** None for Part A. Part B needs Finance to do two things first, then choose an option per row (B-table below):
  - Confirm which days of 26–30 Okt are closed and whether October has a Tutup bulan.
  - Confirm how EasyMax corrects a payment date.

---

## Product Contract

### Summary

The plan has three parts.

- **A. Code fix (PR to `staging`).** The Cash flow check on Tutup hari stops being an unexplained number. When it is not 0, a breakdown appears that adds up **exactly** to the check:
  1. **Waktu pembayaran piutang**: EasyMax customer payments dated that day minus bank rows "Transfer Pembayaran Piutang Pelanggan" dated that day.
  2. **Sisa**: rounding of setoran and other causes. It is flagged when it exceeds `TOLERANSI_RP`.

  The breakdown also gives a hint naming nearby days (±7) that carry the opposite difference, and a plain-language instruction.
- **B. Data fix (Finance and the cashier, in the UI; not executed by us).** The exact rows, the options for each, and the expected check before and after for 26, 29 and 30 Okt.
- **C. Non-goals and risks.**

### Problem Frame

Dion asked why Bakau 26/10/2026 shows a Cash flow check of −123.196.354. The arithmetic is faithful (diagnosis, Appendix). The category "Transfer Pembayaran Piutang Pelanggan" is `dariBukuKas: false` (`apps/dashboard/src/lib/keuangan-sisi-kas.ts:73`). Its arus comes from the EasyMax piutang delta (`deltaPiutangEasymax`, `keuangan-laporan-queries.ts:466-468`), and the bank row is only the cash realisation. So when a bank receipt is dated D and EasyMax records the payment on another day, the receipt appears 1:1 in the check of both days with opposite signs.

On 26 Okt the bank row a8b2f689 (BCA …6811, Rp 123.196.000) has no EasyMax counterpart. EasyMax recorded the three matching payments on 29 Okt. The remaining −354 is setoran rounding.

The product gap is that `TutupHariPanel` shows the number with only "Arus tidak cocok dengan saldo buku." (`apps/dashboard/src/components/keuangan/TutupHariPanel.tsx:126`). It gives no cause and no next step. Finance cannot tell a Rp 123 jt timing pair from a missing Rp 123 jt.

### Requirements

**Explanation (Part A)**

- R1. When the Cash flow check of day D is a number other than 0, Tutup hari shows a "Penjelasan selisih arus kas" block whose lines sum **exactly** (in sen) to the displayed check. When the check is 0 or `null`, the block is absent.
- R2. Line 1, "Waktu pembayaran piutang", = Σ EasyMax customer payments dated D − Σ non-void bank/kas rows with category "Transfer Pembayaran Piutang Pelanggan" whose `business_date` = D. Both counts and amounts are shown. The EasyMax set uses the same customer buckets as `deltaPiutangEasymax`.
- R3. Line 2, "Sisa (pembulatan setoran, dll.)", = check − line 1. It is flagged as needing attention when |sisa| > `TOLERANSI_RP`.
- R4. When line 1 ≠ 0, a hint lists days within D−7…D+7 (excluding D) on which the same unit has a line-1 difference of the opposite sign. Each day shows its rows and its day difference.
  - Exact match: of the pair (D, hint day), the day with negative line 1 (bank surplus) gives the target, which is the sum of its bank rows. If a subset of the EasyMax rows of the day with positive line 1 sums exactly to that target, the hint names it, e.g. "EasyMax mencatat pembayaran piutang Rp 123.196.000 (3 baris) pada 29 Okt".
  - When equal-valued subsets exist, the one with the lowest row order wins.
  - If no line-1 ≠ 0 day has an opposite day in range, the block says so: "Tidak ada hari dalam ±7 hari dengan selisih berlawanan — periksa tanggal pembayaran di EasyMax."
- R5. When line 1 ≠ 0, the block tells Finance in plain Indonesian what to do. Preferred: Finance asks the cashier to record the EasyMax payment on the bank date. Alternative: Finance books the bank row on the EasyMax day; its cost is in Part B. The text also says not to close the gap with a memorial or a counter-entry. When line 1 = 0, this action text is not shown. A flagged sisa instead says "Selisih di luar waktu pembayaran piutang — telusuri di baris arus kas di Laporan keuangan."
- R6. Nothing the system already computes changes. That covers the check value, `langkahHarian`, `day_close.difference_rp`, tier, `koreksiSusulan`, journals, the Layar 2 panels and both PDFs.

**Scope and safety**

- R7. The new read is scoped (`ScopedUnitId` via `getDataScope().requireUnit`) and runs through `qScoped` under RLS. It reads only `public.bppiut`, `public.pelanggan_master`, `app.cash_ledger` and `app.cash_account`.
- R8. If the explanation read fails, the page still renders. The block then says the explanation could not be loaded and the check is shown as before. The error is shown, not swallowed and not replaced with a guessed breakdown.

### Acceptance Examples

- AE1. **Covers R1–R4.** Bakau 26 Okt 2026, check −123.196.354. Line 1 = 0 − 123.196.000 = −123.196.000 (EasyMax 0 baris; bank 1 baris BCA …6811 "LLG-BPD KALBAR … SP2D"). Sisa = −354, not flagged. The hint names 29 Okt: "EasyMax mencatat pembayaran piutang Rp 123.196.000 (3 baris) pada 29 Okt — PLG0607 86.136.000, PLG0609 26.849.200, PLG0607 10.210.800".
- AE2. **Covers R1–R4.** Bakau 29 Okt, check +151.261.816. Line 1 = 173.112.484 − 21.849.700 = +151.262.784; sisa −968. The hint names 26 Okt and 30 Okt. 26 Okt is an exact match: its bank 123.196.000 equals the 3-row subset of 29 Okt EasyMax rows. 30 Okt is not: no subset of 29 Okt rows equals bank 17.864.200, so its day difference is shown.
- AE3. **Covers R1, R3.** A day with check −217 and no piutang activity: line 1 = 0, sisa −217, not flagged, no hint.
- AE4. **Covers R3, R5.** A day with line 1 = 0 and check −25.000: sisa −25.000 is flagged. The text says the sisa is outside piutang timing and must be traced in the arus lines. The re-date action text is not shown.
- AE5. **Covers R1.** Check 0 or `null` ⇒ no block, and the explanation query is not run (see KTD3).

### Scope Boundaries

- The explanation lives on Tutup hari (Layar 4) only. Layar 2 (`app/(app)/keuangan/unit/[code]/[date]/page.tsx`) and its PDF (`lib/export/keuangan-harian-doc.ts`, which prints the Cash Flow panel with its pemeriksa) are **deferred**. The component is built to be mountable there later.
- The Tutup hari PDF is unaffected. `TutupHariExportMount` receives no cash-flow value (`page.tsx:126-146`), and `lib/export/tutup-hari-doc.ts` prints no cash flow, so there is nothing to keep in sync.
- Other `dariBukuKas: false` pairs stay inside "sisa": Setoran Hasil Penjualan vs omzet, Pendapatan Lain-Lain vs Rincian, Biaya Operasional vs beban. Breaking them out is a later, separate decision.
- No change to whether the Cash flow check gates closing. It still does not (`keuangan-kas.ts:169-173`).

### Sources

- `/tmp/cc-bakau22/REPORT10-diagnosis.md` (verified read-only production diagnosis, reproduced in the Appendix).
- `apps/dashboard/KEUANGAN-HARIAN.md` §10.21, §10.57; R24/R28/R32, AE9/AE13 in `docs/plans/2026-10-29-1719-feat-keuangan-pihak-lawan-penebusan-impor-bank-plan.md`.

---

## Planning Contract

### Verification of the diagnosis against code

| Claim | Code evidence | Verdict |
|---|---|---|
| check = net − (kasAkhir − kasAwal) | `cashFlowCheck` `apps/dashboard/src/lib/keuangan-kas.ts:175-181`; `panelCashFlow` `keuangan-laporan-model.ts:131-209` | ✅ |
| Piutang arus = −Δ saldo piutang EasyMax (Lokal + Online), not bank rows | `keuangan-laporan-queries.ts:466-468`; `cashFlowInputDari` `keuangan-laporan-model.ts:508` | ✅ |
| "Transfer Pembayaran Piutang Pelanggan" is not summed into arus (`dariBukuKas: false`) but moves kas | `keuangan-sisi-kas.ts:73`, `arusBukuKas` `:112-121` skips it; kas saldo from all rows via `sisiKasPada` | ✅ ⇒ a bank receipt on D with no EasyMax payment on D shows 1:1 in the check |
| Kas and arus both keyed on `business_date` (rows booked maju count on their hari buku) | `arusBukuKas` filters `m.businessDate !== date`; `getMutasiKas` `keuangan-input-queries.ts:193-222` | ✅ ⇒ R2 must also key bank rows on `business_date` |
| Check does not feed `day_close` / tier | `keuangan-kas.ts:169-173`; tier from `langkahHarianRinci` (`page.tsx:78-110`) | ✅ ⇒ the fix cannot move a closing decision |
| Customer buckets: Lokal = SJENIS {1,5} undotted; Online = dotted; others excluded | `READ_SALDO_PELANGGAN_LEGACY_SQL` `queries.ts:2014-2045`; `getSaldoPelanggan` `queries.ts:2074-2082` (snapshot when ready, same rule) | ✅ ⇒ the EasyMax payment sum must use the same predicate |
| `bppiut` full-synced, catches back-dated rows and `sbatal` flips | `apps/agent/src/sync.ts:516-519`; `apps/backend/src/ingest/table-config.ts:266-273` | ✅ ⇒ option B(a) (cashier re-dates in EasyMax) flows into SolaMax at the next master cadence |
| Index `(unit_id, dtgl)` on `bppiut` exists | `0013_recap_saldo_tables/migration.sql:54` | ✅ ⇒ no migration |

### Key Technical Decisions

- KTD1. **Decompose; never recompute.** The block takes the check value already produced by `panelCashFlow(cashFlowInputDari(bahan))` (`page.tsx:96`) as input. It computes only line 1, and sisa = check − line 1 in sen. Exactness (R1) holds by construction, and no second arithmetic path for the check can drift. Rejected: recomputing net/kas inside the explainer. That would be a second owner of the check, which is the failure mode §KTD5 of the 2026-10-29 plan forbids for `difference_rp`.
- KTD2. **Pure model in a new module** `apps/dashboard/src/lib/selisih-arus-kas-model.ts`: `jelaskanSelisihArusKas({ date, check, hari: HariPiutang[] })` returns `{ baris: [{ kode: "piutang_waktu" | "sisa", rp, ... }], sisaDiLuarToleransi, petunjuk[] }`. All sums are in integer sen (`Math.round(rp*100)`, the `keuangan-sisi-kas.ts:105` idiom). Tolerance comes from the import `TOLERANSI_RP` (`keuangan-tutup-hari.ts:38`), so there is one owner. The R4 exact match is a bounded exhaustive search over the EasyMax rows of the EasyMax-surplus day. It runs only when that day has ≤ 16 rows. Above 16, only the day difference is shown, so the search is never slow.
- KTD3. **One read query, one round-trip, window D−7…D+7**, in a new `apps/dashboard/src/lib/selisih-arus-kas-queries.ts`: `getPembayaranPiutangSekitar(unit: ScopedUnitId, date: string)` returns per-row data for both sides:
  - EasyMax rows: `dtgl`, `ckdplg`, `vcref`, `vcket`, `njumlah` where `sjnsbp = 2 AND COALESCE(sbatal,0) = 0`, in the Lokal-undotted-or-dotted bucket, mirroring `READ_SALDO_PELANGGAN_LEGACY_SQL`.
  - Bank rows: `id`, account name, `business_date`, `tanggal_asal`, `amount`, `keterangan` where `category_label = 'Transfer Pembayaran Piutang Pelanggan' AND NOT void AND NOT saldo_awal`.

  The page calls it only when `cf.pemeriksa.nilai` is a non-zero number, so a balanced day pays nothing. It is run with `qScoped(unit, …)` like every other per-unit read. The category label is taken from the `PETA_KATEGORI_ARUS_KAS` key rather than retyped, and a guard test pins that.
- KTD4. **Render inside `TutupHariPanel` as a plain-data prop.** The page passes `penjelasanArusKas: PenjelasanSelisihArusKas | { galat: string } | null`, and a new presentational `PenjelasanSelisihArusKas.tsx` renders it under the three Syarat cards. The client panel gets serialisable data only; no query moves to the client. The existing `Syarat` card text for the check is unchanged.
- KTD5. **Wording carries the action, not the mechanics.** Per line-1 sign:
  - Bank > EasyMax: "Bank menerima Rp X pada {D}, tetapi EasyMax belum/tidak mencatat pembayarannya pada {D}."
  - EasyMax > bank: "EasyMax mencatat pembayaran Rp X pada {D}, tetapi rekening tidak menerimanya pada {D}."

  When line 1 ≠ 0, the action text is fixed and addressed to Finance: "Minta kasir mencatat pembayaran di EasyMax pada tanggal bank (dianjurkan). Membukukan ulang baris bank pada hari EasyMax membuat baris rekening koran tak bisa dicocokkan. Jangan menutup selisih ini dengan jurnal memorial atau baris lawan."
  - The wording is neutral on how the cashier changes the date (edit vs batal + re-entry), since that EasyMax procedure is still unconfirmed (Part B pre-steps).
  - It names no SQL and no memorial, which is consistent with §10.57 D3.
  - When line 1 = 0, the R5 flagged-sisa sentence is shown instead.

### High-Level Technical Design

```
page.tsx (server)
  bahan = getBahanLaporan(...)            ── unchanged
  cf    = panelCashFlow(cashFlowInputDari(bahan))   ── unchanged, check owner
  if cf.pemeriksa.nilai ∉ {0, null}:
      rows = getPembayaranPiutangSekitar(unit.unit_id, date)   ── NEW, qScoped, ±7 days
      penjelasan = jelaskanSelisihArusKas({ date, check: cf.pemeriksa.nilai, hari: kelompokkanPerHari(rows) })  ── NEW, pure
  <TutupHariPanel ... penjelasanArusKas={penjelasan}/>   ── renders NEW <PenjelasanSelisihArusKas/>
```

Directional only: `kelompokkanPerHari` builds `{ tanggal, easymax: Row[], bank: Row[] }` per date. Line 1 for day d = Σ easymax(d) − Σ bank(d).

### Assumptions

- `bppiut` `sjnsbp = 2` rows in the two buckets are the EasyMax customer payments. The diagnosis treats them so, and on 23, 27 and 31 Okt they equal the bank piutang rows exactly. A non-cash credit (write-off, retur) would also land in line 1. The text calls line 1 "pembayaran/pengurangan piutang di EasyMax", and the hint shows `vcket`, so Finance sees what each row is.
- When `getSaldoPelanggan` is served from a snapshot that lags live `bppiut`, line 1 (live) and the check (snapshot) can disagree by the lag. Sisa absorbs it and R1 still holds. The block then shows a large flagged sisa rather than a false zero.

---

## Implementation Units

### U1. Pure decomposition model

- **Goal:** `jelaskanSelisihArusKas` returns lines that sum exactly to the check, plus hints (KTD1, KTD2).
- **Requirements:** R1–R5, AE1–AE5.
- **Files:** `apps/dashboard/src/lib/selisih-arus-kas-model.ts` (new); `apps/dashboard/src/lib/selisih-arus-kas-model.test.ts` (new); fixture `apps/dashboard/src/lib/__fixtures__/bakau-26-okt-selisih-arus.ts` (new, real 26/29/30 Okt numbers).
- **Approach:**
  - Integer-sen arithmetic throughout.
  - Hints come only from days ≠ D whose line 1 has the opposite sign to D's line 1. They are sorted by |distance|, then by date.
  - The exact match follows R4: the target is the bank-surplus day's bank sum, and the search covers the EasyMax rows of the EasyMax-surplus day. Ties go to the lowest row order. The search is capped at 16 rows (KTD2).
  - The action and flagged-sisa texts are constants exported by the module (KTD5), so the component and tests share one source.
  - The model returns which text applies (`aksi: "piutang_waktu" | "sisa_di_luar_toleransi" | null`); the component does not decide.
- **Test scenarios:**
  - AE1, 26 Okt real numbers. Input: check −123.196.354; D rows EasyMax [] and bank [123.196.000]. 29 Okt EasyMax rows [86.136.000, 26.849.200, 10.210.800, 10.210.800, 17.859.212, 21.846.472] (Σ 173.112.484; the last row is the synthesised remainder, see Appendix) and bank [21.849.700]. 30 Okt EasyMax [] and bank [17.864.200]. Expect line 1 = −123.196.000 and sisa = −354, with Σ lines = −123.196.354 exactly. Sisa is not flagged. Exactly one hint, 29 Okt, with an exact subset of 3 rows summing to 123.196.000; 30 Okt is not hinted (same sign).
  - AE2, 29 Okt: check +151.261.816 ⇒ line 1 +151.262.784, sisa −968. Hints are 26 Okt and 30 Okt. 26 Okt matches exactly: its bank 123.196.000 equals 3 of the 29 Okt EasyMax rows, the first PLG0607 10.210.800 by row order. 30 Okt has no exact match; its day difference −17.864.200 is shown.
  - No opposite day: line 1 −5.000.000 with no other rows in ±7 ⇒ no hint list; the "tidak ada hari … berlawanan" sentence is shown; `aksi = "piutang_waktu"`.
  - 30 Okt: check −17.864.266,5 ⇒ line 1 −17.864.200, sisa −66,5. The half-rupiah survives in sen. Hint: 29 Okt has opposite sign; no exact subset equals 17.864.200, so the day difference is shown.
  - AE3: check −217, no rows ⇒ line 1 = 0, sisa −217, no hints, not flagged, `aksi = null`.
  - AE4: check −25.000, no rows ⇒ sisa flagged (`> TOLERANSI_RP`), `aksi = "sisa_di_luar_toleransi"`.
  - Boundary: |sisa| = 10.000 exactly ⇒ not flagged; 10.000,01 ⇒ flagged.
  - Cap: a hint day with 17 opposite rows ⇒ no subset search, day difference only.
  - Invariant (property-style loop over the fixtures): Σ `baris.rp` in sen === check in sen.
- **Verification:** `pnpm --filter @solamax/dashboard test selisih-arus-kas-model` green.

### U2. Scoped read query

- **Goal:** One `qScoped` read returning both sides for D−7…D+7 (KTD3).
- **Requirements:** R2, R4, R7.
- **Dependencies:** none (parallel with U1).
- **Files:** `apps/dashboard/src/lib/selisih-arus-kas-queries.ts` (new); `apps/dashboard/src/lib/selisih-arus-kas-queries.test.ts` (new, SQL-text guard in the style of `impor-bank-queries.test.ts`); optionally `apps/dashboard/src/lib/selisih-arus-kas.integration.test.ts` (env-gated, local throw-away Postgres 16 only).
- **Approach:**
  - Signature `(unit: ScopedUnitId, date: string)`, with the date validated by `DATE_RE`.
  - SQL uses `$1` unit and `$2::date ± 7`. `UNION ALL` the two sides with a `sisi` column, so it is one round-trip.
  - The EasyMax bucket predicate is copied from `READ_SALDO_PELANGGAN_LEGACY_SQL`'s `piut` CTE (join `pelanggan_master` `sjenis IN (1,5)`, `position('.' in trim(ckdplg))`).
  - The bank side joins `app.cash_account` for the display name and keeps the `amount` sign; Finance rows for receipts are positive debet.
- **Test scenarios:**
  - Guard: the SQL contains `unit_id = $1` on both sides, plus `sjnsbp = 2`, `COALESCE(b.sbatal,0) = 0`, `NOT l.void`, `NOT l.saldo_awal` and `business_date` (not `tanggal_asal`) for the bank side.
  - Guard: the category literal equals a key of `PETA_KATEGORI_ARUS_KAS` whose `baris` is "Transaksi piutang pelanggan EasyMax".
  - Guard: the function body calls `qScoped(` (not `pool.query`) and the module imports no `pool`.
  - Integration (gated `SELISIH_ARUS_LOCAL_DB=1`, local PG16 seeded with a fictitious unit as in `rls-surfaces.integration.test.ts`):
    - A batal row and an SJENIS-4 undotted customer are excluded.
    - A dotted customer is included.
    - A void ledger row is excluded.
    - Rows outside ±7 are excluded.
    - With `app.unit_ids` unset, zero rows are returned (RLS fail-closed).
- **Verification:** guard tests green in `pnpm check`. The integration test is run once locally and reported; it is never pointed at a cloud DB.

### U3. Panel block and page wiring

- **Goal:** Render the breakdown on Tutup hari only when the check ≠ 0 (KTD4, KTD5).
- **Requirements:** R1, R3, R5, R6, R8.
- **Dependencies:** U1, U2.
- **Files:** `apps/dashboard/src/components/keuangan/PenjelasanSelisihArusKas.tsx` (new); `apps/dashboard/src/components/keuangan/PenjelasanSelisihArusKas.render.test.tsx` (new, `renderToStaticMarkup` pattern from `TutupBulanPeriksa.render.test.tsx`); `apps/dashboard/src/components/keuangan/TutupHariPanel.tsx` (add optional prop + mount); `apps/dashboard/src/app/(app)/keuangan/unit/[code]/tutup-hari/[date]/page.tsx` (conditional call, try/catch → `{ galat }`).
- **Approach:**
  - Placement: directly under the `tutup3` cards and above the koreksi-susulan banner. Always expanded, so it stays visible while the close form is filled.
  - Layout:
    - The two lines are a small `tbl-card tbl-scroll` table (label · jumlah baris · rupiah). Amounts use the panel's existing `rp()` formatter, which shows −66,5 as is.
    - Hints list at most the 3 nearest days.
    - Bank rows show a short id (first 8 chars, as Finance quotes "a8b2f689"), account name and keterangan. EasyMax rows show `ckdplg`, amount and `vcket`.
  - Use existing classes only; add no new CSS.
  - States:

    | State | Tone / role | Content |
    |---|---|---|
    | `{ galat }` | `banner danger`, `role="alert"` | "Penjelasan selisih tidak bisa dimuat: …"; check card unchanged |
    | line 1 ≠ 0 | `banner warning`, `role="status"` | lines, hints (or the no-opposite-day sentence), action text |
    | line 1 = 0, sisa within tolerance | `banner info`, `role="status"` | lines only, plus "pembulatan setoran"; no action text |
    | sisa flagged | `banner warning` + `keu-pill` with the text "di luar toleransi" (not colour only) | the flagged-sisa sentence |

  - The page change is additive. The guard that reads this page is `tutup-hari-actions.guard.test.ts`, which pins `langkahHarianRinci(bahanAwal)`, `bolehMenutup(tierFor(`, `await pastikanBarisDayClose(` and `galatBarisDayClose=`. It must stay green untouched. (`laporan-keuangan.guard.test.ts` guards Layar 2 and is unaffected.)
- **Test scenarios:**
  - Render with the AE1 model output. Text contains "−123.196.000", "−354", "29 Okt" and "3 baris". The action sentence matches the KTD5 constant, and the markup contains no "memorial" instruction other than the prohibition.
  - Render `{ galat: "…" }` ⇒ the error text is shown with `role="alert"` and no lines appear.
  - Render the AE3 output ⇒ info tone, no action sentence.
  - `TutupHariPanel` with `penjelasanArusKas={null}` renders identically to today (snapshot of the Syarat block text unchanged).
  - A flagged sisa renders the pill.
- **Verification:** render tests green, `pnpm --filter @solamax/dashboard typecheck` clean. A local `dev` smoke against a local throw-away DB is optional. Never use pilot or staging data.

### U4. Decision record

- **Goal:** Record the decision and its limits where Finance-facing rules live.
- **Requirements:** R5, R6.
- **Dependencies:** U3.
- **Files:** `apps/dashboard/KEUANGAN-HARIAN.md` (new §10.58 "Penjelasan selisih Cash flow check — waktu pembayaran piutang (11 November 2026)").
- **Approach:** State the formula owner (KTD1), the bucket parity, the assumptions above, the deferred Layar 2/PDF, and the recommended Finance action. Do not edit any migration or earlier § text.
- **Test scenarios:** none (documentation).
- **Verification:** the doc renders; the § number is not already taken.

---

## Part B — Data fix (Finance / kasir, in the app; NOT executed by us)

### What the UI offers today (verified in code)

- **"Dibukukan maju" (`tanggal_asal` + `ADJ-FWD-*`) does not apply here.** Only the R28 write paths produce it: impor/klasifikasi, pecah mutasi, penebusan, antar unit, pembalik, EDC. They use `tentukanHariBuku` (`apps/dashboard/src/lib/hari-buku.ts:51-74`), which pushes a row forward **only past CLOSED days** to the first open day ≥ the bank date. It never lets the user pick a later open day. 26 Okt is open (no closed `day_close`), so any of those paths would book on 26 Okt again.
- **A manual "Tambah mutasi" row** goes through `simpanMutasiKas` (`apps/dashboard/src/lib/kas-actions.ts:91-252`). It writes `business_date` = the chosen date and never sets `tanggal_asal`. Finance can therefore type the receipt on any open day ≥ the account's cut-over. The trigger 0026 rejects closed days.
- **Batalkan (void) a bank row** goes through `voidMutasiKas` (`kas-actions.ts:347-466`). It is refused for system rows (saldo awal, EDC, penebusan, antar unit, transfer) and for rows in an active cocok group ("minta Head of Finance membatalkan cocoknya dulu"). It is refused by trigger on a closed day. It never deletes.
- **A manually typed row matches a rekening koran line only when `tanggal_asal ?? business_date` = the bank date.** This is rule 6 in `apps/dashboard/src/lib/cocok-bank-model.ts:39-41, 341-346`. A bank row re-typed on 29 Okt can therefore never be matched to the 26 Okt statement line. That line stays open, and Tutup bulan refuses open statement lines on required accounts. This is the main cost of option (b) below.
- **No raw SQL into `cash_ledger`, no memorial journal** (§10.57 D3). Neither is offered or recommended.

### Pre-steps (Finance, before choosing an option)

1. Check the Tutup hari status of 26–30 Okt and whether October has a Tutup bulan for Bakau. Only 26 Okt is confirmed open. Option (b) needs 29 Okt open. Option (a) moves the EasyMax saldo piutang of 26–28 Okt. If any of those days is already closed, the closed day's stored `difference_rp` stays frozen (§10.15), but its live Balance sheet view will move. In that case, bring the choice back to Dion before the cashier acts.
2. Confirm with the cashier how EasyMax corrects the date of a posted customer payment. It may allow an edit of `dtgl`, or require batal followed by re-entry with the bank date (new `ckdbppiut`, old row `sbatal=1`). Either works for SolaMax, because the `bppiut` full-sync picks up both. Physical deletion does not (see Risks). If EasyMax refuses back-dating altogether, option (a) is impossible and the choice returns to Dion.

### Rows and actions

| # | Row | Problem | Option (a) — recommended | Option (b) |
|---|---|---|---|---|
| B1 | Bank a8b2f689, BCA …6811, Rp 123.196.000, "Transfer Pembayaran Piutang Pelanggan", 26 Okt (LLG-BPD KALBAR … SP2D) | EasyMax recorded the payment as 3 rows dated 29 Okt (PLG0607 86.136.000 + PLG0609 26.849.200 + PLG0607 10.210.800 = 123.196.000) | Cashier re-dates those 3 EasyMax payments to **26 Okt**. SolaMax picks it up at the next full-sync of `bppiut`. The bank row stays matching the rekening koran. | Finance: check whether the row is cocok-linked in "Impor rekening koran". If it is, HoF runs "Batalkan cocok" first. Then **Batalkan** a8b2f689 and **Tambah mutasi** the same 123.196.000 on BCA …6811 dated **29 Okt**, with a keterangan "tgl bank 26 Okt, a8b2f689". Cost: BCA's book saldo differs from the rekening koran on 26–28 Okt. Worse, the 26 Okt statement line can no longer be matched (rule 6 above), and it holds October's Tutup bulan for BCA …6811. Usable only with a HoF decision on how to clear that line. |
| B2 | Bank d8abe42b, Rp 17.864.200, 30 Okt (BPD Kalbar) | EasyMax payment for it is dated **29 Okt**, Rp 17.859.212 (differs by Rp 4.988) | Cashier re-dates the EasyMax payment to **30 Okt**, and confirms with Finance why bank exceeds EasyMax by Rp 4.988 (fee, rounding, or a short-recorded payment). | Finance re-books d8abe42b on **29 Okt** as in B1(b), with the same unmatchable-line cost. The Rp 4.988 lands on 30 Okt under (a) and on 29 Okt under (b). |
| B3 | EasyMax second PLG0607 Rp 10.210.800 (rows BT…228 and BT…229, same note), 29 Okt | Two identical payments, only one bank receipt. Either a double entry in EasyMax or a bank receipt that is missing / not yet entered. | Batal only after all three checks agree: (1) the rekening koran of **every** Bakau account from 26 Okt to the latest imported date (November included) shows no second 10.210.800; (2) PLG0607's invoices/SO show one 10.210.800 obligation, not two; (3) the customer/treasury confirms one SP2D. Only then does the cashier **batal** the duplicate in EasyMax. Cancelling a real payment would bill the customer twice. | If a second bank receipt exists, Finance enters it on its bank date (Tambah mutasi or impor). |
| B4 | 4 manual rows of 26 Okt, status "submitted", not reviewed: pengeluaran 894.000 MESIN AIR BOOR, 170.000 PASIR AIR, 200.000 MT KB8076SG,KB8762AV (no `operational_category`); pendapatan_lain 3.682.900 SETORAN BRIGHT (titipan) | "Kelengkapan input 1 belum" | Finance reviews them in Input keuangan. MT KB8076SG needs an operational category; SETORAN BRIGHT stays a titipan. They are **already inside the check**, so approving them does not change −123.196.354. Rejecting or changing an amount would move the check by that amount. | — |
| B5 | Opening balance (saldo awal) for assets at 30 Sep | "Balance sheet check belum bisa dihitung" | HoF sets the missing opening values through the existing saldo-pembuka path (`tetapkanSaldoAwal`, HoF only). This is unrelated to the cash flow check and tracked separately. | — |

### Expected Cash flow check before and after (from the diagnosis numbers)

Derivation: line 1 on 26/29/30 Okt = −123.196.000 / +151.262.784 / −17.864.200. Sisa = −354 / −968 / −66,5. The 29 Okt remainder (EasyMax 21.846.472 vs bank 21.849.700, −3.228) is **inferred** by subtraction; Finance should confirm it with the U3 hint list.

| Scenario | 26 Okt | 29 Okt | 30 Okt |
|---|---|---|---|
| Today | −123.196.354 | +151.261.816 | −17.864.266,5 |
| B1(a) + B2(a) | −354 | +10.206.604 | −5.054,5 |
| B1(a) + B2(a) + B3 duplicate batal | −354 | −4.196 (= −3.228 − 968) | −5.054,5 (= −4.988 − 66,5) |
| B1(b) + B2(b) | −354 | +10.201.616 | −66,5 |
| B1(b) + B2(b) + B3 duplicate batal | −354 | −9.184 (= −3.228 − 4.988 − 968) | −66,5 |

Only the scenarios that include the B3 resolution bring all three days within `TOLERANSI_RP` (Rp 10.000). Without B3, 29 Okt keeps about +10,2 jt. U3 shows that amount as a piutang-timing line 1 caused by the second PLG0607 10.210.800.

The decomposition behind this table rests on two things that are not yet confirmed: the inferred 29 Okt remainder (21.846.472 vs 21.849.700) and the assumed B3 duplicate. The three-day sum, +10.201.195,5 = 10.210.800 − 3.228 − 4.988 − 1.388,5, is built from those same numbers, so it is not an independent check. Confirm both from the U3 hint list (the actual 29 Okt EasyMax rows) before acting on B3.

Two side effects to tell Finance:
- Option (b) needs 29 Okt to be open. If it is closed, Tambah mutasi is refused there, and only option (a) remains.
- Either option also moves the EasyMax saldo piutang (option a) or the bank saldo (option b) between days. The Balance sheet langkah harian of 26–30 Okt therefore changes too. That is the intended correction, not a new error; re-open Tutup hari for each affected open day afterwards. Closed days: see pre-step 1.

---

## Part C — Non-goals and risks

**Non-goals**
- No change to the check formula, `PETA_KATEGORI_ARUS_KAS`, `deltaPiutangEasymax`, `day_close`, tiers, `koreksiSusulan`, journals or the Layar 2 / PDF outputs (R6).
- No auto-matching or auto-booking of bank rows to EasyMax payments. No new "book on another open day" write path. That would be a product decision on R28 for Dion, not a fix.
- No access to any database other than a local throw-away Postgres 16 for tests. No production, staging, cloud DB, proxy or secrets. No deploy. One PR to `staging` only (CLAUDE.md rule 2). EasyMax stays read-only (rule 1); B1(a)/B2(a)/B3 are done by the cashier in the EasyMax POS itself.

**Risks**

| Risk | Mitigation |
|---|---|
| Line 1 includes non-payment credits (write-off, retur) | Hint lists `vcket` per row. Wording says "pembayaran/pengurangan piutang". |
| Snapshot-served saldo lags live `bppiut` ⇒ line 1 ≠ the piutang part of the check | Sisa absorbs it and is flagged above tolerance. R1 exact by construction (KTD1). |
| Cashier deletes rather than batal/re-dates in EasyMax ⇒ mirror keeps the old row (UPSERT, no delete detection) | B-table asks for batal / re-date, not delete. U4 notes it. |
| Option (b) leaves the original statement line unmatchable (manual rows match only on bank date) and holds October's Tutup bulan | Recommend (a). (b) is allowed only with a HoF decision on that open line. |
| Payments that do not go through the bank (cash at the counter via setoran, another kas category), or a bank piutang row dated before an account's cut-over, appear in line 1 with an opposite flagged sisa on a near-zero day. Parity is shown only for Bakau 23, 27 and 31 Okt. | R1 stays exact. The wording says "pembayaran/pengurangan piutang". Before the PR, check that a near-zero day with such a row would read sensibly in the render test (AE4-style). If other units show this pattern often, the explanation is limited to Tutup hari (no gate) and is revisited as a follow-up. |
| Extra query on Tutup hari | Only when check ≠ 0; indexed `(unit_id, dtgl)`; one round-trip. |

---

## Verification Contract

- `pnpm install && pnpm --filter @solamax/shared build && (cd apps/backend && pnpm exec prisma generate)` in the fresh worktree, then `pnpm check` from the repo root. That runs the SQL syntax check, the mutasi selftest, typecheck and all vitest suites. All must be green, including the untouched `laporan-keuangan.guard.test.ts`, `keuangan-laporan-model*.test.ts` and `keuangan-sisi-kas.test.ts`.
- New tests: `selisih-arus-kas-model.test.ts` (AE1–AE5 + invariant), `selisih-arus-kas-queries.test.ts` (guards), `PenjelasanSelisihArusKas.render.test.tsx`.
- Optional local integration: `SELISIH_ARUS_LOCAL_DB=1` against a local throw-away PG16 seeded with fictitious unit ids, as in `rls-surfaces.integration.test.ts`. Report the result; never point it at cloud.
- R6 proof: `git diff origin/staging -- apps/dashboard/src/lib/keuangan-laporan-model.ts apps/dashboard/src/lib/keuangan-kas.ts apps/dashboard/src/lib/keuangan-sisi-kas.ts apps/dashboard/src/lib/keuangan-laporan-queries.ts apps/dashboard/src/lib/tutup-hari-actions.ts apps/dashboard/src/lib/export apps/backend/prisma/migrations` is empty.

## Definition of Done

- U1–U4 are merged into one PR to `staging`, and `pnpm check` is green.
- The AE1 fixture proves Σ lines = −123.196.354 = −123.196.000 − 354 in sen.
- The R6 diff check is empty, and no migration was added.
- The PR body carries Part B (rows, options, before/after table) for Dion and Finance, and states that nothing was executed against any database.
- No dead or experimental code is left in the diff.

---

## Appendix

### Diagnosis (verified read-only production, Bakau unit 2, 26 Okt 2026)

- dKas total = −246.060.530. That is Kas Besar −352.219.000 (setoran ke bank −672.033.000 + setoran penjualan +319.814.000), plus banks +85.919.542 (BBM −709.309.458, BPD Kalbar piutang +123.196.000, pindah buku +672.033.000), plus EDC +20.238.928.
- net = omzet 345.333.674 + dPiutangEasymax −6.500.000 + dDepositEasymax −1.200.000 + BBM −709.309.458 + pendapatan lain 3.682.900 + biaya −1.264.000 = −369.256.884.
- check = −369.256.884 − (−246.060.530) = −123.196.354 = −123.196.000 (timing) − 354 (setoran 319.814.000 vs computed cash sales 319.813.646).
- 29 Okt check +151.261.816 (EasyMax payments 173.112.484 vs bank piutang 21.849.700). 30 Okt −17.864.266,5 (bank 17.864.200 vs EasyMax 17.859.212 dated 29 Okt).
- 23, 27 and 31 Okt: bank piutang = EasyMax payments. Checks on 22–25, 27, 28 and 31 Okt are all < Rp 1.000.
- Not caused by the 11 Nov transfer corrections or Bentuk ulang: internal transfers net 0 and row a8b2f689 is untouched. The check was already −123.196.354 when a8b2f689 was entered on 6 Nov. 26 Okt has no closed `day_close`.
