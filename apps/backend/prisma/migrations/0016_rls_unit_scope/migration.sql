-- 0016_rls_unit_scope — DB-layer Row-Level Security backstop (unit-scoped).
--
-- Defense-in-depth UNDER the app choke-point (getDataScope → ScopedUnitId,
-- apps/dashboard/src/lib/scope.ts:73). This is the second net: even a query path
-- that forgot getDataScope() cannot read another unit's rows at the DB layer.
--
-- Tenant model = LEGAL ENTITY (PT). One PT tenant owns many units; isolation
-- BETWEEN units is UNIT-scoped (pengawas → their user_unit; direksi/admin → all
-- units in the tenant). So the RLS predicate keys on unit_id, sourced from a
-- per-request GUC `app.unit_ids` set transaction-locally by the app.
--
-- ⚠️ IMAGE-BEFORE-MIGRATE (inverted ordering): enabling RLS here BEFORE the app
--    image that sets `app.unit_ids` (qScoped in db.ts; set_config in ingest) is
--    deployed makes current_setting() NULL → ANY(NULL) → ZERO rows for everyone
--    = outage. Deploy the context-setting image FIRST, then run this migration.
--
-- Fail-closed: unset/empty context → NULLIF→NULL → ANY(NULL) → no rows (never a leak).
-- Rollback: DISABLE ROW LEVEL SECURITY per table (see 0016_rollback note below).

-- Applies to EVERY base table in public/app that carries a unit_id column
-- (self-adjusting: new unit-scoped tables are covered on re-run). Superusers and
-- the table owner-with-bypass still bypass — migrations/seed run unaffected.
--
-- ⚠️ EXCLUDES the AUTHORIZATION-BOOTSTRAP tables `public.unit` and `app.user_unit`.
-- These are read by getDataScope()/getAuthContext() (scope.ts, auth-context.ts) via
-- PLAIN q() to DISCOVER which units a user may see — BEFORE any app.unit_ids context
-- exists. RLS on them → 0 rows → empty scope → total lockout. They are the tables
-- that DEFINE scope, not per-unit data; the app-layer rule unitVisible() governs them.
DO $$
DECLARE
  r record;
  predicate text := $p$unit_id = ANY (string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')::int[])$p$;
BEGIN
  FOR r IN
    SELECT c.table_schema AS s, c.table_name AS t
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema
     AND tb.table_name  = c.table_name
     AND tb.table_type  = 'BASE TABLE'
    WHERE c.column_name = 'unit_id'
      AND c.table_schema IN ('public', 'app')
      AND (c.table_schema, c.table_name) NOT IN (
            ('public', 'unit'),      -- unit registry: read pre-context to authorize
            ('app',    'user_unit')  -- pengawas→unit map: read pre-context to build scope
          )
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.s, r.t);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY',  r.s, r.t);
    EXECUTE format('DROP POLICY IF EXISTS unit_scope ON %I.%I',   r.s, r.t);
    EXECUTE format(
      'CREATE POLICY unit_scope ON %I.%I USING (%s) WITH CHECK (%s)',
      r.s, r.t, predicate, predicate
    );
    RAISE NOTICE 'RLS unit_scope enabled on %.%', r.s, r.t;
  END LOOP;
END $$;
