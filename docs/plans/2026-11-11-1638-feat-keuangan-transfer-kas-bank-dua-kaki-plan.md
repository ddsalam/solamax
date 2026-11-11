---
title: Linked two-leg Kas Besar → bank transfer, plus correction of mis-categorised bank legs - Plan
type: feat
date: 2026-11-11
topic: keuangan-transfer-kas-bank-dua-kaki
artifact_contract: ce-unified-plan/v1
product_contract_source: ce-plan-bootstrap
execution: code
---

# Linked two-leg Kas Besar → bank transfer, plus correction of mis-categorised bank legs - Plan

## Goal Capsule

- **Objective:** Finance records a Kas Besar → bank deposit once, and the books always come out right. 1103 (Belum Disetor) is credited exactly once per deposit, 1190 (Dana dalam Perjalanan) returns to zero, and October can be closed. The 36 existing rows with the wrong category have a reviewed, auditable correction path.
- **Means:** A new "Setor ke bank" action on the Kas Besar tab writes both legs in one transaction (Kas Besar kredit "Setoran ke Bank", bank debet "Pindah Buku"). The legs share a new nullable `transfer_uuid` (KTD1, KTD2), and voiding one leg voids both (KTD6). A guarded in-app action "Jadikan transfer" converts existing wrong bank legs (KTD9).
- **Product authority:** Dion. `apps/dashboard/KEUANGAN-HARIAN.md` remains binding (§10.12 roles, §10.48 setoran, §10.53 journals). KTD5 of plan 2026-10-29 (closed-day guard on new write paths) is binding.
- **Execution profile:** Deep. One additive migration (`0062`), new server actions, UI on Input keuangan, and a data correction (36 rows, Rp 12.489.731.000). This touches money, journals and roles.
- **Stop conditions:** Stop and ask Dion if (a) an existing migration must be edited, (b) `pasangan_uuid` semantics must change, (c) any step needs a production write outside the app (no scripts against `cash_ledger`), (d) the P28 deposit-sign PR turns out to conflict with this branch, or (e) a merge to `main` or the `pilot` gate is needed.
- **Who finishes:** `ce-work` on branch `grok/2026-11-11-transfer-kas-bank-dua-kaki` (from `origin/staging` 6a6e8d5). It opens one PR to `staging` and does not merge. Dion merges, promotes, and approves `pilot`. Finance and HoF run the data correction in the app afterwards.
- **Open blockers:** None. Dion answered the open decisions on 11 Nov 2026 at 17:54 WIB (see "Decision log"): D3 is "Jadikan transfer" only, with no memorial, and "Jadikan transfer" requires an explicit confirmation on every day.

---

## Product Contract

### Summary

Two things change.

1. **A new "Setor ke bank" form on the Kas Besar tab.** Finance enters an amount, a target bank account and a description once. The app writes:
   - a Kas Besar kredit "Setoran ke Bank" row;
   - a bank debet "Pindah Buku" row on that account.

   Both rows are dated the same day and linked. Voiding either row voids both. The bank tab warns when someone tries to record the same money again as "Setoran Hasil Penjualan".
2. **A correction list and a "Jadikan transfer" action for existing rows.** It shows bank rows labelled "Setoran Hasil Penjualan" that have a same-day, same-amount Kas Besar outflow. One click per row:
   - voids the wrong bank row;
   - re-enters it as "Pindah Buku" on the same date;
   - links it to its Kas Besar leg;
   - writes an audit entry.

   Journals rebuild automatically.

### Problem Frame

**Corrected diagnosis.** This replaces REPORT6 §2 point 2 and confirms REPORT7B's correction. Each claim was verified in code at 6a6e8d5 and in read-only production queries on 11 Nov 2026 at about 16:33 WIB.

1. **"Setoran ke Bank" exists only as a kredit category.**
   - Categories are seeded per side, not per account type (`apps/backend/prisma/migrations/0029_cash_ledger/migration.sql:110-126`).
   - Later migrations added "Penjualan EDC" (`0043_edc_per_shift/migration.sql:93-95`) and "Mutasi Belum Teridentifikasi" (`0049_pihak_lawan/migration.sql:204-208`).
   - The debet list has exactly 9 labels: Hutang Piutang, Mutasi Belum Teridentifikasi, Pendapatan Lain-Lain, Penjualan EDC, Pindah Buku, Setoran Hasil Penjualan, Tambahan Modal, Temporary Investment, Transfer Pembayaran Piutang Pelanggan. That matches Dion's screenshot of the Bakau Bank BCA tab exactly.
   - The list is the same for a `kas` account and a `bank` account. The form filters by side only (`apps/dashboard/src/components/keuangan/BukuKasPanel.tsx:109`), never by account kind.
   - A side mismatch is rejected by `kategoriCocok` (`apps/dashboard/src/lib/kas-actions.ts:96`, `keuangan-kas.ts:139`) and by DB CHECK `cash_ledger_jenis_vs_category` (`0029…/migration.sql:167`). So "Setoran ke Bank" could never be picked on the incoming bank leg.
2. **The correct bank leg is debet "Pindah Buku".**
   - It maps to rule P6, the same as "Setoran ke Bank" (`apps/dashboard/src/lib/buku-besar-model.ts:337,344`).
   - P6 posts each leg against 1190 (`:390-395`). Two legs on the same date cancel 1190 that day, and 1103 is never touched.
   - The app's own automatic jemputan pair writes exactly this combination: bank "Pindah Buku" debet plus Kas Besar "Setoran ke Bank" kredit (`apps/dashboard/src/lib/cocok-bank-tulis.ts:181-194`).
   - "Setoran Hasil Penjualan" maps to P2 (`buku-besar-model.ts:333,386`), which credits 1103. On the bank leg this credits 1103 a second time, because the pengawas deposit already credited 1103 when it entered Kas Besar.
3. **Why Finance chose "Setoran Hasil Penjualan".**
   - **It was not `setujuiSetoran`.** All 33 Bakau bank rows have `source_manual_entry_id IS NULL`. Finance typed them through `simpanMutasiKas` (the "Tambah mutasi" form).
   - They were created by user 24 (role `keuangan`) between 29 Oct 17:46 and 9 Nov 12:39 WIB. The one exception is `28e717f3`, by user 2 (`super_admin`) at 11 Nov 16:27.
   - User 24 had **already voided and re-typed 32 earlier versions** of these rows between 29 Oct and 9 Nov, again as "Setoran Hasil Penjualan". This coincides with 75 `cocok_bank.batal` audit entries. So the wrong label was picked twice, deliberately.
   - **There was no better choice on screen, and nothing flagged the choice:**
     - **The word matches.** The money is "setoran penjualan dari kas besar"; that is how the rows are described. "Setoran Hasil Penjualan" reads like the right label, and "Pindah Buku" reads like a transfer between bank accounts.
     - **The label's effect is invisible where it is entered.** The Input page shows only cash and bank balances, which do not depend on category (REPORT6 §3).
     - **Bank matching accepted it.** `cocok-bank-model.ts:286-297` (rule 3, documented `:24-30`) accepts a bank "Setoran Hasil Penjualan" row as a valid SETORAN JEMPUTAN match. That rule exists for older pengawas deposits approved straight into a bank account. So the statement match succeeded and nothing looked wrong.
     - **The UI has no two-leg action.** Finance had to type the bank leg separately and choose its label without guidance.
   - `setujuiSetoran` *can* still write "Setoran Hasil Penjualan" into a bank tab. Its banner shows on every tab and writes into the open tab (`BukuKasPanel.tsx:248-253, 304`; `kas-actions.ts:221-296`). That is how 2 of the 3 "ambiguous" rows came about: Imam Bonjol `60cd0454` and Adisucipto `95a4f8a7`, both with `source_manual_entry_id` set. Those are real direct deposits, so P2 is probably correct for them.
4. **Every Kas Besar out-leg has its bank leg.** In Oct–Nov there are 0 Kas Besar kredit "Setoran ke Bank"/"Pindah Buku" rows without a same-day bank debet of the same amount. The pattern is systematic, not random.
5. **The app does not block void or re-entry on a closed day.**
   - `cash_ledger` has no triggers (`pg_trigger` returns 0 rows).
   - `voidMutasiKas` (`kas-actions.ts:303-415`) and `simpanMutasiKas` (`:82-208`) never read `day_close`.
   - This was proven in prod on 11 Nov at 16:25–16:27 WIB.
   - `hari-buku-queries.ts:30-33` already names this as a known gap. Void writes no `audit_log` entry, and voiding one leg never touches its partner.

**Size.** There are 36 bank rows labelled "Setoran Hasil Penjualan" in Oct–Nov:

| Group | Rows | Amount (Rp) |
|---|---:|---:|
| Bakau, Oct | 26 | 9.077.417.000 |
| Bakau, Nov | 7 | 2.412.982.000 |
| Adisucipto | 2 | |
| Imam Bonjol | 1 | |
| **Total** | **36** | **12.489.731.000** |

- **Fixable:** 32 rows on open days, Rp 11.080.496.000.
- **Closed day:** 1 row, Bakau 22 Oct `28e717f3`, Rp 399.979.000.
- **Ambiguous:** 3 rows, Rp 1.009.256.000.
- **Units 4–7:** none.
- **State:** only one day is closed (Bakau 22 Oct, −470, within_tolerance). No month is closed, no memorial exists, and none of the rows sits in an active bank-match group. Full list: `/tmp/cc-bakau22/run7/daftar-koreksi-kategori-bca.csv`.

**Effect.** Bakau 1103 is −13,4 billion by 10 Nov, with 1190 growing by the same amount. The 22 Oct P24 finding `sisa_1103_belum_disetujui` (−399.379.470) cannot be approved by design (REPORT6 §1). October month close will be rejected because `periksaBukuBesar` requires 1103 and 1190 to be zero (`buku-besar-cek.ts:192-199`).

### Actors

- A1 **Finance staff:** role `keuangan`, not HoF. Types transfers and runs the corrections on open days.
- A2 **Head of Finance (HoF):** listed in `HEAD_OF_FINANCE_EMAILS`. Does not type (§10.12). May run "Jadikan transfer" (classification, like `canReklasifikasi`). Runs the correction for the closed day.
- A3 **super_admin:** everything A1 and A2 can do.
- A4 **Direksi:** read-only here. Dion's D3 decision means no memorial is used for this correction.

### Requirements

**Transfer action**

- R1. **Kas Besar tab only.** "Setor ke bank…" appears only on the Kas Besar tab (the unit's single `kas`-kind account) and only for users who may type (`canInputKeuangan`).
- R2. **Inputs.** The form asks for:
  - the target bank account: active, `bank` kind, same unit;
  - the amount, as positive rupiah;
  - a description: required, prefilled "Setoran ke Bank {tanggal}";
  - the date: the page date.
- R3. **One transaction.** One submit writes exactly two `cash_ledger` rows:
  - Kas Besar: kredit, `-amount`, "Setoran ke Bank";
  - bank: debet, `+amount`, "Pindah Buku".

  Both rows get the same `transfer_uuid`, the same business date, and the same `created_by_user_id`. Either both are written or neither is.
- R4. **Categories are fixed by the server.** Nothing from the client can change them.
- R5. **Journals.** Both rows are journaled by P6 in the same transaction, through the existing post-write hook. The result is 1101 Cr, 111x Dr, 1190 Dr and Cr netting to 0, and no 1103 line.
- R6. **Closed day: book forward.** If the date is closed, both legs are booked forward to the next open day, using `tanggal_asal` and the reason code `ADJ-FWD-TRANSFER`. Both legs must land on the same day, otherwise the save is refused (KTD4).
- R7. **Refusals with a clear message:**
  - the month of the date is closed;
  - the date is before either account's opening balance.
- R8. **Double submit is harmless.** A repeated submit with the same client key writes nothing and reports "sudah tercatat".
- R9. **Audit.** Every transfer writes `audit_log` `kas.transfer.catat` with unit, both row ids, amount, date and hari buku.

**Linked void**

- R10. **Rows show as a pair.** A transfer leg shows a "transfer" chip. Its only void control is "Batalkan transfer", which voids **both** legs atomically. The plain single-row void refuses transfer legs (server-side).
- R11. **When "Batalkan transfer" is refused:**
  - either leg is in an active bank-match group (message: ask HoF to undo the match first);
  - either leg's hari buku is closed;
  - the month is closed.

  These follow §10.48 #4 for jemputan pairs.
- R12. **Audit on void.** A void writes `audit_log` `kas.transfer.batal` with both ids. Journals rebuild through the hook.

**Guard on the bank tab**

- R13. **Warning before saving.** This applies when Finance, on a bank tab, saves a debet "Setoran Hasil Penjualan" through `simpanMutasiKas` and a same-day Kas Besar kredit "Setoran ke Bank"/"Pindah Buku" of the same amount exists without a linked bank leg. The form warns and offers "Catat sebagai Pindah Buku (transfer dari Kas Besar)". The server refuses unless the client sends an explicit `bukanTransfer: true` confirmation, and an override is audited (KTD8).
- R14. **"Setoran Hasil Penjualan" stays available on bank tabs.** It is legitimate for deposits that go straight to the bank and for matching rule 3.

**Correction of existing rows**

- R15. **Correction list.** A page lists every candidate in the unit, oldest first. A candidate is:
  - a non-void bank debet "Setoran Hasil Penjualan" with no `transfer_uuid`;
  - with exactly one same-day Kas Besar kredit "Setoran ke Bank"/"Pindah Buku" of equal absolute amount that has no `transfer_uuid` and is not void.

  Rows with zero or several candidates are listed as "periksa manual" with no button.
- R16. **"Jadikan transfer" in one transaction:**
  - voids the bank row;
  - inserts a new bank row with the same account, business date, `tanggal_asal`/`alasan_maju`, description and amount, debet "Pindah Buku", and a new `transfer_uuid`;
  - sets the same `transfer_uuid` on the Kas Besar leg (category unchanged);
  - writes `audit_log` `kas.transfer.koreksi` with the old id, new id, Kas Besar id and reason, plus the confirmation and both legs as shown (`konfirmasi`, `kaki`);
  - rebuilds journals.
- R17. **Who may run "Jadikan transfer":** keuangan (non-HoF), HoF or super_admin on open days. On a closed day (month open), only HoF or super_admin, and a reason is required. It is refused in a closed month and when either row is in an active bank-match group.
- R18. **Explicit confirmation on every day** (Dion, 11 Nov 2026 17:54 WIB). The row button only opens a confirmation step. It shows the unit, date and amount, the Kas Besar leg (kredit, its category, id8) and the bank leg (debet "Pindah Buku", last 4 digits of the account, id8 of the old row). The user must tick "Saya yakin"; on a closed day the written reason is also required. The **server** refuses a request without `konfirmasi.yakin === true`, and refuses when the confirmed date or amount differs from the locked row. The confirmation and the legs go into the audit detail.

### Acceptance Examples

- **AE1 (transfer on an open day).** Bakau, open day, Rp 399.979.000 to BCA …6811.
  - Two rows are written. Kas Besar goes down 399.979.000 and BCA goes up 399.979.000.
  - Journals have 1190 net 0 that day and no 1103 line.
  - The audit entry exists.
- **AE2 (closed day).** The date is closed and the next day is open. Both legs land on the next day with `tanggal_asal` = the typed date and `ADJ-FWD-TRANSFER`. The message names the hari buku.
- **AE3 (void).** "Batalkan transfer" on the BCA leg voids both rows, and both journals disappear. If the BCA leg is in an active match group, the void is refused and neither row changes.
- **AE4 (correction).** "Jadikan transfer" on Bakau 22 Oct `28e717f3`:
  - The run by HoF writes the new bank row on 22 Oct as "Pindah Buku", linked to its Kas Besar leg.
  - That day's 1103 net goes from −399.379.470 to +599.530 before the P28 fix, and to −470 after it.
  - The keuangan role is refused, with a message saying HoF is needed.
- **AE5 (guard).** On the BCA tab for a day that has a Kas Besar "Setoran ke Bank" −X, entering debet "Setoran Hasil Penjualan" +X triggers the warning. Saving without confirmation is refused.

### Scope Boundaries

- **In scope:**
  - Kas Besar → bank only;
  - one new nullable column plus one reason code;
  - the two new actions and the correction list;
  - the bank-tab guard.
- **Out of scope:**
  - bank → Kas Besar withdrawals;
  - bank → bank transfers (the existing "Pindah Buku" typing and matching rule 5 stay as they are);
  - changing `pasangan_uuid`, matching rules or P-rules;
  - editing a category in place;
  - any SQL script against `cash_ledger`.

### Deferred to Follow-Up Work

- **Restrict `setujuiSetoran` to the Kas Besar account** (server and banner). This aligns with §10.48 "always Kas Besar" and removes the second source of bank "Setoran Hasil Penjualan" rows. See D7.
- **Write `audit_log` on every plain `voidMutasiKas`.** It writes none today. See D8.
- **Give automatic jemputan pairs (`tulisPasanganJemputan`) a `transfer_uuid` too,** so all pairs look alike.
- **Generalise to bank → Kas Besar and bank → bank.**

### Dependencies

- **P28 deposit-sign fix** (branch `grok/2026-11-11-p28-deposit-sign`, a separate PR) is independent in code. It must be live before HoF's October/November "Bentuk ulang" (see the cleanup sequence).
- **Migration number `0062`.** This assumes nothing else on `staging` claims it. `scripts/ci/check-migrations.sh` enforces this; rebase onto `staging` before pushing.

### Sources

- `/tmp/cc-bakau22/REPORT6.md`, `/tmp/cc-bakau22/REPORT7B.md`, `/tmp/cc-bakau22/run7/daftar-koreksi-kategori-bca.{md,csv}`.
- Read-only production queries in `/tmp/cc-bakau22/run8/q1.sql`, `q2.sql` and `q3.sql`, run 11 Nov 2026 at about 16:33 WIB as role `ingest` inside `BEGIN READ ONLY`. The proxy was stopped and the credential file deleted afterwards.
- `apps/dashboard/KEUANGAN-HARIAN.md` §10.12, §10.48, §10.53; plan `docs/plans/2026-10-29-1719-…` KTD5 (closed-day guard on new write paths).

---

## Planning Contract

### Key Technical Decisions

- **KTD1. New nullable column `cash_ledger.transfer_uuid`, not `pasangan_uuid`.**
  - **Why not `pasangan_uuid`.** It means "inter-unit pair" in at least nine readers, so reusing it would misclassify intra-unit transfers everywhere:
    - `voidMutasiKas` and `barisSistemDari` (`kas-actions.ts:338,382`; `keuangan-kas-model.ts:65`);
    - P15 → P14 narrowing (`buku-besar-model.ts:543`);
    - the bank matcher's rule "antar-unit" (`cocok-bank-model.ts:346`);
    - `batalkanCocok` (`cocok-bank-actions.ts:323,420-487`);
    - tutup bulan "kaki_antar_unit" (`tutup-bulan-model.ts:289`);
    - Pemantauan "balik_antar_unit" (`keuangan-pantau-queries.ts:501,542`);
    - antar-unit queries and the Pihak lawan page.
  - **Why not `lahir_dari_cocok_id`.** It belongs to a bank-match group.
  - A column follows the KTD4 idiom of 0049 (one shared uuid across legs).
- **KTD2. Categories fixed server-side; no new category.** The Kas Besar leg is kredit "Setoran ke Bank" and the bank leg is debet "Pindah Buku", identical to `tulisPasanganJemputan`.
  - No seed change means `ATURAN_KATEGORI_KAS`, `PETA_KATEGORI_ARUS_KAS` and their seed-reading tests are untouched.
  - Cash flow is unaffected, because both labels map to "Perpindahan antar akun kas" with `dariBukuKas: false` (`keuangan-sisi-kas.ts:74,81`).
- **KTD3. Write core in a non-"use server" module.** `transfer-kas-tulis.ts` follows the `antar-unit-tulis.ts` / `cocok-bank-tulis.ts` pattern. Thin actions in `transfer-kas-actions.ts` follow the `buka()` → BEGIN → `set_config('app.unit_ids')` → write → `auditKeuangan` → `bentukJurnalSesudahTulis` → COMMIT pattern of `kas-actions.ts`. The pemicu guard test (`buku-besar-pemicu.guard.test.ts`) derives writers from the code, so the new actions are covered automatically. They must call the hook after their last write.
- **KTD4. Closed day: book forward, do not block.**
  - Each leg's hari buku comes from `hariBukuTerkunci` (`hari-buku-queries.ts`), using its own account for the cut-over. If the two differ, the save is refused. This mirrors `tulisPasanganJemputan` (`cocok-bank-tulis.ts:150-157`).
  - Forwarded legs carry `tanggal_asal` and the new code `ADJ-FWD-TRANSFER`.
  - **Rationale:**
    - Plan 2026-10-29 KTD5 makes the guard mandatory on every *new* write path, and booking forward is its defined behaviour.
    - Blocking would leave Finance no in-app route for a late transfer, which pushes them back to the unguarded single-leg form.
    - Journals use the effective date `tanggal_asal ?? business_date` (`buku-besar-model.ts:375`), and both legs move together, so 1190 still nets to 0.
  - **Closed month (of the typed date): refused.** This follows the `lengkapiBebanMutasi` pattern, `kas-actions.ts:964-971`. Forwarding across a closed month would journal into a frozen month.
- **KTD5. Idempotency through a client key that becomes `transfer_uuid`.**
  - The client generates a uuid when the form opens.
  - The server first checks `EXISTS (transfer_uuid = key)`, void included, and returns `{ok:true, sudahAda:true}` without writing.
  - A unique index `(transfer_uuid, account_id) WHERE transfer_uuid IS NOT NULL` makes a concurrent double submit fail on the second insert. That failure is mapped to the same "sudah tercatat" message.
  - A key is never reused, because void rows are kept.
- **KTD6. Linked void is its own action, and the single-leg void refuses transfer legs.**
  - `barisSistemDari` gains a `transfer` kind. `voidMutasiKas` then refuses it, both in the verdict and in its `UPDATE … WHERE transfer_uuid IS NULL`, with a message pointing to "Batalkan transfer".
  - `batalkanTransfer` does the following:
    - locks both legs `FOR UPDATE`, ordered by id;
    - refuses if either leg is in an active `cocok_bank_baris`;
    - refuses if either hari buku is `closed` (consistent with §10.48 #4, because voiding removes cash from a closed day);
    - refuses if the month is closed;
    - voids both legs, audits, and rebuilds journals.
- **KTD7. Roles.**
  - Creating and voiding a transfer is typing, so it uses `canInputKeuangan` (keuangan non-HoF, super_admin; §10.12).
  - "Jadikan transfer" uses a new standalone predicate, `canJadikanTransfer`. Its members are `canInputKeuangan` plus HoF, the same membership as `canReklasifikasi`. It is classification (no new cash, amount or date) and HoF owns the cleanup.
  - On a closed day the action additionally requires HoF or super_admin and a written reason (`canJadikanTransferHariTutup`).
  - Direksi has no role here.
- **KTD8. Guard on the bank tab: confirm before saving, not a ban.** "Setoran Hasil Penjualan" on a bank account is legitimate for direct deposits (matching rule 3, `cocok-bank-model.ts:24-30`), so it stays available. `simpanMutasiKas` gains a pure detector, `kakiTransferTerlewat`: bank account, debet, "Setoran Hasil Penjualan", and a same-day Kas Besar kredit "Setoran ke Bank"/"Pindah Buku" of equal amount with no `transfer_uuid`.
  - If the detector hits and `bukanTransfer !== true`, the save is refused with a message.
  - The form shows the warning beforehand, offers a button that switches the entry to the transfer-correction path, and sends `bukanTransfer: true` only after an explicit tick.
  - Overrides write `audit_log` `kas.setoran_bank_bukan_transfer`.
  - A hard ban was rejected because it would block real direct deposits that coincide with an unrelated Kas Besar transfer of the same amount (unlikely, but costly). A hint alone was rejected because the hint's absence is what caused the 36 rows.
- **KTD9. Correction is an in-app action, not manual re-typing and not a script.** See "Data correction plan" for the comparison. The action voids and re-inserts the bank row; it never `UPDATE`s a category. That keeps the "void, never edit" rule of `cash_ledger` (0029), keeps the old row as evidence, and lets `bentukJurnalSesudahTulis` see both writes by `xmin`. The Kas Besar leg is *linked* by an `UPDATE` of `transfer_uuid` only: its category and amount are already right, and re-inserting it would churn a correct row.
- **KTD10. Migration `0062_transfer_kas` is additive only:**
  - `ADD COLUMN IF NOT EXISTS transfer_uuid UUID` (nullable, no default);
  - unique index `cash_ledger_transfer_akun_uq (transfer_uuid, account_id) WHERE transfer_uuid IS NOT NULL`;
  - index `(unit_id, transfer_uuid) WHERE transfer_uuid IS NOT NULL`;
  - CHECK `cash_ledger_transfer_bukan_antar_unit (transfer_uuid IS NULL OR pasangan_uuid IS NULL)`;
  - CHECK `cash_ledger_transfer_kategori (transfer_uuid IS NULL OR category_label IN ('Setoran ke Bank','Pindah Buku'))`;
  - reason code `('ADJ-FWD-TRANSFER','Transfer Kas Besar ke bank (dibukukan maju)','adjustment',false)` with `ON CONFLICT DO NOTHING`.

  It is idempotent, and every existing row has a NULL column, so the CHECKs pass without `NOT VALID`. The new column inherits the existing table grants (0029/0049 note), so **no GRANT is needed**. RLS (FORCE) is unaffected because no rows are seeded. Rollback is `apps/backend/scripts/rollback-0062-transfer-kas.sql` (see Rollout).
- **KTD11. Keep the P28 sign fix a separate PR.** It is an independent revert unit, with different risk and no migration. A bug fix that can deploy immediately should not wait on a new feature with migration and UI review.

### High-Level Technical Design

*Directional only, not an implementation spec.*

Transfer write, one transaction:

```text
catatTransferKeBank(code, date, bankAccountId, amount, keterangan, key)
  buka() → canInputKeuangan            ─ refuse: role
  validate: amount>0 (sen), keterangan, date, key uuid
  BEGIN; set_config(app.unit_ids)
  EXISTS transfer_uuid=key ?           ─ yes → COMMIT-less return "sudah tercatat"
  read accounts FOR SHARE: kas-kind (Kas Besar), bank-kind active, same unit
  tutup_bulan for month(date)?         ─ refuse
  hKas  = hariBukuTerkunci(date, Kas Besar)
  hBank = hariBukuTerkunci(date, bank)  ─ pra-cut-over / different → refuse
  INSERT Kas Besar kredit  -amt  'Setoran ke Bank' transfer_uuid=key [tanggal_asal, ADJ-FWD-TRANSFER if forwarded]
  INSERT bank      debet   +amt  'Pindah Buku'     transfer_uuid=key [same]
  auditKeuangan 'kas.transfer.catat'
  bentukJurnalSesudahTulis  → P6 ×2: 1101 Cr / 1190 Dr ; 111x Dr / 1190 Cr
  COMMIT
```

States of a transfer pair:

```text
(none) --catat--> AKTIF --batalkanTransfer--> VOID (both legs)
                    |  ^ refused if: active cocok group | hari buku closed | month closed
                    +--cocokkan (statement match: rule 3 via adaKakiKasBesar / rule 6)--> AKTIF+DICOCOKKAN
                    AKTIF+DICOCOKKAN --HoF batalkanCocok--> AKTIF   (typed legs are not lahir, so not voided)
legacy bank 'SHP' row + Kas Besar out-leg --jadikanTransfer--> old bank row VOID + new AKTIF pair
```

### Interaction with bank matching (verified)

- **A new pair is matched as before.** A new transfer's bank leg ("Pindah Buku" plus a same-day Kas Besar "Setoran ke Bank") is a rule-3 SETORAN JEMPUTAN candidate through `adaKakiKasBesar` (`cocok-bank-model.ts:294,359-369`), and a rule-6 "ketikan" candidate.
- **No duplicate automatic pair.** `usulkanSetoranJemputan`'s `kakiKasDiketik` (`:412-421`) stops an automatic pair when a typed Kas Besar "Setoran ke Bank" exists, so no duplicate legs are created.
- **Undoing a match leaves transfer legs alone.** `batalkanCocok` voids only rows born from the group (`lahir_dari_cocok_id`).
- **Wording for the Pindah Buku Kas Besar legs.** The 7 Bakau legs that use kredit "Pindah Buku" (early October) are valid P6 legs. A "Pindah Buku" bank leg paired with a "Pindah Buku" Kas Besar leg does not satisfy `adaKakiKasBesar`, which requires "Setoran ke Bank". It still matches through rule 6. No change is needed, but the correction list should say so.

### Assumptions

- Each unit has exactly one `kas`-kind account (verified: 7 units × 1). The action refuses if there are 0 or more than 1, instead of guessing.
- Amounts are whole rupiah or sen, handled through `rupiahKeSen` / `senKeTeks` as in `cocok-bank-tulis.ts`.
- `day_close.difference_rp` does not depend on category (REPORT6 §3). Converting a bank leg's category on a closed day therefore leaves the closed day's difference unchanged. This is checked in the U7 verification.
- "Bentuk ulang" (`bentukUlangBukuBesar`) rebuilds derived journals only. No memorial exists today, so the open question "does Bentuk ulang keep an approved memorial" does not affect the recommended route (D3).

### Sequencing

U1 (migration) → U2 (pure model) → U3 (write core and actions) → U4 (UI on Input) → U5 (guard on the bank tab) → U6 (correction list and action) → U7 (docs and runbook). U5 and U6 depend on U3. U4 and U6 can run in parallel after U3.

---

## Implementation Units

### U1. Migration 0062_transfer_kas and rollback script

- **Goal:** Add `transfer_uuid`, its indexes and CHECKs, and the `ADJ-FWD-TRANSFER` reason code. All changes are additive.
- **Requirements:** R3, R6, R8; KTD1, KTD10.
- **Files:**
  - `apps/backend/prisma/migrations/0062_transfer_kas/migration.sql` (new);
  - `apps/backend/prisma/schema.prisma` (add the nullable field, if the model lists `cash_ledger` columns; check first);
  - `apps/backend/scripts/rollback-0062-transfer-kas.sql` (new, NOT EXECUTED header).
- **Approach:** Use the `IF NOT EXISTS` / `DO $$ … pg_constraint` idioms of 0049. Seed no unit-scoped rows. The header comment must explain why `pasangan_uuid` is not reused (KTD1). The rollback script:
  - first asserts there are 0 non-void rows with `transfer_uuid` (otherwise RAISE);
  - drops the constraints, indexes and column;
  - deletes the reason code only if it is unreferenced.
- **Test scenarios:**
  - `check-migrations.sh` passes (0062 > max on staging).
  - `check-sql-syntax.mjs` passes.
  - The integration test (U3) applies all migrations to a throw-away local Postgres and asserts:
    - a row with `transfer_uuid` and `pasangan_uuid` both set is rejected;
    - `transfer_uuid` with category "Pembelian BBM" is rejected;
    - a duplicate `(transfer_uuid, account_id)` is rejected;
    - `ADJ-FWD-TRANSFER` exists with `applies_to='adjustment'`.
- **Verification:** The migration applies twice without error (idempotent). It applies cleanly on the testing tier's DB through CD.

### U2. Pure model: plan of a transfer, detectors, verdicts

- **Goal:** Pure, unit-testable functions with no DB access.
- **Requirements:** R2–R7, R10–R11, R13, R15; KTD2, KTD4, KTD6, KTD8.
- **Files:**
  - `apps/dashboard/src/lib/transfer-kas-model.ts` (new);
  - `apps/dashboard/src/lib/transfer-kas-model.test.ts` (new);
  - `apps/dashboard/src/lib/keuangan-kas-model.ts` (add `transfer` to `BarisSistem`, `barisSistemDari({transfer})`, and `PENJELASAN_BARIS_SISTEM.transfer`).
- **Approach:**
  - `rencanaTransfer({amount, keterangan, akunKas, akunBank, hariKas, hariBank})` returns two legs or a refusal message.
  - `kakiTransferTerlewat(row, kasRows)` returns `boolean` (KTD8).
  - `kandidatJadikanTransfer(bankRows, kasRows)` returns `{siap: […], periksaManual: […]}` (R15).
  - `vonisBatalTransfer({legs, dicocokkan, hariTutup, bulanTutup})` returns `null | pesan`.
- **Test scenarios:**
  - The happy path gives Kas Besar −X "Setoran ke Bank" and bank +X "Pindah Buku".
  - Amount 0 or negative is refused.
  - An empty description is refused.
  - A destination that is not `bank` kind (Kas Besar itself or EDC Penampungan) is refused.
  - Different hari buku for the two legs is refused.
  - Booking forward gives both legs `tanggal_asal` and `ADJ-FWD-TRANSFER`.
  - The detector:
    - hits on the same day and amount;
    - misses on an amount 1 sen different;
    - misses when the Kas Besar leg already has a `transfer_uuid`;
    - misses on a Kas Besar debet.
  - Candidates:
    - one Kas Besar match lands in `siap`;
    - two equal Kas Besar outflows on the same day land in `periksaManual`;
    - no Kas Besar leg lands in `periksaManual` (covers Bakau 1 Oct `977285c9`, Imam Bonjol and Adisucipto).
  - A void verdict refuses on `dicocokkan`, a closed hari buku, or a closed month.
  - Journal outcome: feeding both legs through `jurnalKas` (`buku-besar-model.ts:522`) with pos 1101 and 1111 gives 1101 Cr X, 1111 Dr X, 1190 Dr X and Cr X, and **no 1103 line**. For contrast, the same bank leg labelled "Setoran Hasil Penjualan" yields a 1103 Cr line.

### U3. Write core and server actions: create and linked void

- **Goal:** Atomic two-leg create and two-leg void, with audit and journals.
- **Requirements:** R1–R12; KTD3–KTD7.
- **Files:**
  - `apps/dashboard/src/lib/transfer-kas-tulis.ts` (new, not "use server");
  - `apps/dashboard/src/lib/transfer-kas-actions.ts` (new, "use server": `catatTransferKeBank`, `batalkanTransfer`);
  - `apps/dashboard/src/lib/kas-actions.ts` (`voidMutasiKas`: select `transfer_uuid IS NOT NULL`, refuse through the `transfer` verdict, add `AND transfer_uuid IS NULL` to the UPDATE);
  - `apps/dashboard/src/lib/keuangan-input-queries.ts` (select `transfer_uuid`, set `transfer` on rows);
  - `apps/dashboard/src/lib/keuangan-wewenang.ts` (add `canJadikanTransfer` and `canJadikanTransferHariTutup` with doc comments; creating and voiding reuse `canInputKeuangan`);
  - tests: `transfer-kas-actions.guard.test.ts` (new), `transfer-kas.integration.test.ts` (new, gated `TRANSFER_LIVE_DB=1` + `TRANSFER_DB_URL`, local throw-away DB only), additions to `kas-actions.guard.test.ts` and `keuangan-wewenang.test.ts`.
- **Approach:** Follow `pecahMutasi` (`kas-actions.ts:594-729`) and `tulisPasanganJemputan` for structure:
  - month-closed check before `hariBukuTerkunci`;
  - insert both legs with `RETURNING id`;
  - `auditKeuangan`;
  - `bentukJurnalSesudahTulis(client, unit.unit_id, aktor)` last before COMMIT;
  - `revalidatePath` for the page date and the hari buku when forwarded.

  `batalkanTransfer` takes the `transfer_uuid` (not a row id), so the UI cannot void the wrong pair.
- **Execution note:** Write the guard tests and the gated integration test first, red, then implement.
- **Test scenarios:**
  - **Roles:** pengawas, direksi, admin_perusahaan and HoF are refused on create and void; keuangan and super_admin are allowed.
  - **Atomicity:** if the second insert fails (forced through a bad account id), no row remains.
  - **Idempotency:**
    - the same key twice gives one pair and the second call returns "sudah tercatat";
    - two concurrent calls with the same key give one pair (unique index).
  - **Closed day:** close day D in the fixture; a transfer on D lands on D+1 with `tanggal_asal = D`.
  - **Closed month:** a `tutup_bulan` row for the month refuses the save.
  - **Before cut-over:** refused.
  - **Wrong destination:** a bank account of another unit is refused (RLS plus `unit_id` check). A `kas`-kind destination is refused.
  - **Journal outcome (integration):** after commit, the `jurnal` lines for both `cash_ledger` source ids sum to 0 on 1190, and there are 0 lines on 1103.
  - **Void:**
    - both legs become void and both journals are removed;
    - an active `cocok_bank_baris` on one leg refuses and changes nothing;
    - a closed hari buku refuses;
    - `voidMutasiKas` on a single transfer leg refuses with the "Batalkan transfer" message;
    - `voidMutasiKas` on a normal row behaves as before (regression).
  - **Audit:** `kas.transfer.catat` and `kas.transfer.batal` rows exist with both ids.
  - **Pemicu guard:** `buku-besar-pemicu.guard.test.ts` passes with no allow-list edit.

### U4. UI: "Setor ke bank" on the Kas Besar tab, pair display, linked void

- **Goal:** Finance enters the transfer once and sees the pair.
- **Requirements:** R1, R2, R8, R10.
- **Files:**
  - `apps/dashboard/src/components/keuangan/TransferKeBankForm.tsx` (new);
  - `apps/dashboard/src/components/keuangan/BukuKasPanel.tsx` (button on the `kas` tab, `transfer` chip, "Batalkan transfer" control);
  - `apps/dashboard/src/app/(app)/keuangan/unit/[code]/[date]/input/page.tsx` (pass the bank accounts; already available in `akun`);
  - a render test `TransferKeBankForm.render.test.tsx`.
- **Approach and copy (Indonesian):**
  - Button, Kas Besar tab only: **"Setor ke bank…"**.
  - Title: **"Setor dari Kas Besar ke bank"**. Fields:
    - "Rekening tujuan": active bank accounts by name;
    - "Nominal";
    - "Keterangan": prefilled "Setoran ke Bank {tanggal}".
  - Preview line: *"Akan tercatat dua baris yang tertaut: Kas Besar keluar Rp {X} (Setoran ke Bank) dan {rekening} masuk Rp {X} (Pindah Buku). Membatalkan satu baris membatalkan keduanya."*
  - Submit button: **"Simpan transfer"**.
  - Success: *"Transfer tersimpan: Kas Besar −{X}, {rekening} +{X}."*. When forwarded, add *" Dibukukan di hari buku {d} karena {t} sudah tutup hari."*
  - Chip on both legs: **"transfer"**, with the tooltip from `PENJELASAN_BARIS_SISTEM.transfer`: *"Satu kaki transfer Kas Besar ↔ bank. Batalkan lewat 'Batalkan transfer' — kedua kaki batal bersama."*
  - Void confirmation: **"Ya, batalkan kedua kaki"** / **"Tidak"**.
  - The idempotency key is generated when the form opens (`crypto.randomUUID()`) and regenerated after success.
  - The submit button is disabled while pending.
- **Test scenarios:**
  - The button renders only on the `kas` tab and only when `bolehTulis`.
  - The preview shows both legs with the same amount.
  - A double click sends one request (pending disables).
  - A transfer leg shows the chip and "Batalkan transfer", not "Batalkan".
  - Messages render for an error and for forwarding.

### U5. Guard on the bank tab against re-entering a transfer as "Setoran Hasil Penjualan"

- **Goal:** Stop new rows with the wrong category.
- **Requirements:** R13, R14; KTD8.
- **Files:**
  - `apps/dashboard/src/lib/kas-actions.ts` (`simpanMutasiKas`: detector check inside the transaction, new optional input `bukanTransfer`, audit on override);
  - `BukuKasPanel.tsx` (warning banner when a bank tab, debet "Setoran Hasil Penjualan" and the amount match a same-day Kas Besar out-leg in `bukuPerAkun`);
  - tests in `kas-actions.guard.test.ts` and the integration test.
- **Approach and copy:**
  - Warning: *"Di Kas Besar tanggal ini ada 'Setoran ke Bank' sebesar Rp {X}. Bila uang ini pindahan dari Kas Besar, kategorinya 'Pindah Buku' — 'Setoran Hasil Penjualan' akan mengkredit 1103 dua kali."*
  - Button: **"Ganti ke Pindah Buku"**.
  - Checkbox: **"Ini setoran langsung ke bank, bukan dari Kas Besar"**. Only this sends `bukanTransfer: true`.
  - Server refusal without the checkbox: the same sentence plus *"Pakai kategori Pindah Buku, atau centang 'setoran langsung' bila memang bukan dari Kas Besar."*
  - **Hint under "Pindah Buku"** (on every debet tab): *"Untuk uang dari Kas Besar atau rekening sendiri."*
- **Test scenarios:**
  - The detector hit refuses without `bukanTransfer`.
  - With `bukanTransfer`, the row saves and the audit row `kas.setoran_bank_bukan_transfer` exists.
  - A different amount saves without a warning.
  - The Kas Besar tab "Setoran Hasil Penjualan" is never checked.
  - `setujuiSetoran` is unchanged (deferred, D7).

### U6. Correction list and "Jadikan transfer" action

- **Goal:** A reviewable, audited in-app correction for the existing rows (oldest first).
- **Requirements:** R15–R17; KTD7, KTD9.
- **Files:**
  - `apps/dashboard/src/app/(app)/keuangan/unit/[code]/koreksi-transfer/page.tsx` (new);
  - `apps/dashboard/src/components/keuangan/KoreksiTransferPanel.tsx` (new);
  - `apps/dashboard/src/lib/transfer-kas-queries.ts` (new; reads the candidates for the unit since `MULAI_BUKU_BESAR`);
  - `transfer-kas-tulis.ts` / `transfer-kas-actions.ts` (`jadikanTransfer`);
  - the route-gate entry checked by `gerbang-rute-keuangan.guard.test.ts`;
  - a link from the bank tab when the unit has candidates (*"{n} baris bank tampaknya transfer dari Kas Besar — koreksi"*);
  - tests in the guard and integration files.
- **Approach:**
  - **Each row shows:** date, bank (name), amount, Kas Besar leg (category, id8), day status (open/closed), and a button **"Jadikan transfer"**.
  - **Closed-day rows:** the button is visible only to HoF or super_admin, and it requires "Alasan".
  - **"Periksa manual" rows:** shown with their reason and no button.
  - **Action in one transaction:**
    - lock both rows `FOR UPDATE`;
    - re-check that they are still candidates (otherwise "berubah — muat ulang");
    - refuse on an active bank match or a closed month;
    - void the old bank row (`voided_by` = actor);
    - insert the new bank row (same account, `business_date`, `tanggal_asal`, `alasan_maju`, `alasan_maju_applies_to`, keterangan and amount; debet "Pindah Buku"; `transfer_uuid` = new uuid);
    - `UPDATE` the Kas Besar leg's `transfer_uuid` (only that column, `WHERE transfer_uuid IS NULL AND NOT void`);
    - `auditKeuangan('kas.transfer.koreksi', {lama, baru, kas, tanggal, nominal, hariTutup, alasan})`;
    - `bentukJurnalSesudahTulis`.
  - No `hariBukuTerkunci` forwarding: the correction is cash-neutral and keeps the original date (KTD9; §10.53 #2 confirms that journals of closed days in open months are rebuilt).
- **Test scenarios:**
  - **Happy path:** an open day by keuangan voids the old row, creates a new "Pindah Buku" row with the same date and amount, links both legs, and the journals for that day show 1103 change by +X and 1190 net 0.
  - **Closed day:**
    - keuangan is refused;
    - HoF without a reason is refused;
    - HoF with a reason succeeds, and `day_close.difference_rp` for that day is unchanged.
  - **Closed month:** refused.
  - **Active bank match** on either row: refused, nothing changed.
  - **Stale candidate** (the bank row was voided in between): refused.
  - **Run twice** on the same row: the second call finds no candidate.
  - **Two equal Kas Besar legs** on the same day: listed as "periksa manual" with no button.
  - **Afterwards:** the new pair can be voided by "Batalkan transfer" on an open day.

### U7. Documentation and Finance runbook

- **Goal:** Record the decisions and give Finance and HoF the exact correction steps.
- **Requirements:** all; Dependencies.
- **Files:**
  - `apps/dashboard/KEUANGAN-HARIAN.md` (new §10.57 "Transfer Kas Besar → bank dua kaki", listing KTD1, KTD4, KTD6, KTD8, KTD9 and the known limits);
  - `docs/runbooks/2026-11-koreksi-kaki-bank-transfer.md` (new; the steps in "Data correction plan"; bank accounts by last 4 digits only).
- **Test expectation:** none (documentation).
- **Verification:** The doc review finds no full account numbers. A grep for 10-digit sequences in changed files returns nothing.

---

## Data correction plan (reviewable; nothing is run by this PR)

### Options compared

| | (a) Finance: void + re-type per row | (b) In-app "Jadikan transfer" (U6) | (c) One-off reviewed script by owner |
|---|---|---|---|
| Steps | 64 manual actions (32 voids + 32 entries), across 30+ dates | 33 clicks on one list, oldest first | 1 run |
| Error risk | High. The same user already re-typed 32 rows wrongly once (Q6). Amount/date typos are possible. | Low. Amount, date and account are copied by the server. The category is fixed. | Low logic risk, but it bypasses app invariants. |
| Audit | None. `voidMutasiKas` writes no `audit_log`. | `kas.transfer.koreksi` per row, with the actor. | Only what the script writes. It breaks "who did it" (DB role, not an app user). |
| Journals | Rebuilt per write | Rebuilt per write | Needs a separate Bentuk ulang. The `xmin` hook does not run. |
| Leaves rows linked | No | Yes. Future voids are paired. | Only if the script sets `transfer_uuid`. |
| Closed day 22 Oct | Possible but unguarded | Guarded: HoF/super_admin plus a reason | Possible |
| Hard rules | OK | OK | Conflicts with "no raw writes to `cash_ledger`" |

**Recommendation: (b).** It is the only option that is audited, keeps journals consistent through the normal hook, and ends with the same linked state the new feature produces. (c) is excluded by the hard rules. (a) stays as the fallback if (b) is not approved; the runbook keeps REPORT7B's step list for it.

### Sequence (after both PRs are live on pilot)

1. **The P28 deposit-sign PR** is merged, verified on testing (`-rlsstg`) and promoted (independent of this PR, either order).
2. **This PR** is merged to `staging`, verified on testing (see Verification Contract), then promoted to `main` through the `pilot` gate.
3. **Finance (keuangan, user 24) on `/keuangan/unit/6378301/koreksi-transfer`:** "Jadikan transfer" for the 31 open-day Bakau rows, oldest first. Then the same for Adisucipto's open-day row (Rp 160.417.000, 1 Oct, BCA …3811). That is 32 rows, Rp 11.080.496.000.
4. **HoF, Bakau 22 Oct `28e717f3`:** "Jadikan transfer" with the reason *"Kaki bank transfer Kas Besar → BCA …6811 salah kategori (Setoran Hasil Penjualan → Pindah Buku); 1103 terkredit dua kali. Ref REPORT6/7B."*, after checking both legs on the confirmation step and ticking "Saya yakin". **No memorial** (Dion's D3, 11 Nov 2026 17:54 WIB). Expected result: both legs stay dated 22 Oct (no booking forward), the bank leg no longer credits 1103, 1190 nets to 0, and the day close stays `closed` with difference −470.
5. **The three "periksa manual" rows** (Finance checks the deposit slips and statements first; see D6):
   - **Imam Bonjol 1 Oct `60cd0454` and Adisucipto 2 Oct `95a4f8a7`:** expected to be real direct deposits. No action.
   - **Bakau 1 Oct `977285c9`, Rp 170.341.000:**
     - If the cash physically went Kas Besar → bank, Finance voids the bank row and enters it with "Setor ke bank" dated 1 Oct. That writes both legs and fixes Kas Besar too.
     - If the money never passed through Kas Besar, Finance must look at the 30 Sep Kas Besar debet `cf15e72d` with HoF. It is outside the journal period, before `MULAI_BUKU_BESAR`, but it does affect the Kas Besar balance.
6. **HoF runs "Bentuk ulang"** for 2026-10, then 2026-11, on `/keuangan/unit/<code>/buku-besar/<bulan>` for Bakau, Adisucipto and Imam Bonjol. This is needed for P28. The transfer corrections already rebuilt their own days.
7. **Check** (read-only, by Dion or an agent with the documented `ingest` read-only path):
   - Bakau 22 Oct 1103 remainder = −470, P24 posted to 5130, and the finding `sisa_1103_belum_disetujui` is gone;
   - for each unit, 1190 is 0 at each day's end except real items in transit;
   - 1103 per day is about 0 apart from tolerated differences;
   - 0 bank "Setoran Hasil Penjualan" rows remain with a same-day Kas Besar out-leg.
8. **Then** October month close can be attempted.

---

## Verification Contract

- **Local, required before the PR:**
  - `cd apps/backend && pnpm exec prisma generate`;
  - `pnpm check` (SQL syntax, mutasi self-test, typecheck all, vitest all);
  - `pnpm lint`;
  - `bash scripts/ci/check-migrations.sh`.

  All must pass. Report exact pass/fail counts in the PR.
- **Gated integration tests:** `TRANSFER_LIVE_DB=1 TRANSFER_DB_URL=<local throw-away postgres>` runs `transfer-kas.integration.test.ts` against a local DB with all migrations applied. Never point it at a cloud DB. If no local Postgres is available, say so in the PR; do not fake it.
- **Guard suites that must stay green:**
  - `buku-besar-pemicu.guard.test.ts`;
  - `kas-actions.guard.test.ts`;
  - `gerbang-rute-keuangan.guard.test.ts`;
  - `hak-dml.guard.test.ts` (no new DML grants);
  - `keuangan-sisi-kas.test.ts` and the seed tests for `ATURAN_KATEGORI_KAS` (no new category, so they stay unchanged).
- **Testing tier (`-rlsstg`, after Dion merges to `staging`; CD migrates `solamax-pg-rlsstg` first).** With test users for keuangan, HoF and pengawas:
  1. As keuangan: "Setor ke bank" on an open day. Both rows appear, and the Buku Besar day shows no 1103 line from them and 1190 net 0.
  2. Submit twice quickly; only one pair is created.
  3. Close a test day, then transfer on that date. Both legs land on the next open day with `tanggal_asal`.
  4. "Batalkan transfer" voids both. Match a test statement line to the bank leg, then try to void: refused.
  5. On the bank tab, enter "Setoran Hasil Penjualan" with the same amount: warning, and refused without the tick.
  6. Seed a legacy-style pair on testing through the old form (bank "Setoran Hasil Penjualan" + Kas Besar "Setoran ke Bank"), then "Jadikan transfer" as keuangan (open day) and as HoF (closed day, with a reason).
  7. Pengawas and Direksi see no write controls.
- **Pilot (after promotion):** read-only checks only, plus Finance running step 3 of the correction sequence.

## Definition of Done

- U1–U7 are implemented; the tests listed per unit exist and pass; and the local gates are green with counts reported.
- No change to existing migrations, P-rules, `pasangan_uuid` behaviour or category seeds.
- No production or staging DB writes, no grants, no deploys. The PR targets `staging` and is not merged.
- No full bank account numbers anywhere in the diff, plan, runbook or PR (last 4 digits only).
- The rollback script exists, marked NOT EXECUTED, with its pre-check.
- `KEUANGAN-HARIAN.md` §10.57 and the runbook are written.
- No abandoned experimental code is left in the diff.

## Rollout and rollback

- **Rollout:**
  - PR → `staging` (Dion merges). CD migrates the testing DB, then deploys `-rlsstg`. Verify the testing-tier steps.
  - Dion opens `staging → main` and approves `pilot`. CD runs `prisma migrate deploy` on `solamax-pg`, then serves the new image. Migration failure halts the pipeline (DEPLOY.md).
  - Finance and HoF run the correction.
- **Rollback (code):** revert the PR. Old code ignores `transfer_uuid`. **Caveat:** after revert, transfer legs lose their `transfer` verdict, so the single-row void could split a pair. If rows were already written, keep the code and fix forward instead of reverting. If a revert is unavoidable, tell Finance to void both legs manually.
- **Rollback (schema):** `apps/backend/scripts/rollback-0062-transfer-kas.sql` (owner-run, as `ingest`, only with explicit approval):
  - it refuses if any non-void row has a `transfer_uuid`;
  - it drops the CHECKs, indexes and column;
  - it removes `ADJ-FWD-TRANSFER` only if unreferenced.

  The migration directory stays (checksum rule); a follow-up migration would be needed to re-add.
- **Rollback (data correction):** each "Jadikan transfer" is reversible on an open day by "Batalkan transfer" plus Finance re-entering the old row (audit shows both). On a closed day there is no in-app reversal; this is why the closed-day action needs HoF, a written reason and the explicit confirmation. Any later change to that day is a new decision for Dion.

## Risks

- **Re-journal cost.** `bentukJurnalSesudahTulis` scans unit rows since 1 Oct by `xmin` on each write (§10.53 #3). Two legs per write is unchanged in kind. Watch latency on the 33-row cleanup.
- **Deadlock with tutup hari.** This is the known §10.53 #3 limit: the trigger side is caught by its SAVEPOINT, and HoF retries tutup hari.
- **Old paths still write bank "Setoran Hasil Penjualan".** `setujuiSetoran` on a bank tab, and an overridden guard. These are mitigated by audit and deferred item D7.
- **False positives in the guard.** A direct deposit coinciding with an unrelated Kas Besar transfer of the same amount is possible but rare. The tick overrides it, with audit.
- **Changing a closed day.** The category conversion on Bakau 22 Oct changes journals of a closed day. The cash numbers are unchanged, and it is HoF-gated, reasoned, explicitly confirmed and audited. Dion accepted this route (D3).
- **Migration number clash.** `0062` could clash with a parallel branch; CI catches it, rebase.
- **Ordering with P28.** "Bentuk ulang" before P28 is live leaves the −600.000 P28 error. Run it after both PRs are live.

## Decision log

- **11 Nov 2026, 17:54 WIB — Dion:**
  - **D3 answered:** Bakau 22 Oct `28e717f3` (closed day) is corrected with "Jadikan transfer" **only**. **No memorial**, not as an alternative and not in addition.
  - **Explicit confirmation (new, R18):** "Jadikan transfer" must require an explicit confirmation on **open days too** (it was one click). Built on all days, enforced by the server, logged in `audit_log`.
  - The other decisions (D1, D2, D4–D9) were not changed and stay at the recommendation, as built.

## Open decisions for Dion (answered — see "Decision log")

Each decision has a recommendation, and the executor builds the recommendation unless Dion says otherwise.

1. **D1. A transfer typed on a closed day.**
   - **Recommendation:** book both legs forward to the next open day with `ADJ-FWD-TRANSFER` (KTD4). This matches every other new write path and the jemputan pair.
   - **Alternative:** block with "Hari sudah ditutup".
2. **D2. Route for the 32 open-day rows.**
   - **Recommendation:** the in-app "Jadikan transfer" action (b).
   - **Alternative:** Finance void + re-type (a).
   - The script (c) is not recommended.
3. **D3. Bakau 22 Oct `28e717f3` (closed day).** **Answered 11 Nov 2026 17:54 WIB: "Jadikan transfer" only, no memorial.**
   - HoF runs "Jadikan transfer" with a reason and the explicit confirmation. It is cash-neutral and keeps source data and journals consistent on every rebuild.
4. **D4. Who may run "Jadikan transfer".**
   - **Recommendation:** keuangan, HoF or super_admin on open days; HoF or super_admin only on closed days, with a reason.
5. **D5. The bank-tab guard.**
   - **Recommendation:** warn and require an explicit "setoran langsung" tick, with audit.
   - **Alternatives:** a hard ban, or a hint only.
6. **D6. The three ambiguous rows.**
   - **Recommendation:** no action on Imam Bonjol `60cd0454` and Adisucipto `95a4f8a7` (direct deposits, P2 correct) after Finance confirms with the slips.
   - **Bakau `977285c9`:** Finance proves where the Rp 170.341.000 went, then follows step 5 of the sequence.
7. **D7. Restrict `setujuiSetoran` to the Kas Besar account** (§10.48 "always Kas Besar").
   - **Recommendation:** yes, as a small follow-up PR.
8. **D8. Audit every plain `voidMutasiKas`.**
   - **Recommendation:** yes, as a follow-up PR. Today voids leave no `audit_log`.
9. **D9. PR split and order.**
   - **Recommendation:** keep the P28 sign fix and this feature as separate PRs (KTD11). Merge P28 first because it is a pure bug fix. Run "Bentuk ulang" only after both are live and the corrections are done.

---

## Appendix: production facts used (read-only, 11 Nov 2026 about 16:33 WIB)

- **Bank debet "Setoran Hasil Penjualan", Oct–Nov:**
  - Bakau: 33 rows, all `source_manual_entry_id` NULL. 32 by user 24 (keuangan), created 29 Oct to 9 Nov; 1 by user 2 (super_admin) on 11 Nov.
  - Adisucipto: 2 rows (1 typed, 1 via `setujuiSetoran`).
  - Imam Bonjol: 1 row (via `setujuiSetoran`).
  - Earlier voided versions: 32 by user 24 (29 Oct to 9 Nov) and 1 by user 2 (11 Nov 16:25).
- **Kas Besar kredit legs:** Bakau 25 "Setoran ke Bank" (−8.595.274.000) and 7 "Pindah Buku" (−2.724.784.000); Adisucipto 1 "Setoran ke Bank" (−160.417.000). None is unpaired.
- **Bank debet "Pindah Buku" in Oct–Nov:** 3 rows, all Bakau, all unrelated small amounts. Nobody used "Pindah Buku" for deposits.
- **Accounts:** every unit has 1 `kas` account and 1 `edc_penampungan`. Bakau has 5 bank accounts; the other units have 1.
- **State:**
  - `cash_ledger` triggers: 0;
  - closed `day_close` rows: 1 (Bakau 22 Oct);
  - `tutup_bulan` rows: 0;
  - memorial journals: 0;
  - active bank-match rows on the affected categories: 0;
  - `ADJ-FWD-*` codes: 7 existing (EDC, IMPORT, INTERUNIT, LEDGER, PURCHASE, REVERSAL, SUSPENSE).
- **Audit actions present:** `cocok_bank.batal` 75, `cocok_bank.otomatis` 74, `kas.beban` 16, `antar_unit.catat` 8. There is no `kas.void` action at all.
