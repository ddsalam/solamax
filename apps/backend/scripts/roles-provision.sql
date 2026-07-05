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

-- dashboard_app: create if missing, then enforce attributes + password.
SELECT format('CREATE ROLE dashboard_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', :'dashboard_app_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app')
\gexec
ALTER ROLE dashboard_app WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'dashboard_app_pw';

-- ingest: backend /ingest writer.
SELECT format('CREATE ROLE ingest LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', :'ingest_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ingest')
\gexec
ALTER ROLE ingest WITH LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD :'ingest_pw';
