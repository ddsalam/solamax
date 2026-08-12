-- 0024_manual_entry_workflow — kolom aditif untuk app.manual_entry (B8, §10.8).
--
-- 🔴 TABEL INI DIPAKAI PRODUKSI 7 UNIT SETIAP HARI. Karena itu:
--   · seluruh kolom baru NULLABLE, kecuali `status` yang NOT NULL DEFAULT
--     (Postgres ≥11 menambah kolom ber-DEFAULT tanpa menulis ulang tabel);
--   · NOL backfill NILAI — tak satu pun baris lama diberi kategori atau akun.
--
-- ⛔ `operational_category` NULL berarti "BELUM BERKATEGORI", bukan nol dan
-- bukan "Lain-Lain". JANGAN PERNAH menurunkannya dari `keterangan` — itu
-- menebak milik pengawas (§2.1), dan tebakan yang tersimpan tak bisa dibedakan
-- dari isian sungguhan setelahnya.
--
-- ⛔ `status` di-backfill `submitted`, BUKAN `closed`. Immutabilitas datang
-- bersama `day_close`; ia tidak dipasang MUNDUR ke hari yang tak pernah
-- melewati gerbangnya. Menandai masa lalu 'closed' berarti mengklaim ribuan
-- hari sudah disahkan padahal gerbangnya belum ada.
--
-- `accounting_account` DISIMPAN (diisi dari category_account_map saat submit,
-- lalu beku), bukan diturunkan saat baca (§2.1) — supaya `reclassification`
-- tetap append-only dan tak pernah menyentuh baris asli. Akun efektif =
-- reklasifikasi non-void terakhir bila ada, kalau tidak nilai beku ini.
--
-- ⚠️ Mode transisi (§10.8): kategori OPSIONAL dulu, wajib setelah pengawas
-- terbiasa. Karena itu TIDAK ada CHECK "kategori wajib" di sini. Memaksa wajib
-- di hari pertama menghasilkan pilihan asal, dan data asal lebih buruk daripada
-- data kosong — kosong jujur mengatakan "belum berkategori".
--
-- Idempoten / aman re-run.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'manual_entry_status' AND n.nspname = 'app'
  ) THEN
    CREATE TYPE "app"."manual_entry_status" AS ENUM ('draft', 'submitted', 'returned', 'closed');
  END IF;
END
$$;

ALTER TABLE "app"."manual_entry"
    ADD COLUMN IF NOT EXISTS "operational_category"  TEXT,
    ADD COLUMN IF NOT EXISTS "accounting_account"    TEXT,
    ADD COLUMN IF NOT EXISTS "status"                "app"."manual_entry_status"
        NOT NULL DEFAULT 'submitted',
    ADD COLUMN IF NOT EXISTS "submitted_at"          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "reviewed_by_user_id"   INTEGER,
    ADD COLUMN IF NOT EXISTS "reviewed_at"           TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "returned_reason"       TEXT;

-- `Return for Correction` (§2.3) harus menyebut alasannya; status lain tidak
-- boleh membawa alasan-pengembalian yang tertinggal dari siklus sebelumnya.
ALTER TABLE "app"."manual_entry" DROP CONSTRAINT IF EXISTS "manual_entry_returned_reason";
ALTER TABLE "app"."manual_entry" ADD CONSTRAINT "manual_entry_returned_reason" CHECK (
    ("status" = 'returned') = (btrim(COALESCE("returned_reason", '')) <> '')
);

CREATE INDEX IF NOT EXISTS "manual_entry_status_idx"
    ON "app"."manual_entry"("unit_id", "business_date", "status");
-- Daftar kerja Finance: entri yang belum berkategori (§10.8 mode transisi).
CREATE INDEX IF NOT EXISTS "manual_entry_uncategorized_idx"
    ON "app"."manual_entry"("unit_id", "business_date")
    WHERE "operational_category" IS NULL AND NOT "void";

-- ---------------------------------------------------------------------------
-- VOID DITOLAK SETELAH HARI DITUTUP (§10.8 aturan 4) — ditegakkan di DB.
--
-- Kenapa TRIGGER dan bukan CHECK: aturannya tentang PERPINDAHAN
-- (`void` false→true saat status sudah `closed`), sedangkan CHECK hanya melihat
-- baris akhir. CHECK `NOT void OR status <> 'closed'` akan ikut melarang baris
-- yang sudah di-void SEBELUM hari ditutup — itu larangan yang berbeda, dan
-- bukan yang diminta.
--
-- Setelah hari ditutup, satu-satunya jalan adalah `Adjust/Reverse` (§2.3):
-- entri BARU yang bertaut, bukan penghapusan yang menyamar.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "app"."manual_entry_block_void_after_close"()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF NEW."void" AND NOT OLD."void" AND OLD."status" = 'closed' THEN
    RAISE EXCEPTION
      'void ditolak: hari sudah ditutup (manual_entry %). Pakai Adjust/Reverse.', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS "manual_entry_no_void_after_close" ON "app"."manual_entry";
CREATE TRIGGER "manual_entry_no_void_after_close"
    BEFORE UPDATE ON "app"."manual_entry"
    FOR EACH ROW
    EXECUTE FUNCTION "app"."manual_entry_block_void_after_close"();

-- ⚠️ Yang trigger ini TIDAK jaga, sebutkan apa adanya: immutabilitas PENUH
-- setelah closing (§2.2 — nominal, tanggal, uraian pun tak boleh berubah)
-- belum ditegakkan. Ia menunggu `day_close`, yang di luar lingkup Tugas 2.
-- Hari ini hanya jalur VOID yang tertutup.
