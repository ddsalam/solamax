-- 0053_manual_entry_kas — beban/pendapatan pintu Finance yang LAHIR BERSAMA
-- baris kasnya (rencana 2026-10-29 U11; R9, R21, R27; KTD6).
--
-- Rencana: docs/plans/2026-10-29-1719-feat-keuangan-pihak-lawan-penebusan-impor-bank-plan.md
--
--   app.manual_entry — + `cash_ledger_id`: baris kas bank yang MEREALISASIKAN
--                      beban (`pengeluaran`) atau pendapatan lain-lain ini.
--
-- ⛔ KENAPA KOLOM INI PERLU (temuan U6, dibuktikan ulang di U11):
--
-- Laba harian hanya membaca `manual_entry` (pengeluaran / pendapatan_lain) dan
-- `noncash_expense`. Baris kas berkategori "Biaya Operasional", "Management
-- Fee", atau "Pendapatan Lain-Lain" adalah REALISASI tunainya
-- (`PETA_KATEGORI_ARUS_KAS[...].dariBukuKas = false`) — ia menggeser kas, tidak
-- menggeser laba. Klasifikasi mutasi bank sebagai beban (U11) dan pecahan
-- bunga ke beban (U3) karenanya WAJIB menulis dua baris dalam satu transaksi:
-- baris kas + `manual_entry` pintu Finance (§2.4, `tambahBiayaFinance`). Tanpa
-- tautan, membatalkan baris kasnya (void / batalkan cocok) meninggalkan beban
-- yang tetap mengurangi laba sementara kasnya kembali — langkah neraca melompat
-- dan tak ada yang tahu baris mana pasangannya.
--
-- 1. **FK komposit `(cash_ledger_id, unit_id)`** (idiom 0019/0029/0052): beban
--    dan baris kasnya milik unit yang SAMA. FK Postgres mengabaikan RLS.
-- 2. **Hanya pintu Finance** (`source_door = 'finance'`): baris pengawas adalah
--    fakta Rincian Penjualan (§2.1) dan tak pernah dilahirkan baris kas.
--    `NOT VALID` seperti 0042 — semua baris lama NULL, jadi tak ada yang
--    dilanggar, dan ALTER tak perlu memindai tabel produksi.
-- 3. **Paling banyak satu beban AKTIF per baris kas** — partial unique.
--
-- Hak `dashboard_app` atas manual_entry sudah ada (0007/0024); kolom baru
-- ikut hak tabelnya. RLS manual_entry sudah ada (0016) — tanpa tabel baru.
--
-- Idempoten / aman re-run.

ALTER TABLE "app"."manual_entry"
    ADD COLUMN IF NOT EXISTS "cash_ledger_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manual_entry_cash_ledger_fk') THEN
    ALTER TABLE "app"."manual_entry"
      ADD CONSTRAINT "manual_entry_cash_ledger_fk"
      FOREIGN KEY ("cash_ledger_id", "unit_id") REFERENCES "app"."cash_ledger"("id", "unit_id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manual_entry_cash_ledger_finance') THEN
    ALTER TABLE "app"."manual_entry"
      ADD CONSTRAINT "manual_entry_cash_ledger_finance" CHECK (
        "cash_ledger_id" IS NULL OR "source_door" = 'finance'
      ) NOT VALID;
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "manual_entry_cash_ledger_aktif_uq"
    ON "app"."manual_entry"("cash_ledger_id") WHERE "cash_ledger_id" IS NOT NULL AND NOT "void";
