-- Rincian Penjualan — domain baru (FASE 1b). Sumber & strategi TERKUNCI by probe
-- (ADR-001 / FASE1-PLAN.md). Catatan: nama pelanggan (vcnmplg) DI-DENORMALISASI
-- dari view EasyMax → TIDAK ada master_pelanggan (hindari mismatch format CKDPLG).
-- `card` (tm_card) tetap master karena vw_edc3 hanya membawa CKDKARTU.

-- CreateTable deposit — prabayar pelanggan (tr_deposit). UPSERT by (unit_id,ckddepo).
CREATE TABLE "public"."deposit" (
    "unit_id" SMALLINT NOT NULL,
    "ckddepo" CHAR(15) NOT NULL,
    "dtgl" DATE NOT NULL,
    "ckdplg" VARCHAR(12),
    "ntotal" DECIMAL,
    "nsaldo" DECIMAL,
    "sbatal" SMALLINT,
    "vcket" TEXT,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposit_pkey" PRIMARY KEY ("unit_id","ckddepo")
);

-- CreateTable edc — non-tunai (vw_edc3). Surrogate id; REPLACE per (unit_id,business_date)
-- (tr_edc tanpa PK bersih & tanpa SBATAL → replace menangkap koreksi, tanpa under-count).
CREATE TABLE "public"."edc" (
    "id" BIGSERIAL NOT NULL,
    "unit_id" SMALLINT NOT NULL,
    "business_date" DATE NOT NULL,
    "cshift" VARCHAR(1),
    "tanggaljam" TIMESTAMPTZ NOT NULL,
    "ckdkartu" CHAR(5),
    "total" DECIMAL,
    "liter" DECIMAL,
    "jenis" SMALLINT,
    "cnotrace" VARCHAR(20),
    "nonozle" VARCHAR(4),
    "jrnkey" INTEGER,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edc_pkey" PRIMARY KEY ("id")
);

-- CreateTable pelanggan_sale — penjualan tempo via pjualplg (vw_jualplg).
-- Surrogate id; REPLACE per (unit_id,business_date). vcnmplg denormal.
CREATE TABLE "public"."pelanggan_sale" (
    "id" BIGSERIAL NOT NULL,
    "unit_id" SMALLINT NOT NULL,
    "business_date" DATE NOT NULL,
    "ckdplg" VARCHAR(12),
    "vcnmplg" TEXT,
    "ckdjualplg" CHAR(15),
    "ckdbbm" VARCHAR(5),
    "nshift" SMALLINT,
    "liter" DECIMAL,
    "total" DECIMAL,
    "sbatal" SMALLINT,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pelanggan_sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable voucher_sale — penjualan voucher (vw_usevouc). Surrogate id; REPLACE per business_date.
CREATE TABLE "public"."voucher_sale" (
    "id" BIGSERIAL NOT NULL,
    "unit_id" SMALLINT NOT NULL,
    "business_date" DATE NOT NULL,
    "ckdplg" VARCHAR(12),
    "vcnmplg" TEXT,
    "ckdusevouc" CHAR(15),
    "ckdbbm" VARCHAR(5),
    "nshift" SMALLINT,
    "liter" DECIMAL,
    "total" DECIMAL,
    "sbatal" SMALLINT,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voucher_sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable card — master kartu/channel EDC (tm_card). Full-sync (UPSERT by PK).
CREATE TABLE "public"."card" (
    "unit_id" SMALLINT NOT NULL,
    "ckdcard" CHAR(5) NOT NULL,
    "vcnmcard" TEXT,
    "ckdbank" CHAR(5),
    "cgl" VARCHAR(8),

    CONSTRAINT "card_pkey" PRIMARY KEY ("unit_id","ckdcard")
);

-- CreateIndex — filter laporan per (unit, tanggal bisnis).
CREATE INDEX "deposit_unit_id_dtgl_idx" ON "public"."deposit"("unit_id", "dtgl");
CREATE INDEX "edc_unit_id_business_date_idx" ON "public"."edc"("unit_id", "business_date");
CREATE INDEX "pelanggan_sale_unit_id_business_date_idx" ON "public"."pelanggan_sale"("unit_id", "business_date");
CREATE INDEX "voucher_sale_unit_id_business_date_idx" ON "public"."voucher_sale"("unit_id", "business_date");

-- Grant SELECT ke role app dashboard (pola migrasi 0004). ALTER DEFAULT PRIVILEGES
-- hanya menutup schema `app` → tabel `public` baru WAJIB di-grant eksplisit.
-- Hanya SELECT: dashboard_app TAK boleh menulis ke mirror EasyMax (negative-access test).
-- Di dev lokal role mungkin belum ada → jangan gagalkan migrasi.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT ON "public"."deposit" TO dashboard_app;
    GRANT SELECT ON "public"."edc" TO dashboard_app;
    GRANT SELECT ON "public"."pelanggan_sale" TO dashboard_app;
    GRANT SELECT ON "public"."voucher_sale" TO dashboard_app;
    GRANT SELECT ON "public"."card" TO dashboard_app;
  END IF;
END
$$;
