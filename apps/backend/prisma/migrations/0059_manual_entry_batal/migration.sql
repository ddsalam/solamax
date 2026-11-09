-- 0059_manual_entry_batal — rencana 2026-11-07 (Batalkan & Balik baris pintu
-- Finance), U2 / KTD4. Rilis 1.
--
-- Finance kini bisa MEMBATALKAN baris biaya/pendapatan lain-lain pintu Finance
-- selama hari belum ditutup. Pembatalan tetap void (UPDATE, bukan DELETE —
-- 0007), tetapi kini membawa ALASAN: satu kode dari daftar tertutup grup baru
-- `void` dan alasan tertulis. Tanpa kolom ini, "siapa membatalkan" terekam
-- (voided_by_user_id) tetapi "mengapa" hilang — dan alasan itulah yang dibaca
-- Pemantauan dan layar blok 4.
--
-- ⛔ Yang SENGAJA tidak ditegakkan di DB: "alasan WAJIB untuk setiap void".
-- Void lain sah tanpa alasan dan sudah ada jalurnya: pembatalan baris oleh
-- pengawas (manual-entry-actions) dan kaskade pembatalan mutasi kas → beban
-- (kas-actions, cocok-bank-actions). Kewajibannya untuk Batalkan Finance hidup
-- di satu jalur tulisnya (`batal-balik-tulis.ts`). Yang DB tegakkan: kode
-- berasal dari grup `void` (FK komposit + CHECK, idiom 0027/0049), pasangan
-- kode↔alasan utuh, dan alasan hanya ada pada baris yang memang void.
--
-- Trigger 0024/0026/0027 TIDAK disentuh: UPDATE ke hari yang sudah ditutup tetap
-- ditolak 0026, termasuk UPDATE kolom-kolom baru ini.
--
-- Urutan deploy (HOUSE RULE): migrate-deploy DULU, baru image dashboard.
-- Idempoten / aman re-run. Aditif: kolom NULL, tanpa backfill.

-- ---------------------------------------------------------------------------
-- 1. Grup kode alasan `void` — daftar tertutup
-- ---------------------------------------------------------------------------
ALTER TABLE "app"."reason_code" DROP CONSTRAINT IF EXISTS "reason_code_applies_to";
ALTER TABLE "app"."reason_code" ADD CONSTRAINT "reason_code_applies_to" CHECK (
    "applies_to" IN ('closing', 'adjustment', 'reclass', 'void')
);

INSERT INTO "app"."reason_code" ("code", "label", "applies_to", "requires_target_date") VALUES
    ('VOID-DUP',     'Entri ganda',                                 'void', false),
    ('VOID-SALAH',   'Salah unit/tanggal — dicatat ulang di tempat benar', 'void', false),
    ('VOID-NOMINAL', 'Nominal salah — dicatat ulang',               'void', false),
    ('VOID-LAIN',    'Lain-lain (lihat alasan tertulis)',           'void', false)
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Alasan pembatalan di baris manual_entry
-- ---------------------------------------------------------------------------
ALTER TABLE "app"."manual_entry" ADD COLUMN IF NOT EXISTS "void_reason_code" TEXT;
-- Bayangan `reason_code.applies_to` — dikunci FK komposit + CHECK supaya hanya
-- kode grup `void` yang bisa dipakai (kode `closing` tak bisa dipinjam).
ALTER TABLE "app"."manual_entry" ADD COLUMN IF NOT EXISTS "void_reason_applies_to" TEXT;
ALTER TABLE "app"."manual_entry" ADD COLUMN IF NOT EXISTS "void_alasan" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manual_entry_void_reason_fk') THEN
    ALTER TABLE "app"."manual_entry"
      ADD CONSTRAINT "manual_entry_void_reason_fk"
      FOREIGN KEY ("void_reason_code", "void_reason_applies_to")
      REFERENCES "app"."reason_code"("code", "applies_to");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manual_entry_void_reason_grup') THEN
    ALTER TABLE "app"."manual_entry"
      ADD CONSTRAINT "manual_entry_void_reason_grup" CHECK (
        "void_reason_applies_to" IS NULL OR "void_reason_applies_to" = 'void'
      );
  END IF;
  -- Kode, bayangannya, dan alasan tertulis datang BERSAMA atau tidak sama sekali.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manual_entry_void_reason_pasangan') THEN
    ALTER TABLE "app"."manual_entry"
      ADD CONSTRAINT "manual_entry_void_reason_pasangan" CHECK (
        ("void_reason_code" IS NULL) = ("void_reason_applies_to" IS NULL)
        AND ("void_reason_code" IS NULL) = ("void_alasan" IS NULL)
      );
  END IF;
  -- Alasan hanya pada baris yang void, dan tak pernah kosong/spasi.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manual_entry_void_reason_isi') THEN
    ALTER TABLE "app"."manual_entry"
      ADD CONSTRAINT "manual_entry_void_reason_isi" CHECK (
        "void_reason_code" IS NULL OR ("void" AND btrim("void_alasan") <> '')
      );
  END IF;
END
$$;
