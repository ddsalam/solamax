-- 0046_edc_rekening_pencairan — rekening tempat tiap EDC mencairkan penjualannya.
--
-- ⛔ KEPUTUSAN OWNER 26 Sep 2026 (KEUANGAN-HARIAN §10.28):
--   · tiap EDC (BCA, MANDIRI, BRI, BNI, LINKAJA, MYPERTAMINA, …) mencairkan
--     penjualannya ke rekening yang DISEPAKATI dengan banknya — dan kesepakatan
--     itu BISA BERUBAH sewaktu-waktu;
--   · tim Finance (staf Keuangan, Head of Finance) yang mengubahnya, lewat
--     layar "Pengaturan EDC" — bukan rilis kode, bukan pengawas.
--
-- Karena berubah-ubah, pengaturan ini BERTANGGAL BERLAKU dan TIDAK PERNAH
-- ditimpa: rekening baru = baris baru dengan `berlaku_sejak`-nya. Rekening yang
-- berlaku pada tanggal X = baris aktif dengan `berlaku_sejak` terbesar ≤ X.
-- Batch settlement yang sudah tercatat menyimpan rekeningnya sendiri
-- (`edc_settlement.to_account_id`), jadi mengganti pengaturan tidak mengubah
-- riwayat apa pun — ia hanya mengubah SARAN untuk batch berikutnya dan menjadi
-- pembanding di layar Pemantauan.
--
-- ⚠️ Mengganti rekening tujuan dana adalah celah penyelewengan klasik. Maka:
-- void-only (tanpa DELETE), pelaku & waktu di barisnya, `audit_log` di server
-- action, dan setiap perubahan tampil di Pemantauan pemakaian.
--
-- Idempoten / aman re-run.

CREATE TABLE IF NOT EXISTS "app"."edc_rekening_pencairan" (
    "id"                 UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"            SMALLINT NOT NULL,
    -- Nama EDC, ejaan SAMA dengan `edc_kartu_acquirer.acquirer` (huruf besar,
    -- dirapikan server). Teks, bukan enum — EDC bertambah/berhenti seperti rekening.
    "acquirer"           TEXT NOT NULL,
    -- Rekening bank tujuan neto. FK KOMPOSIT ke akun unit yang SAMA (idiom 0030):
    -- tanpa itu pengaturan unit A bisa menunjuk rekening unit B.
    "to_account_id"      UUID NOT NULL,
    "berlaku_sejak"      DATE NOT NULL,
    "catatan"            TEXT,
    "created_by_user_id" INTEGER NOT NULL,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "void"               BOOLEAN NOT NULL DEFAULT false,
    "voided_by_user_id"  INTEGER,
    "voided_at"          TIMESTAMPTZ,

    CONSTRAINT "edc_rekening_pencairan_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "edc_rekening_pencairan_account_fk" FOREIGN KEY ("to_account_id", "unit_id")
        REFERENCES "app"."cash_account"("id", "unit_id"),
    CONSTRAINT "edc_rekening_pencairan_acquirer_isi" CHECK (
        btrim("acquirer") <> '' AND "acquirer" = upper(btrim("acquirer"))
    ),
    CONSTRAINT "edc_rekening_pencairan_void_audit" CHECK (
        "void" = ("voided_at" IS NOT NULL) AND "void" = ("voided_by_user_id" IS NOT NULL)
    )
);

-- Satu pengaturan AKTIF per (unit, EDC, tanggal berlaku). Mengoreksi = batalkan
-- yang lama lalu tulis yang baru; riwayatnya tetap utuh.
CREATE UNIQUE INDEX IF NOT EXISTS "edc_rekening_pencairan_aktif_uq"
    ON "app"."edc_rekening_pencairan"("unit_id", "acquirer", "berlaku_sejak") WHERE NOT "void";

-- Hak akses: VOID-only, tanpa DELETE.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "app"."edc_rekening_pencairan" TO dashboard_app;
    REVOKE DELETE ON "app"."edc_rekening_pencairan" FROM dashboard_app;
  END IF;
END
$$;

-- RLS unit-scoped (§4.1b) — predikat IDENTIK dengan 0016.
DO $$
DECLARE
  predicate text := $p$unit_id = ANY (ARRAY(
      SELECT tok::int
      FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
      WHERE tok ~ '^-?[0-9]+$'
  ))$p$;
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['edc_rekening_pencairan'] LOOP
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
