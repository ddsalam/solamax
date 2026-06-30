-- Usulan Penebusan SO — input pengawas (per produk per tanggal) yang ditujukan ke
-- Keuangan. Tiga kolom manual (Plan Penerimaan DO Hari ini, Plan Permintaan DO
-- Besok, Usulan Penebusan); kolom "awal hari" (Sisa Stock / Sisa DO) TIDAK
-- disimpan — dihitung ulang (carry-forward D−1) di dashboard. Pola sama dgn
-- app.manual_entry: schema `app` (RW dashboard_app), VOID-only (TANPA DELETE),
-- audit void. `status` informasional (draft → diajukan), pengawas-driven; tak ada
-- role Keuangan / gerbang approval (lihat AUTH-RBAC-DESIGN). Satu baris AKTIF per
-- (unit, tanggal, produk) — edit = void baris aktif + insert baru (jejak audit).
--
-- Urutan deploy (HOUSE RULE): migrate-deploy DULU, baru deploy image dashboard
-- yang mereferensikan tabel ini. Idempoten / aman re-run.

CREATE TABLE IF NOT EXISTS "app"."usulan_so" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"            SMALLINT NOT NULL,
    "business_date"      DATE NOT NULL,
    "product_key"        TEXT NOT NULL,
    "penerimaan_hari"    DECIMAL(14,2) NOT NULL DEFAULT 0,
    "permintaan_besok"   DECIMAL(14,2) NOT NULL DEFAULT 0,
    "usulan_penebusan"   DECIMAL(14,2) NOT NULL DEFAULT 0,
    "status"             TEXT NOT NULL DEFAULT 'draft',
    "void"               BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" INTEGER NOT NULL,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_by_user_id"  INTEGER,
    "voided_at"          TIMESTAMPTZ,

    CONSTRAINT "usulan_so_pkey" PRIMARY KEY ("id")
);

-- Tepat satu baris AKTIF (non-void) per (unit, tanggal, produk). Edit/save =
-- void baris aktif lama lalu insert baru dalam satu txn (di server action).
CREATE UNIQUE INDEX IF NOT EXISTS "usulan_so_active_uq"
    ON "app"."usulan_so"("unit_id", "business_date", "product_key") WHERE NOT void;

CREATE INDEX IF NOT EXISTS "usulan_so_unit_date_idx"
    ON "app"."usulan_so"("unit_id", "business_date");

-- RW utk role app dashboard (schema `app` = milik aplikasi). TANPA DELETE —
-- pembatalan/edit lewat kolom `void` (audit). Mirror app.manual_entry: deploy B1
-- men-set ALTER DEFAULT PRIVILEGES …GRANT…DELETE → REVOKE eksplisit agar tak ada
-- hard-delete oleh aplikasi.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "app"."usulan_so" TO dashboard_app;
    REVOKE DELETE ON "app"."usulan_so" FROM dashboard_app;
  END IF;
END
$$;
