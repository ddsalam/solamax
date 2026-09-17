-- Pengawas pergerakan angka pada data BEKU.
--
-- Keputusan pemilik 2026-09-17: angka historis IKUT BERGERAK mengikuti koreksi
-- sumber. Syaratnya, pergerakan pada data beku harus TERLIHAT dan harus DIAKUI
-- manusia. Dua tabel di bawah ini adalah catatan permanen pergerakan itu, dan
-- catatan permanen pengakuannya.
--
-- ⛔ DEFINISI BEKU HANYA SATU, dan ia sudah ada:
--      scripts/piutang-verifikasi/01-build-malam.sql, gerbang G5
--      BEKU  ≡  as_of_date < source_completed_at::date - 7
--    Jangan membuat definisi kedua di sini atau di mana pun.
--
-- Ambangnya >= 1 rupiah pada SALAH SATU dari ENAM total (awal & akhir untuk
-- ketiga ember). G5 hari ini hanya membandingkan tiga total akhir; enam adalah
-- yang benar, sebab awal(D) dapat bergeser tanpa akhir(D) ikut bergeser.
--
-- Nilai sebelum/sesudah disimpan DI SINI, bukan dirujuk ke manifest, supaya
-- peristiwanya berdiri sendiri. Peristiwa TIDAK PERNAH ikut dipensiunkan:
-- PRUNE_RETIRED_SOURCE_ROWS_SQL hanya menyentuh tiga tabel sumber, dan kedua
-- tabel ini sengaja tidak ditambahkan ke sana.

CREATE TABLE "app"."saldo_pelanggan_shift" (
    "unit_id" SMALLINT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "generation_id" UUID NOT NULL,
    "previous_generation_id" UUID NOT NULL,
    "source_cycle_sequence" BIGINT NOT NULL,
    "rebuild_epoch" BIGINT NOT NULL DEFAULT 0,
    "source_completed_at" TIMESTAMPTZ NOT NULL,
    -- Dihitung sekali saat perekaman memakai definisi G5 di atas. Disimpan,
    -- bukan dihitung ulang saat dibaca: cut yang datang kemudian menggeser
    -- source_completed_at, dan keadaan beku sebuah peristiwa adalah keadaan
    -- pada saat ia terjadi.
    "frozen" BOOLEAN NOT NULL,
    "detected_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- ⚠️ SENGAJA NULLABLE. Perekaman ini berjalan di dalam transaksi publikasi;
    -- NOT NULL telanjang akan membuat satu manifest parsial (atau formula v3
    -- kelak yang tak mengisi keenam total) MENGUNCI build malam. Pengeras untuk
    -- masa depan — bukan tambalan cacat yang ada: 135 manifest complete di
    -- produksi 2026-09-17 nol NULL pada keenam total.
    -- Perbandingannya memakai COALESCE(...,0) supaya transisi NULL -> nilai
    -- TERBACA sebagai pergeseran, bukan lenyap jadi NULL lalu senyap.
    "before_awal_piutang_lokal" NUMERIC,
    "before_akhir_piutang_lokal" NUMERIC,
    "before_awal_piutang_online" NUMERIC,
    "before_akhir_piutang_online" NUMERIC,
    "before_awal_hutang_lokal" NUMERIC,
    "before_akhir_hutang_lokal" NUMERIC,
    "after_awal_piutang_lokal" NUMERIC,
    "after_akhir_piutang_lokal" NUMERIC,
    "after_awal_piutang_online" NUMERIC,
    "after_akhir_piutang_online" NUMERIC,
    "after_awal_hutang_lokal" NUMERIC,
    "after_akhir_hutang_lokal" NUMERIC,

    -- Kuncinya menyertakan generation_id DENGAN SENGAJA. Persetujuan terikat
    -- pada NILAI, bukan pada baris: pergeseran berikutnya pada tanggal yang
    -- sama menerbitkan generasi baru, jadi baris peristiwa baru, jadi ia
    -- memerah lagi. Kunci (unit_id, as_of_date) akan membungkam pergeseran
    -- berikutnya selamanya.
    CONSTRAINT "sps_shift_pkey"
        PRIMARY KEY ("unit_id", "as_of_date", "generation_id"),
    CONSTRAINT "sps_shift_manifest_fkey"
        FOREIGN KEY ("unit_id", "as_of_date", "generation_id")
        REFERENCES "app"."saldo_pelanggan_snapshot_manifest"
            ("unit_id", "as_of_date", "generation_id")
);

CREATE INDEX "sps_shift_belum_diakui_idx"
    ON "app"."saldo_pelanggan_shift" ("unit_id", "as_of_date")
    WHERE "frozen";

-- Pengakuan pemilik. APPEND-ONLY, meniru 0017_audit_log: dashboard_app boleh
-- SELECT dan INSERT, tak pernah UPDATE/DELETE. Tabel terpisah dan bukan kolom
-- pada peristiwa, karena grant UPDATE pada peristiwa sekaligus membuka jalan
-- menulis ulang NILAI pergeserannya.
--
-- Tanpa UNIQUE pada peristiwa: klik kedua tidak boleh melempar, dan dua
-- pengakuan atas satu peristiwa adalah jejak yang sah, bukan galat. Pembacanya
-- memakai EXISTS.
CREATE TABLE "app"."saldo_pelanggan_shift_ack" (
    "ack_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id" SMALLINT NOT NULL,
    "as_of_date" DATE NOT NULL,
    "generation_id" UUID NOT NULL,
    "acknowledged_by_user_id" TEXT,
    "acknowledged_by_email" TEXT NOT NULL,
    "acknowledged_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "sps_shift_ack_pkey" PRIMARY KEY ("ack_id"),
    CONSTRAINT "sps_shift_ack_shift_fkey"
        FOREIGN KEY ("unit_id", "as_of_date", "generation_id")
        REFERENCES "app"."saldo_pelanggan_shift"
            ("unit_id", "as_of_date", "generation_id")
);

CREATE INDEX "sps_shift_ack_shift_idx"
    ON "app"."saldo_pelanggan_shift_ack" ("unit_id", "as_of_date", "generation_id");

-- RLS unit-scoped + FORCE, predikat identik dengan 0016/0037. Tanpa ini kedua
-- tabel akan terbaca penuh lintas tenant.
DO $$
DECLARE
  r record;
  predicate text := $p$unit_id = ANY (ARRAY(
      SELECT tok::int
      FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
      WHERE tok ~ '^-?[0-9]+$'
    ))$p$;
BEGIN
  FOR r IN
    SELECT unnest(ARRAY[
      'saldo_pelanggan_shift',
      'saldo_pelanggan_shift_ack'
    ]) AS table_name
  LOOP
    EXECUTE format('ALTER TABLE "app".%I ENABLE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('ALTER TABLE "app".%I FORCE ROW LEVEL SECURITY', r.table_name);
    EXECUTE format('DROP POLICY IF EXISTS unit_scope ON "app".%I', r.table_name);
    EXECUTE format(
      'CREATE POLICY unit_scope ON "app".%I USING (%s) WITH CHECK (%s)',
      r.table_name, predicate, predicate
    );
  END LOOP;
END
$$;

-- dashboard_app: MEMBACA peristiwa, MENULIS pengakuan. Menulis pengakuan adalah
-- tindakan pemilik lewat UI, kelas yang sama dengan app.audit_log yang sudah
-- ditulis dashboard_app hari ini — bukan kelas "menulis permukaan snapshot".
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT ON "app"."saldo_pelanggan_shift" TO dashboard_app;
    GRANT SELECT, INSERT ON "app"."saldo_pelanggan_shift_ack" TO dashboard_app;

    REVOKE INSERT, UPDATE, DELETE ON "app"."saldo_pelanggan_shift" FROM dashboard_app;
    REVOKE UPDATE, DELETE ON "app"."saldo_pelanggan_shift_ack" FROM dashboard_app;
  END IF;
END
$$;

-- ── BACKFILL RETROAKTIF (keputusan pemilik α, 2026-09-17) ────────────────────
--
-- Manifest menyimpan keenam total tiap generasi dan TIDAK ikut dipensiunkan,
-- jadi seluruh riwayat pergeseran dapat direkonstruksi. Ia dijalankan di dalam
-- migrasi supaya terjadi TEPAT SEKALI dan tak bisa terlupa.
--
-- Urutannya (source_cycle_sequence, rebuild_epoch) — kunci yang SAMA dengan
-- yang dipakai CAS pointer, bukan (rebuild_epoch, completed_at) seperti G5 hari
-- ini. Setiap manifest complete pernah duduk di pointer (penyelesaian manifest
-- dan pertukaran pointer berbagi satu transaksi), jadi status='complete' adalah
-- padanan eksak dari "pernah dilihat pengguna".
--
-- 🔴 RLS: tabel-tabel ini ber-FORCE dan peran migrasi tidak ber-BYPASSRLS, jadi
-- TANPA app.unit_ids seluruh blok ini memulangkan NOL BARIS TANPA GALAT — hijau
-- palsu yang sempurna. Scope dipasang lebih dulu, lalu DIBUKTIKAN terpasang.
SELECT set_config(
  'app.unit_ids',
  COALESCE((SELECT string_agg(unit_id::text, ',' ORDER BY unit_id) FROM public.unit), ''),
  false
);

DO $$
BEGIN
  IF COALESCE(current_setting('app.unit_ids', true), '') = ''
     AND EXISTS (SELECT 1 FROM public.unit)
  THEN
    RAISE EXCEPTION
      'backfill dibatalkan: app.unit_ids kosong padahal public.unit berisi — '
      'seluruh backfill akan memulangkan nol baris tanpa galat';
  END IF;
END
$$;

INSERT INTO "app"."saldo_pelanggan_shift" (
  unit_id, as_of_date, generation_id, previous_generation_id,
  source_cycle_sequence, rebuild_epoch, source_completed_at, frozen, detected_at,
  before_awal_piutang_lokal, before_akhir_piutang_lokal,
  before_awal_piutang_online, before_akhir_piutang_online,
  before_awal_hutang_lokal, before_akhir_hutang_lokal,
  after_awal_piutang_lokal, after_akhir_piutang_lokal,
  after_awal_piutang_online, after_akhir_piutang_online,
  after_awal_hutang_lokal, after_akhir_hutang_lokal
)
WITH gen AS (
  SELECT m.unit_id, m.as_of_date, m.generation_id,
         m.source_cycle_sequence, m.rebuild_epoch, m.source_completed_at,
         m.completed_at,
         m.awal_piutang_lokal_total   AS apl, m.akhir_piutang_lokal_total   AS epl,
         m.awal_piutang_online_total  AS apo, m.akhir_piutang_online_total  AS epo,
         m.awal_hutang_lokal_total    AS ahl, m.akhir_hutang_lokal_total    AS ehl,
         lag(m.generation_id)             OVER w AS p_gen,
         lag(m.awal_piutang_lokal_total)  OVER w AS p_apl,
         lag(m.akhir_piutang_lokal_total) OVER w AS p_epl,
         lag(m.awal_piutang_online_total) OVER w AS p_apo,
         lag(m.akhir_piutang_online_total)OVER w AS p_epo,
         lag(m.awal_hutang_lokal_total)   OVER w AS p_ahl,
         lag(m.akhir_hutang_lokal_total)  OVER w AS p_ehl
  FROM "app"."saldo_pelanggan_snapshot_manifest" m
  WHERE m.status = 'complete'
  WINDOW w AS (
    PARTITION BY m.unit_id, m.as_of_date
    ORDER BY m.source_cycle_sequence, m.rebuild_epoch
  )
)
SELECT g.unit_id, g.as_of_date, g.generation_id, g.p_gen,
       g.source_cycle_sequence, g.rebuild_epoch, g.source_completed_at,
       (g.as_of_date < g.source_completed_at::date - 7),
       COALESCE(g.completed_at, CURRENT_TIMESTAMP),
       g.p_apl, g.p_epl, g.p_apo, g.p_epo, g.p_ahl, g.p_ehl,
       g.apl,   g.epl,   g.apo,   g.epo,   g.ahl,   g.ehl
FROM gen g
WHERE g.p_gen IS NOT NULL
  AND (
       abs(COALESCE(g.apl, 0) - COALESCE(g.p_apl, 0)) >= 1
    OR abs(COALESCE(g.epl, 0) - COALESCE(g.p_epl, 0)) >= 1
    OR abs(COALESCE(g.apo, 0) - COALESCE(g.p_apo, 0)) >= 1
    OR abs(COALESCE(g.epo, 0) - COALESCE(g.p_epo, 0)) >= 1
    OR abs(COALESCE(g.ahl, 0) - COALESCE(g.p_ahl, 0)) >= 1
    OR abs(COALESCE(g.ehl, 0) - COALESCE(g.p_ehl, 0)) >= 1
  )
ON CONFLICT ("unit_id", "as_of_date", "generation_id") DO NOTHING;
