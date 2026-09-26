-- 0043_edc_per_shift — penjualan EDC hari-H masuk EDC Penampungan, per shift × bank.
--
-- ⛔ KEPUTUSAN OWNER 26 Sep 2026 (KEUANGAN-HARIAN §10.25):
--   · nominal = BRUTO dari EasyMax (tabel `edc`), BUKAN ketikan;
--   · pengawas MENCOCOKKAN dengan slip settlement per shift — slip adalah
--     PEMERIKSA, bukan sumber;
--   · staf Keuangan MENYETUJUI posting → Debet EDC Penampungan;
--   · granularitas PER SHIFT × acquirer;
--   · foto slip OPSIONAL sekarang, wajib kelak (kolomnya disiapkan);
--   · peta kode kartu EasyMax → bank diisi Head of Finance / super admin /
--     Direksi (owner) / pengawas unit itu.
--
-- Sebelum ini EDC Penampungan hanya pernah DIKREDIT (jurnal pencairan H+1,
-- 0030) — sisi masuknya tak dicatat siapa pun, sehingga akunnya selalu minus.

-- 1 · Peta kode kartu EasyMax → acquirer/bank, per unit.
CREATE TABLE IF NOT EXISTS "app"."edc_kartu_acquirer" (
    "unit_id"            SMALLINT NOT NULL,
    "ckdkartu"           TEXT NOT NULL,
    "acquirer"           TEXT NOT NULL,
    "updated_by_user_id" INTEGER NOT NULL,
    "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "edc_kartu_acquirer_pkey" PRIMARY KEY ("unit_id", "ckdkartu"),
    CONSTRAINT "edc_kartu_acquirer_kode_isi" CHECK (btrim("ckdkartu") <> '' AND "ckdkartu" = btrim("ckdkartu")),
    CONSTRAINT "edc_kartu_acquirer_isi" CHECK (btrim("acquirer") <> '')
);

-- 2 · Cek slip settlement oleh pengawas, per (tanggal, shift, acquirer).
CREATE TABLE IF NOT EXISTS "app"."edc_shift_cek" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"            SMALLINT NOT NULL,
    "business_date"      DATE NOT NULL,
    "cshift"             TEXT NOT NULL,
    "acquirer"           TEXT NOT NULL,
    -- Bruto EasyMax SAAT dicocokkan. Bila data EasyMax berubah sesudahnya,
    -- persetujuan ditolak sampai pengawas mencocokkan ulang.
    "easymax_rp"         DECIMAL(17,2) NOT NULL,
    "slip_rp"            DECIMAL(17,2) NOT NULL,
    -- Opsional sekarang (keputusan 26-09), wajib kelak.
    "slip_foto_ref"      TEXT,
    "catatan"            TEXT,
    "checked_by_user_id" INTEGER NOT NULL,
    "checked_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Diisi Keuangan saat menyetujui bila slip ≠ EasyMax.
    "reason_code"        TEXT,
    "reason_applies_to"  TEXT,
    "void"               BOOLEAN NOT NULL DEFAULT false,
    "voided_by_user_id"  INTEGER,
    "voided_at"          TIMESTAMPTZ,
    CONSTRAINT "edc_shift_cek_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "edc_shift_cek_unit_uq" UNIQUE ("id", "unit_id"),
    CONSTRAINT "edc_shift_cek_easymax_positif" CHECK ("easymax_rp" > 0),
    CONSTRAINT "edc_shift_cek_slip_nonneg" CHECK ("slip_rp" >= 0),
    CONSTRAINT "edc_shift_cek_shift_isi" CHECK (btrim("cshift") <> ''),
    CONSTRAINT "edc_shift_cek_acquirer_isi" CHECK (btrim("acquirer") <> ''),
    CONSTRAINT "edc_shift_cek_reason_fk" FOREIGN KEY ("reason_code", "reason_applies_to")
        REFERENCES "app"."reason_code"("code", "applies_to"),
    CONSTRAINT "edc_shift_cek_reason_closing" CHECK (
        "reason_applies_to" IS NULL OR "reason_applies_to" = 'closing'
    ),
    CONSTRAINT "edc_shift_cek_reason_pair" CHECK (
        ("reason_code" IS NULL) = ("reason_applies_to" IS NULL)
    ),
    CONSTRAINT "edc_shift_cek_void_audit" CHECK (
        "void" = ("voided_at" IS NOT NULL) AND "void" = ("voided_by_user_id" IS NOT NULL)
    )
);
-- Satu cek AKTIF per (unit, tanggal, shift, acquirer). Mencocokkan ulang =
-- batalkan yang lama lalu tulis yang baru — riwayat tetap utuh.
CREATE UNIQUE INDEX IF NOT EXISTS "edc_shift_cek_aktif_uq"
    ON "app"."edc_shift_cek"("unit_id", "business_date", "cshift", "acquirer") WHERE NOT "void";
CREATE INDEX IF NOT EXISTS "edc_shift_cek_tanggal_idx"
    ON "app"."edc_shift_cek"("unit_id", "business_date") WHERE NOT "void";

-- 3 · Posting ke buku: satu baris cash_ledger (Debet EDC Penampungan) per cek.
ALTER TABLE "app"."cash_ledger"
    ADD COLUMN IF NOT EXISTS "edc_shift_cek_id" UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_ledger_edc_shift_cek_fk') THEN
    ALTER TABLE "app"."cash_ledger"
      ADD CONSTRAINT "cash_ledger_edc_shift_cek_fk"
      FOREIGN KEY ("edc_shift_cek_id") REFERENCES "app"."edc_shift_cek"("id");
  END IF;
END
$$;
-- Satu posting AKTIF per cek: persetujuan ganda (dua klik, dua tab) ditolak DB.
CREATE UNIQUE INDEX IF NOT EXISTS "cash_ledger_edc_shift_cek_uq"
    ON "app"."cash_ledger"("edc_shift_cek_id")
    WHERE "edc_shift_cek_id" IS NOT NULL AND NOT "void";

-- 4 · Kategori mutasi untuk posting ini (daftar tertutup 0029).
INSERT INTO "app"."cash_mutation_category" ("side", "label") VALUES
    ('debet', 'Penjualan EDC')
ON CONFLICT ("side", "label") DO NOTHING;

-- 5 · Hak akses: VOID-only, tanpa DELETE. Peta kartu boleh diperbarui (UPDATE)
--     — ia konfigurasi, bukan transaksi; pelaku & waktunya tersimpan di barisnya.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "app"."edc_kartu_acquirer" TO dashboard_app;
    REVOKE DELETE ON "app"."edc_kartu_acquirer" FROM dashboard_app;
    GRANT SELECT, INSERT, UPDATE ON "app"."edc_shift_cek" TO dashboard_app;
    REVOKE DELETE ON "app"."edc_shift_cek" FROM dashboard_app;
  END IF;
END
$$;

-- 6 · RLS unit-scoped (§4.1b) — predikat IDENTIK dengan 0016.
DO $$
DECLARE
  predicate text := $p$unit_id = ANY (ARRAY(
      SELECT tok::int
      FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
      WHERE tok ~ '^-?[0-9]+$'
  ))$p$;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['edc_kartu_acquirer', 'edc_shift_cek'] LOOP
    EXECUTE format('ALTER TABLE "app".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "app".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS unit_scope ON "app".%I', t);
    EXECUTE format(
      'CREATE POLICY unit_scope ON "app".%I USING (%s) WITH CHECK (%s)',
      t, predicate, predicate
    );
  END LOOP;
END
$$;
