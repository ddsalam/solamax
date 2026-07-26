-- rbac-scope-rollback.sql — rollback IDEMPOTEN migrasi 0019_rbac_scope_alignment.
--
-- Mengembalikan skema akses ke bentuk pra-0019: tanpa app.user_role, tanpa
-- membership.all_units, tanpa user_unit.tenant_id, FK sederhana seperti semula.
--
-- ⚠️ URUTAN — KEBALIKAN deploy. Image baru TIDAK BISA hidup tanpa `all_units`
--    (setiap request 500). Jadi:
--       1. kembalikan traffic ke revisi LAMA dulu:
--          gcloud run services update-traffic solamax-dashboard-staging \
--            --region=asia-southeast2 --to-revisions=<REVISI-LAMA>=100
--       2. BARU jalankan naskah ini.
--    Membalik urutan = pemadaman, persis kelas kesalahan inversi 0016.
--
-- Jalankan sebagai role PEMILIK tabel `ingest` (bukan dashboard_app):
--    psql "$INGEST_URL" -f apps/backend/scripts/rbac-scope-rollback.sql
--
-- KEHILANGAN DATA yang disengaja & bisa diterima: kolom all_units / user_unit.tenant_id
-- adalah turunan — semuanya bisa dihitung ulang dari (role, membership.tenant_id) saat
-- 0019 dipasang kembali. audit_log.tenant_id SENGAJA TIDAK di-drop: append-only, dan
-- kolom tambahan tidak mengganggu image lama (yang tak pernah menyebutnya).
--
-- Pasang kembali = jalankan ulang
-- apps/backend/prisma/migrations/0019_rbac_scope_alignment/migration.sql.

BEGIN;

-- 4′ user_unit: lepas FK komposit + trigger, kembalikan FK tunggal, buang kolom.
ALTER TABLE "app"."user_unit" DROP CONSTRAINT IF EXISTS "user_unit_membership_tenant_fkey";
ALTER TABLE "app"."user_unit" DROP CONSTRAINT IF EXISTS "user_unit_unit_tenant_fkey";

DROP TRIGGER  IF EXISTS "user_unit_fill_tenant" ON "app"."user_unit";
DROP FUNCTION IF EXISTS "app"."user_unit_fill_tenant"();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_unit_membership_id_fkey') THEN
    ALTER TABLE "app"."user_unit" ADD CONSTRAINT "user_unit_membership_id_fkey"
      FOREIGN KEY ("membership_id") REFERENCES "app"."membership"("id")
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_unit_unit_id_fkey') THEN
    ALTER TABLE "app"."user_unit" ADD CONSTRAINT "user_unit_unit_id_fkey"
      FOREIGN KEY ("unit_id") REFERENCES "public"."unit"("unit_id")
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE "app"."user_unit" DROP COLUMN IF EXISTS "tenant_id";

-- 3′ membership: lepas FK role, kembalikan unique lama (NULLS DISTINCT), buang all_units.
ALTER TABLE "app"."membership" DROP CONSTRAINT IF EXISTS "membership_user_id_role_fkey";
ALTER TABLE "app"."membership" DROP CONSTRAINT IF EXISTS "membership_id_tenant_id_key";
ALTER TABLE "app"."membership" DROP CONSTRAINT IF EXISTS "membership_user_id_tenant_id_key";
DROP INDEX IF EXISTS "app"."membership_user_id_tenant_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "membership_user_id_tenant_id_key"
  ON "app"."membership" ("user_id", "tenant_id");   -- bentuk Prisma 0002 (NULLS DISTINCT)
ALTER TABLE "app"."membership" DROP COLUMN IF EXISTS "all_units";

-- 2′ user_role
DROP TABLE IF EXISTS "app"."user_role";

-- 1′ public.unit: lepas kunci komposit, kembalikan tenant opsional + ON DELETE SET NULL.
ALTER TABLE "public"."unit" DROP CONSTRAINT IF EXISTS "unit_unit_id_tenant_id_key";
ALTER TABLE "public"."unit" ALTER COLUMN "tenant_id" DROP NOT NULL;
ALTER TABLE "public"."unit" DROP CONSTRAINT IF EXISTS "unit_tenant_id_fkey";
ALTER TABLE "public"."unit" ADD CONSTRAINT "unit_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "app"."tenant"("id")
  ON UPDATE CASCADE ON DELETE SET NULL;

COMMIT;
