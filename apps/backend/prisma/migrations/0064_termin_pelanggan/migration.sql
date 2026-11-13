-- 0064_termin_pelanggan — master termin pembayaran milik SolaMax: bawaan unit
-- dan pengecualian per pelanggan.
--
-- Rencana: docs/plans/2026-11-13-1845-feat-tagihan-pelanggan-monitoring-plan.md
-- (U4; R14–R16, KTD6, KTD7, KTD9). ADDITIVE: dua tabel baru, tanpa ALTER pada
-- tabel yang sudah ada, tanpa seed, tanpa backfill.
--
--   app.termin_unit       — termin BAWAAN satu unit (hari), satu baris aktif
--   app.termin_pelanggan  — pengecualian per (unit, kode pelanggan), satu baris
--                           aktif; tanpa baris aktif = pelanggan memakai bawaan
--
-- ⛔ KEPUTUSAN YANG MENGIKAT:
--
-- 1. **Dua tabel, bukan satu tabel ber-unit_id NULL (KTD6).** Alasannya sama
--    dengan 0056 butir 3: tabel campuran memaksa cabang `unit_id IS NULL OR …`
--    pada policy, dan menjalankan ulang 0016 menggantinya dengan versi ketat
--    sehingga baris tanpa unit lenyap tanpa galat. Di sini kedua tabel SELALU
--    milik satu unit (kolomnya NOT NULL), jadi predikat 0016 dipakai apa adanya.
--
-- 2. **Mengubah = void + insert (pola `pihak_lawan_saldo_awal`, 0049).** Baris
--    lama tak pernah disunting nilainya dan tak pernah dihapus — riwayat termin
--    tetap terbaca (R16). "Hapus pengecualian" = void TANPA baris pengganti.
--    Indeks unik parsial menjamin satu baris aktif. Setiap perubahan juga
--    menulis `app.audit_log` lewat aksinya (`termin-tulis.ts`).
--
-- 3. **Termin TIDAK dibekukan per faktur (KTD7).** Tak ada tanggal berlaku di
--    sini: perubahan langsung berlaku untuk semua faktur tanpa jatuh tempo
--    EasyMax yang sah, termasuk faktur terbuka lama. Status dihitung saat baca.
--
-- 4. **`kode_pelanggan` VARCHAR(12), tersimpan TERPANGKAS** — bentuk yang sama
--    dengan `saldo_pelanggan_snapshot_row.customer_code` (0037) dan dengan cara
--    layar Saldo pelanggan mengunci pelanggan (`btrim(ckdplg)`). Sumbernya
--    `pelanggan_master.ckdplg` CHAR(12) yang berpengisi spasi; menyimpan bentuk
--    berpengisi akan membuat `'NOL/02'` dan `'NOL/02      '` jadi dua pelanggan
--    bagi indeks unik. CHECK menegakkannya di DB. Isi kode tidak diubah selain
--    itu: garis miring dan titik (kode Online) sah apa adanya.
--
-- 5. **TANPA FK ke `public.pelanggan_master`.** Master itu cermin EasyMax yang
--    ditulis ulang jalur ingest dan kuncinya CHAR(12) berpengisi; FK akan
--    membuat ingest gagal saat EasyMax menghapus pelanggan yang punya termin.
--    Keberadaan pelanggan diperiksa aksi SAAT MENULIS; pengecualian yang
--    pelanggannya lenyap dari master tetap terbaca dan tetap bisa dihapus.
--
-- 6. **Tanpa FK ke `app.users` pada kolom pencatat** — sejalan seluruh tabel
--    keuangan sejak 0020 (`created_by_user_id INTEGER`, tanpa REFERENCES).
--
-- Idempotent / aman re-run.

-- ---------------------------------------------------------------------------
-- 1. Termin bawaan unit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."termin_unit" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"            SMALLINT NOT NULL,
    -- Hari bulat sesudah tanggal faktur. 0 sah: jatuh tempo pada tanggal faktur.
    "termin_hari"        SMALLINT NOT NULL,
    "created_by_user_id" INTEGER NOT NULL,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "void"               BOOLEAN NOT NULL DEFAULT false,
    "voided_by_user_id"  INTEGER,
    "voided_at"          TIMESTAMPTZ,

    CONSTRAINT "termin_unit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "termin_unit_rentang" CHECK ("termin_hari" BETWEEN 0 AND 365),
    CONSTRAINT "termin_unit_void_audit" CHECK (
        "void" = ("voided_at" IS NOT NULL) AND "void" = ("voided_by_user_id" IS NOT NULL)
    )
);

-- SATU termin bawaan aktif per unit — pola 0036/0049. Mengganti = void yang
-- lama lalu tulis yang baru.
CREATE UNIQUE INDEX IF NOT EXISTS "termin_unit_aktif_uq"
    ON "app"."termin_unit"("unit_id") WHERE NOT "void";

-- ---------------------------------------------------------------------------
-- 2. Pengecualian termin per pelanggan
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."termin_pelanggan" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"            SMALLINT NOT NULL,
    -- `btrim(pelanggan_master.ckdplg)` — keputusan 4 di kepala.
    "kode_pelanggan"     VARCHAR(12) NOT NULL,
    "termin_hari"        SMALLINT NOT NULL,
    "created_by_user_id" INTEGER NOT NULL,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "void"               BOOLEAN NOT NULL DEFAULT false,
    "voided_by_user_id"  INTEGER,
    "voided_at"          TIMESTAMPTZ,

    CONSTRAINT "termin_pelanggan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "termin_pelanggan_rentang" CHECK ("termin_hari" BETWEEN 0 AND 365),
    CONSTRAINT "termin_pelanggan_kode_terpangkas" CHECK (
        NULLIF("kode_pelanggan", '') IS NOT NULL AND
        "kode_pelanggan" = btrim("kode_pelanggan")
    ),
    CONSTRAINT "termin_pelanggan_void_audit" CHECK (
        "void" = ("voided_at" IS NOT NULL) AND "void" = ("voided_by_user_id" IS NOT NULL)
    )
);

-- SATU pengecualian aktif per (unit, pelanggan).
CREATE UNIQUE INDEX IF NOT EXISTS "termin_pelanggan_aktif_uq"
    ON "app"."termin_pelanggan"("unit_id", "kode_pelanggan") WHERE NOT "void";

-- ---------------------------------------------------------------------------
-- Hak akses — eksplisit. VOID-only: DELETE di-REVOKE (pola 0049); UPDATE
-- dibutuhkan untuk menandai void. `dashboard_ro` dijaga IF EXISTS (pola 0060):
-- di dev lokal / basis data CI role bisa belum ada.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "app"."termin_unit" TO dashboard_app;
    REVOKE DELETE ON "app"."termin_unit" FROM dashboard_app;
    GRANT SELECT, INSERT, UPDATE ON "app"."termin_pelanggan" TO dashboard_app;
    REVOKE DELETE ON "app"."termin_pelanggan" FROM dashboard_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_ro') THEN
    GRANT SELECT ON "app"."termin_unit" TO dashboard_ro;
    GRANT SELECT ON "app"."termin_pelanggan" TO dashboard_ro;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- RLS unit-scoped — 0016 hanya menyapu tabel yang ada saat ia jalan; tabel yang
-- lahir sesudahnya WAJIB memasang RLS-nya sendiri. Predikat disalin PERSIS dari
-- 0016 (lewat 0049); jangan dirapikan. Cabang NULL DIPUTUSKAN SADAR: TIDAK ADA
-- — kedua tabel selalu milik satu unit (keputusan 1 di kepala).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  predicate text := $p$unit_id = ANY (ARRAY(
      SELECT tok::int
      FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
      WHERE tok ~ '^-?[0-9]+$'
  ))$p$;
BEGIN
  FOREACH t IN ARRAY ARRAY['termin_unit', 'termin_pelanggan'] LOOP
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
