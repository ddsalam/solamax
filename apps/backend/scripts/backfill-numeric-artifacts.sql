-- backfill-numeric-artifacts.sql — IDEMPOTENT one-shot cleanup of floating-point
-- artifacts in mirror `numeric` columns (investigation 2026-08-06).
--
-- WHY: before the `sql.ts` fix (NUMERIC_COLUMNS → text param + ::numeric), Prisma
-- rendered JS `number` params at 16 SIGNIFICANT DIGITS instead of shortest-roundtrip,
-- so values whose double error crossed half-an-ulp at digit 16 landed distorted:
--     73867616.46    → 73867616.45999999   (bppiut PP2022100101473, unit 1)
--     67.26          → 67.26000000000001   (sales_detail.nvolume pattern)
--     99213863301.15 → 99213863301.14999   (cash_header.ntotal pattern)
-- Sweep of the pilot DB found ~243.800 such cells across all 7 units. Total deviation
-- of ALL of them is 0.0000746 — immaterial, but permanently dirty without this pass.
-- Evidence: session-notes/2026-08-06-artefak-float-numeric-ingest.md
--
-- WHAT IT DOES: for every `numeric` column of every unit-scoped mirror table,
--     SET col = trim_scale(round(col, 4)) WHERE scale(col) >= 5
-- Self-adjusting (no hardcoded column list), idempotent (second run touches 0 rows).
--
-- WHY round to 4 and not 2: artifacts always live at scale >= 5, while `tera.liter`
-- holds 10 LEGITIMATE values at scale 3-4. Rounding to 4 recovers every true value
-- (max artifact deviation 0.00001 « 0.00005) and cannot damage legitimate data.
-- `trim_scale` then drops the padding zeros so 99213863301.1500 reads as ...301.15.
--
-- PRE-REQUISITE: deploy the `sql.ts` fix FIRST. Running this before the fix only
-- cleans rows that the very next sync will dirty again.
--
-- RUN AS the table owner role `ingest` (FORCE RLS applies to the owner too, hence
-- the app.unit_ids context below). Pass the units to clean:
--     psql "$INGEST_URL" -v units="1,2,3,4,5,6,7" -f backfill-numeric-artifacts.sql
-- Prefer a low-traffic window: it row-locks the rows it rewrites.

\set ON_ERROR_STOP on

-- Fail loudly on a missing -v units=… : without it `:'units'` would become the
-- literal ':units', RLS would hide every row, and the run would report a
-- reassuring "0 cells" while having cleaned nothing.
\if :{?units}
\else
\warn 'ABORT: pass the units to clean, e.g. -v units="1,2,3,4,5,6,7"'
\quit 1
\endif

BEGIN;

-- RLS context: without it the policy `unit_scope` is fail-closed (0 rows visible)
-- and this script would report a silent, misleading "nothing to do".
SELECT set_config('app.unit_ids', :'units', true);

\echo '=== BEFORE: artifact cells per table.column (scale >= 5) ==='
DO $$
DECLARE r record; n bigint; total bigint := 0;
BEGIN
  FOR r IN
    SELECT c.table_name AS t, c.column_name AS c
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.data_type IN ('numeric', 'double precision', 'real')
      AND EXISTS (SELECT 1 FROM information_schema.columns u
                  WHERE u.table_schema = 'public' AND u.table_name = c.table_name
                    AND u.column_name = 'unit_id')
    ORDER BY 1, 2
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE scale(%I) >= 5', r.t, r.c) INTO n;
    IF n > 0 THEN
      RAISE NOTICE '  %.% : % cells', r.t, r.c, n;
      total := total + n;
    END IF;
  END LOOP;
  RAISE NOTICE 'TOTAL before: % cells', total;
END $$;

\echo '=== REWRITING (trim_scale(round(col,4)) where scale >= 5) ==='
DO $$
DECLARE r record; n bigint; total bigint := 0;
BEGIN
  FOR r IN
    SELECT c.table_name AS t, c.column_name AS c
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.data_type IN ('numeric', 'double precision', 'real')
      AND EXISTS (SELECT 1 FROM information_schema.columns u
                  WHERE u.table_schema = 'public' AND u.table_name = c.table_name
                    AND u.column_name = 'unit_id')
    ORDER BY 1, 2
  LOOP
    EXECUTE format(
      'UPDATE %I SET %I = trim_scale(round(%I, 4)) WHERE scale(%I) >= 5',
      r.t, r.c, r.c, r.c);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE '  %.% : % rows rewritten', r.t, r.c, n;
      total := total + n;
    END IF;
  END LOOP;
  RAISE NOTICE 'TOTAL rewritten: % rows', total;
END $$;

\echo '=== AFTER: must be 0 (anything left = a column the pass could not reach) ==='
DO $$
DECLARE r record; n bigint; total bigint := 0;
BEGIN
  FOR r IN
    SELECT c.table_name AS t, c.column_name AS c
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.data_type IN ('numeric', 'double precision', 'real')
      AND EXISTS (SELECT 1 FROM information_schema.columns u
                  WHERE u.table_schema = 'public' AND u.table_name = c.table_name
                    AND u.column_name = 'unit_id')
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE scale(%I) >= 5', r.t, r.c) INTO n;
    total := total + n;
    IF n > 0 THEN RAISE WARNING '  STILL DIRTY %.% : % cells', r.t, r.c, n; END IF;
  END LOOP;
  RAISE NOTICE 'TOTAL after: % cells', total;
  IF total > 0 THEN
    RAISE EXCEPTION 'backfill incomplete: % cells still at scale >= 5 — nothing committed', total;
  END IF;
END $$;

COMMIT;
