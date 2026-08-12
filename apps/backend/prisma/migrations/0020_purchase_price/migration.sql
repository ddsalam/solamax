-- 0020_purchase_price — harga beli BBM per (unit, produk, berlaku-sejak).
--
-- Keputusan yang diwujudkan tabel ini ada di apps/dashboard/KEUANGAN-HARIAN.md
-- §4.1; jawaban owner B1–B8 di §10. Baca itu dulu — berkas ini tidak mengulang
-- alasannya, hanya menegakkannya.
--
-- Ringkas yang mengikat:
--  · Harga beli = INPUT MANUAL (keputusan owner, final). JANGAN pernah menariknya
--    dari tr_dtebus.NHRGBELI dan JANGAN menyentuh tebus_detail.
--  · Harga JUAL tidak pernah diketik — selalu dari EasyMax.
--  · BERLAKU-SEJAK, bukan satu baris per hari. Harga yang berlaku pada tanggal D
--    = baris non-void dengan effective_from TERBESAR yang ≤ D. Workbook lama
--    mereplikasi nilai sama ke ribuan baris harian; itu membuat "kapan harga
--    berubah" tak terbaca dan sel kosong tak bisa dibedakan dari "belum diisi".
--  · VOID-only (TANPA DELETE) + audit — pola app.manual_entry / app.usulan_so.
--
-- P1 (penjaga "harga beli > harga jual") = PERINGATAN WAJIB-DIAKUI, BUKAN reject
-- (keputusan owner 10 Agu 2026; diuji ke 2.048 hari sejarah Bakau → 436 sel /
-- 336 hari terpicu, hampir semua Pertamina Dex & Pertamax Turbo, yang secara
-- operasional SAH pada masa transisi harga). Yang menghalangi simpan adalah
-- PENGAKUAN, bukan nilainya.
--
-- ⚠️ Batas CHECK p1_complete — sebutkan apa adanya: DB tidak tahu harga jual,
-- jadi ia TIDAK bisa memverifikasi bahwa `p1_triggered` dihitung jujur. Yang
-- dijaga DB hanyalah: KALAU aplikasi menyatakan P1 terpicu, MAKA ketiga jejaknya
-- (pengaku, waktu, alasan tak-kosong) wajib ada. Kejujuran flag-nya dijaga
-- lapis aturan murni (harga-beli.ts) + tesnya. Jangan menalar seolah CHECK ini
-- menjamin lebih dari itu.
--
-- Urutan deploy (HOUSE RULE): migrate-deploy DULU, baru image dashboard yang
-- mereferensikan tabel ini. Idempoten / aman re-run.

CREATE TABLE IF NOT EXISTS "app"."purchase_price" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"            SMALLINT NOT NULL,
    "product_key"        TEXT NOT NULL,
    -- BERLAKU-SEJAK. Tidak ada kolom "berlaku-sampai": ia tersirat dari baris
    -- berikutnya. Satu sumbu, jadi tak ada dua tanggal yang bisa berselisih.
    "effective_from"     DATE NOT NULL,
    "price"              DECIMAL(14,4) NOT NULL,
    -- Rujukan dokumen tebus / SK harga. Bukan wajib: sebagian harga historis
    -- memang tak punya dokumen, dan memaksa kolom ini menghasilkan isian asal.
    "source_note"        TEXT,

    -- P1 (§4.1). Ketiganya terisi HANYA saat P1 terpicu; kelengkapannya
    -- ditegakkan CHECK di bawah.
    "p1_triggered"       BOOLEAN NOT NULL DEFAULT false,
    -- Harga jual EasyMax yang dibandingkan saat keputusan diambil. Disimpan
    -- supaya "selisih" (§4.1) bisa dihitung ulang kemudian tanpa menebak harga
    -- jual mana yang berlaku waktu itu: selisih = price − p1_sell_price.
    "p1_sell_price"      DECIMAL(14,4),
    "p1_acknowledged_by" INTEGER,
    "p1_acknowledged_at" TIMESTAMPTZ,
    "p1_reason"          TEXT,

    "void"               BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" INTEGER NOT NULL,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_by_user_id"  INTEGER,
    "voided_at"          TIMESTAMPTZ,

    CONSTRAINT "purchase_price_pkey" PRIMARY KEY ("id"),

    -- Harga beli negatif tidak punya arti; nol pun tidak (itu "belum diisi",
    -- dan "belum diisi" diwakili oleh TIDAK ADA BARIS, bukan oleh nol).
    -- Pelajaran Bakau: HargaBeli Solar kosong sejak 2026-03-04 membuat COGS
    -- Solar = 0 dan Inventory Solar = 0 tanpa satu pun alarm berbunyi.
    CONSTRAINT "purchase_price_positive" CHECK ("price" > 0),

    -- KALAU p1_triggered, MAKA jejaknya lengkap. Lihat batasnya di kepala berkas.
    CONSTRAINT "purchase_price_p1_complete" CHECK (
        NOT "p1_triggered" OR (
            "p1_acknowledged_by" IS NOT NULL
        AND "p1_acknowledged_at" IS NOT NULL
        AND btrim(COALESCE("p1_reason", '')) <> ''
        )
    ),
    -- Kebalikannya juga dijaga: jejak P1 tak boleh ada kalau P1 tak terpicu —
    -- supaya hitungan frekuensi per produk tidak tercemar baris yang "sekadar
    -- diberi alasan".
    CONSTRAINT "purchase_price_p1_clean" CHECK (
        "p1_triggered" OR (
            "p1_acknowledged_by" IS NULL
        AND "p1_acknowledged_at" IS NULL
        AND "p1_reason" IS NULL
        AND "p1_sell_price" IS NULL
        )
    ),

    CONSTRAINT "purchase_price_void_audit" CHECK (
        "void" = ("voided_at" IS NOT NULL) AND "void" = ("voided_by_user_id" IS NOT NULL)
    )
);

-- Tepat satu baris AKTIF per (unit, produk, berlaku-sejak). Koreksi harga =
-- void baris lama + insert baru dalam satu txn (jejak audit), bukan UPDATE.
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_price_active_uq"
    ON "app"."purchase_price"("unit_id", "product_key", "effective_from") WHERE NOT void;

-- Pencarian "harga berlaku pada D" = ORDER BY effective_from DESC LIMIT 1.
CREATE INDEX IF NOT EXISTS "purchase_price_lookup_idx"
    ON "app"."purchase_price"("unit_id", "product_key", "effective_from" DESC) WHERE NOT void;

-- Frekuensi P1 per produk (§4.1 syarat ke-3): kalau satu produk memicu
-- terus-menerus, itu TEMUAN, bukan kebisingan. Indeks parsial supaya hitungan
-- itu murah dan karenanya benar-benar dijalankan.
CREATE INDEX IF NOT EXISTS "purchase_price_p1_idx"
    ON "app"."purchase_price"("unit_id", "product_key", "effective_from") WHERE "p1_triggered";

-- RW utk role app dashboard. TANPA DELETE — pembatalan lewat kolom `void`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "app"."purchase_price" TO dashboard_app;
    REVOKE DELETE ON "app"."purchase_price" FROM dashboard_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- RLS unit-scoped — WAJIB DI SINI, bukan diwarisi.
--
-- 0016_rls_unit_scope memang self-adjusting ATAS TABEL YANG SUDAH ADA saat ia
-- dijalankan; ia TIDAK berjalan ulang untuk tabel yang lahir sesudahnya, sebab
-- `prisma migrate deploy` hanya menjalankan migrasi baru. purchase_price adalah
-- tabel unit-scoped PERTAMA setelah 0016 ⇒ kalau blok ini lupa, tabel ini
-- berdiri TANPA RLS dan tak ada yang berbunyi merah.
--
-- Predikat disalin PERSIS dari 0016 (filter token numerik dulu → fail-closed
-- pada input rusak: nol baris, tanpa throw). Jangan "dirapikan" — kalau ia
-- menyimpang dari 0016, dua tabel akan punya dua definisi scope.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  predicate text := $p$unit_id = ANY (ARRAY(
      SELECT tok::int
      FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
      WHERE tok ~ '^-?[0-9]+$'
  ))$p$;
BEGIN
  EXECUTE 'ALTER TABLE "app"."purchase_price" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "app"."purchase_price" FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS unit_scope ON "app"."purchase_price"';
  EXECUTE format(
    'CREATE POLICY unit_scope ON "app"."purchase_price" USING (%s) WITH CHECK (%s)',
    predicate, predicate
  );
END
$$;
