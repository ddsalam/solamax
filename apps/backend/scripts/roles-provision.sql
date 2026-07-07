-- roles-provision.sql — FRESH-INSTANCE role provisioning. (F2b)
--
-- CREATEs the dashboard_app + ingest roles and SETs their passwords + attributes.
--
-- ⚠️ THIS RESETS PASSWORDS. Use ONLY when standing up a NEW instance (fresh staging /
--    newly-created prod). NEVER run on a live instance serving traffic — the ALTER ROLE …
--    PASSWORD would break the running dashboard + IB agent DB auth until the Secret Manager
--    secrets are rotated in lockstep. For live grant re-assertion use grants-bootstrap.sql
--    (which never touches passwords).
--
-- Run BEFORE grants-bootstrap.sql. As a superuser (passwords via -v, never committed):
--   psql "$SUPERUSER_URL" -v ingest_pw="…" -v dashboard_app_pw="…" -f roles-provision.sql
--
-- 🔒 NOSUPERUSER NOBYPASSRLS is REQUIRED: either attribute silently bypasses RLS (0016).

-- Attributes NOSUPERUSER NOBYPASSRLS are set at CREATE (settable everywhere, and the
-- defaults). The re-assert ALTER sets ONLY the password — on Cloud SQL the admin is
-- `cloudsqlsuperuser` (NOT a true superuser) and cannot ALTER the SUPERUSER/BYPASSRLS
-- attribute ("Only roles with the SUPERUSER attribute may change it"); it also cannot
-- GRANT those attributes, so a role here can never gain them. The assertion below
-- fail-closes if a pre-existing role somehow carries either.

-- dashboard_app: create if missing (with attrs), then set password.
SELECT format('CREATE ROLE dashboard_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', :'dashboard_app_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app')
\gexec
ALTER ROLE dashboard_app WITH LOGIN PASSWORD :'dashboard_app_pw';

-- ingest: backend /ingest writer.
SELECT format('CREATE ROLE ingest LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', :'ingest_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ingest')
\gexec
ALTER ROLE ingest WITH LOGIN PASSWORD :'ingest_pw';

-- 🔒 Fail-closed guard: RLS (0016) is silently bypassed by SUPERUSER/BYPASSRLS.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('dashboard_app','ingest')
             AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'dashboard_app/ingest must be NOSUPERUSER NOBYPASSRLS (RLS backstop)';
  END IF;
END $$;
