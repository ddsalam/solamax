-- roles-bootstrap.sql — reproduce the OUT-OF-GIT DB roles + grants.
--
-- GAP (flagged Phase 1): the `ingest` role and its grants were created outside
-- Prisma migrations → not in git. Only dashboard_app's per-table data grants live
-- in migrations (guarded by `IF EXISTS pg_roles`). This script recreates both
-- roles + ALL grants idempotently so any instance (fresh staging, promoted prod,
-- future branch) is reproducible from one committed file.
--
-- Run AFTER `prisma migrate deploy` (schemas/tables exist → ALL TABLES grants
-- bind, and this becomes the SINGLE reproducible source of every grant). As a
-- superuser, via:
--   psql "$SUPERUSER_URL" -v ingest_pw="superpw" -v dashboard_app_pw="apppw" -f roles-bootstrap.sql
-- Passwords via -v (never committed). Interpolated OUTSIDE dollar-quotes only
-- (psql does not expand :vars inside DO $$ … $$).
--
-- 🔒 NOSUPERUSER NOBYPASSRLS is REQUIRED: a role with either attribute silently
--    bypasses Row-Level Security (0016), defeating the DB-layer backstop.

-- dashboard_app: create if missing, then enforce attributes + password (idempotent).
SELECT format('CREATE ROLE dashboard_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', :'dashboard_app_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app')
\gexec
ALTER ROLE dashboard_app WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'dashboard_app_pw';

-- ingest: backend /ingest writer (public data tables, incl. DELETE for the
-- REPLACE-by-business-date domains edc/pelanggan_sale/voucher_sale).
SELECT format('CREATE ROLE ingest LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', :'ingest_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ingest')
\gexec
ALTER ROLE ingest WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'ingest_pw';

-- Schema usage.
GRANT USAGE ON SCHEMA public, app TO dashboard_app;
GRANT USAGE ON SCHEMA public          TO ingest;

-- dashboard_app: SELECT-only on the public data mirror (reproduces the out-of-git
-- broad grant that let the dashboard read sales/opname/etc.).
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dashboard_app;

-- dashboard_app: RW on the app schema (auth/RBAC/manual-entry).
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA app TO dashboard_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE ON TABLES TO dashboard_app;

-- ingest: full DML on public data tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ingest;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ingest;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ingest;

-- Re-assert the append-only / void-only invariants (the broad app.* grant above
-- would otherwise hand dashboard_app UPDATE/DELETE it must not have). Idempotent.
DO $$
BEGIN
  IF to_regclass('app.audit_log')    IS NOT NULL THEN REVOKE UPDATE, DELETE ON app.audit_log    FROM dashboard_app; END IF;
  IF to_regclass('app.manual_entry') IS NOT NULL THEN REVOKE DELETE         ON app.manual_entry FROM dashboard_app; END IF;
  IF to_regclass('app.usulan_so')    IS NOT NULL THEN REVOKE DELETE         ON app.usulan_so    FROM dashboard_app; END IF;
END $$;
