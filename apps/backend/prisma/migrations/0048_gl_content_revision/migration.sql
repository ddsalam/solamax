-- Additive cache metadata only. Existing rows stay NULL until a new backend
-- processes that domain; dashboard readers use the legacy heartbeat token
-- until the revision/run handshake is valid. No source backfill or grants.
-- Bound the DDL lock wait; keep the columns in place on an application rollback.
BEGIN;
SET LOCAL lock_timeout = '10s';
ALTER TABLE "public"."sync_state"
  ADD COLUMN "gl_revision" BIGINT,
  ADD COLUMN "gl_revision_run_at" TIMESTAMPTZ;
COMMIT;
