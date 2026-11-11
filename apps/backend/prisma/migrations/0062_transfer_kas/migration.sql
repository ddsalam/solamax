-- 0062_transfer_kas — transfer Kas Besar → bank DUA KAKI yang bertaut.
--
-- Rencana: docs/plans/2026-11-11-1638-feat-keuangan-transfer-kas-bank-dua-kaki-plan.md
-- (U1; R3, R6, R8; KTD1, KTD10).
--
--   app.cash_ledger  — + `transfer_uuid` (NULLABLE, tanpa default): dua kaki satu
--                      transfer Kas Besar → bank berbagi nilai ini.
--   app.reason_code  — + ADJ-FWD-TRANSFER (transfer dibukukan maju).
--
-- ⛔ KENAPA BUKAN `pasangan_uuid` (KTD1). `pasangan_uuid` berarti "pasangan
-- ANTAR UNIT" bagi sedikitnya sembilan pembaca: `voidMutasiKas` /
-- `barisSistemDari` (baris sistem antar_unit), penyempitan P15 → P14 di buku
-- besar, aturan pencocok bank "antar-unit", `batalkanCocok`, tutup bulan
-- "kaki_antar_unit", Pemantauan "balik_antar_unit", kueri antar unit, dan
-- halaman Pihak lawan. Memakainya untuk transfer DI DALAM satu unit akan salah
-- menggolongkan transfer itu di semua tempat tersebut. `lahir_dari_cocok_id`
-- juga bukan: ia milik kelompok cocok bank. Kolom baru mengikuti idiom KTD4
-- 0049 (satu uuid bersama di kedua kaki).
--
-- ⛔ YANG MENGIKAT:
--
-- 1. **Satu kaki per rekening per transfer** — unik parsial
--    (transfer_uuid, account_id). Ia juga kunci idempotensi (KTD5): dua kiriman
--    bersamaan dengan kunci klien yang sama gagal di INSERT kedua.
-- 2. **Transfer bukan pasangan antar unit** — CHECK keduanya tak boleh terisi.
-- 3. **Kategori kaki transfer tertutup** — hanya "Setoran ke Bank" (kaki Kas
--    Besar, kredit) dan "Pindah Buku" (kaki bank, debet), keduanya P6 → 1190.
--    Tak ada kategori baru; seed kategori TIDAK disentuh.
--
-- Aditif & idempoten: kolom NULLABLE, setiap baris lama bernilai NULL sehingga
-- kedua CHECK lolos tanpa `NOT VALID`. Kolom baru mewarisi GRANT tabel
-- `cash_ledger` (0029: SELECT, INSERT, UPDATE untuk dashboard_app) — tak ada
-- GRANT baru. RLS (FORCE) tak terpengaruh: tak ada baris unit yang di-seed.
-- Rollback: apps/backend/scripts/rollback-0062-transfer-kas.sql (TIDAK
-- dijalankan otomatis; pemilik, dengan persetujuan eksplisit).

ALTER TABLE "app"."cash_ledger"
    ADD COLUMN IF NOT EXISTS "transfer_uuid" UUID;

CREATE UNIQUE INDEX IF NOT EXISTS "cash_ledger_transfer_akun_uq"
    ON "app"."cash_ledger" ("transfer_uuid", "account_id")
    WHERE "transfer_uuid" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "cash_ledger_transfer_idx"
    ON "app"."cash_ledger" ("unit_id", "transfer_uuid")
    WHERE "transfer_uuid" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_ledger_transfer_bukan_antar_unit') THEN
    ALTER TABLE "app"."cash_ledger"
      ADD CONSTRAINT "cash_ledger_transfer_bukan_antar_unit" CHECK (
        "transfer_uuid" IS NULL OR "pasangan_uuid" IS NULL
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_ledger_transfer_kategori') THEN
    ALTER TABLE "app"."cash_ledger"
      ADD CONSTRAINT "cash_ledger_transfer_kategori" CHECK (
        "transfer_uuid" IS NULL OR "category_label" IN ('Setoran ke Bank', 'Pindah Buku')
      );
  END IF;
END
$$;

INSERT INTO "app"."reason_code" ("code", "label", "applies_to", "requires_target_date") VALUES
    ('ADJ-FWD-TRANSFER', 'Transfer Kas Besar ke bank (dibukukan maju)', 'adjustment', false)
ON CONFLICT ("code") DO NOTHING;
