-- CreateTable
-- Snapshot ATG keadaan-kini per tangki (sumber EasyMax tb_realtank). Satu baris
-- per tangki = pembacaan terkini (volume/tinggi/suhu/air). PK natural (unit_id,
-- tank_no) → UPSERT menimpa baris lama tiap siklus (bukan log historis).
CREATE TABLE "public"."real_tank" (
    "unit_id" SMALLINT NOT NULL,
    "tank_no" SMALLINT NOT NULL,
    "ntinggi" DECIMAL,
    "nvolume" DECIMAL,
    "nsuhu" DECIMAL,
    "ntinggiair" DECIMAL,
    "nvolumeair" DECIMAL,
    "nstatus" SMALLINT,
    "dtanggaljam" TIMESTAMPTZ NOT NULL,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "real_tank_pkey" PRIMARY KEY ("unit_id","tank_no")
);

-- Grant SELECT ke role app dashboard. ALTER DEFAULT PRIVILEGES hanya menutup
-- schema `app`, bukan `public` → tabel public baru WAJIB di-grant eksplisit.
-- Dijaga: di dev lokal role `dashboard_app` mungkin belum ada → jangan gagalkan migrasi.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT ON "public"."real_tank" TO dashboard_app;
  END IF;
END
$$;
