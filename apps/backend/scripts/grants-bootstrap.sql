-- grants-bootstrap.sql — GRANTS ONLY, idempotent, LIVE-SAFE. (F2a)
--
-- Reproduces the out-of-git data grants + re-asserts the append/void REVOKE invariants.
-- Contains NO `CREATE ROLE` and NO `ALTER ROLE … PASSWORD` — it never touches role
-- passwords or attributes, so it is SAFE to re-assert on the promoted-prod (live IB)
-- instance without breaking the running app/agent. This is the "re-assert grants on prod"
-- step referenced by the live-cutover runbook.
--
-- PREREQ: roles `dashboard_app` + `ingest` already exist (fresh instance: run
-- roles-provision.sql first). Run AFTER `prisma migrate deploy`. As a superuser:
--   psql "$SUPERUSER_URL" -f grants-bootstrap.sql
--
-- 🔒 dashboard_app/ingest must be NOSUPERUSER NOBYPASSRLS (set by roles-provision.sql)
--    or RLS (0016) is silently bypassed.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app')
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ingest') THEN
    RAISE EXCEPTION 'roles dashboard_app/ingest missing — run roles-provision.sql first (fresh instance only)';
  END IF;
END $$;

-- Schema usage.
GRANT USAGE ON SCHEMA public, app TO dashboard_app;
-- (B3) ingest needs USAGE on `app` too: it OWNS the app-schema RLS tables (manual_entry,
-- usulan_so) on instances where migrations ran as ingest, and enabling RLS (0016) on them
-- requires schema USAGE. Without it, `0016` fails partway with "permission denied for schema
-- app" and the whole DO-block rolls back → 0 policies. (On live, ingest already owns schema
-- app; this makes fresh-instance provisioning robust when table-owner ≠ schema-owner.)
GRANT USAGE ON SCHEMA public, app     TO ingest;

-- dashboard_app: SELECT-only on the public data mirror (the out-of-git broad grant).
GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO dashboard_app;

-- dashboard_app: RW on the app schema (auth/RBAC/manual-entry).
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA app TO dashboard_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE ON TABLES TO dashboard_app;
-- (B4) DELETE on the two auth-management tables that /admin mutates: grantAccess DELETEs
-- app.user_unit (re-scope before re-insert) and revokeAccess DELETEs app.membership
-- (admin-actions.ts). The blanket app grant above is DELETE-less by default, so a fresh instance
-- built only from this script had /admin grant/revoke fail `permission denied for table user_unit`.
-- (Live had this out-of-git and worked; surfaced on a fresh instance -rlsstg 2026-07-07.)
-- audit_log/manual_entry/usulan_so stay DELETE-revoked (see the invariants block below).
GRANT DELETE ON app.user_unit, app.membership TO dashboard_app;
-- (B2) USAGE on app-schema SEQUENCES — Auth.js pg-adapter `createUser`/`linkAccount`/
-- `createSession` INSERT into app.users/accounts/sessions whose ids come from
-- users_id_seq/accounts_id_seq/sessions_id_seq. Without this, first login fails with
-- "permission denied for sequence users_id_seq". (Surfaced by the real-infra login on
-- a fresh instance; live IB already had this grant out-of-git.)
GRANT USAGE ON ALL SEQUENCES IN SCHEMA app TO dashboard_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT USAGE ON SEQUENCES TO dashboard_app;

-- ingest: full DML on public data tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ingest;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ingest;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ingest;

-- Re-assert the append-only / void-only invariants (the broad app.* grant above would
-- otherwise hand dashboard_app UPDATE/DELETE it must not have). Idempotent.
DO $$
BEGIN
  IF to_regclass('app.audit_log')    IS NOT NULL THEN REVOKE UPDATE, DELETE ON app.audit_log    FROM dashboard_app; END IF;
  IF to_regclass('app.manual_entry') IS NOT NULL THEN REVOKE DELETE         ON app.manual_entry FROM dashboard_app; END IF;
  IF to_regclass('app.usulan_so')    IS NOT NULL THEN REVOKE DELETE         ON app.usulan_so    FROM dashboard_app; END IF;
END $$;
