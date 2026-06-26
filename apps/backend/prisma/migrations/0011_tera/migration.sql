-- Tera/kalibrasi nozzle — domain baru. Sumber tabel EasyMax `tera` (BUKAN
-- `tr_tera` yang kosong). Watermark TanggalJam (datetime). Basis kolom "Tera (L)"
-- + komponen Penjualan_BERSIH (jual KOTOR − tera) di perhitungan Gain/Losses
-- harian (selaras RESUME OPERASIONAL). ADDITIVE (CREATE TABLE saja; TANPA ALTER
-- TYPE → aman dijalankan out-of-band sebelum deploy image).
--
-- ckdbbm di-resolve di agent (join MySQL `tera → tm_tangki → tm_bbm` by name).
-- Identifier mentah (no_nozzle/id_pompa/sa_tangki) disimpan untuk audit + kunci
-- unik. UPSERT by (unit_id, tanggaljam, no_nozzle) → idempoten saat re-pull window.

-- CreateTable tera — surrogate id; UPSERT by (unit_id, tanggaljam, no_nozzle).
CREATE TABLE "public"."tera" (
    "id" BIGSERIAL NOT NULL,
    "unit_id" SMALLINT NOT NULL,
    "business_date" DATE NOT NULL,
    "tanggaljam" TIMESTAMPTZ NOT NULL,
    "no_nozzle" VARCHAR(4),
    "id_pompa" SMALLINT,
    "sa_tangki" SMALLINT,
    "jenis" SMALLINT,
    "ckdbbm" CHAR(5),
    "liter" DECIMAL,
    "total" DECIMAL,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tera_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tera_unit_id_tanggaljam_no_nozzle_key" ON "public"."tera"("unit_id", "tanggaljam", "no_nozzle");

-- CreateIndex
CREATE INDEX "tera_unit_id_business_date_idx" ON "public"."tera"("unit_id", "business_date");
