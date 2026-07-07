# Bakau EasyMax — Schema-Parity Verdict (Phase 1 close)

Probe run on Bakau server PC via SQL Manager, read-only, 2026-07-05. Source: `bakau-probe-pack.sql`.

## VERDICT: Bakau ≈ Imam Bonjol — schema-identical, agent-compatible.
Same EasyMax build, all objects present, all views healthy, all agent-referenced
columns resolve. Differences are **unit-specific master values** (expected, handled by
unit-scoped masters) plus **3 flagged deltas** — none blocking; all covered by existing
mechanisms, 3 need acceptance-time verification.

## Identical to IB (parity confirmed)
- **Server**: `5.0.67-community-nt`, tz `SYSTEM`, clock correct → mysql2/insecureAuth path works. [0]
- **Objects**: 25/25 present, correct BASE TABLE vs VIEW split. [1]
- **Views resolve** (not broken), return data with core agent columns: vw_realtm [6], vw_edc3/vw_jualplg/vw_usevouc [1b]. [11]
- **Key columns** proven present by successful column-specific SELECTs across [3][4][5][6][7][8][11].
- **Product classification by-name**: all 6 active product names match the dashboard regexes (PERTALITE/PERTAMAX/PERTAMAX TURBO/SOLAR+BIO SOLAR/DEXLITE/PERTAMINA DEX). [3][4]
- **Tank CKDTANGKI2** = numeric 1–6 (tera join OK); capacities present & sane (30100/20300/8300). [4][6]
- **Hazards**: NULL-DTGLJAM present (cure = business-date rescan); tera min=1980-01-01 → pre-2020 floor needed (already in code); KAS dormant (last 2021-09-30, 0 in 2026); corrupt-date tables present but inert. [8][9][10][11]

## Unit-specific (expected — unit-scoped masters handle it)
- **Product codes** `BB-01..BB-08` are Bakau's own. Same code ≠ same product across units:
  `BB-01`=PERTALITE at Bakau vs Premium(discontinued) at IB. `Product @@id[unitId,ckdbbm]`
  + dashboard join `p.unit_id=sd.unit_id AND p.ckdbbm=sd.ckdbbm` → resolves per-unit. Proven safe. [3][4]
- **Tanks** 6 (T-01..T-06), **nozzles** 22 (NZ-01..NZ-22, pumps D-01..D-04). [4][5]
- **Customers** ~629, SJENIS mix differs (see delta 3). [7]
- **History** since 2015-08 (~11 years). [11]

## DELTAS TO FLAG
1. **Duplicate-name legacy product codes** (LOW). tm_bbm has 8 rows incl. `BB-01` PERTALITE
   and `BB-05` BIO SOLAR — NOT tank-assigned (active set = 6, one per canonical name), but
   `BB-01` IS present in historical txn data (vw_usevouc 2015). Name-based classification
   folds `BB-01`+`BB-07`→PERTALITE and `BB-03`+`BB-05`→SOLAR, so canonical totals are correct.
   ▸ Acceptance: confirm per-product rincian sums by canonical name (no PERTALITE double-listed),
     not pick-one. [3][4][1b]
2. **NULL-DTGLJAM pervasive across ALL 3 shifts** (MEDIUM). ~9,600 detail rows
   (shift1=3,114 / shift2=3,232 / shift3=3,280), vs IB's narrow shift-3 pattern. Incremental
   `DTGLJAM>watermark` sync would permanently skip them; only the shift-agnostic business-date
   `SALES_RESYNC` + one-time inception sweep catch them.
   ▸ Backfill correctness depends on business-date sweep to inception, not just incremental. [8]
3. **tm_plg SJENIS mix unhandled by saldo rule** (MEDIUM). Distribution 1=9, 2=9, 3=13,
   **4=575 (dominant)**, 5=23. Dashboard RECAP saldo classifies Lokal{1,5}/Online{3};
   SJENIS 2 and 4 fall in neither bucket.
   ▸ Acceptance: verify whether SJENIS 2/4 customers carry tr_bppiut/tr_bphut balances the
     RECAP block would omit/misclassify; adjust classification if so. [7]

## Other notes
- **Backfill scope**: one-time catch-up-to-inception must reach ~2015-08 (~4,000 days) — far
  beyond the rolling `fullSweepFloorDays=1095` (~3yr). Explicit deep-sweep to inception required. [11]
- **deposit** dormant tail (max 2025-05-01); **PT identity** not exposed in EasyMax under
  spbu/setup/perusahaan/company/profil/config table names → PT Sola Petra Abadi remains
  owner-asserted (business fact, not DB fact). [11][12]
- **Column-shape [2]** captured (9 screenshots); key columns confirmed by successful execution.
  Full byte-level column diff vs IB available on request / first dry-run will surface any drift.

Phase 1 CLOSED. Phase 2 (plan) awaits explicit go.
