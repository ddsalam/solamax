-- rls-rollback.sql — INSTANT, IDEMPOTENT rollback of migration 0016 (unit-scoped RLS).
--
-- Drops the `unit_scope` policy and DISABLEs Row-Level Security on EVERY table that
-- carries it (self-adjusting — no hardcoded list). Use to revert the RLS cutover:
-- afterwards dashboard_app/ingest read/write as before RLS (app-layer scoping still
-- applies). Pair with an image rollback if the RLS-aware image was already deployed.
--
-- Run as a superuser:  psql "$SUPERUSER_URL" -f rls-rollback.sql
-- Re-enable = re-run 0016 (apps/backend/prisma/migrations/0016_rls_unit_scope/migration.sql).

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname AS s, c.relname AS t
    FROM pg_policy p
    JOIN pg_class c     ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE p.polname = 'unit_scope'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DISABLE ROW LEVEL SECURITY', r.s, r.t);
    EXECUTE format('DROP POLICY IF EXISTS unit_scope ON %I.%I',     r.s, r.t);
    RAISE NOTICE 'RLS unit_scope removed from %.%', r.s, r.t;
  END LOOP;
END $$;
