-- Saldo Piutang/Hutang Pelanggan — domain baru utk blok RECAP di Laporan Operasional.
-- Sumber EasyMax (full-sync, UPSERT by PK): tr_bppiut (buku piutang), tr_bphut (buku
-- hutang), tm_plg (master AR; SJENIS = diskriminator Lokal/Online). ADDITIVE (CREATE
-- TABLE saja; tanpa ALTER TYPE) → aman dijalankan out-of-band sebelum deploy image.
-- Formula terkunci vs oracle (probe ronde 11-13, EKSAK 27-Jun):
--   Piutang = Σ njumlah·sign(sjnsbp:1=+,2=−), sbatal=0, dtgl<tanggal; Lokal=SJENIS{1,5},
--             Online=SJENIS 3, SJENIS 4 dikecualikan.
--   Hutang Lokal = −Σ njumlah·sign(sjnsbp:2=+,1=−), sbatal=0, dtgl<tanggal.

-- CreateTable bppiut — UPSERT by (unit_id, ckdbppiut).
CREATE TABLE "public"."bppiut" (
    "unit_id" SMALLINT NOT NULL,
    "ckdbppiut" CHAR(15) NOT NULL,
    "dtgl" DATE NOT NULL,
    "ckdplg" VARCHAR(12),
    "vcref" VARCHAR(20),
    "vcket" TEXT,
    "njumlah" DECIMAL,
    "sjnsbp" SMALLINT,
    "sbatal" SMALLINT,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bppiut_pkey" PRIMARY KEY ("unit_id","ckdbppiut")
);

-- CreateTable bphut — UPSERT by (unit_id, ckdbphut).
CREATE TABLE "public"."bphut" (
    "unit_id" SMALLINT NOT NULL,
    "ckdbphut" CHAR(15) NOT NULL,
    "dtgl" DATE NOT NULL,
    "ckdplg" VARCHAR(12),
    "vcref" VARCHAR(20),
    "vcket" TEXT,
    "njumlah" DECIMAL,
    "sjnsbp" SMALLINT,
    "sbatal" SMALLINT,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bphut_pkey" PRIMARY KEY ("unit_id","ckdbphut")
);

-- CreateTable pelanggan_master — master AR (tm_plg). UPSERT by (unit_id, ckdplg).
CREATE TABLE "public"."pelanggan_master" (
    "unit_id" SMALLINT NOT NULL,
    "ckdplg" CHAR(12) NOT NULL,
    "vcnmplg" TEXT,
    "sjenis" SMALLINT,
    "saktif" SMALLINT,

    CONSTRAINT "pelanggan_master_pkey" PRIMARY KEY ("unit_id","ckdplg")
);

-- CreateIndex
CREATE INDEX "bppiut_unit_id_dtgl_idx" ON "public"."bppiut"("unit_id", "dtgl");
CREATE INDEX "bppiut_unit_id_ckdplg_idx" ON "public"."bppiut"("unit_id", "ckdplg");
CREATE INDEX "bphut_unit_id_dtgl_idx" ON "public"."bphut"("unit_id", "dtgl");

-- Grant SELECT ke role app dashboard (pola migrasi 0006). Hanya SELECT: dashboard_app
-- TAK boleh menulis ke mirror EasyMax (negative-access test). Di dev lokal role bisa
-- belum ada → jangan gagalkan migrasi.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT ON "public"."bppiut" TO dashboard_app;
    GRANT SELECT ON "public"."bphut" TO dashboard_app;
    GRANT SELECT ON "public"."pelanggan_master" TO dashboard_app;
  END IF;
END $$;
