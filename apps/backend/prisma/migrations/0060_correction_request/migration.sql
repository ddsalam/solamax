-- 0060_correction_request — rencana 2026-11-07 (Batalkan & Balik baris pintu
-- Finance), U5 / KTD5. Rilis 2.
--
-- BALIK baris pintu Finance di hari yang SUDAH DITUTUP. Baris aslinya tidak
-- pernah di-UPDATE (trigger 0026 tetap menolaknya); yang lahir adalah satu baris
-- `app.correction_entry` (0021, append-only, tujuh field audit, pengaju ≠
-- approver) ber-`kind = 'reversal'`. Aturan "baris berlaku"
-- (`keuangan-berlaku.ts`) membaca reversal itu, sehingga baris tak berlaku di
-- hari ASLINYA — keputusan owner, pengecualian tercatat atas §10.33
-- (KEUANGAN-HARIAN §10.56).
--
-- `correction_entry` menuntut approver SAAT INSERT, jadi pengajuan yang
-- menunggu persetujuan butuh rumah sendiri: `app.correction_request`.
--
-- ⛔ Yang ditegakkan DI DB (bukan hanya di aplikasi):
--   · pemisahan tugas — yang menyetujui/menolak ≠ pengaju; yang menarik = pengaju;
--   · keputusan = pasangan (siapa, kapan); disetujui ⇔ ada correction_entry;
--     ditolak ⇔ ada catatan;
--   · paling banyak SATU pengajuan menunggu per baris, dan SATU reversal per baris;
--   · baris yang sudah diputus BEKU (trigger) — pengajuan bukan jejak yang bisa
--     ditulis ulang sesudah keputusan;
--   · kode alasan hanya grup `adjustment` (FK komposit + CHECK, idiom 0027).
-- ⛔ Yang TIDAK bisa ditegakkan DI DB: keanggotaan penyetuju (`canCloseException`
--   — Head of Finance hidup di ENV, §10.4; catatan 0027). Itu dijaga server.
--
-- Urutan deploy (HOUSE RULE): migrate-deploy DULU, baru image dashboard.
-- Idempoten / aman re-run.

-- Prasyarat FK komposit (original_txn_id, unit_id): kunci unik eksplisit. `id`
-- sudah unik, jadi kunci ini tak pernah menolak baris yang ada.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'manual_entry_id_unit_uq') THEN
    ALTER TABLE "app"."manual_entry" ADD CONSTRAINT "manual_entry_id_unit_uq" UNIQUE ("id", "unit_id");
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "app"."correction_request" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"           SMALLINT NOT NULL,
    -- Hari ini satu-satunya sumber yang bisa dibalik lewat pengajuan.
    "source_kind"       TEXT NOT NULL DEFAULT 'manual_entry',
    "original_txn_id"   UUID NOT NULL,
    "reason_code"       TEXT NOT NULL,
    "reason_applies_to" TEXT NOT NULL,
    "alasan"            TEXT NOT NULL,
    -- Nilai baris saat diajukan — `value_before` correction_entry nanti.
    "value_before"      DECIMAL(17,2) NOT NULL,
    "status"            TEXT NOT NULL DEFAULT 'menunggu',
    "requested_by_user_id" INTEGER NOT NULL,
    "requested_at"      TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_user_id"   INTEGER,
    "decided_at"        TIMESTAMPTZ,
    "catatan_keputusan" TEXT,
    "correction_entry_id" UUID,

    CONSTRAINT "correction_request_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "correction_request_sumber" CHECK ("source_kind" = 'manual_entry'),
    CONSTRAINT "correction_request_baris_fk"
        FOREIGN KEY ("original_txn_id", "unit_id")
        REFERENCES "app"."manual_entry"("id", "unit_id"),
    CONSTRAINT "correction_request_reason_fk"
        FOREIGN KEY ("reason_code", "reason_applies_to")
        REFERENCES "app"."reason_code"("code", "applies_to"),
    CONSTRAINT "correction_request_reason_adjustment" CHECK ("reason_applies_to" = 'adjustment'),
    CONSTRAINT "correction_request_alasan_isi" CHECK (btrim("alasan") <> ''),
    CONSTRAINT "correction_request_ce_fk"
        FOREIGN KEY ("correction_entry_id") REFERENCES "app"."correction_entry"("id"),
    CONSTRAINT "correction_request_status" CHECK (
        "status" IN ('menunggu', 'disetujui', 'ditolak', 'ditarik')
    ),
    -- Keputusan = pasangan (siapa, kapan), terisi TEPAT ketika sudah diputus.
    CONSTRAINT "correction_request_keputusan_pasangan" CHECK (
        ("status" = 'menunggu') = ("decided_by_user_id" IS NULL)
        AND ("decided_by_user_id" IS NULL) = ("decided_at" IS NULL)
    ),
    -- ⛔ PEMISAHAN TUGAS: menyetujui atau menolak = orang lain; menarik = pengaju.
    CONSTRAINT "correction_request_segregation" CHECK (
        "status" NOT IN ('disetujui', 'ditolak') OR "decided_by_user_id" <> "requested_by_user_id"
    ),
    CONSTRAINT "correction_request_tarik_pengaju" CHECK (
        "status" <> 'ditarik' OR "decided_by_user_id" = "requested_by_user_id"
    ),
    -- Disetujui ⇔ ada reversal yang ia lahirkan.
    CONSTRAINT "correction_request_disetujui_ce" CHECK (
        ("status" = 'disetujui') = ("correction_entry_id" IS NOT NULL)
    ),
    -- Penolakan selalu bercatatan.
    CONSTRAINT "correction_request_tolak_catatan" CHECK (
        "status" <> 'ditolak' OR btrim(COALESCE("catatan_keputusan", '')) <> ''
    )
);

-- Paling banyak SATU pengajuan menunggu per baris.
CREATE UNIQUE INDEX IF NOT EXISTS "correction_request_menunggu_uq"
    ON "app"."correction_request"("source_kind", "original_txn_id")
    WHERE "status" = 'menunggu';
CREATE INDEX IF NOT EXISTS "correction_request_unit_idx"
    ON "app"."correction_request"("unit_id", "requested_at" DESC);

-- Paling banyak SATU reversal per baris — baris yang dibalik dua kali bukan nol,
-- ia "minus satu kali". Tak ada jalur tulis correction_entry sebelum migrasi ini.
CREATE UNIQUE INDEX IF NOT EXISTS "correction_entry_reversal_uq"
    ON "app"."correction_entry"("source_kind", "original_txn_id")
    WHERE "kind" = 'reversal';

-- Baris yang sudah DIPUTUS beku; kolom pengajuan tak pernah berubah.
CREATE OR REPLACE FUNCTION "app"."correction_request_beku"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" <> 'menunggu' THEN
    RAISE EXCEPTION 'pengajuan balik % sudah diputus (%) — tidak bisa diubah', OLD."id", OLD."status"
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."unit_id" <> OLD."unit_id"
     OR NEW."source_kind" <> OLD."source_kind"
     OR NEW."original_txn_id" <> OLD."original_txn_id"
     OR NEW."reason_code" <> OLD."reason_code"
     OR NEW."alasan" <> OLD."alasan"
     OR NEW."value_before" <> OLD."value_before"
     OR NEW."requested_by_user_id" <> OLD."requested_by_user_id"
     OR NEW."requested_at" <> OLD."requested_at" THEN
    RAISE EXCEPTION 'isi pengajuan balik % tidak bisa diubah — hanya keputusannya', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS "correction_request_beku" ON "app"."correction_request";
CREATE TRIGGER "correction_request_beku"
    BEFORE UPDATE ON "app"."correction_request"
    FOR EACH ROW EXECUTE FUNCTION "app"."correction_request_beku"();

-- ---------------------------------------------------------------------------
-- Hak akses: SELECT + INSERT + UPDATE (keputusan), TANPA DELETE.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "app"."correction_request" TO dashboard_app;
    REVOKE DELETE ON "app"."correction_request" FROM dashboard_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_ro') THEN
    GRANT SELECT ON "app"."correction_request" TO dashboard_ro;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- RLS unit-scoped — predikat disalin PERSIS dari 0016; jangan dirapikan.
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
  FOREACH t IN ARRAY ARRAY['correction_request'] LOOP
    EXECUTE format('ALTER TABLE "app".%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE "app".%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS unit_scope ON "app".%I', t);
    EXECUTE format(
      'CREATE POLICY unit_scope ON "app".%I USING (%s) WITH CHECK (%s)',
      t, predicate, predicate
    );
  END LOOP;
END
$$;
