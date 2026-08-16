-- 0026_day_close — GERBANG PENUTUPAN HARI. Jantung modul keuangan.
--
-- Keputusan yang diwujudkan: KEUANGAN-HARIAN.md §3 (tangga toleransi), §4.6
-- (bentuk data), §10.2 (reason_code), dan keputusan owner 13 Agu 2026 untuk
-- wewenang tingkat ketiga. Baca §3 dulu; berkas ini menegakkan, tidak memutuskan.
--
-- Tangga §3.2 — yang diukur adalah LANGKAH HARIAN `BSCheck(d) − BSCheck(d−1)`
-- (§1.2), BUKAN nilai kumulatifnya:
--
--   |selisih| ≤ 10.000          → within_tolerance  · penutup operasional
--   10.001 … 100.000            → exception_hof     · Head of Finance
--   > 100.000                   → override_direksi  · Direksi / super_admin
--
-- ⛔ Selisih ≤ toleransi TIDAK dinolkan dan TIDAK diabaikan. Ia disimpan apa
-- adanya beserta `reason_code`-nya. Alasannya bukan kerapian: pola yang berulang
-- hanya terlihat kalau selisih kecil disimpan. Gerbang yang "membereskan"
-- selisih dengan membuangnya menghapus buktinya sendiri.
--
-- Idempoten / aman re-run.

-- ---------------------------------------------------------------------------
-- Prasyarat: kunci unik untuk FK KOMPOSIT ke reason_code.
--
-- `code` sudah PRIMARY KEY, jadi (code, requires_target_date) otomatis unik —
-- tetapi Postgres menuntut constraint unik EKSPLISIT pada persis kolom yang
-- direferensikan FK. Idiom yang sama dipakai 0019 untuk mengunci keselarasan
-- unit↔tenant secara STRUKTURAL.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reason_code_target_uq'
  ) THEN
    ALTER TABLE "app"."reason_code"
      ADD CONSTRAINT "reason_code_target_uq" UNIQUE ("code", "requires_target_date");
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'day_close_status' AND n.nspname = 'app'
  ) THEN
    CREATE TYPE "app"."day_close_status" AS ENUM ('open', 'closed');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'day_close_tier' AND n.nspname = 'app'
  ) THEN
    CREATE TYPE "app"."day_close_tier" AS ENUM
      ('within_tolerance', 'exception_hof', 'override_direksi');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "app"."day_close" (
    "unit_id"       SMALLINT NOT NULL,
    "business_date" DATE NOT NULL,
    "status"        "app"."day_close_status" NOT NULL DEFAULT 'open',

    -- Selisih APA ADANYA: langkah harian, tidak dibulatkan, tidak dinolkan,
    -- termasuk yang ≤ Rp 10.000.
    "difference_rp" DECIMAL(17,2) NOT NULL,

    "tier"          "app"."day_close_tier" NOT NULL,

    "reason_code"   TEXT,
    -- Bayangan `reason_code.requires_target_date`, dijaga FK komposit di bawah
    -- sehingga TIDAK BISA menyimpang dari masternya. Ini yang membuat CHECK
    -- tanggal-target membaca DATA, bukan menghardcode 'CLS-INVESTIGATING'.
    "reason_requires_target" BOOLEAN,
    "target_date"   DATE,

    "closed_by_user_id"   INTEGER,
    "closed_at"           TIMESTAMPTZ,
    "approved_by_user_id" INTEGER,
    "approved_at"         TIMESTAMPTZ,

    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "day_close_pkey" PRIMARY KEY ("unit_id", "business_date"),

    CONSTRAINT "day_close_reason_fk" FOREIGN KEY ("reason_code", "reason_requires_target")
        REFERENCES "app"."reason_code"("code", "requires_target_date"),

    -- §4.6: reason_code WAJIB bila selisihnya bukan nol.
    CONSTRAINT "day_close_reason_required" CHECK (
        "difference_rp" = 0 OR "reason_code" IS NOT NULL
    ),
    -- Bayangannya ikut ada/tiada bersama kodenya (FK MATCH SIMPLE tidak
    -- menegakkan apa pun bila salah satu kolomnya NULL — celah itu ditutup di sini).
    CONSTRAINT "day_close_reason_shadow" CHECK (
        ("reason_code" IS NULL) = ("reason_requires_target" IS NULL)
    ),

    -- ⛔ TANGGAL TARGET WAJIB — dibaca dari DATA, bukan dari nama kode.
    -- `CLS-INVESTIGATING` tidak disebut di mana pun: yang menentukan adalah
    -- kolom `requires_target_date` di masternya. Kalau kelak ada kode kedua yang
    -- menuntut target, ia cukup diberi flag itu — tanpa menyentuh migrasi ini.
    --
    -- Inilah yang membuat CLS-INVESTIGATING katup jujur dan bukan tempat sampah:
    -- eskalasi ke Direksi bersandar pada LEWATNYA tanggal target, bukan pada ada
    -- orang yang ingat melapor.
    CONSTRAINT "day_close_target_required" CHECK (
        NOT COALESCE("reason_requires_target", false) OR "target_date" IS NOT NULL
    ),
    -- Tanggal target tak punya arti tanpa kode yang menuntutnya.
    CONSTRAINT "day_close_target_clean" CHECK (
        "target_date" IS NULL OR COALESCE("reason_requires_target", false)
    ),

    -- ⛔ TIER ADALAH FUNGSI DARI SELISIH, bukan pilihan bebas. Tanpa CHECK ini,
    -- selisih Rp 5 juta bisa ditulis `within_tolerance` dan lolos tanpa
    -- persetujuan siapa pun — tangga §3.2 runtuh dari dalam, tanpa galat.
    -- Ambangnya pada NILAI MUTLAK: toleransi soal besaran, bukan arah.
    CONSTRAINT "day_close_tier_matches_difference" CHECK (
        (abs("difference_rp") <= 10000      AND "tier" = 'within_tolerance') OR
        (abs("difference_rp") >  10000 AND
         abs("difference_rp") <= 100000     AND "tier" = 'exception_hof')    OR
        (abs("difference_rp") >  100000     AND "tier" = 'override_direksi')
    ),

    -- Persetujuan WAJIB untuk tier di luar toleransi (§3.2), dan TIDAK BOLEH ada
    -- untuk yang di dalam toleransi — supaya "disetujui" tetap berarti sesuatu.
    CONSTRAINT "day_close_approval_required" CHECK (
        "tier" = 'within_tolerance'
        OR "status" = 'open'
        OR ("approved_by_user_id" IS NOT NULL AND "approved_at" IS NOT NULL)
    ),
    CONSTRAINT "day_close_approval_clean" CHECK (
        "tier" <> 'within_tolerance'
        OR ("approved_by_user_id" IS NULL AND "approved_at" IS NULL)
    ),

    -- Hari yang berstatus `closed` wajib menyebut siapa dan kapan.
    CONSTRAINT "day_close_closed_audit" CHECK (
        "status" <> 'closed'
        OR ("closed_by_user_id" IS NOT NULL AND "closed_at" IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS "day_close_unit_status_idx"
    ON "app"."day_close"("unit_id", "status", "business_date" DESC);
-- Daftar kerja: hari yang ditutup dengan katup "sedang ditelusuri" dan sudah
-- LEWAT tanggal targetnya. Indeks parsial supaya pemeriksaan itu murah — dan
-- karenanya benar-benar dijalankan.
CREATE INDEX IF NOT EXISTS "day_close_target_overdue_idx"
    ON "app"."day_close"("target_date")
    WHERE "target_date" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "app"."day_close" TO dashboard_app;
    REVOKE DELETE ON "app"."day_close" FROM dashboard_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- RLS unit-scoped — CABANG NULL DIPUTUSKAN SECARA SADAR: **TIDAK ADA**.
--
-- Berbeda dari `category_account_map` (0023) yang memang punya baris berlaku-
-- global (`unit_id IS NULL` = semua unit), `day_close` **tidak boleh** punya
-- baris global: penutupan hari selalu milik SATU unit pada SATU tanggal, dan
-- itu sudah dikunci PRIMARY KEY (unit_id, business_date) yang NOT NULL.
--
-- Karena itu predikatnya disalin PERSIS dari 0016, tanpa cabang `IS NULL`.
-- Dinyatakan di sini supaya ketiadaan cabang itu terbaca sebagai KEPUTUSAN,
-- bukan sebagai salinan yang kebetulan.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  predicate text := $p$unit_id = ANY (ARRAY(
      SELECT tok::int
      FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
      WHERE tok ~ '^-?[0-9]+$'
  ))$p$;
BEGIN
  EXECUTE 'ALTER TABLE "app"."day_close" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "app"."day_close" FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS unit_scope ON "app"."day_close"';
  EXECUTE format(
    'CREATE POLICY unit_scope ON "app"."day_close" USING (%s) WITH CHECK (%s)',
    predicate, predicate
  );
END
$$;

-- ---------------------------------------------------------------------------
-- IMMUTABILITAS SETELAH HARI DITUTUP (§2.2 nomor 3) — DI DB, struktural.
--
-- Janjinya: setelah day closing disahkan, transaksi asli immutable bagi pengawas
-- MAUPUN Finance. Aplikasi yang lupa memeriksa TIDAK BOLEH cukup untuk
-- melanggarnya — karena itu penjaganya di sini, bukan di server action.
--
-- Trigger ini MENGGANTIKAN penjaga 0024 yang hanya melihat `manual_entry.status`:
-- status itu harus diingat seseorang untuk diisi, sedangkan `day_close` adalah
-- fakta penutupan itu sendiri. Menanyakan fakta lebih kuat daripada menanyakan
-- penanda yang mewakilinya.
--
-- ⚠️ URUTAN YANG WAJIB DIIKUTI SAAT MENUTUP HARI: perbarui `manual_entry`
-- (mis. `status` → 'closed') LEBIH DULU, baru INSERT/UPDATE `day_close` menjadi
-- `closed`. Sesudah barisnya `closed`, setiap UPDATE ke manual_entry hari itu
-- ditolak — termasuk oleh proses penutupan itu sendiri.
--
-- ⛔ YANG TRIGGER INI TIDAK JAGA — sebut apa adanya: ia menahan UPDATE dan
-- DELETE, TIDAK menahan INSERT baris BARU bertanggal hari yang sudah ditutup.
-- Menahan INSERT belum diputuskan owner (lihat catatan di PR); dampaknya nyata,
-- jadi jangan dianggap sudah tertutup.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "app"."manual_entry_block_after_day_close"()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  tutup boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM "app"."day_close" d
    WHERE d."unit_id" = OLD."unit_id"
      AND d."business_date" = OLD."business_date"
      AND d."status" = 'closed'
  ) INTO tutup;

  IF tutup THEN
    RAISE EXCEPTION
      'hari sudah ditutup (unit % tanggal %): manual_entry % tidak bisa diubah/di-void. Pakai Adjust/Reverse.',
      OLD."unit_id", OLD."business_date", OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS "manual_entry_immutable_after_close" ON "app"."manual_entry";
CREATE TRIGGER "manual_entry_immutable_after_close"
    BEFORE UPDATE OR DELETE ON "app"."manual_entry"
    FOR EACH ROW
    EXECUTE FUNCTION "app"."manual_entry_block_after_day_close"();
