-- 0021_correction_reclass — dua tabel APPEND-ONLY yang menegakkan model
-- kepemilikan KEUANGAN-HARIAN.md §2: fakta transaksi ≠ wewenang klasifikasi.
--
--   app.reclassification  — §4.4 · memindahkan CoA, tak menyentuh transaksi asli
--   app.correction_entry  — §4.5 · koreksi/pembalik setelah hari ditutup
--
-- ⛔ Yang tabel ini jaga, dan alasannya:
--
-- Finance TIDAK punya tombol Edit generik atas transaksi dari Rincian Penjualan
-- (§2.3, keputusan owner). Sekali ada satu jalan untuk MENYUNTING baris asli,
-- seluruh model ini bohong — sebab tak ada lagi cara membedakan "angkanya memang
-- begitu" dari "angkanya pernah lain". Karena itu koreksi maupun reklasifikasi
-- berbentuk BARIS BARU yang bertaut, bukan UPDATE.
--
-- APPEND-ONLY ditegakkan DI DB, bukan hanya di aplikasi: dashboard_app hanya
-- diberi SELECT + INSERT, sedangkan UPDATE dan DELETE di-REVOKE eksplisit.
-- Pola sama dengan app.audit_log (0017). Jejak yang bisa disunting bukan jejak.
--
-- Reklasifikasi ≠ koreksi (§2.3). Reklasifikasi memindahkan CoA kapan pun secara
-- teraudit TANPA meminta pengawas menyentuh apa pun; nominal, tanggal, dan
-- operational_category tidak berubah. Dua tabel terpisah supaya keduanya tidak
-- bisa saling menyamar dalam laporan.
--
-- Urutan deploy (HOUSE RULE): migrate-deploy DULU, baru image dashboard.
-- Idempoten / aman re-run.

-- ---------------------------------------------------------------------------
-- Reklasifikasi (§4.4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."reclassification" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"           SMALLINT NOT NULL,

    -- Taut ke transaksi asli. TANPA FOREIGN KEY, dan itu disengaja: taksonomi
    -- "transaksi apa saja yang boleh direklasifikasi" BELUM diputuskan owner.
    -- Hari ini satu-satunya sumber adalah app.manual_entry, tetapi mengunci FK
    -- ke sana sekarang berarti memutuskan pertanyaan itu diam-diam. Kolom
    -- source_kind menyimpan jawabannya secara eksplisit supaya FK bisa dipasang
    -- kemudian tanpa menebak sekarang.
    "source_kind"       TEXT NOT NULL,
    "source_txn_id"     UUID NOT NULL,

    "from_account"      TEXT NOT NULL,
    "to_account"        TEXT NOT NULL,
    -- Daftar TERTUTUP (§10.2 grup `reclass`). FK menyusul bersama master
    -- app.reason_code — belum dibangun, dan bukan bagian Tugas 1.
    "reason_code"       TEXT NOT NULL,
    "note"              TEXT,

    "created_by_user_id" INTEGER NOT NULL,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reclassification_pkey" PRIMARY KEY ("id"),
    -- Memindahkan akun ke dirinya sendiri bukan reklasifikasi, ia derau yang
    -- akan mengacaukan hitungan frekuensi RCL-MAPDEF (§10.2).
    CONSTRAINT "reclassification_moves" CHECK ("from_account" <> "to_account")
);

CREATE INDEX IF NOT EXISTS "reclassification_source_idx"
    ON "app"."reclassification"("source_kind", "source_txn_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "reclassification_unit_idx"
    ON "app"."reclassification"("unit_id", "created_at" DESC);
-- Frekuensi per kode per unit (§10.2): RCL-MAPDEF yang berulang untuk kategori
-- sama berarti TABEL PEMETAAN-nya yang salah, bukan transaksinya.
CREATE INDEX IF NOT EXISTS "reclassification_reason_idx"
    ON "app"."reclassification"("unit_id", "reason_code", "created_at");

-- ---------------------------------------------------------------------------
-- Koreksi / pembalik (§4.5) — TUJUH field audit, tak satu pun opsional
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "app"."correction_entry" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"           SMALLINT NOT NULL,

    -- (1) referensi transaksi asli — lihat catatan FK di reclassification.
    "source_kind"       TEXT NOT NULL,
    "original_txn_id"   UUID NOT NULL,
    -- (2) alasan koreksi, daftar tertutup (§10.2 grup `adjustment`).
    "reason_code"       TEXT NOT NULL,
    -- (3) & (4) nilai sebelum dan sesudah.
    "value_before"      DECIMAL(17,2) NOT NULL,
    "value_after"       DECIMAL(17,2) NOT NULL,
    -- (5) pengaju · (6) approver · (7) timestamp persetujuan.
    "submitted_by_user_id" INTEGER NOT NULL,
    "approved_by_user_id"  INTEGER NOT NULL,
    "approved_at"          TIMESTAMPTZ NOT NULL,
    -- Bukti pendukung.
    "evidence_ref"      TEXT,

    "kind"              TEXT NOT NULL,

    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "correction_entry_pkey" PRIMARY KEY ("id"),

    -- ⛔ PEMISAHAN TUGAS, ditegakkan di DB (§4.5). Approver yang sama dengan
    -- pengaju membuat SELURUH tangga wewenang §3.2 jadi hiasan: siapa pun yang
    -- boleh mengajukan otomatis boleh menyetujui. Ini satu-satunya baris yang
    -- mencegahnya, jadi ia hidup di DB — bukan di aplikasi yang bisa dilewati.
    CONSTRAINT "correction_entry_segregation" CHECK (
        "submitted_by_user_id" <> "approved_by_user_id"
    ),

    CONSTRAINT "correction_entry_kind" CHECK ("kind" IN ('reversal', 'corrected_entry')),

    -- Koreksi yang tidak mengubah apa pun bukan koreksi.
    CONSTRAINT "correction_entry_changes" CHECK ("value_before" <> "value_after")
);

CREATE INDEX IF NOT EXISTS "correction_entry_source_idx"
    ON "app"."correction_entry"("source_kind", "original_txn_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "correction_entry_unit_idx"
    ON "app"."correction_entry"("unit_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "correction_entry_reason_idx"
    ON "app"."correction_entry"("unit_id", "reason_code", "created_at");

-- ---------------------------------------------------------------------------
-- APPEND-ONLY di lapis hak akses (pola app.audit_log / 0017)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT, INSERT ON "app"."reclassification" TO dashboard_app;
    GRANT SELECT, INSERT ON "app"."correction_entry" TO dashboard_app;
    -- Eksplisit: deploy B1 memasang ALTER DEFAULT PRIVILEGES …GRANT… UPDATE/DELETE,
    -- jadi TANPA REVOKE ini kedua tabel akan bisa disunting oleh aplikasi.
    REVOKE UPDATE, DELETE ON "app"."reclassification" FROM dashboard_app;
    REVOKE UPDATE, DELETE ON "app"."correction_entry" FROM dashboard_app;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- RLS unit-scoped — ditulis di sini, tidak diwarisi (alasan sama seperti 0020:
-- 0016 tidak berjalan ulang untuk tabel yang lahir sesudahnya). Predikat
-- disalin PERSIS dari 0016; jangan dirapikan.
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
  FOREACH t IN ARRAY ARRAY['reclassification', 'correction_entry'] LOOP
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
