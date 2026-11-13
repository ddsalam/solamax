---
title: Credit-customer invoice monitoring (Tagihan pelanggan) - Plan
type: feat
date: 2026-11-13
topic: tagihan-pelanggan-monitoring
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-brainstorm
execution: code
---

# Credit-customer invoice monitoring (Tagihan pelanggan) - Plan

## Goal Capsule

- **Objective:** Finance can see, in SolaMax, every credit-customer invoice of every SPBU with its real payment state — unpaid (not yet due, overdue), paid (in full, in part, overpaid) — and every credit sale not yet invoiced, without opening EasyMax at each branch.
- **Product authority:** Dion. Scoped on 13 Nov 2026. This plan owns invoice monitoring and the payment-term master it needs. Bank-to-invoice matching, credit limits, and active collection are not active scope.
- **Means:** Mirror the three EasyMax invoice tables as one new sync domain (KTD1, KTD2), compute status at read time in a pure model (KTD4), and keep payment terms in SolaMax-owned tables (KTD6).
- **Execution profile:** Deep. Touches all four packages: shared contract, agent, backend ingest plus two additive migrations, and dashboard (new routes, one write path). Money-adjacent and multi-tenant; no change to existing balances or journals.
- **Stop conditions:** Stop and ask Dion if (a) an existing migration would have to be edited, (b) any step needs a write to EasyMax or a production write outside the app, (c) the mirror cannot be made to match the EasyMax menus to the rupiah on the first unit, (d) a unit's probe pack contradicts a KTD, or (e) a merge to `main`, an agent bundle swap, or the `pilot` gate is needed.
- **Who finishes:** `ce-work` on branch `feat/tagihan-pelanggan-monitoring` (from `origin/staging`). It opens PRs to `staging` and does not merge. Dion merges, promotes, approves `pilot`, and swaps agent bundles per unit.
- **Open blockers:** None for implementation. Six units still have to run the probe pack before their own rollout; Dion runs it, the agent has no access to branch MySQL.
---

## Product Contract

### Summary

SolaMax mirrors the EasyMax invoice module and shows it to Finance as a per-SPBU collection work list with a computed status per invoice, an invoice detail, a group of credit sales not yet invoiced, and a cross-SPBU summary. Due dates come from EasyMax when valid and otherwise from a payment term that Finance maintains in SolaMax.

### Problem Frame

Finance learns which invoices are unpaid only by opening the invoice menu in EasyMax at each branch, and learns what was paid from the "Pembayaran Tagihan Pelanggan" menu there. No single place shows what is overdue across the seven SPBU. EasyMax itself only distinguishes paid from unpaid; it does not show part payment or overpayment, and several units leave the due date empty.

The existing "Saldo pelanggan" screen shows a balance per customer. It cannot answer invoice-level questions, because payments in the mirrored receivables ledger do not point to a specific invoice. EasyMax keeps that link in a separate invoice module that SolaMax does not sync today. The customer detail page already reserves space for "Tagihan, Pembayaran, Aging, dan Kebijakan kredit".

### Actors

- A1. Finance staff — primary user; works the list daily to decide whom to collect from, and maintains payment terms.
- A2. Direksi and owner — read the cross-SPBU summary.
- A3. Branch pengawas/admin — not a user of this screen; they issue invoices and record payments in EasyMax, which this screen reflects.

### Requirements

**Invoice list and status**

- R1. Finance sees a list of invoices per SPBU, each with customer, invoice number, invoice date, due date, invoice value, amount paid, and remaining amount.
- R2. Each invoice carries one paid state — unpaid, `Sebagian` (with remaining amount), `Lunas`, or `Lebih bayar` (with the excess) — and, while an amount remains, one due state: `Belum jatuh tempo`, `Lewat jatuh tempo` (with days overdue), or `Termin belum diatur`.
- R3. Paid state is computed from the sum of non-cancelled payments against the invoice value, not taken from the EasyMax status flag.
- R4. An invoice whose computed paid state disagrees with the EasyMax status flag, or whose computed remaining amount disagrees with the EasyMax remaining-balance field, is visibly marked, so the branch can check it.
- R5. A part-paid invoice is also classified as not yet due or overdue on its remaining amount.
- R6. Cancelled invoices and cancelled payments never count toward any status or total.
- R7. Every invoice that is not exactly `Lunas` always appears, including `Lebih bayar`. `Lunas` invoices are filtered by period.
- R8. The list can be filtered by status and by customer, sorted by days overdue, and exported.

**Due date**

- R9. The EasyMax due date is used when it is valid for that invoice: strictly later than the invoice date and within a plausibility bound.
- R10. Otherwise the due date is the invoice date plus the SolaMax payment term: the customer's term when set, else the unit default.
- R11. An invoice with neither is shown as `Termin belum diatur` and is never counted as overdue.
- R12. An implausible EasyMax due date is flagged on the invoice, is never used to compute days overdue, and falls back to R10.
- R13. The screen shows which source produced each due date (EasyMax or SolaMax term).

**Payment term master**

- R14. Finance can set one default payment term per SPBU and override it per customer.
- R15. Any user who may enter data in the Keuangan module may change terms.
- R16. Every term change records who changed it and when.

**Invoice detail and customer view**

- R17. An invoice detail shows the sales documents grouped into the invoice and every payment recorded against it, including cancelled ones marked as such.
- R18. The existing customer detail page gains Tagihan and Pembayaran views for that customer.

**Not yet invoiced**

- R19. A separate group, `Belum ditagihkan`, lists per customer the credit sales documents that belong to no invoice.
- R20. Per customer, the screen shows the remaining amount of all live invoices plus not-yet-invoiced sales next to the receivables balance from "Saldo pelanggan", and shows the difference rather than hiding it.

**Cross-SPBU summary**

- R21. A summary page shows, per SPBU the user may see, the count and value of invoices not yet due, overdue, term not set, and not yet invoiced, each linking to that unit's list.

**Trust and access**

- R22. Every screen states how fresh the mirrored data is.
- R23. Access follows the existing Keuangan read permission and existing unit isolation; a user never sees an SPBU outside their scope.
- R24. SolaMax never writes to EasyMax.

### Key Flows

- F1. Daily collection
  - **Trigger:** Finance opens the invoice list for an SPBU.
  - **Steps:** Filter to `Lewat jatuh tempo`; sort by days overdue; open an invoice to see its sales documents and payments; export the list.
  - **Outcome:** Finance knows whom to contact and for how much.
  - **Covers R1, R2, R8, R17.**
- F2. Setting terms
  - **Trigger:** Invoices show `Termin belum diatur`.
  - **Steps:** Finance sets the unit default, then overrides for specific customers.
  - **Outcome:** Those invoices move to `Belum jatuh tempo` or `Lewat jatuh tempo`.
  - **Covers R10, R11, R14, R15, R16.**
- F3. Chasing invoicing discipline
  - **Trigger:** The summary shows a large `Belum ditagihkan` value for a unit.
  - **Steps:** Open the unit; read the not-yet-invoiced sales per customer.
  - **Outcome:** Finance asks the branch to issue the invoice.
  - **Covers R19, R21.**

### Acceptance Examples

Figures are illustrative.

- AE1. **Covers R2, R3.** Invoice value 10.000.000, payments 4.000.000 and 6.000.000, both live → `Lunas`.
- AE2. **Covers R2, R5.** Invoice value 10.000.000, one live payment 4.000.000, due date yesterday → `Sebagian`, remaining 6.000.000, overdue 1 day.
- AE3. **Covers R2.** Invoice value 10.000.000, payments total 10.050.000 → `Lebih bayar`, excess 50.000.
- AE4. **Covers R6.** Invoice value 10.000.000, one payment 10.000.000 that is cancelled → unpaid, not `Lunas`.
- AE5. **Covers R4.** EasyMax marks an invoice paid but live payments total less than its value → shown with its computed status and the disagreement marker.
- AE6. **Covers R9, R13.** EasyMax due date is 14 days after the invoice date → that date is used, source shown as EasyMax, even when the SolaMax term is 30 days.
- AE7. **Covers R10.** EasyMax due date equals the invoice date in a unit that does not fill it; unit term 30 days, customer term 14 days → due 14 days after the invoice date, source shown as SolaMax term.
- AE8. **Covers R11.** No valid EasyMax due date and no term set → `Termin belum diatur`; counted in neither `Belum jatuh tempo` nor `Lewat jatuh tempo`.
- AE9. **Covers R12.** EasyMax due date is decades after the invoice date → flagged, days overdue computed from the SolaMax term instead.
- AE10. **Covers R19.** A credit sale posted yesterday that appears in no invoice → listed under `Belum ditagihkan` for its customer; it leaves the group once an invoice includes it.

### Success Criteria

- For each SPBU, the unpaid-invoice list and the payment list match the two EasyMax menus Finance uses today, to the rupiah, at a stated point in time.
- Finance stops opening EasyMax to answer "what is unpaid and what was paid".
- Released to one SPBU first; the other six follow after that unit matches.

### Key Decisions

- Finance collection work list is the primary shape; the Direksi summary is secondary. (session-settled: user-directed — chosen over a summary-first Direksi view and a branch-compliance view: Finance is who acts on the data.)
- Due date falls back to a SolaMax payment term. (session-settled: user-approved — chosen over EasyMax-only due dates: some units never fill the due date, so nothing there could ever be overdue.)
- Not-yet-invoiced credit sales are in scope as a document-level group. (session-settled: user-directed — chosen over invoices-only and over a derived single figure: Finance wants to see which sales a branch has not invoiced.)
- Per-unit list plus a cross-SPBU summary. (session-settled: user-approved — chosen over one combined list: follows the existing per-unit Keuangan pattern and unit isolation.)
- All Finance staff may change terms. (session-settled: user-directed — chosen over Head of Finance only and over a propose/approve flow: faster to fill in.)
- Status is computed from payments; the EasyMax status flag is only a cross-check. (session-settled: user-approved — chosen over trusting the flag: the flag cannot express part payment or overpayment and can be stale.)
- Overpayment is judged per invoice, not per customer.

### Scope Boundaries

- Matching bank-statement rows to a customer or an invoice.
- Credit limits, warnings, and blocking. SolaMax cannot block a customer at the pump.
- Reminders, collection letters, follow-up notes, and promises to pay.
- Aging of receivables balance that has no invoice.
- Any change to how the existing "Saldo pelanggan" balance is computed.

<!-- ce-section: work-relationships -->
### How This Work Fits Together

- **This plan:** invoice monitoring plus the payment-term part of a credit master.
- **Credit limits** would extend the same credit master later; independent of this plan.
- **Bank-to-invoice matching** would build on the mirrored invoices and payments from this plan. Tentative.
- **Active collection** (reminders, notes) would build on the invoice list from this plan. Tentative.

### Dependencies

- The EasyMax invoice module (invoice header, invoice-to-sales link, invoice payments) must be mirrored for all seven units before any screen is trustworthy.
- The existing customer master mirror and the "Saldo pelanggan" snapshot supply customer names and the balance used in R20.

### Outstanding Questions

**Resolve Before Planning**

- None. The probe pack `session-notes/2026-11-13-tagihan-probe-pack.sql` was run on one unit on 13 Nov 2026 (see "Probe findings"). The other six units run the same pack as a per-unit rollout gate.

**Deferred to Implementation**

- What the two invoice-type values mean. One follow-up query (invoice type against the prefix of its sales documents) settles it; no requirement depends on it.
- The plausibility bound for R12 beyond the provisional value in KTD5. The unit known to hold garbage due dates has not run this pack.
- Whether not-yet-invoiced sales older than the current year form a legacy backlog in some unit (KTD8).

### Probe findings (one unit, 13 Nov 2026)

Counts are withheld; this repository is public. Seven of eight sealed expectations held; T8 was refuted.

- **Invoice value.** The admin fee is never used; grand total equals total on every live invoice.
- **Paid state.** Every invoice flagged paid is covered in full by live payments; some of them are overpaid. Invoices flagged unpaid are either unpaid or part-paid, except one that is paid exactly while still flagged unpaid — the stale-flag case R4 exists for.
- **Remaining-balance field (T8 refuted).** The invoice header's remaining-balance field equals invoice value minus live payments on every live invoice, negative when overpaid. It is a second, POS-maintained check on R3, not a customer balance.
- **Integrity.** No payment points to a missing or cancelled invoice. Every live invoice has sales documents. No sales document belongs to two live invoices. The link table keeps rows of cancelled invoices, so it must always be read through live invoices.
- **Not yet invoiced.** Every credit-sale posting of 2026 is in a live invoice except the current month and one straggler from an earlier month. The reverse also holds: every invoiced document has a live posting. R19 is computable and its output is small and meaningful.
- **Due date.** Almost every 2026 invoice has a due date equal to its invoice date. "Valid EasyMax due date" in R9 therefore means strictly later than the invoice date and within the plausibility bound; a due date equal to the invoice date counts as not filled. At this unit nearly every invoice will depend on the SolaMax term.

### Sources

- Prior investigation in this repo: `session-notes/2026-09-07-piutang-fase1-gerbang-0b-0c-hasil-parsial.md`, `session-notes/2026-09-08-piutang-butir1-rancangan-layar.md`, and the Gerbang 0C/0D result notes of 8 Sep 2026.
- Existing screen: Keuangan → "Saldo pelanggan" and its customer detail placeholder.

---

## Planning Contract

### Key Technical Decisions

- KTD1. **One sync domain, `tagihan`, carrying three tables** — invoice header, invoice-to-sales link, invoice payment. Payloads are chunked **by invoice**: an invoice's links and payments always travel in the same payload as its header, the way `tebus` chunks by header (`apps/agent/src/sync.ts:310-323`). `/ingest` commits per payload, so this is what keeps one invoice consistent.
- KTD2. **Full-snapshot sync with a manifest-driven prune, not upsert-only.** Every cycle reads the three tables whole.
  - Header and payment rows upsert by their EasyMax primary key with `skipUnchanged`.
  - Link rows are keyed `(unit_id, invoice, sales document)`. Insert with `ON CONFLICT DO NOTHING`; for each invoice in the payload, delete links not in the payload. An unchanged cycle therefore writes nothing.
  - The agent ends a cycle with a **manifest payload**: the full key lists of headers and payments it read. In one transaction under a per-unit `tagihan` lock, the backend deletes header and payment rows whose key is not in the manifest, deletes links of absent invoices, and stamps the unit's completed-cycle time.
  - The manifest is sent only when all three source queries succeeded and every chunk was accepted. No manifest, no prune. `syncMasters` swallows a failed table query and still sends the rest (`apps/agent/src/sync.ts:1346-1358`); this domain must not copy that.
  - Reason for pruning: upsert-only keeps a row forever after EasyMax deletes it (`packages/shared/src/ingest.ts:10-19` records this for `terra_resmi`), and deleting documents after re-dating them is a known EasyMax behaviour.
  - This is a new ingest mode. The existing `source_cut` contract is closed to the saldo domains and never prunes `public` (`packages/shared/src/ingest.ts:23,127-147`); empty payloads are rejected unless they carry a recognised marker (`packages/shared/src/ingest.ts:103`), so the manifest payload needs its own marker in the schema.
- KTD3. **Mirror every column of the three tables as-is**, including the EasyMax status flag, the remaining-balance field, the raw due date, and cancelled rows. Zero dates become NULL. Nothing is derived at ingest.
- KTD4. **Status is computed at read time by a pure model**, not stored. Days overdue depends on today (`todayWib()`, `apps/dashboard/src/lib/periods.ts:6`) and on a term Finance can change, so a stored status would be stale by construction. The tables are small enough to compute per request.
- KTD5. **Due-date rule.** An EasyMax due date is valid when it is 1 to 365 days after the invoice date. The upper bound is provisional and lives in one constant. A due date equal to the invoice date, or empty, counts as not filled and raises no flag. A due date before the invoice date or more than 365 days after it raises the flag `jt_easymax_tak_wajar`. Each due date resolves to one source: `easymax`, `termin_pelanggan`, `termin_unit`, or `belum_diatur`.
- KTD6. **Payment terms live in two unit-scoped tables**, one for the unit default and one for customer overrides, following the precedent in migration `0056_pos` (two tables, never a nullable `unit_id`, which breaks under the RLS policy). A change voids the old row and inserts a new one, as `app.pihak_lawan_saldo_awal` does, so history survives. Every change also writes `app.audit_log` through `auditKeuangan()`.
- KTD7. **A term change applies immediately to every invoice that has no valid EasyMax due date**, including old open invoices. The term is a property of the customer relationship, not a snapshot per invoice; freezing it per invoice would need a term-at-invoice-date lookup that nobody asked for.
- KTD8. **Not-yet-invoiced uses the same customer population as "Saldo pelanggan".** It is the live debit postings in the mirrored receivables ledger whose reference is a sales or voucher document, for customers the snapshot counts as receivables (Lokal: master class 1 or 5; Online: codes containing a dot — `apps/backend/src/saldo-pelanggan/snapshot-sql.ts:91,181,216-231`), and which appear in no link row of a live invoice.
  - Cash-sale class customers (master class 4) post ledger debits that are never invoiced (`apps/dashboard/src/lib/queries.ts:1447-1473`); they are excluded, or they would sit in the group forever.
  - Voucher postings can also live in the payables ledger (`apps/dashboard/src/lib/queries.ts:1506-1515`). The probed unit had none among invoiced documents; probe T9 checks each unit before its rollout.
  - The R20 comparison sums the remaining amount of **all** live invoices, negatives included, and compares against the snapshot's closing receivables balance of the same bucket. Ledger credits not tied to an invoice payment remain a legitimate source of difference; the screen shows the difference, it does not explain it.
  - Link rows of cancelled invoices are ignored. No date floor in the first release; if a unit shows a legacy backlog, a floor becomes a decision for Dion.
- KTD9. **Term writes get their own permission predicate.** `canInputKeuangan` excludes the Head of Finance (`apps/dashboard/src/lib/keuangan-wewenang.ts:174`); the decision "all Finance staff" includes them. The new predicate allows `canInputKeuangan` or Head of Finance. Read access stays `canViewLaporanKeuangan`.
- KTD10. **No overpayment threshold in the first release.** An invoice is `Lebih bayar` when live payments exceed its value by any amount. Whether small excesses should be folded into `Lunas` is decided after Finance has seen real lists.
- KTD11. **No feature flag; readiness and freshness come from the unit's completed-cycle time** written by the prune transaction (KTD2), not from `sync_state`, which any partial payload advances (`apps/backend/src/ingest/ingest.service.ts:147-156`). A unit that has never completed a cycle shows "Data tagihan belum tersedia untuk SPBU ini" instead of an empty list. This lets the backend and dashboard ship before any agent is swapped.
- KTD12. **Binding decisions move to `apps/dashboard/PIUTANG-PELANGGAN.md`**, as `session-notes/2026-09-08-piutang-butir1-rancangan-layar.md` §14 planned, and `CLAUDE.md` links to it.

### High-Level Technical Design

```
EasyMax (per SPBU, SELECT-only)
  invoice header ─┐
  invoice↔sales  ─┼─ agent domain `tagihan` (full snapshot, master cadence)
  invoice payment ┘        │
                           ▼
              backend /ingest: upsert + replace-links + prune-on-complete
                           │
                           ▼
   public mirror tables (RLS unit_scope)      app term tables (RLS unit_scope)
                           │                          │
                           └────────────┬─────────────┘
                                        ▼
                     pure model: due date → paid state → status
                                        │
        ┌───────────────┬───────────────┼────────────────┬──────────────┐
        ▼               ▼               ▼                ▼              ▼
   unit list      invoice detail   not yet invoiced   cross-unit    customer tabs
   (+ CSV)                         (+ ledger mirror)   summary
```

Status derivation, in order:

1. `dibayar` = sum of non-cancelled payments of the invoice.
2. `sisa` = invoice value − `dibayar`.
3. Paid state: `dibayar = 0` → unpaid; `0 < dibayar < value` → `Sebagian`; `dibayar = value` → `Lunas`; `dibayar > value` → `Lebih bayar`. Compared in whole rupiah.
4. Due date by KTD5.
5. For unpaid and `Sebagian`: `Belum jatuh tempo`, `Lewat jatuh tempo` (today − due date, in days), or `Termin belum diatur`.
6. Markers: `beda_status` when the paid state disagrees with the EasyMax flag; `beda_sisa` when `sisa` disagrees with the EasyMax remaining-balance field.

### UI/UX Design

All screens follow the existing Keuangan conventions: global CSS in `apps/dashboard/src/styles/app.css`, `.status-pill` / `.tag-pill`, `<nav className="seg">` filters, plain tables inside `.tbl-scroll`, `.banner` for freshness, link pagination at 50 rows, labels in Bahasa Indonesia, formatters from `apps/dashboard/src/lib/format.ts`.

**S1. Daftar tagihan per SPBU** — `/keuangan/unit/[code]/tagihan`

- Header: title "Tagihan pelanggan", unit name, freshness line ("data EasyMax terakhir masuk …"), actions "Atur termin" and "Ekspor CSV".
- Four summary tiles: `Lewat jatuh tempo`, `Belum jatuh tempo`, `Termin belum diatur`, `Belum ditagihkan` — each rupiah plus count, each a link that applies the matching filter.
- Segmented filter: `Perlu tindakan` (default: everything not exactly `Lunas`) · `Lewat jatuh tempo` · `Sebagian` · `Lebih bayar` · `Lunas` · `Belum ditagihkan`. Customer search box. `Lunas` adds a period picker, default current and previous month.
- Table columns: Pelanggan + no. faktur · Tgl faktur · Jatuh tempo (with source as sub-line: "dari EasyMax" / "termin N hari") · Nilai · Dibayar · Sisa · Status.
- Default sort: days overdue descending, then due date ascending.
- Status pills: `Lewat N hari` (danger) · `Jatuh tempo N hari lagi` (neutral) · `Termin belum diatur` (warning) · `Sebagian` (warning, shown together with the due-date pill) · `Lunas` (success) · `Lebih bayar` (info, with the excess in the Sisa column as a negative).
- Markers `beda dengan EasyMax` appear as a short sub-line under the invoice number; the explanation lives in a tooltip and on the detail page. Sub-lines in nowrap cells stay short (`session-notes/do-sisa-bakau/LEDGER.md:199-203`).
- Empty states: no data yet for the unit (KTD11); no rows for the filter ("Tidak ada faktur lewat jatuh tempo").
- When `Termin belum diatur` is non-zero, an info banner links to S4.

**S2. Rincian faktur** — `/keuangan/unit/[code]/tagihan/faktur/[kode]`

- Header card: customer, invoice number, dates, due date with its source, value, paid, remaining, status pills, EasyMax flag and remaining-balance field shown side by side with the computed values when they differ.
- Table "Dokumen penjualan dalam faktur ini": document number, date, amount (from the receivables ledger mirror).
- Table "Pembayaran": payment number, date, proof number, amount; cancelled payments shown struck through with their reason.
- Link back to the customer page.

**S3. Belum ditagihkan** — the `Belum ditagihkan` filter of S1

- Grouped by customer: customer name, number of documents, total, oldest document date. Expanding a customer lists the documents.
- Footer line per customer for R20: "Sisa faktur terbuka + belum ditagihkan" next to "Saldo piutang (Saldo pelanggan, per …)" and the difference.

**S4. Atur termin** — `/keuangan/unit/[code]/tagihan/termin`

- Unit default: one number field in days, current value, who set it and when.
- Customer overrides: searchable customer list with current term, "pakai bawaan unit" when none; inline edit; "hapus pengecualian" returns the customer to the default.
- A side note states how many open invoices currently depend on the SolaMax term.
- Read-only for users without the term permission (KTD9).

**S5. Ringkasan lintas SPBU** — `/keuangan/tagihan`

- One row per SPBU in scope: the four tile figures (rupiah and count), last payment date recorded, data freshness. Each cell links into S1 with the filter applied.
- Units without data show the KTD11 message in their row.

**S6. Customer detail tabs** — existing `/keuangan/unit/[code]/piutang/[date]/pelanggan/[...customerCode]`

- The placeholder card (lines 81-84) is replaced by "Tagihan" (that customer's invoices, same columns as S1) and "Pembayaran" (that customer's payments across invoices).

### Assumptions

- Invoice volume per unit stays small enough for whole-table sync and read-time computation. If a unit proves otherwise, the fallback is a stored per-invoice paid total, not a change of status rules.
- The master cadence (one hour) is fresh enough for collection work. Tightening it is a config change.
- The receivables ledger mirror already carries every posting R19 needs; no new ledger sync is required.

### Sequencing

1. U1, U2 (contract, mirror, ingest) → `staging`, verified on the test tier with a synthetic unit.
2. U3 (agent) → canary bundle on the first unit after U1/U2 reach `pilot`. The backend must be live first: an upgraded agent talking to an old backend gets a 400 for the new domain.
3. U4–U6 (terms, model, queries) can proceed in parallel with U3.
4. U7–U10 (screens) → `staging`.
5. Gold-check on the first unit against the two EasyMax menus, then the remaining six units, each after its own probe pack.

---

## Implementation Units

### U1. Shared contract and mirror tables

- **Goal:** The `tagihan` domain exists in the payload contract and three RLS-protected mirror tables exist.
- **Requirements:** R6, R23, R24; KTD1, KTD3.
- **Dependencies:** none.
- **Files:** `packages/shared/src/domains.ts`, `packages/shared/src/rows.ts`, `packages/shared/src/ingest.ts`, `packages/shared/src/ingest.test.ts`, `apps/backend/prisma/schema.prisma`, `apps/backend/prisma/migrations/<next>_tagihan_mirror/migration.sql`.
- **Approach:** Add the domain and its three tables to `DOMAINS` / `TABLES_BY_DOMAIN`, row schemas next to `BppiutRow`, and the payload keys. Migration creates the three `public` tables keyed by `(unit_id, <EasyMax key>)` for header and payment and `(unit_id, invoice, sales document)` for links, with indexes on invoice and customer, plus a per-unit completed-cycle table (KTD11) and an index on the receivables ledger mirror's `(unit_id, vcref)` for the KTD8 join — existing joins use `trim(vcref)`, so decide and state whether the index is on the trimmed expression. Copy the RLS block from `apps/backend/prisma/migrations/0049_pihak_lawan/migration.sql:175-198` (ENABLE + FORCE + `unit_scope`) and add explicit grants: `ingest` DML, `dashboard_app` SELECT, and `dashboard_ro` SELECT guarded by `IF EXISTS` as in `0060_correction_request:147`. Rebase on `staging` before numbering (`scripts/ci/check-migrations.sh`).
- **Test scenarios:** payload with the three tables validates; a manifest payload with no rows validates; an empty payload without the manifest marker is still rejected; `nama-tabel.guard.test.ts` passes with the new tables; a Postgres test proves a query without `app.unit_ids` returns zero rows and a positive control returns rows.
- **Verification:** `pnpm check`; migration applies cleanly on a fresh database and on a copy of the test-tier schema.

### U2. Backend ingest: upsert, replace links, prune on complete

- **Goal:** A complete `tagihan` cycle leaves the mirror identical to the payload for that unit.
- **Requirements:** R6, R17; KTD2.
- **Dependencies:** U1.
- **Files:** `apps/backend/src/ingest/table-config.ts`, `apps/backend/src/ingest/sql.ts`, `apps/backend/src/ingest/ingest.service.ts`, `apps/backend/src/ingest/ingest.test.ts`, `apps/backend/src/ingest/sql.test.ts`, a new `apps/backend/src/ingest/tagihan.postgres.test.ts`, `.github/workflows/ci.yml` (one `- run:` line for the new Postgres suite).
- **Approach:** `TABLE_CONFIG` entries for header and payment (`conflict` on the key, `skipUnchanged`). Links as in KTD2. Manifest handling as in KTD2, in one transaction under a per-unit lock built like the keys at `ingest.service.ts:112-125`.
- **Test scenarios:** second identical cycle writes nothing in any of the three tables; a changed status flag updates the row; an invoice whose links shrink ends with the smaller set; a row absent from the manifest is deleted; without a manifest nothing is deleted; a manifest for one unit never touches another; the completed-cycle time moves only on a manifest; a manifest listing a key that never arrived does not fail the transaction.
- **Verification:** `pnpm check`; the new Postgres suite runs in the `snapshot-postgres-16` job.

### U3. Agent domain `tagihan`

- **Goal:** Each agent reads the three EasyMax tables read-only and sends complete snapshots on the master cadence.
- **Requirements:** R22, R24; KTD1, KTD2, KTD3.
- **Dependencies:** U1, U2 live on the target tier.
- **Files:** `apps/agent/src/domains.ts`, `apps/agent/src/sync.ts`, `apps/agent/src/domains.test.ts`, `apps/agent/src/sync.test.ts`, `apps/agent/RUNBOOK-SPBU.md`.
- **Approach:** A three-query domain with explicit column lists and SQL that runs on MySQL 5.0.67. Unlike `syncMasters`, any failed query aborts the cycle. Chunked by invoice (KTD1); the manifest goes last and only after every chunk was accepted (KTD2). Scheduled inside `if (opts.includeMasters)` in its own try/catch so a failure never blocks other domains. All SQL passes `apps/agent/src/db/readonly-guard.ts`. Runbook gains the bundle-swap note: backend first, restart mandatory.
- **Test scenarios:** SQL contains only SELECT; zero dates map to NULL; one query throws → no chunk and no manifest; a rejected chunk → no manifest; an invoice with more links than the batch size stays in one payload; an empty source table still sends a manifest; domain failure leaves other domains running.
- **Verification:** `pnpm check`; on the canary unit, row counts in the mirror equal the probe pack's T1 and T5a counts taken the same hour.

### U4. Payment-term master and write path

- **Goal:** Finance can set and change the unit default term and customer overrides, with history.
- **Requirements:** R14, R15, R16; KTD6, KTD9.
- **Dependencies:** none.
- **Files:** `apps/backend/prisma/schema.prisma`, `apps/backend/prisma/migrations/<next>_termin_pelanggan/migration.sql`, `apps/dashboard/src/lib/termin-tulis.ts`, `apps/dashboard/src/lib/termin-actions.ts`, `apps/dashboard/src/lib/keuangan-wewenang.ts`, tests beside each, `apps/dashboard/src/lib/termin.integration.test.ts`.
- **Approach:** Two `app` tables, unit-scoped, void-and-insert with a partial unique index `WHERE NOT void`, RLS and grants as in `0049` (SELECT, INSERT, UPDATE; no DELETE). Server actions follow `apps/dashboard/src/lib/pihak-lawan-actions.ts`: `buka()` → permission → BEGIN → `set_config` → DML → `auditKeuangan` → COMMIT → `revalidatePath`. New predicate `canAturTermin` = `canInputKeuangan` or Head of Finance. Term is a whole number of days, 0 to 365.
- **Test scenarios:** staff Finance may write; Head of Finance may write; direksi and pengawas may not; a second write voids the first and keeps it readable; removing an override restores the unit default; out-of-range values are rejected; a user scoped to one unit cannot write another unit's term; each write produces one audit row.
- **Verification:** `pnpm check`; integration test against a live test database with its env gate.

### U5. Pure model: due date, paid state, status

- **Goal:** One tested function turns an invoice, its payments, the terms and today into the status of R2.
- **Requirements:** R2, R3, R4, R5, R6, R9–R13; KTD4, KTD5, KTD7, KTD10.
- **Dependencies:** none.
- **Files:** `apps/dashboard/src/lib/tagihan-model.ts`, `apps/dashboard/src/lib/tagihan-model.test.ts`.
- **Approach:** No I/O. Amounts compared in whole rupiah. The plausibility bound is one exported constant. Also holds filter, sort and page-size definitions, mirroring `apps/dashboard/src/lib/piutang-model.ts`.
- **Test scenarios:** AE1–AE9 one test each; due date equal to invoice date is treated as not filled; due date before invoice date is flagged; customer term wins over unit term; today equal to the due date is not overdue; a cancelled invoice yields no status; `beda_status` and `beda_sisa` fire independently.
- **Verification:** `pnpm --filter @solamax/dashboard test tagihan-model`.

### U6. Queries

- **Goal:** Scoped reads for the list, the detail, not-yet-invoiced, the summary, and the R20 cross-check.
- **Requirements:** R1, R7, R8, R17, R19, R20, R21, R22, R23; KTD8, KTD11.
- **Dependencies:** U1, U4, U5.
- **Files:** `apps/dashboard/src/lib/tagihan-queries.ts`, `apps/dashboard/src/lib/tagihan-route.ts`, tests beside each.
- **Approach:** Every query takes a `ScopedUnitId` from `getDataScope()` and runs through `qScoped()`. The summary passes the unit-id array once, as `apps/dashboard/src/lib/keuangan-pantau-queries.ts` does. Open invoices are never date-limited; `Lunas` is limited to the chosen period. Not-yet-invoiced joins the receivables ledger mirror to link rows of live invoices only. The R20 balance needs a reader for the latest published "Saldo pelanggan" snapshot per unit: `getSaldoSnapshot` (`apps/dashboard/src/lib/saldo-snapshot.ts:451`) is keyed by unit and date, so add a latest-pointer query, match rows by trimmed customer code, and show the snapshot date; when no snapshot is ready, show "belum tersedia" instead of a difference.
- **Test scenarios:** AE10; a link row of a cancelled invoice does not hide a sale from not-yet-invoiced; a unit with no completed cycle reports "not available" rather than zero; a cash-sale class customer never appears in not-yet-invoiced; the summary never includes a unit outside scope; customer codes with a slash resolve.
- **Verification:** `pnpm check`; `nama-tabel.guard.test.ts` passes.

### U7. Screen S1 and S3: list, not yet invoiced, CSV

- **Goal:** Finance works the per-unit list.
- **Requirements:** R1, R2, R7, R8, R13, R19, R20, R22; F1, F3.
- **Dependencies:** U5, U6.
- **Files:** `apps/dashboard/src/app/(app)/keuangan/unit/[code]/tagihan/page.tsx`, `apps/dashboard/src/components/keuangan/TagihanView.tsx`, `apps/dashboard/src/app/api/keuangan/unit/[code]/tagihan/csv/route.ts`, `apps/dashboard/src/lib/export/tagihan.ts`, `apps/dashboard/src/styles/app.css`, `apps/dashboard/src/lib/pemilih-unit-keuangan.guard.test.ts`, render tests.
- **Approach:** As specified in S1 and S3. Every new per-unit page renders `<UnitDateFilters` and is added to the route list in `pemilih-unit-keuangan.guard.test.ts:43`; this applies to U8 and U9 too. The page calls `canViewLaporanKeuangan(...)` or `notFound()`. The export route lives under `app/api/keuangan`, never under `(app)/keuangan` (`gerbang-rute-keuangan.guard.test.ts`).
- **Test scenarios:** each status renders its pill; a part-paid overdue invoice shows both pills; the default view is `Perlu tindakan` sorted by days overdue; the CSV contains the same rows as the active filter; the empty and not-available states render; the page 404s for a user without read access.
- **Verification:** `pnpm check`; browser check on the test tier at desktop and phone width.

### U8. Screen S2 and S6: invoice detail and customer tabs

- **Goal:** Finance sees what an invoice contains and how it was paid, and sees a customer's invoices from the existing customer page.
- **Requirements:** R4, R17, R18.
- **Dependencies:** U6.
- **Files:** `apps/dashboard/src/app/(app)/keuangan/unit/[code]/tagihan/faktur/[kode]/page.tsx`, `apps/dashboard/src/app/(app)/keuangan/unit/[code]/piutang/[date]/pelanggan/[...customerCode]/page.tsx`, components and render tests.
- **Approach:** As specified in S2 and S6. The invoice route is a single segment; confirm on the first unit that invoice codes never contain a slash, otherwise use a catch-all as the customer route does.
- **Test scenarios:** cancelled payments are shown and excluded from the total; the disagreement panel appears only when a marker is set; an unknown invoice code 404s; an invoice of another unit 404s; the placeholder text is gone from the customer page.
- **Verification:** `pnpm check`.

### U9. Screen S4: Atur termin

- **Goal:** Finance maintains terms in the app.
- **Requirements:** R14, R15, R16; F2.
- **Dependencies:** U4.
- **Files:** `apps/dashboard/src/app/(app)/keuangan/unit/[code]/tagihan/termin/page.tsx`, `apps/dashboard/src/components/keuangan/TerminPanel.tsx`, render tests.
- **Test scenarios:** read-only for users without the permission; saving the unit default moves `Termin belum diatur` invoices in S1; who and when are shown after a change.
- **Verification:** `pnpm check`; F2 walked through on the test tier.

### U10. Screen S5, sidebar, and documentation

- **Goal:** The summary exists, the screens are reachable, and the decisions are written where the repo keeps them.
- **Requirements:** R21, R22, R23; KTD12.
- **Dependencies:** U6, U7.
- **Files:** `apps/dashboard/src/app/(app)/keuangan/tagihan/page.tsx`, `apps/dashboard/src/components/Sidebar.tsx`, `apps/dashboard/src/components/Sidebar.keuangan.test.ts`, `apps/dashboard/PIUTANG-PELANGGAN.md`, `CLAUDE.md`, `docs/runbooks/tagihan-rollout.md`.
- **Approach:** The summary is registered in `pemilih-unit-keuangan.guard.test.ts:58` as a cross-unit page (`dimensiUnit="tak_berlaku"`). Sidebar entry "Tagihan pelanggan" in the Keuangan group next to "Saldo pelanggan". The runbook holds the per-unit sequence: probe pack → bundle swap → first complete cycle → gold-check → terms set.
- **Test scenarios:** the summary lists only units in scope; a unit without data shows the not-available row; the sidebar entry is hidden from users who cannot read Keuangan.
- **Verification:** `pnpm check`.

---

## Verification Contract

- `pnpm check` (SQL syntax check, `mutasi.selftest.sh`, typecheck, all tests) passes on every PR. Run `prisma generate` first.
- `scripts/ci/check-migrations.sh` passes after rebasing on `staging`.
- New Postgres suites have their own `- run:` line in the `snapshot-postgres-16` job of `.github/workflows/ci.yml`.
- **RLS negative and positive control** on the three mirror tables and two term tables: zero rows without `app.unit_ids`, zero rows with another unit's id, rows with the right id.
- **Gold-check per unit** (Dion, results kept outside this repository): at one stated time,
  - count and total of unpaid invoices in S1 equal the EasyMax unpaid-invoice menu;
  - count and total of payments for a chosen period equal the EasyMax "Pembayaran Tagihan Pelanggan" menu;
  - the mirror's row counts equal probes T1 and T5a;
  - probe T9 shows no class or ledger that KTD8 misses.
- **The gold-check must be able to fail.** Before trusting a pass, change one payment in a test database and confirm the comparison goes red.

## Definition of Done

- R1–R24 are met and AE1–AE10 pass as tests.
- All ten units are merged to `staging`; nothing is merged to `main` by the executor.
- The first unit passes the gold-check to the rupiah.
- `apps/dashboard/PIUTANG-PELANGGAN.md` and `docs/runbooks/tagihan-rollout.md` exist and match what was built.
- No real figures, customer names or document numbers appear in code, tests, commits or PR text.
- Abandoned-attempt code is removed from the diff.

## Rollout and rollback

- **Order:** backend and migrations → dashboard → agent bundle on the first unit → gold-check → terms set by Finance → remaining units one at a time, each after its probe pack.
- **Rollback:** the migrations are additive; the screens can be unlinked from the sidebar. An agent can be returned to its previous bundle; the backend keeps accepting the domain. Mirror tables can be emptied and refilled by one complete cycle.

## Risks

- **A unit behaves unlike the probed one.** Mitigation: the probe pack is a gate per unit; KTD5's bound is a single constant.
- **Prune deletes real data after a broken cycle.** Mitigation: prune only on an explicit complete marker; tested in U2 and U3.
- **Units that stopped recording payments look like large arrears.** The screen cannot tell unpaid from unrecorded. The summary shows the last recorded payment date per unit so the reader can see it.
- **Finance reads `Termin belum diatur` as "not overdue".** Mitigation: its own tile and a banner linking to S4.
- **Hourly freshness is too slow for collection calls.** Mitigation: freshness is always shown; cadence is a config change.
