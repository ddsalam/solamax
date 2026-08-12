-- 0023_category_account_map — pemetaan 14 kategori operasional (milik pengawas)
-- → akun akuntansi / CoA (milik Finance). Keputusan owner B1 + B3, 12 Agu 2026
-- (KEUANGAN-HARIAN.md §10.1 & §10.3).
--
-- B1: bagan akun SERAGAM untuk 7 unit ⇒ seluruh 14 baris seed ber-`unit_id NULL`
-- (= berlaku semua unit), dan NOL baris ber-unit.
--
-- Kenapa kolomnya tetap nullable dan bukan dibuang: yang menegakkan keseragaman
-- adalah GERBANG OWNER, bukan skema. Kalau kelak ada satu pengecualian sah, ia
-- jadi SATU BARIS — bukan migrasi `ALTER` di tabel yang sudah berisi pemetaan
-- yang dipakai jurnal.
--
-- ⛔ B3: Supir Tangki / mobil tangki = BEBAN OPERASIONAL 6-2100, BUKAN freight-in
-- ke HPP. Konsekuensinya menyelamatkan pekerjaan: Gross Profit tetap
-- `Revenue + TeraValue + COGS`, sehingga 10 kasus emas T3 tetap berlaku apa
-- adanya. Kalau ini pernah diubah jadi freight-in, kesepuluhnya harus dihitung
-- ulang — bukan ekspektasinya yang disesuaikan.
--
-- Idempoten / aman re-run.

CREATE TABLE IF NOT EXISTS "app"."category_account_map" (
    "id"                   UUID NOT NULL DEFAULT gen_random_uuid(),
    -- NULL = berlaku SEMUA unit (keadaan yang dijaga). Lihat penjaga di bawah.
    "unit_id"              SMALLINT,
    "operational_category" TEXT NOT NULL,
    "accounting_account"   TEXT NOT NULL,
    "effective_from"       DATE NOT NULL,
    -- WAJIB terisi bila baris ini ber-unit. Inilah penjaganya: baris ber-unit
    -- tidak bisa masuk TANPA DISENGAJA, sebab ia menuntut kalimat alasan yang
    -- harus diketik seseorang. Menambah baris ber-unit tetap butuh GERBANG
    -- OWNER (§10.1) — kolom ini membuat pelanggarannya terlihat, bukan mustahil.
    "override_reason"      TEXT,

    "created_by_user_id"   INTEGER,
    "created_at"           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_account_map_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "category_account_map_override_deliberate" CHECK (
        "unit_id" IS NULL OR btrim(COALESCE("override_reason", '')) <> ''
    ),
    -- Baris default tidak boleh membawa alasan-override: kalau ia ada, berarti
    -- seseorang menyalin baris ber-unit dan melupakan unit_id-nya.
    CONSTRAINT "category_account_map_default_clean" CHECK (
        "unit_id" IS NOT NULL OR "override_reason" IS NULL
    )
);

-- Satu pemetaan aktif per (unit, kategori, berlaku-sejak). COALESCE(-1) supaya
-- baris default (unit_id NULL) tetap unik — NULL tidak sama dengan NULL di
-- indeks unik biasa, jadi tanpa ini 14 baris default bisa digandakan diam-diam.
CREATE UNIQUE INDEX IF NOT EXISTS "category_account_map_uq"
    ON "app"."category_account_map"(
        COALESCE("unit_id", -1), "operational_category", "effective_from"
    );

CREATE INDEX IF NOT EXISTS "category_account_map_lookup_idx"
    ON "app"."category_account_map"("operational_category", "effective_from" DESC);

-- 14 pemetaan §10.3, seluruhnya default (unit_id NULL).
INSERT INTO "app"."category_account_map"
    ("unit_id", "operational_category", "accounting_account", "effective_from")
VALUES
    (NULL, 'Iklan, Promosi, Spanduk',                                        '6-4100', DATE '2026-01-01'),
    (NULL, 'Transportasi / Kendaraan Milik Perusahaan',                      '6-2200', DATE '2026-01-01'),
    (NULL, 'Supir Tangki',                                                   '6-2100', DATE '2026-01-01'),
    (NULL, 'Maintance Operasional SPBU (Tera, Cleaning Tank, Sabun)',        '6-2300', DATE '2026-01-01'),
    (NULL, 'Sumbangan / Donasi',                                             '6-3500', DATE '2026-01-01'),
    (NULL, 'Komputer dan Internet',                                          '6-3300', DATE '2026-01-01'),
    (NULL, 'Sarana & Prasarana (Listrik, Air, Lampu, Tlpn, Genset, Jalan)',  '6-2400', DATE '2026-01-01'),
    (NULL, 'Konsumsi Makanan, Lembur, & Hiburan',                            '6-1300', DATE '2026-01-01'),
    (NULL, 'Peralatan Kantor (ATK)',                                         '6-3100', DATE '2026-01-01'),
    (NULL, 'Biaya Taktis',                                                   '6-9100', DATE '2026-01-01'),
    (NULL, 'Gaji Karyawan',                                                  '6-1100', DATE '2026-01-01'),
    (NULL, 'Lain-Lain',                                                      '6-9900', DATE '2026-01-01'),
    (NULL, 'MDR',                                                            '7-1200', DATE '2026-01-01'),
    (NULL, 'Biaya Admin',                                                    '7-1100', DATE '2026-01-01')
ON CONFLICT DO NOTHING;

-- Pemetaan dibaca aplikasi, tetapi TIDAK ditulis olehnya: mengubah pemetaan =
-- keputusan Finance/owner lewat migrasi, bukan lewat layar.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT ON "app"."category_account_map" TO dashboard_app;
    REVOKE INSERT, UPDATE, DELETE ON "app"."category_account_map" FROM dashboard_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- ⚠️ RLS — POLICY-NYA SENGAJA BERBEDA DARI 0016, DAN INI BUKAN KELALAIAN.
--
-- Tabel ini punya kolom `unit_id`, jadi 0016 akan memasukkannya kalau pernah
-- dijalankan ulang. Predikat 0016 adalah `unit_id = ANY (ARRAY(...))` — dan
-- untuk baris ber-`unit_id NULL` ekspresi itu menghasilkan NULL, BUKAN true.
-- Artinya: dengan predikat 0016 apa adanya, **keempat belas baris default
-- menjadi tak terlihat oleh siapa pun**, dan setiap biaya kehilangan akun
-- akuntansinya tanpa satu pun galat muncul.
--
-- Karena itu policy di sini menambahkan cabang `unit_id IS NULL OR …`:
-- baris default terlihat oleh semua, baris ber-unit tetap ter-scope.
--
-- 🔴 BAHAYA YANG DIBAWA: `0016_rls_unit_scope` bersifat self-adjusting DAN
-- memakai `DROP POLICY IF EXISTS unit_scope` sebelum membuat ulang. Kalau ada
-- yang MENJALANKANNYA ULANG secara manual (bukan lewat `prisma migrate deploy`,
-- yang tidak akan), policy tabel ini akan diganti versi ketat dan defaultnya
-- lenyap. Kalau itu terjadi, jalankan ulang migrasi ini.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  predicate text := $p$(unit_id IS NULL OR unit_id = ANY (ARRAY(
      SELECT tok::int
      FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
      WHERE tok ~ '^-?[0-9]+$'
  )))$p$;
BEGIN
  EXECUTE 'ALTER TABLE "app"."category_account_map" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "app"."category_account_map" FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS unit_scope ON "app"."category_account_map"';
  EXECUTE format(
    'CREATE POLICY unit_scope ON "app"."category_account_map" USING (%s) WITH CHECK (%s)',
    predicate, predicate
  );
END
$$;
