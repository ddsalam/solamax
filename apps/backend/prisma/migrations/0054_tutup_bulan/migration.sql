-- 0054_tutup_bulan — penutupan BULAN per unit + koreksi susulan tutup hari.
--
-- Rencana: docs/plans/2026-10-29-1719-feat-keuangan-pihak-lawan-penebusan-impor-bank-plan.md
-- (U12; R24, R25, R32; KTD14, KTD15).
--
--   app.tutup_bulan — satu baris per (unit, bulan) yang SUDAH ditutup HoF.
--                     Ketiadaan baris = bulan terbuka. Syarat R25 diputuskan
--                     SATU fungsi murni (`tutup-bulan-model.ts`); tabel ini
--                     hanya mencatat bahwa vonisnya lolos, siapa, dan kapan.
--   app.day_close   — + `koreksi_susulan_rp`: pengaruh baris yang dibukukan
--                     hari itu bertanggal asal lebih awal (KTD15), DI SAMPING
--                     `difference_rp` (yang dinilai tangga toleransi §3.2).
--
-- ⛔ KEPUTUSAN YANG MENGIKAT:
--
-- 1. **Bulan tertutup itu beku.** `dashboard_app` hanya SELECT + INSERT; UPDATE
--    dan DELETE di-REVOKE. Tak ada jalur "buka ulang bulan" — koreksi sesudah
--    bulan ditutup dibukukan maju lewat R28 (hari-harinya sudah tertutup).
-- 2. **`bulan` = hari pertama bulan** (CHECK). Dua penulisan untuk bulan yang
--    sama dengan tanggal berbeda (1 Okt vs 15 Okt) tak boleh lolos PRIMARY KEY.
-- 3. **`koreksi_susulan_rp` NULLABLE, baris lama TIDAK disentuh.** Hari yang
--    sudah ditutup tak pernah dihitung ulang (§10.15) — mengisi kolom ini
--    untuk baris lama berarti menulis ulang sejarah. NULL = "tak tercatat
--    (ditutup sebelum 0054)", bukan nol. Tier tetap fungsi `difference_rp`
--    (CHECK 0026 tak diubah): koreksi susulan tidak ikut dinilai (R32).
--
-- Idempoten / aman re-run.

CREATE TABLE IF NOT EXISTS "app"."tutup_bulan" (
    "unit_id"            SMALLINT NOT NULL,
    "bulan"              DATE NOT NULL,
    "ditutup_by_user_id" INTEGER NOT NULL,
    "ditutup_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tutup_bulan_pkey" PRIMARY KEY ("unit_id", "bulan"),
    -- Keputusan 2.
    CONSTRAINT "tutup_bulan_hari_pertama" CHECK (
        "bulan" = date_trunc('month', "bulan")::date
    )
);

ALTER TABLE "app"."day_close"
    ADD COLUMN IF NOT EXISTS "koreksi_susulan_rp" DECIMAL(17,2);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    -- Keputusan 1.
    GRANT SELECT, INSERT ON "app"."tutup_bulan" TO dashboard_app;
    REVOKE UPDATE, DELETE ON "app"."tutup_bulan" FROM dashboard_app;
  END IF;
END
$$;

-- Tanpa seed: tabel lahir kosong (§4.1b c — tak ada INSERT ter-scope unit di
-- bawah blok RLS).

-- RLS — cabang NULL DIPUTUSKAN SADAR: **TIDAK ADA**. Penutupan bulan selalu
-- milik SATU unit (`unit_id` NOT NULL, bagian PRIMARY KEY). Predikat disalin
-- PERSIS dari 0016 (§4.1b).
DO $$
DECLARE
  t text;
  predicate text := $p$unit_id = ANY (ARRAY(
      SELECT tok::int
      FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
      WHERE tok ~ '^-?[0-9]+$'
  ))$p$;
BEGIN
  FOREACH t IN ARRAY ARRAY['tutup_bulan'] LOOP
    EXECUTE format('ALTER TABLE "app".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "app".%I FORCE ROW LEVEL SECURITY',  t);
    EXECUTE format('DROP POLICY IF EXISTS unit_scope ON "app".%I',   t);
    EXECUTE format(
      'CREATE POLICY unit_scope ON "app".%I USING (%s) WITH CHECK (%s)',
      t, predicate, predicate
    );
  END LOOP;
END
$$;
