-- ROLLBACK 0062_transfer_kas — ⛔ BELUM PERNAH DIJALANKAN (NOT EXECUTED).
--
-- Rencana: docs/plans/2026-11-11-1638-feat-keuangan-transfer-kas-bank-dua-kaki-plan.md
-- ("Rollout and rollback").
--
-- SIAPA & KAPAN: pemilik skema (peran `ingest`), HANYA dengan persetujuan
-- eksplisit owner, dan hanya bila kode transfer sudah di-revert. Bukan bagian
-- CD; tidak pernah dijalankan otomatis.
--
--   psql "<url ingest>" -v ON_ERROR_STOP=1 -f apps/backend/scripts/rollback-0062-transfer-kas.sql
--
-- PENJAGA: menolak (RAISE) bila masih ada SATU baris non-void yang membawa
-- `transfer_uuid` — membuang kolomnya akan memutus pasangan yang hidup, dan
-- void satu kaki kelak memisahkannya. Batalkan dulu transfernya di aplikasi
-- ("Batalkan transfer"), atau pertahankan kodenya dan perbaiki maju.
--
-- CADANGAN: baris yang pernah bertaut (termasuk yang sudah void) disalin ke
-- `app.cash_ledger_transfer_uuid_cadangan_0062` sebelum kolomnya dibuang, jadi
-- tautannya bisa dipulihkan. Tabel cadangan itu dibuang manual sesudah
-- diperiksa.
--
-- PEMULIHAN: direktori migrasi 0062 tetap (aturan checksum); memasang ulang
-- butuh migrasi susulan bernomor baru, lalu salin `transfer_uuid` dari tabel
-- cadangan.
--
-- `_prisma_migrations`: baris 0062 TIDAK disentuh skrip ini — karena kolomnya
-- hilang, owner menandai migrasinya lewat migrasi susulan, bukan dengan
-- menghapus riwayat.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- Penjaga sasaran: hanya basis data yang memang memuat 0062.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'app' AND table_name = 'cash_ledger' AND column_name = 'transfer_uuid'
  ) THEN
    RAISE EXCEPTION 'rollback-0062: kolom app.cash_ledger.transfer_uuid tidak ada — tak ada yang dibatalkan';
  END IF;
END
$$;

-- Penjaga data: nol pasangan transfer yang masih hidup. RLS (FORCE) berlaku
-- juga bagi pemilik — `app.unit_ids` diisi semua unit agar hitungannya jujur.
SELECT set_config('app.unit_ids', (SELECT string_agg(unit_id::text, ',') FROM public.unit), true);

DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM app.cash_ledger WHERE transfer_uuid IS NOT NULL AND NOT void;
  IF n > 0 THEN
    RAISE EXCEPTION 'rollback-0062 DITOLAK: % baris non-void masih membawa transfer_uuid — batalkan transfernya dulu', n;
  END IF;
END
$$;

-- Cadangan tautan (termasuk yang void) sebelum kolomnya dibuang.
CREATE TABLE IF NOT EXISTS app.cash_ledger_transfer_uuid_cadangan_0062 AS
  SELECT id, unit_id, account_id, transfer_uuid, void
    FROM app.cash_ledger
   WHERE transfer_uuid IS NOT NULL;

ALTER TABLE app.cash_ledger DROP CONSTRAINT IF EXISTS cash_ledger_transfer_kategori;
ALTER TABLE app.cash_ledger DROP CONSTRAINT IF EXISTS cash_ledger_transfer_bukan_antar_unit;
DROP INDEX IF EXISTS app.cash_ledger_transfer_idx;
DROP INDEX IF EXISTS app.cash_ledger_transfer_akun_uq;
ALTER TABLE app.cash_ledger DROP COLUMN IF EXISTS transfer_uuid;

-- Kode alasan dibuang HANYA bila tak dirujuk satu baris pun (FK 0049 juga
-- akan menolak, tetapi pesan yang menyebut sebabnya lebih baik).
DELETE FROM app.reason_code r
 WHERE r.code = 'ADJ-FWD-TRANSFER'
   AND NOT EXISTS (SELECT 1 FROM app.cash_ledger l WHERE l.alasan_maju = r.code);

COMMIT;
