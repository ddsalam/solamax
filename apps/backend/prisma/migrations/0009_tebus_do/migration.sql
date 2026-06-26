-- Penebusan DO — domain baru. Sumber tr_htebus ⋈ tr_dtebus (watermark DTGLTBS,
-- kolom DATE). Basis kolom "Penebusan DO" + running-balance DO Awal/Sisa di
-- Laporan DO Harian. ADDITIVE (CREATE TABLE saja; TANPA ALTER TYPE → aman dijalankan
-- out-of-band sebelum deploy image). CATATAN: tr_dtebus.NSISA = kolom mati
-- (selalu = NVOLUME; EasyMax hitung sisa live) → TIDAK disimpan.

-- CreateTable tebus_header — UPSERT by (unit_id, ckdtbs).
CREATE TABLE "public"."tebus_header" (
    "unit_id" SMALLINT NOT NULL,
    "ckdtbs" CHAR(15) NOT NULL,
    "dtgltbs" DATE NOT NULL,
    "sbatal" SMALLINT,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tebus_header_pkey" PRIMARY KEY ("unit_id","ckdtbs")
);

-- CreateTable tebus_detail — surrogate id; UPSERT by (unit_id, ckdtbs, ckdbbm).
CREATE TABLE "public"."tebus_detail" (
    "id" BIGSERIAL NOT NULL,
    "unit_id" SMALLINT NOT NULL,
    "ckdtbs" CHAR(15) NOT NULL,
    "ckdbbm" CHAR(5),
    "nvolume" DECIMAL,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tebus_detail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tebus_header_unit_id_dtgltbs_idx" ON "public"."tebus_header"("unit_id", "dtgltbs");

-- CreateIndex
CREATE UNIQUE INDEX "tebus_detail_unit_id_ckdtbs_ckdbbm_key" ON "public"."tebus_detail"("unit_id", "ckdtbs", "ckdbbm");
