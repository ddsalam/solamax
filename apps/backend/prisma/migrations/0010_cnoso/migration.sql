-- Per-SO open-balance (logika F12): link penerimaan↔penebusan lewat No. SO
-- Pertamina (CNOSO), ada di KEDUA tabel sumber (tr_terimabbm & tr_htebus).
-- ADDITIVE: ADD COLUMN tanpa default → instan, tanpa rewrite tabel, tanpa
-- ALTER TYPE → aman dijalankan out-of-band di staging live. Baris lama ber-cnoso
-- NULL sampai di-backfill ulang (reset watermark delivery+tebus di agent).

-- AlterTable
ALTER TABLE "public"."delivery" ADD COLUMN "cnoso" CHAR(20);

-- AlterTable
ALTER TABLE "public"."tebus_header" ADD COLUMN "cnoso" CHAR(20);
