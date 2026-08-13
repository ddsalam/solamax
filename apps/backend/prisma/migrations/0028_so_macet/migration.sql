-- 0028_so_macet — penandaan SO MACET oleh Finance. Keputusan owner B6
-- (KEUANGAN-HARIAN.md §10.6): `SOValue` memakai **`sisa − sisa_macet`**, dan
-- definisi "macet" adalah **penandaan MANUAL Finance**.
--
-- ⛔ AMBANG HARI HANYA MENGUSULKAN KANDIDAT, TIDAK MEMUTUSKAN. Karena itu tabel
-- ini tidak punya kolom ambang apa pun, dan tidak ada baris yang lahir sendiri.
--
-- Kenapa manual: ambang otomatis akan MENGHAPUS SO yang sebenarnya masih ditagih,
-- dan MENGHIDUPKAN KEMBALI SO mati begitu ambangnya digeser. Penandaan manual
-- membuat penghapusan itu punya PEMILIK dan TANGGAL — dan bisa dibatalkan
-- (void) tanpa mengarang ulang sejarah.
--
-- Kandidat pertama yang sudah diketahui (bukti T3, Bakau):
--   · CNOSO 4023445216 · BB-03 Solar · tebus 2023-01-23 · 32.000 dipesan / 24.000 diterima → sisa 8.000
--   · CNOSO 4027089474 · BB-03 Solar · tebus 2023-11-24 · 40.000 dipesan / 32.000 diterima → sisa 8.000
--   Keduanya = Rp 105.074.482, konstan di 10/10 tanggal T3.
--   · SO PREMIUM (BB-01) 1,12 juta liter — tak punya harga beli, jadi nilainya
--     Rp 0; ia mencolok di VOLUME, bukan di rupiah.
-- ⚠️ TIDAK di-seed. Menandai SO milik unit sungguhan adalah keputusan Finance,
-- bukan keputusan migrasi.
--
-- Idempoten / aman re-run.

CREATE TABLE IF NOT EXISTS "app"."so_macet" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"     SMALLINT NOT NULL,
    -- Kunci SO EasyMax. Disimpan ter-normalisasi (lower+trim) sebab tautan
    -- CNOSO di repo ini case-insensitive (temuan 2026-08-04) — menyimpannya
    -- apa adanya membuat penandaan meleset dari SO yang dimaksud.
    "cnoso"       TEXT NOT NULL,
    "ckdbbm"      TEXT NOT NULL,

    "alasan"      TEXT NOT NULL,
    "marked_by_user_id" INTEGER NOT NULL,
    "marked_at"   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    "void"        BOOLEAN NOT NULL DEFAULT false,
    "voided_by_user_id" INTEGER,
    "voided_at"   TIMESTAMPTZ,

    CONSTRAINT "so_macet_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "so_macet_alasan_isi" CHECK (btrim("alasan") <> ''),
    -- Penandaan tanpa alasan tak bisa ditinjau ulang; penandaan ter-normalisasi
    -- salah huruf tak akan pernah cocok dengan SO-nya.
    CONSTRAINT "so_macet_cnoso_normal" CHECK ("cnoso" = lower(btrim("cnoso"))),
    CONSTRAINT "so_macet_void_audit" CHECK (
        "void" = ("voided_at" IS NOT NULL) AND "void" = ("voided_by_user_id" IS NOT NULL)
    )
);

-- Satu penandaan AKTIF per (unit, SO, produk). Membatalkan = void lalu tandai
-- ulang — jejaknya tersimpan, bukan tertimpa.
CREATE UNIQUE INDEX IF NOT EXISTS "so_macet_aktif_uq"
    ON "app"."so_macet"("unit_id", "cnoso", "ckdbbm") WHERE NOT "void";

CREATE INDEX IF NOT EXISTS "so_macet_unit_idx"
    ON "app"."so_macet"("unit_id") WHERE NOT "void";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "app"."so_macet" TO dashboard_app;
    REVOKE DELETE ON "app"."so_macet" FROM dashboard_app;
  END IF;
END
$$;

-- RLS unit-scoped. Cabang NULL DIPUTUSKAN SADAR: **TIDAK ADA** — penandaan SO
-- selalu milik satu unit (kolomnya NOT NULL). Predikat disalin PERSIS dari 0016
-- (§4.1b).
DO $$
DECLARE
  predicate text := $p$unit_id = ANY (ARRAY(
      SELECT tok::int
      FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
      WHERE tok ~ '^-?[0-9]+$'
  ))$p$;
BEGIN
  EXECUTE 'ALTER TABLE "app"."so_macet" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "app"."so_macet" FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS unit_scope ON "app"."so_macet"';
  EXECUTE format(
    'CREATE POLICY unit_scope ON "app"."so_macet" USING (%s) WITH CHECK (%s)',
    predicate, predicate
  );
END
$$;
