-- 0017_audit_log — append-only audit trail for /admin membership changes
-- (owner decision A #2). Currently only soft-audit columns exist on
-- app.manual_entry; grant/revoke of access is untracked.
--
-- No unit_id → NOT unit-scoped by 0016 (tenant/global admin action). Append-only:
-- dashboard_app may SELECT + INSERT; UPDATE/DELETE revoked (tamper-evident).
-- Standard migrate-BEFORE-image ordering (table must exist before the image writes).

CREATE TABLE IF NOT EXISTS "app"."audit_log" (
    "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
    "actor_user_id" INTEGER     NOT NULL,
    "actor_email"   TEXT,
    "action"        TEXT        NOT NULL,   -- grant_access | revoke_access | (future) data_access
    "target"        TEXT,                   -- membership id / target user / unit code
    "detail"        JSONB,                  -- old/new role, unit scope, etc.
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_log_created_at_idx" ON "app"."audit_log" ("created_at");
CREATE INDEX IF NOT EXISTS "audit_log_action_idx"     ON "app"."audit_log" ("action");

-- Append-only grant for the dashboard app role (SELECT+INSERT; no UPDATE/DELETE).
-- ⚠️ B1 deploy runs ALTER DEFAULT PRIVILEGES IN app GRANT ...,DELETE → new app
-- tables inherit DELETE. REVOKE explicitly so the trail cannot be rewritten.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT, INSERT ON "app"."audit_log" TO dashboard_app;
    REVOKE UPDATE, DELETE ON "app"."audit_log" FROM dashboard_app;
  END IF;
END
$$;
