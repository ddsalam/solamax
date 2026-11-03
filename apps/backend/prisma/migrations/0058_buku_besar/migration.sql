-- 0058_buku_besar — buku besar debet-kredit: jurnal, baris jurnal, saldo awal
-- pos, dan penanda "bulan ditutup dengan buku besar".
--
-- Rencana: docs/plans/2026-11-02-1804-feat-keuangan-buku-besar-posting-otomatis-plan.html
-- (U8; R6, R7, R9, R11, R13; KTD3, KTD4, KTD5, KTD10).
--
--   app.jurnal          — satu catatan buku besar per unit. Jenis: `sumber`
--                         (dibentuk sistem dari catatan sumber, kunci stabil),
--                         `koreksi` (selisih bulan tertutup, bertanggal maju),
--                         `memorial` (HoF, U9), `saldo_awal` (U9).
--   app.jurnal_baris    — sisi debet/kredit dalam sen, satu pos empat digit.
--   app.saldo_awal_pos  — saldo awal per unit per pos per 30 Sep 2026 (R9),
--                         diisi lewat layar U9. Tabel lahir sekarang.
--   app.tutup_bulan     — + `buku_besar`: bulan ini ditutup DENGAN buku besar.
--   app.reason_code     — + ADJ-FWD-LEDGER (koreksi buku besar dibukukan maju).
--
-- ⛔ KEPUTUSAN YANG MENGIKAT:
--
-- 1. **Seimbang per jurnal, ditegakkan DB** — constraint trigger DEFERRABLE
--    INITIALLY DEFERRED: Σ debet = Σ kredit dan minimal dua baris, diperiksa
--    saat COMMIT. Tunda, bukan seketika: baris jurnal disisipkan satu per satu,
--    dan pembentukan ulang menghapus lalu menyisipkan baris dalam satu transaksi.
-- 2. **Sen bulat (BIGINT), tidak bertanda per baris.** Tepat satu dari debet/
--    kredit > 0 (CHECK). Tanda ada di sisi, bukan di angka.
-- 3. **Kunci sumber stabil (KTD3)** — unik parsial (unit, sumber_tabel,
--    sumber_id, aturan) untuk jenis `sumber`, sehingga pembentukan ulang
--    menimpa jurnal yang sama, bukan menggandakan.
-- 4. **Garis beku = tutup bulan dengan buku besar (R13).** Trigger menolak
--    INSERT/UPDATE/DELETE jurnal (dan barisnya) yang tanggal bukunya jatuh di
--    bulan `tutup_bulan.buku_besar = true`. Bulan yang ditutup K5 sebelum 0058
--    (`buku_besar = false`) masih boleh di-backfill SATU KALI (aturan di
--    `buku-besar-model.ts` `modeBentukUlang`); DB tidak membedakan backfill,
--    aplikasi yang memutuskan. Hanya jurnal `sumber` yang boleh DIHAPUS —
--    memorial dan koreksi dibatalkan dengan pembalikan.
-- 5. **`tutup_bulan.buku_besar` DEFAULT false.** Baris lama = tutup K5 tanpa
--    buku besar. Penutup bulan yang memeriksa buku besar (U11) WAJIB menyisipkan
--    `buku_besar = true`; tabel itu tetap tanpa UPDATE (0054 keputusan 1).
-- 6. **Pos yang dijurnal harus ada, bukan induk, dan bukan 3900** (Laba Tahun
--    Berjalan dihitung, tidak dijurnal). Pos resmi dari `app.pos`, sub-pos dari
--    `app.pos_unit` unit yang SAMA. Berlaku juga untuk saldo awal pos.
-- 7. **Pengusul tidak menyetujui memorialnya sendiri** (R8) — CHECK. Kolom
--    persetujuan nullable; alurnya milik U9.
-- 8. **Saldo awal pos VOID-only**, satu aktif per (unit, pos) — pola
--    pihak_lawan_saldo_awal 0049. Bertanda: positif = saldo debet.
--
-- Idempoten / aman re-run.

-- ---------------------------------------------------------------------------
-- 1. Penanda tutup bulan dengan buku besar + kode alasan
-- ---------------------------------------------------------------------------
ALTER TABLE "app"."tutup_bulan"
    ADD COLUMN IF NOT EXISTS "buku_besar" BOOLEAN NOT NULL DEFAULT false;

INSERT INTO "app"."reason_code" ("code", "label", "applies_to", "requires_target_date") VALUES
    ('ADJ-FWD-LEDGER', 'Koreksi buku besar bulan tertutup (dibukukan maju)', 'adjustment', false)
ON CONFLICT ("code") DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Jurnal
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."jurnal" (
    "id"                     UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"                SMALLINT NOT NULL,
    -- Hari buku: tanggal jurnal masuk laporan.
    "tanggal_buku"           DATE NOT NULL,
    -- Tanggal asal (R33): sama dengan tanggal_buku kecuali jurnal terdorong maju.
    "tanggal_efektif"        DATE NOT NULL,
    "jenis"                  TEXT NOT NULL,
    -- P1–P28 (Tabel Aturan Posting), ADJ-FWD untuk koreksi maju.
    "aturan"                 TEXT NOT NULL,
    "sumber_tabel"           TEXT,
    "sumber_id"              TEXT,
    -- Ditulis backfill ke bulan yang ditutup K5 (KTD3).
    "backfill"               BOOLEAN NOT NULL DEFAULT false,
    "alasan_maju"            TEXT,
    "keterangan"             TEXT NOT NULL,
    "status"                 TEXT NOT NULL DEFAULT 'aktif',
    -- Persetujuan memorial (R8, U9).
    "diusulkan_oleh_user_id" INTEGER,
    "disetujui_oleh_user_id" INTEGER,
    "disetujui_at"           TIMESTAMPTZ,
    -- NULL = dibentuk sistem.
    "created_by_user_id"     INTEGER,
    "created_at"             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jurnal_pkey" PRIMARY KEY ("id"),
    -- Target FK komposit jurnal_baris (idiom 0019/0029/0053).
    CONSTRAINT "jurnal_unit_uq" UNIQUE ("id", "unit_id"),
    CONSTRAINT "jurnal_jenis_sah" CHECK ("jenis" IN ('sumber', 'koreksi', 'memorial', 'saldo_awal')),
    CONSTRAINT "jurnal_status_sah" CHECK ("status" IN ('aktif', 'menunggu', 'batal')),
    CONSTRAINT "jurnal_aturan_sah" CHECK ("aturan" ~ '^(P([1-9]|1[0-9]|2[0-8])|ADJ-FWD)$'),
    CONSTRAINT "jurnal_keterangan_isi" CHECK (btrim("keterangan") <> ''),
    -- Buku besar mulai 1 Okt 2026; saldo awal bertanggal 30 Sep 2026 (R9).
    CONSTRAINT "jurnal_tanggal_mulai" CHECK (
        ("jenis" = 'saldo_awal' AND "tanggal_buku" = DATE '2026-09-30')
        OR ("jenis" <> 'saldo_awal' AND "tanggal_buku" >= DATE '2026-10-01')
    ),
    CONSTRAINT "jurnal_efektif_tidak_sesudah" CHECK ("tanggal_efektif" <= "tanggal_buku"),
    -- Jurnal sumber dan koreksi selalu punya kunci sumber.
    CONSTRAINT "jurnal_kunci_sumber" CHECK (
        "jenis" NOT IN ('sumber', 'koreksi')
        OR ("sumber_tabel" IS NOT NULL AND "sumber_id" IS NOT NULL)
    ),
    -- Jurnal sumber tidak melalui persetujuan.
    CONSTRAINT "jurnal_sumber_aktif" CHECK ("jenis" <> 'sumber' OR "status" = 'aktif'),
    -- Koreksi selalu maju dan beralasan ADJ-FWD-*; yang beralasan maju memang maju.
    CONSTRAINT "jurnal_koreksi_beralasan" CHECK ("jenis" <> 'koreksi' OR "alasan_maju" IS NOT NULL),
    CONSTRAINT "jurnal_maju_bentuk" CHECK (
        "alasan_maju" IS NULL
        OR ("alasan_maju" LIKE 'ADJ-FWD-%' AND "tanggal_efektif" < "tanggal_buku")
    ),
    CONSTRAINT "jurnal_alasan_maju_fk" FOREIGN KEY ("alasan_maju") REFERENCES "app"."reason_code"("code"),
    -- Keputusan 7.
    CONSTRAINT "jurnal_empat_mata" CHECK (
        "disetujui_oleh_user_id" IS NULL OR "diusulkan_oleh_user_id" IS NULL
        OR "disetujui_oleh_user_id" <> "diusulkan_oleh_user_id"
    ),
    CONSTRAINT "jurnal_persetujuan_pasangan" CHECK (("disetujui_oleh_user_id" IS NULL) = ("disetujui_at" IS NULL))
);

-- Keputusan 3.
CREATE UNIQUE INDEX IF NOT EXISTS "jurnal_sumber_uq"
    ON "app"."jurnal" ("unit_id", "sumber_tabel", "sumber_id", "aturan")
    WHERE "jenis" = 'sumber';
CREATE INDEX IF NOT EXISTS "jurnal_unit_tanggal_buku_idx" ON "app"."jurnal" ("unit_id", "tanggal_buku");
CREATE INDEX IF NOT EXISTS "jurnal_unit_tanggal_efektif_idx" ON "app"."jurnal" ("unit_id", "tanggal_efektif");

CREATE TABLE IF NOT EXISTS "app"."jurnal_baris" (
    "id"         UUID NOT NULL DEFAULT gen_random_uuid(),
    "jurnal_id"  UUID NOT NULL,
    "unit_id"    SMALLINT NOT NULL,
    "pos_kode"   TEXT NOT NULL,
    "debet_sen"  BIGINT NOT NULL DEFAULT 0,
    "kredit_sen" BIGINT NOT NULL DEFAULT 0,
    "keterangan" TEXT,

    CONSTRAINT "jurnal_baris_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "jurnal_baris_kode_empat_digit" CHECK ("pos_kode" ~ '^[1-5][0-9]{3}$'),
    -- Keputusan 2.
    CONSTRAINT "jurnal_baris_satu_sisi" CHECK (
        ("debet_sen" > 0 AND "kredit_sen" = 0) OR ("kredit_sen" > 0 AND "debet_sen" = 0)
    ),
    -- Baris milik jurnal unit yang SAMA.
    CONSTRAINT "jurnal_baris_jurnal_fk" FOREIGN KEY ("jurnal_id", "unit_id")
        REFERENCES "app"."jurnal"("id", "unit_id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "jurnal_baris_jurnal_idx" ON "app"."jurnal_baris" ("jurnal_id");
CREATE INDEX IF NOT EXISTS "jurnal_baris_unit_pos_idx" ON "app"."jurnal_baris" ("unit_id", "pos_kode");

-- ---------------------------------------------------------------------------
-- 3. Saldo awal pos (R9)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."saldo_awal_pos" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"            SMALLINT NOT NULL,
    "pos_kode"           TEXT NOT NULL,
    "per_tanggal"        DATE NOT NULL DEFAULT DATE '2026-09-30',
    -- Keputusan 8: positif = saldo debet, negatif = saldo kredit.
    "saldo_sen"          BIGINT NOT NULL,
    -- akuntan = diketik HoF dari data akuntan; akun_kas = dibaca dari saldo pembuka akun kas/bank.
    "sumber"             TEXT NOT NULL,
    "entered_by_user_id" INTEGER NOT NULL,
    "entered_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "void"               BOOLEAN NOT NULL DEFAULT false,
    "voided_by_user_id"  INTEGER,
    "voided_at"          TIMESTAMPTZ,

    CONSTRAINT "saldo_awal_pos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "saldo_awal_pos_kode_empat_digit" CHECK ("pos_kode" ~ '^[1-5][0-9]{3}$'),
    CONSTRAINT "saldo_awal_pos_tanggal" CHECK ("per_tanggal" = DATE '2026-09-30'),
    CONSTRAINT "saldo_awal_pos_sumber_sah" CHECK ("sumber" IN ('akuntan', 'akun_kas')),
    CONSTRAINT "saldo_awal_pos_void_audit" CHECK (
        "void" = ("voided_at" IS NOT NULL) AND "void" = ("voided_by_user_id" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS "saldo_awal_pos_aktif_uq"
    ON "app"."saldo_awal_pos" ("unit_id", "pos_kode") WHERE NOT "void";

-- ---------------------------------------------------------------------------
-- 4. Trigger
-- ---------------------------------------------------------------------------

-- Keputusan 6 — dipakai jurnal_baris dan saldo_awal_pos (kolom unit_id, pos_kode).
CREATE OR REPLACE FUNCTION "app"."pos_jurnal_sah"()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  induk boolean;
BEGIN
  IF NEW."pos_kode" = '3900' THEN
    RAISE EXCEPTION 'pos 3900 Laba Tahun Berjalan dihitung dari kelas 4 dan 5 — tidak bisa dijurnal'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT p."induk" INTO induk FROM "app"."pos" p WHERE p."kode" = NEW."pos_kode";
  IF FOUND THEN
    IF induk THEN
      RAISE EXCEPTION 'pos % adalah pos induk — jurnal memakai sub-posnya', NEW."pos_kode"
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM "app"."pos_unit" u WHERE u."unit_id" = NEW."unit_id" AND u."kode" = NEW."pos_kode"
  ) THEN
    RAISE EXCEPTION 'pos % tidak dikenal di unit %', NEW."pos_kode", NEW."unit_id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS "jurnal_baris_pos_sah" ON "app"."jurnal_baris";
CREATE TRIGGER "jurnal_baris_pos_sah"
    BEFORE INSERT OR UPDATE OF "pos_kode", "unit_id" ON "app"."jurnal_baris"
    FOR EACH ROW EXECUTE FUNCTION "app"."pos_jurnal_sah"();

DROP TRIGGER IF EXISTS "saldo_awal_pos_pos_sah" ON "app"."saldo_awal_pos";
CREATE TRIGGER "saldo_awal_pos_pos_sah"
    BEFORE INSERT OR UPDATE OF "pos_kode", "unit_id" ON "app"."saldo_awal_pos"
    FOR EACH ROW EXECUTE FUNCTION "app"."pos_jurnal_sah"();

-- Keputusan 1 — satu fungsi untuk dua constraint trigger (jurnal dan barisnya).
CREATE OR REPLACE FUNCTION "app"."jurnal_seimbang"()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  jid uuid;
  ids uuid[];
  n int;
  d bigint;
  k bigint;
BEGIN
  IF TG_TABLE_NAME = 'jurnal' THEN
    ids := ARRAY[NEW."id"];
  ELSIF TG_OP = 'INSERT' THEN
    ids := ARRAY[NEW."jurnal_id"];
  ELSIF TG_OP = 'DELETE' THEN
    ids := ARRAY[OLD."jurnal_id"];
  ELSE
    ids := ARRAY[OLD."jurnal_id", NEW."jurnal_id"];
  END IF;
  FOREACH jid IN ARRAY ids LOOP
    -- Jurnal yang sudah dihapus (CASCADE) tak perlu seimbang.
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM "app"."jurnal" j WHERE j."id" = jid);
    SELECT count(*), COALESCE(sum(b."debet_sen"), 0), COALESCE(sum(b."kredit_sen"), 0)
      INTO n, d, k
      FROM "app"."jurnal_baris" b WHERE b."jurnal_id" = jid;
    IF n < 2 OR d <> k THEN
      RAISE EXCEPTION 'jurnal % tidak seimbang: % baris, debet % sen, kredit % sen', jid, n, d, k
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN NULL;
END
$fn$;

DROP TRIGGER IF EXISTS "jurnal_seimbang" ON "app"."jurnal";
CREATE CONSTRAINT TRIGGER "jurnal_seimbang"
    AFTER INSERT ON "app"."jurnal"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION "app"."jurnal_seimbang"();

DROP TRIGGER IF EXISTS "jurnal_baris_seimbang" ON "app"."jurnal_baris";
CREATE CONSTRAINT TRIGGER "jurnal_baris_seimbang"
    AFTER INSERT OR UPDATE OR DELETE ON "app"."jurnal_baris"
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION "app"."jurnal_seimbang"();

-- Keputusan 4 — garis beku.
CREATE OR REPLACE FUNCTION "app"."jurnal_bulan_beku"()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  u smallint;
  t date;
  r record;
BEGIN
  IF TG_TABLE_NAME = 'jurnal' THEN
    IF TG_OP = 'DELETE' AND OLD."jenis" <> 'sumber' THEN
      RAISE EXCEPTION 'jurnal % (%) tidak boleh dihapus — batalkan dengan pembalikan', OLD."id", OLD."jenis"
        USING ERRCODE = 'check_violation';
    END IF;
    FOR r IN
      SELECT x.unit_id, x.tanggal_buku FROM (VALUES
        (CASE WHEN TG_OP <> 'INSERT' THEN OLD."unit_id" END, CASE WHEN TG_OP <> 'INSERT' THEN OLD."tanggal_buku" END),
        (CASE WHEN TG_OP <> 'DELETE' THEN NEW."unit_id" END, CASE WHEN TG_OP <> 'DELETE' THEN NEW."tanggal_buku" END)
      ) AS x(unit_id, tanggal_buku)
      WHERE x.unit_id IS NOT NULL
    LOOP
      IF EXISTS (
        SELECT 1 FROM "app"."tutup_bulan" tb
         WHERE tb."unit_id" = r.unit_id AND tb."buku_besar"
           AND tb."bulan" = date_trunc('month', r.tanggal_buku)::date
      ) THEN
        RAISE EXCEPTION 'bulan % sudah ditutup dengan buku besar — jurnalnya beku; koreksi dibukukan maju',
          to_char(r.tanggal_buku, 'YYYY-MM') USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- jurnal_baris: tanggal buku dibaca dari jurnalnya. Jurnal yang sedang
  -- dihapus (CASCADE) sudah lolos pemeriksaan di atas.
  FOR r IN
    SELECT j."unit_id", j."tanggal_buku" FROM "app"."jurnal" j
     WHERE j."id" IN (
       CASE WHEN TG_OP <> 'INSERT' THEN OLD."jurnal_id" END,
       CASE WHEN TG_OP <> 'DELETE' THEN NEW."jurnal_id" END
     )
  LOOP
    IF EXISTS (
      SELECT 1 FROM "app"."tutup_bulan" tb
       WHERE tb."unit_id" = r.unit_id AND tb."buku_besar"
         AND tb."bulan" = date_trunc('month', r.tanggal_buku)::date
    ) THEN
      RAISE EXCEPTION 'bulan % sudah ditutup dengan buku besar — baris jurnalnya beku',
        to_char(r.tanggal_buku, 'YYYY-MM') USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$fn$;

DROP TRIGGER IF EXISTS "jurnal_bulan_beku" ON "app"."jurnal";
CREATE TRIGGER "jurnal_bulan_beku"
    BEFORE INSERT OR UPDATE OR DELETE ON "app"."jurnal"
    FOR EACH ROW EXECUTE FUNCTION "app"."jurnal_bulan_beku"();

DROP TRIGGER IF EXISTS "jurnal_baris_bulan_beku" ON "app"."jurnal_baris";
CREATE TRIGGER "jurnal_baris_bulan_beku"
    BEFORE INSERT OR UPDATE OR DELETE ON "app"."jurnal_baris"
    FOR EACH ROW EXECUTE FUNCTION "app"."jurnal_bulan_beku"();

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    -- Pembentukan ulang menimpa dan menghapus jurnal sumber; trigger keputusan
    -- 4 yang membatasi apa yang boleh dihapus dan kapan.
    GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."jurnal" TO dashboard_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "app"."jurnal_baris" TO dashboard_app;
    -- Keputusan 8: VOID-only.
    GRANT SELECT, INSERT, UPDATE ON "app"."saldo_awal_pos" TO dashboard_app;
    REVOKE DELETE ON "app"."saldo_awal_pos" FROM dashboard_app;
  END IF;
END
$$;

-- Tanpa seed: ketiga tabel lahir kosong (§4.1b c — tak ada INSERT ter-scope
-- unit di bawah blok RLS). Jurnal dibentuk aksi "Bentuk ulang buku besar".

-- RLS — cabang NULL DIPUTUSKAN SADAR: **TIDAK ADA**. Jurnal, barisnya, dan
-- saldo awal pos selalu milik SATU unit (`unit_id` NOT NULL). Predikat disalin
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
  FOREACH t IN ARRAY ARRAY['jurnal', 'jurnal_baris', 'saldo_awal_pos'] LOOP
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
