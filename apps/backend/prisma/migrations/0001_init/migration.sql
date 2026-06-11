-- CreateTable
CREATE TABLE "unit" (
    "unit_id" SMALLINT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "api_key_hash" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Pontianak',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_pkey" PRIMARY KEY ("unit_id")
);

-- CreateTable
CREATE TABLE "sync_state" (
    "unit_id" SMALLINT NOT NULL,
    "domain" TEXT NOT NULL,
    "last_watermark" TIMESTAMPTZ,
    "last_run_at" TIMESTAMPTZ,
    "last_row_count" INTEGER,

    CONSTRAINT "sync_state_pkey" PRIMARY KEY ("unit_id","domain")
);

-- CreateTable
CREATE TABLE "sales_header" (
    "unit_id" SMALLINT NOT NULL,
    "ckdjualbbm" CHAR(15) NOT NULL,
    "dtgljual" DATE NOT NULL,
    "nshift" SMALLINT,
    "vcket" TEXT,

    CONSTRAINT "sales_header_pkey" PRIMARY KEY ("unit_id","ckdjualbbm")
);

-- CreateTable
CREATE TABLE "sales_detail" (
    "id" BIGSERIAL NOT NULL,
    "unit_id" SMALLINT NOT NULL,
    "ckdjualbbm" CHAR(15) NOT NULL,
    "ckdnozzle" CHAR(5) NOT NULL,
    "nurut" INTEGER NOT NULL,
    "nstandawal" DECIMAL,
    "nstandakhir" DECIMAL,
    "nvolume" DECIMAL,
    "nhargajual" DECIMAL,
    "nsubtotal" DECIMAL,
    "ckdbbm" CHAR(5),
    "ckdtangki" CHAR(5),
    "vcopeator" TEXT,
    "dtgljam" TIMESTAMPTZ NOT NULL,
    "subah" SMALLINT,
    "sedit" SMALLINT,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_detail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_header" (
    "unit_id" SMALLINT NOT NULL,
    "ckdkb" CHAR(15) NOT NULL,
    "dtgl" DATE NOT NULL,
    "vcket" TEXT,
    "sjnstrans" SMALLINT,
    "ntotal" DECIMAL,
    "vcref" TEXT,
    "ctmpkas" TEXT,
    "sbatal" SMALLINT,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_header_pkey" PRIMARY KEY ("unit_id","ckdkb")
);

-- CreateTable
CREATE TABLE "cash_detail" (
    "id" BIGSERIAL NOT NULL,
    "unit_id" SMALLINT NOT NULL,
    "ckdkb" CHAR(15) NOT NULL,
    "ckdperk" CHAR(8),
    "njumlah" DECIMAL,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_detail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opname" (
    "id" BIGSERIAL NOT NULL,
    "unit_id" SMALLINT NOT NULL,
    "ckdopnbbm" CHAR(15) NOT NULL,
    "ckdtangki" CHAR(5) NOT NULL,
    "ckdbbm" CHAR(5),
    "dtaglopn" DATE,
    "nstockbk" DECIMAL,
    "nstockop" DECIMAL,
    "nvolselisih" DECIMAL,
    "dtgljam" TIMESTAMPTZ NOT NULL,
    "sbatal" SMALLINT,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "opname_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery" (
    "unit_id" SMALLINT NOT NULL,
    "ckdtrm" CHAR(15) NOT NULL,
    "dtgltrm" DATE,
    "dtgljam" TIMESTAMPTZ NOT NULL,
    "cnodo" TEXT,
    "nvoldo" DECIMAL,
    "nvolreal" DECIMAL,
    "nvolselisih" DECIMAL,
    "cnopol" TEXT,
    "vcsopir" TEXT,
    "ckdtangki" CHAR(5),
    "ckdbbm" CHAR(5),
    "sbatal" SMALLINT,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_pkey" PRIMARY KEY ("unit_id","ckdtrm")
);

-- CreateTable
CREATE TABLE "product" (
    "unit_id" SMALLINT NOT NULL,
    "ckdbbm" CHAR(5) NOT NULL,
    "vcnmbbm" TEXT,
    "nhrgjual" DECIMAL,
    "perk_map" JSONB,

    CONSTRAINT "product_pkey" PRIMARY KEY ("unit_id","ckdbbm")
);

-- CreateTable
CREATE TABLE "nozzle" (
    "unit_id" SMALLINT NOT NULL,
    "ckdnozzle" CHAR(5) NOT NULL,
    "ckdpompa" CHAR(5),
    "ckdtangki" CHAR(5),

    CONSTRAINT "nozzle_pkey" PRIMARY KEY ("unit_id","ckdnozzle")
);

-- CreateTable
CREATE TABLE "tangki" (
    "unit_id" SMALLINT NOT NULL,
    "ckdtangki" CHAR(5) NOT NULL,
    "ckdbbm" CHAR(5),
    "vcnmtangki" TEXT,

    CONSTRAINT "tangki_pkey" PRIMARY KEY ("unit_id","ckdtangki")
);

-- CreateTable
CREATE TABLE "account" (
    "unit_id" SMALLINT NOT NULL,
    "ckdperk" CHAR(8) NOT NULL,
    "vcnmperk" TEXT,
    "ckdinduk" CHAR(8),

    CONSTRAINT "account_pkey" PRIMARY KEY ("unit_id","ckdperk")
);

-- CreateIndex
CREATE UNIQUE INDEX "unit_code_key" ON "unit"("code");

-- CreateIndex
CREATE UNIQUE INDEX "unit_api_key_hash_key" ON "unit"("api_key_hash");

-- CreateIndex
CREATE INDEX "sales_header_unit_id_dtgljual_idx" ON "sales_header"("unit_id", "dtgljual");

-- CreateIndex
CREATE INDEX "sales_detail_unit_id_dtgljam_idx" ON "sales_detail"("unit_id", "dtgljam");

-- CreateIndex
CREATE UNIQUE INDEX "sales_detail_unit_id_ckdjualbbm_ckdnozzle_nurut_key" ON "sales_detail"("unit_id", "ckdjualbbm", "ckdnozzle", "nurut");

-- CreateIndex
CREATE INDEX "cash_header_unit_id_dtgl_idx" ON "cash_header"("unit_id", "dtgl");

-- CreateIndex
CREATE UNIQUE INDEX "cash_detail_unit_id_ckdkb_ckdperk_key" ON "cash_detail"("unit_id", "ckdkb", "ckdperk");

-- CreateIndex
CREATE INDEX "opname_unit_id_dtgljam_idx" ON "opname"("unit_id", "dtgljam");

-- CreateIndex
CREATE UNIQUE INDEX "opname_unit_id_ckdopnbbm_ckdtangki_key" ON "opname"("unit_id", "ckdopnbbm", "ckdtangki");

-- CreateIndex
CREATE INDEX "delivery_unit_id_dtgljam_idx" ON "delivery"("unit_id", "dtgljam");

