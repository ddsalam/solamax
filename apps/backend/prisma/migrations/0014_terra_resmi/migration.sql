-- Tera RESMI — domain baru. Sumber ledger EasyMax `tr_hterra ⋈ tr_dterra` (BUKAN
-- tabel `tera` log mentah, yang TIDAK dipakai laporan mana pun setelah unifikasi).
-- SUMBER TUNGGAL semua angka terra laporan: Rincian "Terra/Nozzle Test" (B), seksi
-- TERRA per-produk, kolom "Tera (L)" Laporan Operasional, dan net-sales G/L
-- (NetSales = gross − Σ nvolume RESMI). Grup tanggal-bisnis = DTGLTERRA (= DTGLJUAL
-- jurnal penjualan tertaut `ckdjualbbm`). Filter laporan: sbatal = 0.
-- Rekon EKSAK 8/8 hari ke RINCIAN PENJUALAN + RESUME OPERASIONAL PDF (probe16,
-- 2026-06-29): 17/6 1.106.200 (Plt 61,27/Dex 21), 24/6 350.982, 26/6 349.650,
-- 27/6 445.200; 14/15/16/18 = 0.
--
-- ADDITIVE (CREATE TABLE saja; TANPA ALTER TYPE / TANPA menyentuh tabel `tera`) →
-- aman dijalankan out-of-band sebelum deploy image (migrate-before-image).
-- UPSERT by natural key (unit_id, ckdterra, ckdnozzle) → idempoten saat full-sync
-- berulang (REPLACE antar-siklus; tangkap koreksi/flip SBATAL + sesi back-dated).

-- CreateTable terra_resmi — PK natural (unit_id, ckdterra, ckdnozzle).
CREATE TABLE "public"."terra_resmi" (
    "unit_id" SMALLINT NOT NULL,
    "business_date" DATE NOT NULL,
    "ckdterra" VARCHAR(15) NOT NULL,
    "ckdnozzle" VARCHAR(5) NOT NULL,
    "nshift" SMALLINT,
    "ckdtangki" CHAR(5),
    "ckdbbm" CHAR(5),
    "nvolume" DECIMAL,
    "nharga" DECIMAL,
    "ntotal" DECIMAL,
    "dtgljam" TIMESTAMPTZ NOT NULL,
    "ckdjualbbm" VARCHAR(15),
    "sbatal" SMALLINT,
    "ingested_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terra_resmi_pkey" PRIMARY KEY ("unit_id","ckdterra","ckdnozzle")
);

-- CreateIndex — akses laporan per (unit, tanggal-bisnis).
CREATE INDEX "terra_resmi_unit_id_business_date_idx" ON "public"."terra_resmi"("unit_id", "business_date");

-- Grant SELECT ke role app dashboard (pola migrasi 0006/0013). Hanya SELECT:
-- dashboard_app TAK boleh menulis ke mirror EasyMax. Di dev lokal role bisa belum
-- ada → jangan gagalkan migrasi.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT ON "public"."terra_resmi" TO dashboard_app;
  END IF;
END $$;
