-- ============================================================================
-- BAKAU EasyMax — READ-ONLY SCHEMA-PARITY PROBE PACK
-- Unit "6378301 Bakau" (SolaGroup 63.783.01) vs Imam Bonjol (6478111).
-- Run on the Bakau server PC via the existing SQL Manager (admin/root read is
-- fine — every statement here is SELECT/SHOW/DESCRIBE, NOTHING writes).
--
-- 🔒 SAFETY: EasyMax is the LIVE POS DB. This pack is READ-ONLY. Do NOT run any
--    CREATE/GRANT/INSERT/UPDATE from this file. (Creating the readonly_sync
--    user is a SEPARATE, later execution step — not part of this probe.)
--
-- Purpose: confirm the 7-SPBU-identical-schema assumption against Bakau's live
--    DB, and capture the per-unit masters (products/tanks/nozzles/capacities)
--    the dashboard needs. Copy each result block back.
-- ============================================================================

-- [0] SERVER IDENTITY — must be 5.0.x for mysql2/insecureAuth path; TZ + clock.
SELECT VERSION() AS version, @@session.time_zone AS tz, NOW() AS now_wib;

-- [1] TABLE/VIEW PRESENCE — every object the agent reads. TABLE_TYPE tells us
--     BASE TABLE vs VIEW. Any row MISSING here is a hard parity delta.
SELECT TABLE_NAME, TABLE_TYPE
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'easymax'
  AND TABLE_NAME IN (
    'tr_hjualbbm','tr_djualbbm','tr_hopnamebbm','tr_dopnamebbm','tr_terimabbm',
    'tr_hkasbank','tr_dkasbank','tr_deposit','tr_bppiut','tr_bphut',
    'tr_htebus','tr_dtebus','tr_hterra','tr_dterra','tera',
    'tm_bbm','tm_nozzle','tm_tangki','tm_perk','tm_card','tm_plg',
    'vw_realtm','vw_jualplg','vw_usevouc','vw_edc3'
  )
ORDER BY TABLE_TYPE, TABLE_NAME;

-- [1b] VIEW QUERYABILITY — a view can exist in the catalog yet be BROKEN (missing
--      base table/column). LIMIT 1 keeps the heavy union views cheap while proving
--      each resolves + revealing its real column names/sample.
SELECT * FROM vw_jualplg LIMIT 1;
SELECT * FROM vw_usevouc LIMIT 1;
SELECT * FROM vw_edc3    LIMIT 1;
SELECT * FROM vw_realtm  LIMIT 1;

-- [2] COLUMN SHAPE — one shot: all columns for all probed objects. Compare the
--     key columns the agent SELECTs (see notes at bottom) against IB.
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'easymax'
  AND TABLE_NAME IN (
    'tr_hjualbbm','tr_djualbbm','tr_hopnamebbm','tr_dopnamebbm','tr_terimabbm',
    'tr_hkasbank','tr_dkasbank','tr_deposit','tr_bppiut','tr_bphut',
    'tr_htebus','tr_dtebus','tr_hterra','tr_dterra','tera',
    'tm_bbm','tm_nozzle','tm_tangki','tm_perk','tm_card','tm_plg',
    'vw_realtm','vw_jualplg','vw_usevouc','vw_edc3'
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- [3] PRODUCT-CODE DRIFT — the multi-tenant crux. Dashboard classifies BY NAME
--     (classifyProduct/canonicalProductKey), so Bakau's CKDBBM codes may differ
--     freely — BUT the NAMES must match these regexes (uppercased):
--       PERTALITE | PERTAMAX | PERTAMAX TURBO | SOLAR/BIO SOLAR | DEXLITE | PERTAMINA DEX
--     Any product name NOT matching → falls through classify → excluded from
--     PSO/NPSO bauran + target resolution. FLAG any surprise name.
--     (Names are the gate; price/other cols intentionally omitted so an unexpected
--     column name can't error out this critical query.)
SELECT CKDBBM, VCNMBBM FROM tm_bbm ORDER BY CKDBBM;

-- [4] TANK SET — denah/monitoring + tera join (CKDTANGKI2 CAST). Confirm the
--     tank→product mapping and the 1..N numeric CKDTANGKI2 domain.
SELECT CKDTANGKI, CKDTANGKI2, CKDBBM, VCNMTANGKI FROM tm_tangki ORDER BY CKDTANGKI2;

-- [5] NOZZLE SET — pump/nozzle topology.
SELECT CKDNOZZLE, CKDPOMPA, CKDTANGKI FROM tm_nozzle ORDER BY CKDNOZZLE;

-- [6] ATG CAPACITIES — real_tank.nkapasitas is data-driven from this view.
--     Confirm NKAPASITAS present + sane (IB e.g. DEX 9000). dtanggaljam = live clock.
SELECT CKDTANGKI, NKAPASITAS, NVOLUME, dtanggaljam FROM vw_realtm;

-- [7] CUSTOMER MASTER — SJENIS distribution (1=Lokal,5=... / 3=Online per saldo rule).
SELECT SJENIS, COUNT(*) AS n FROM tm_plg GROUP BY SJENIS ORDER BY SJENIS;

-- ---------------------------------------------------------------------------
-- KNOWN DATA HAZARDS — confirm present/absent at Bakau
-- ---------------------------------------------------------------------------

-- [8] NULL-DTGLJAM shift-3 rows (keyed next morning). Wide business-date rescan
--     (SALES_RESYNC) is the cure; confirm the hazard exists so we know rescan matters.
SELECT COUNT(*) AS null_dtgljam_rows FROM tr_djualbbm WHERE DTGLJAM IS NULL;
SELECT h.NSHIFT, COUNT(*) AS n
FROM tr_djualbbm d
JOIN tr_hjualbbm h ON h.CKDJUALBBM = d.CKDJUALBBM
WHERE d.DTGLJAM IS NULL
GROUP BY h.NSHIFT ORDER BY h.NSHIFT;

-- [9] CORRUPT-DATE tables (IB had year 2116/2262 in pjpelanggan, tr_nopolodo).
--     One-shot: presence + their date/datetime columns. EMPTY result = tables
--     absent = hazard NOT present at Bakau. If rows return, run the MAX follow-up
--     (fill <col> from the COLUMN_NAME(s) below) — a max year 2116/2262 confirms it.
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='easymax'
  AND TABLE_NAME IN ('pjpelanggan','tr_nopolodo')
  AND DATA_TYPE IN ('date','datetime','timestamp')
ORDER BY TABLE_NAME, ORDINAL_POSITION;
--   Follow-up per date column returned above:
--   SELECT MIN(<col>) AS mn, MAX(<col>) AS mx FROM pjpelanggan;
--   SELECT MIN(<col>) AS mn, MAX(<col>) AS mx FROM tr_nopolodo;

-- [10] KAS dormancy (dead since ~2019 at IB → 0 rows in 2026 is NORMAL).
SELECT MAX(DTGL) AS last_kas,
       (SELECT COUNT(*) FROM tr_hkasbank WHERE DTGL >= '2026-01-01') AS kas_2026
FROM tr_hkasbank;

-- [11] DATA INCEPTION / RANGES — drives the one-time catch-to-inception backfill
--      (rolling fullSweepFloor can strand old data). Per domain min/max business date.
SELECT 'sales'    AS domain, MIN(DTGLJUAL) mn, MAX(DTGLJUAL) mx FROM tr_hjualbbm
UNION ALL SELECT 'opname',   MIN(DTAGLOPN), MAX(DTAGLOPN) FROM tr_hopnamebbm
UNION ALL SELECT 'delivery', MIN(DTGLTRM),  MAX(DTGLTRM)  FROM tr_terimabbm
UNION ALL SELECT 'deposit',  MIN(DTGL),     MAX(DTGL)     FROM tr_deposit
UNION ALL SELECT 'piutang',  MIN(DTGL),     MAX(DTGL)     FROM tr_bppiut
UNION ALL SELECT 'hutang',   MIN(DTGL),     MAX(DTGL)     FROM tr_bphut
UNION ALL SELECT 'tebus',    MIN(DTGLTBS),  MAX(DTGLTBS)  FROM tr_htebus
UNION ALL SELECT 'terra',    MIN(DTGLTERRA),MAX(DTGLTERRA)FROM tr_hterra;
-- tera + edc separately (view/floor):
SELECT MIN(TanggalJam) AS tera_mn, MAX(TanggalJam) AS tera_mx FROM tera;
SELECT MIN(ctgl) AS edc_mn, MAX(ctgl) AS edc_mx FROM vw_edc3;

-- [12] UNIT/PT IDENTITY — reconfirm Bakau's legal entity = PT Sola Petra Abadi
--      (same tenant as IB) and read Bakau's own SPBU code/name fields. Find where
--      EasyMax stores the SPBU/company profile.
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA='easymax'
  AND (TABLE_NAME LIKE '%spbu%' OR TABLE_NAME LIKE '%setup%'
       OR TABLE_NAME LIKE '%perusaha%' OR TABLE_NAME LIKE '%company%'
       OR TABLE_NAME LIKE '%profil%' OR TABLE_NAME LIKE '%config%');
--   Then SELECT * from the likely profile table to read PT name + SPBU code.

-- ============================================================================
-- KEY COLUMNS the agent depends on (cross-check against [2]) — if any renamed
-- or typed differently at Bakau, that's a code-touching delta:
--   tr_djualbbm: CKDJUALBBM,CKDNOZZLE,NVOLUME,NHARGAJUAL,NSUBTOTAL,CKDBBM,
--                CKDTANGKI,DTGLJAM,SUBAH,SEDIT
--   tr_hjualbbm: CKDJUALBBM,DTGLJUAL,NSHIFT,VCKET
--   tr_terimabbm: CNOSO,CNODO,NVOLDO,NVOLREAL,DTGLJAM,DTGLTRM,SBATAL
--   tm_tangki:   CKDTANGKI2 (numeric, tera join)
--   vw_realtm:   NKAPASITAS, dtanggaljam
--   vw_edc3:     ctgl, TanggalJam, CKDKARTU, JrnKey
--   tm_plg:      SJENIS, SAKTIF
-- ============================================================================
