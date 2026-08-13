-- 0027_backdate_override — JALUR TEMBUS bernama untuk INSERT ke hari yang sudah
-- ditutup. Keputusan owner 13 Agustus 2026.
--
-- Latar: 0026 menahan UPDATE dan DELETE pada `app.manual_entry` setelah hari
-- ditutup, tetapi TIDAK menahan INSERT — entri baru yang di-backdate ke hari
-- tertutup melewati seluruh gerbang. Keputusan owner: **tahan secara default,
-- dengan jalur tembus bagi Finance yang memakai reason code + approver.**
--
-- ⛔ BENTUKNYA MENGIKAT. Jalur tembus yang salah bentuk LEBIH BURUK daripada
-- tidak ada gerbang sama sekali: ia memberi rasa aman tanpa memberi jaminan.
-- Lima syarat, semuanya diwujudkan di bawah:
--
-- 1. **BUKAN flag GUC.** Jangan pernah menegakkannya lewat
--    `current_setting('app.…')` seperti RLS. GUC fail-**OPEN**: aplikasi yang
--    salah menyetelnya membuka pintu TANPA JEJAK. Yang dipakai di sini adalah
--    CATATAN OVERRIDE SEBAGAI DATA, yang dikonsultasi trigger — sehingga setiap
--    kali pintu terbuka, ada barisnya.
-- 2. Baris override ber-(unit_id, business_date) membawa `reason_code` WAJIB
--    ber-`applies_to = 'adjustment'` (dikunci FK KOMPOSIT, idiom 0019/0026),
--    pengaju, approver, waktu persetujuan, dan alasan tertulis.
-- 3. Approver wajib memenuhi `canCloseException`. ⚠️ Lihat batas di bawah:
--    yang DB tegakkan adalah `requested_by <> approved_by`; kapabilitasnya
--    dijaga lapis aturan (`keuangan-override.ts`) karena keanggotaan Head of
--    Finance hidup di ENV (§10.4), di luar jangkauan Postgres.
-- 4. **SEKALI PAKAI.** Override dikonsumsi begitu satu INSERT lolos. Dari dua
--    pilihan owner (sekali pakai / ber-`expires_at` pendek) dipilih sekali pakai
--    karena ia sekaligus memenuhi syarat 5: konsumsinya MENCATAT entri mana yang
--    ia izinkan, jadi tautannya 1:1 dan tak perlu kolom baru di tabel produksi.
--    Override yang MENETAP membuka hari itu SELAMANYA dan tak seorang pun akan
--    menyadarinya — itulah kegagalan yang paling mahal di sini.
-- 5. Setiap INSERT yang lolos tertaut ke override-nya lewat `consumed_by_entry_id`.
--    Jalur tembus yang tidak terlihat bukan jalur tembus, ia kebocoran.
--
-- Idempoten / aman re-run.

-- Prasyarat FK komposit: kunci unik eksplisit pada (code, applies_to).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reason_code_applies_uq') THEN
    ALTER TABLE "app"."reason_code"
      ADD CONSTRAINT "reason_code_applies_uq" UNIQUE ("code", "applies_to");
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "app"."backdate_override" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"       SMALLINT NOT NULL,
    "business_date" DATE NOT NULL,

    "reason_code"   TEXT NOT NULL,
    -- Bayangan `reason_code.applies_to`, dikunci FK komposit + CHECK di bawah
    -- sehingga HANYA kode ber-applies_to='adjustment' yang bisa dipakai. Tanpa
    -- ini, kode `closing` bisa dipinjam untuk membenarkan backdate.
    "reason_applies_to" TEXT NOT NULL,
    "alasan"        TEXT NOT NULL,

    "requested_by_user_id" INTEGER NOT NULL,
    "approved_by_user_id"  INTEGER,
    "approved_at"          TIMESTAMPTZ,

    -- SEKALI PAKAI + tautan ke entri yang ia izinkan (syarat 4 & 5).
    "consumed_at"           TIMESTAMPTZ,
    "consumed_by_entry_id"  UUID,

    "void"          BOOLEAN NOT NULL DEFAULT false,
    "voided_by_user_id" INTEGER,
    "voided_at"     TIMESTAMPTZ,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backdate_override_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "backdate_override_reason_fk"
        FOREIGN KEY ("reason_code", "reason_applies_to")
        REFERENCES "app"."reason_code"("code", "applies_to"),
    CONSTRAINT "backdate_override_reason_adjustment" CHECK (
        "reason_applies_to" = 'adjustment'
    ),

    CONSTRAINT "backdate_override_alasan_isi" CHECK (btrim("alasan") <> ''),

    -- ⛔ PEMISAHAN TUGAS, di DB — sama seperti `correction_entry` (0021).
    -- Pengaju yang bisa menyetujui dirinya sendiri membuat syarat approver
    -- menjadi hiasan.
    CONSTRAINT "backdate_override_segregation" CHECK (
        "approved_by_user_id" IS NULL
        OR "approved_by_user_id" <> "requested_by_user_id"
    ),
    -- Persetujuan = pasangan (siapa, kapan). Salah satu saja bukan persetujuan.
    CONSTRAINT "backdate_override_approval_pair" CHECK (
        ("approved_by_user_id" IS NULL) = ("approved_at" IS NULL)
    ),
    -- Konsumsi = pasangan (kapan, entri mana). Konsumsi tanpa tautan menghapus
    -- syarat 5 diam-diam.
    CONSTRAINT "backdate_override_consumed_pair" CHECK (
        ("consumed_at" IS NULL) = ("consumed_by_entry_id" IS NULL)
    ),
    -- Tak bisa terpakai sebelum disetujui.
    CONSTRAINT "backdate_override_consume_after_approve" CHECK (
        "consumed_at" IS NULL OR "approved_at" IS NOT NULL
    ),
    CONSTRAINT "backdate_override_void_audit" CHECK (
        "void" = ("voided_at" IS NOT NULL) AND "void" = ("voided_by_user_id" IS NOT NULL)
    )
);

-- Paling banyak SATU override aktif (disetujui, belum terpakai, belum void) per
-- (unit, tanggal). Tanpa ini, sepuluh override bisa menumpuk dan hari itu
-- terbuka sepuluh kali — "sekali pakai" yang dilipatgandakan bukan sekali pakai.
CREATE UNIQUE INDEX IF NOT EXISTS "backdate_override_aktif_uq"
    ON "app"."backdate_override"("unit_id", "business_date")
    WHERE "consumed_at" IS NULL AND NOT "void";

CREATE INDEX IF NOT EXISTS "backdate_override_unit_idx"
    ON "app"."backdate_override"("unit_id", "business_date", "created_at" DESC);
-- Laporan bulanan (syarat 5): override yang TERPAKAI, per unit per bulan.
CREATE INDEX IF NOT EXISTS "backdate_override_terpakai_idx"
    ON "app"."backdate_override"("unit_id", "consumed_at")
    WHERE "consumed_at" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "app"."backdate_override" TO dashboard_app;
    REVOKE DELETE ON "app"."backdate_override" FROM dashboard_app;
  END IF;
END
$$;

-- RLS unit-scoped. Cabang NULL DIPUTUSKAN SADAR: **TIDAK ADA** — override selalu
-- milik satu unit pada satu tanggal (kolomnya NOT NULL). Predikat disalin PERSIS
-- dari 0016 (§4.1b).
DO $$
DECLARE
  predicate text := $p$unit_id = ANY (ARRAY(
      SELECT tok::int
      FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
      WHERE tok ~ '^-?[0-9]+$'
  ))$p$;
BEGIN
  EXECUTE 'ALTER TABLE "app"."backdate_override" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "app"."backdate_override" FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS unit_scope ON "app"."backdate_override"';
  EXECUTE format(
    'CREATE POLICY unit_scope ON "app"."backdate_override" USING (%s) WITH CHECK (%s)',
    predicate, predicate
  );
END
$$;

-- ---------------------------------------------------------------------------
-- GERBANG INSERT — menahan secara default, membuka HANYA lewat override yang
-- disetujui dan belum terpakai, lalu MENGONSUMSINYA.
--
-- `FOR UPDATE` pada pencarian override bukan hiasan: dua INSERT bersamaan pada
-- hari yang sama akan berebut override yang sama, dan tanpa kunci baris keduanya
-- bisa lolos memakai satu izin. Yang kedua kini menunggu, lalu melihat
-- `consumed_at` sudah terisi dan ditolak.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "app"."manual_entry_backdate_gate"()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  ov_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "app"."day_close" d
    WHERE d."unit_id" = NEW."unit_id"
      AND d."business_date" = NEW."business_date"
      AND d."status" = 'closed'
  ) THEN
    RETURN NEW; -- hari belum ditutup: jalur biasa, tanpa syarat tambahan.
  END IF;

  SELECT o."id" INTO ov_id
    FROM "app"."backdate_override" o
   WHERE o."unit_id" = NEW."unit_id"
     AND o."business_date" = NEW."business_date"
     AND o."approved_at" IS NOT NULL
     AND o."consumed_at" IS NULL
     AND NOT o."void"
   ORDER BY o."approved_at"
   LIMIT 1
     FOR UPDATE;

  IF ov_id IS NULL THEN
    RAISE EXCEPTION
      'hari sudah ditutup (unit % tanggal %): entri baru butuh backdate_override yang DISETUJUI dan BELUM terpakai.',
      NEW."unit_id", NEW."business_date"
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE "app"."backdate_override"
     SET "consumed_at" = CURRENT_TIMESTAMP,
         "consumed_by_entry_id" = NEW."id"
   WHERE "id" = ov_id;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS "manual_entry_backdate_gate" ON "app"."manual_entry";
CREATE TRIGGER "manual_entry_backdate_gate"
    BEFORE INSERT ON "app"."manual_entry"
    FOR EACH ROW
    EXECUTE FUNCTION "app"."manual_entry_backdate_gate"();

-- ⚠️ BATAS YANG DIJAGA LAPIS INI — sebut apa adanya:
--  · DB menegakkan: ada override, DISETUJUI, BELUM terpakai, pengaju ≠ approver,
--    reason code ber-applies_to='adjustment', dan konsumsinya tercatat.
--  · DB TIDAK bisa menegakkan bahwa approver memenuhi `canCloseException`:
--    keanggotaan Head of Finance hidup di ENV (`HEAD_OF_FINANCE_EMAILS`, §10.4),
--    di luar jangkauan Postgres. Menegakkan bagian rolenya saja di DB akan
--    SALAH MENOLAK HoF (perannya `admin_perusahaan`). Kapabilitas itu dijaga
--    `keuangan-override.ts` + tesnya. Jangan menalar seolah DB menjaminnya.
