-- Manual-entry (FASE 1b) — seksi Pendapatan Lain & Pengeluaran diisi pengawas
-- (sumber EasyMax mati/absen; ADR-001). Schema `app` (RW oleh dashboard_app).
-- v1 minimal + audit void: siapa menghapus/ubah angka kas = sinyal kepatuhan.
-- Identitas = id uuid SAJA (input manusia → TANPA unique urut; `urut` = ordering).
-- void via UPDATE (jejak audit), BUKAN DELETE → GRANT tanpa DELETE.

CREATE TYPE "app"."manual_entry_section" AS ENUM ('pendapatan_lain', 'pengeluaran');

CREATE TABLE "app"."manual_entry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id" SMALLINT NOT NULL,
    "business_date" DATE NOT NULL,
    "section" "app"."manual_entry_section" NOT NULL,
    "urut" INTEGER NOT NULL DEFAULT 0,
    "keterangan" TEXT NOT NULL,
    "amount" DECIMAL(17,2) NOT NULL,
    "void" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_by_user_id" INTEGER,
    "voided_at" TIMESTAMPTZ,

    CONSTRAINT "manual_entry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "manual_entry_unit_id_business_date_section_idx"
    ON "app"."manual_entry"("unit_id", "business_date", "section");

-- RW utk role app dashboard (schema `app` = milik aplikasi). TANPA DELETE —
-- pembatalan lewat kolom `void` (audit). USAGE schema `app` di-set deploy-time.
-- ⚠️ Deploy B1 men-set `ALTER DEFAULT PRIVILEGES IN app GRANT SELECT,INSERT,UPDATE,DELETE`
-- → tabel `app` baru mewarisi DELETE. REVOKE eksplisit agar pembatalan HANYA lewat
-- `void` (UPDATE) — jejak audit utuh, tak ada hard-delete oleh aplikasi.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "app"."manual_entry" TO dashboard_app;
    REVOKE DELETE ON "app"."manual_entry" FROM dashboard_app;
  END IF;
END
$$;
