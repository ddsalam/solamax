-- 0052_cocok_bank — kelompok cocok baris rekening koran ↔ baris kas.
--
-- Rencana: docs/plans/2026-10-29-1719-feat-keuangan-pihak-lawan-penebusan-impor-bank-plan.md
-- (U10; R19, R20, R29, R31; KTD6, KTD7).
--
--   app.cocok_bank       — satu kelompok cocok: unit, cara (otomatis/manual),
--                          pembuat, status aktif, pembatalan beralasan.
--   app.cocok_bank_baris — anggota kelompok: TEPAT SATU dari baris impor
--                          (`mutasi_bank`) atau baris kas (`cash_ledger`).
--   app.cash_ledger      — + `lahir_dari_cocok_id`: baris kas yang DILAHIRKAN
--                          klasifikasi sebuah kelompok (U11), supaya pembatalan
--                          kelompok itu tahu baris mana yang harus di-void /
--                          dibalik maju.
--
-- ⛔ KEPUTUSAN YANG MENGIKAT:
--
-- 1. **Pencocokan adalah TAUTAN, tak pernah menyunting buku** (KTD6). Tak ada
--    kolom nominal/tanggal di sini; Σ kelompok dihitung dari anggotanya. Σ = 0
--    ditegakkan aksi (sen bulat) dan diperiksa ulang pemeriksa integritas
--    (`keuangan-integritas.ts`) — bukan CHECK, karena CHECK tak bisa melihat
--    baris tabel lain.
-- 2. **Satu baris impor & satu baris kas paling banyak di SATU kelompok
--    AKTIF** — partial unique per kolom, di antara anggota yang `aktif`.
-- 3. **Status aktif DICERMINKAN ke anggota lewat FK komposit
--    `(cocok_id, unit_id, aktif)` ON UPDATE CASCADE** (trik yang sama dengan
--    `mutasi_bank.rk_status`, 0051): membatalkan kelompok = satu UPDATE atas
--    `cocok_bank`; anggota ikut nonaktif tanpa ditulis aplikasi, cermin tak
--    mungkin tertinggal, dan anggota tak bisa disisipkan ke kelompok yang
--    sudah dibatalkan (FK menolak `aktif = true` ke induk `false`).
-- 4. **FK komposit `(id, unit_id)`** ke setiap tabel ber-unit (idiom 0019/0029):
--    kelompok, baris impor, dan baris kas milik unit yang SAMA. FK Postgres
--    mengabaikan RLS — tanpa unit di kunci, kelompok unit A bisa menunjuk baris
--    kas unit B yang kebetulan terlihat di transaksi dua unit.
-- 5. **Hak akses**: `cocok_bank` SELECT/INSERT/UPDATE (UPDATE hanya untuk
--    pembatalan — satu-satunya transisi; aplikasi tak pernah menyalakan ulang
--    kelompok). `cocok_bank_baris` SELECT/INSERT saja — cermin status
--    dijalankan trigger RI sebagai pemilik tabel. DELETE di-REVOKE keduanya.
-- 6. **Pembatalan beralasan** (R31): kode dari master `reason_code`
--    (applies_to 'adjustment', idiom bayangan 0027/0049/0051) + catatan wajib.
--
-- Idempoten / aman re-run.

CREATE TABLE IF NOT EXISTS "app"."cocok_bank" (
    "id"                          UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"                     SMALLINT NOT NULL,
    "cara"                        TEXT NOT NULL,
    "dibuat_by_user_id"           INTEGER NOT NULL,
    "dibuat_at"                   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aktif"                       BOOLEAN NOT NULL DEFAULT true,
    "dibatalkan_at"               TIMESTAMPTZ,
    "dibatalkan_by_user_id"       INTEGER,
    "dibatalkan_alasan"           TEXT,
    -- Bayangan `reason_code.applies_to` (idiom 0027/0049/0051).
    "dibatalkan_alasan_applies_to" TEXT,
    "dibatalkan_catatan"          TEXT,

    CONSTRAINT "cocok_bank_pkey" PRIMARY KEY ("id"),
    -- Target FK komposit `cash_ledger.lahir_dari_cocok_id` (keputusan 4).
    CONSTRAINT "cocok_bank_unit_uq" UNIQUE ("id", "unit_id"),
    -- Target FK komposit anggota — juga cermin status (keputusan 3).
    CONSTRAINT "cocok_bank_cermin_uq" UNIQUE ("id", "unit_id", "aktif"),
    CONSTRAINT "cocok_bank_cara" CHECK ("cara" IN ('otomatis', 'manual')),
    -- Dibatalkan ⇔ kapan, siapa, alasan, catatan — semuanya, atau tak satu pun.
    CONSTRAINT "cocok_bank_batal_audit" CHECK (
        (NOT "aktif") = ("dibatalkan_at" IS NOT NULL)
        AND (NOT "aktif") = ("dibatalkan_by_user_id" IS NOT NULL)
        AND (NOT "aktif") = ("dibatalkan_alasan" IS NOT NULL)
        AND (NOT "aktif") = (NULLIF(btrim("dibatalkan_catatan"), '') IS NOT NULL)
    ),
    CONSTRAINT "cocok_bank_alasan_fk" FOREIGN KEY ("dibatalkan_alasan", "dibatalkan_alasan_applies_to")
        REFERENCES "app"."reason_code"("code", "applies_to"),
    CONSTRAINT "cocok_bank_alasan_adjustment" CHECK (
        "dibatalkan_alasan_applies_to" IS NULL OR "dibatalkan_alasan_applies_to" = 'adjustment'
    ),
    CONSTRAINT "cocok_bank_alasan_pair" CHECK (
        ("dibatalkan_alasan" IS NULL) = ("dibatalkan_alasan_applies_to" IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS "cocok_bank_unit_idx"
    ON "app"."cocok_bank"("unit_id", "dibuat_at");

CREATE TABLE IF NOT EXISTS "app"."cocok_bank_baris" (
    "id"             UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"        SMALLINT NOT NULL,
    "cocok_id"       UUID NOT NULL,
    -- Cermin `cocok_bank.aktif` — diisi FK ON UPDATE CASCADE (keputusan 3).
    "aktif"          BOOLEAN NOT NULL DEFAULT true,
    "mutasi_bank_id" UUID,
    "cash_ledger_id" UUID,

    CONSTRAINT "cocok_bank_baris_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cocok_bank_baris_cocok_fk" FOREIGN KEY ("cocok_id", "unit_id", "aktif")
        REFERENCES "app"."cocok_bank"("id", "unit_id", "aktif")
        ON UPDATE CASCADE,
    CONSTRAINT "cocok_bank_baris_mutasi_fk" FOREIGN KEY ("mutasi_bank_id", "unit_id")
        REFERENCES "app"."mutasi_bank"("id", "unit_id"),
    CONSTRAINT "cocok_bank_baris_kas_fk" FOREIGN KEY ("cash_ledger_id", "unit_id")
        REFERENCES "app"."cash_ledger"("id", "unit_id"),
    -- Tepat satu: baris impor ATAU baris kas.
    CONSTRAINT "cocok_bank_baris_satu_jenis" CHECK (num_nonnulls("mutasi_bank_id", "cash_ledger_id") = 1),
    -- Anggota yang sama tak tercatat dua kali di satu kelompok.
    CONSTRAINT "cocok_bank_baris_mutasi_uq" UNIQUE ("cocok_id", "mutasi_bank_id"),
    CONSTRAINT "cocok_bank_baris_kas_uq" UNIQUE ("cocok_id", "cash_ledger_id")
);

-- 🔴 Keputusan 2: satu kelompok AKTIF per baris impor / per baris kas.
CREATE UNIQUE INDEX IF NOT EXISTS "cocok_bank_baris_mutasi_aktif_uq"
    ON "app"."cocok_bank_baris"("mutasi_bank_id") WHERE "aktif" AND "mutasi_bank_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "cocok_bank_baris_kas_aktif_uq"
    ON "app"."cocok_bank_baris"("cash_ledger_id") WHERE "aktif" AND "cash_ledger_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "cocok_bank_baris_unit_idx"
    ON "app"."cocok_bank_baris"("unit_id", "cocok_id");

-- cash_ledger.lahir_dari_cocok_id — baris kas yang dilahirkan klasifikasi
-- kelompok itu (U11 mengisinya). NULL untuk semua baris lama dan untuk setiap
-- baris yang hanya DIcocokkan (KTD6: mencocokkan tak menulis baris kas).
ALTER TABLE "app"."cash_ledger"
    ADD COLUMN IF NOT EXISTS "lahir_dari_cocok_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_ledger_lahir_dari_cocok_fk') THEN
    ALTER TABLE "app"."cash_ledger"
      ADD CONSTRAINT "cash_ledger_lahir_dari_cocok_fk"
      FOREIGN KEY ("lahir_dari_cocok_id", "unit_id") REFERENCES "app"."cocok_bank"("id", "unit_id");
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "cash_ledger_lahir_dari_cocok_idx"
    ON "app"."cash_ledger"("lahir_dari_cocok_id") WHERE "lahir_dari_cocok_id" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "app"."cocok_bank" TO dashboard_app;
    REVOKE DELETE ON "app"."cocok_bank" FROM dashboard_app;
    -- Keputusan 5: anggota tak bisa disunting aplikasi.
    GRANT SELECT, INSERT ON "app"."cocok_bank_baris" TO dashboard_app;
    REVOKE UPDATE, DELETE ON "app"."cocok_bank_baris" FROM dashboard_app;
  END IF;
END
$$;

-- Tanpa seed: kedua tabel lahir kosong (§4.1b c tetap dipatuhi — tak ada
-- INSERT ter-scope unit di bawah blok RLS).

-- RLS — cabang NULL DIPUTUSKAN SADAR: **TIDAK ADA**. Setiap kelompok &
-- anggotanya milik satu unit (`unit_id` NOT NULL). Predikat disalin PERSIS dari
-- 0016 (§4.1b).
DO $$
DECLARE
  t text;
  predicate text := $p$unit_id = ANY (ARRAY(
      SELECT tok::int
      FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
      WHERE tok ~ '^-?[0-9]+$'
  ))$p$;
BEGIN
  FOREACH t IN ARRAY ARRAY['cocok_bank', 'cocok_bank_baris'] LOOP
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
