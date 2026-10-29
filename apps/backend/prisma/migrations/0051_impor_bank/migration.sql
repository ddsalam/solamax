-- 0051_impor_bank — rekening koran BCA yang diimpor & baris mutasinya.
--
-- Rencana: docs/plans/2026-10-29-1719-feat-keuangan-pihak-lawan-penebusan-impor-bank-plan.md
-- (U9; R17–R19, R22, R31; KTD6, KTD10, KTD13).
--
--   app.rekening_koran — satu e-statement per (rekening, bulan): kepala, kaki,
--                        sha256 berkas, pengunggah, status aktif/ditarik.
--   app.mutasi_bank    — baris mutasi rekening koran itu, apa adanya dari bank.
--
-- ⛔ KEPUTUSAN YANG MENGIKAT:
--
-- 1. **Baris impor TIDAK PERNAH menyentuh `cash_ledger`** (KTD6). Pencocokan
--    (U10) adalah TAUTAN baris impor ↔ baris kas; tak ada kolom di sini yang
--    menunjuk baris kas, dan migrasi ini tidak mengubah `cash_ledger`.
-- 2. **Kaki tersimpan & konsisten** (R17): saldo_awal + total_cr − total_db =
--    saldo_akhir ditegakkan CHECK. Pembaca (U8) sudah menolak utuh bila hasil
--    baca ≠ kaki; CHECK ini menjamin tak ada jalan lain menulis kaki yang tak
--    menutup. DECIMAL(17,2), tanpa float.
-- 3. **Satu rekening koran AKTIF per (rekening, bulan)** — partial unique.
--    Berkas identik (sha256 sama) = no-op di aksi; berkas berbeda ditolak
--    sampai HoF menarik yang lama (R31).
-- 4. **Kunci alami baris = (rekening_koran_id, tanggal_bank, urutan)**, plus
--    partial unique (account_id, tanggal_bank, urutan) di antara baris milik
--    rekening koran AKTIF. `urutan` = urutan cetak di dalam tanggal (U8), jadi
--    di dalam SATU berkas kuncinya pasti unik; nominal/keterangan tak menambah
--    daya beda. Baris rekening koran yang DITARIK tidak bertabrakan dengan
--    unggahan penggantinya karena yang kedua hanya berlaku di antara yang aktif.
--    Status aktif itu DICERMINKAN ke baris lewat FK komposit
--    `(rekening_koran_id, unit_id, account_id, rk_status)` ON UPDATE CASCADE —
--    bukan disalin aplikasi, sehingga cermin tak mungkin tertinggal; dan baris
--    tak bisa disisipkan ke rekening koran yang sudah ditarik (FK menolak).
-- 5. **Pra-cut-over disimpan, tidak pernah dibukukan** (R22, AE8):
--    `pra_cutover = true` ditulis saat impor menurut aturan KTD5
--    (`tentukanHariBuku`, cut-over rekening ⇒ cut-over unit).
-- 6. **Baris bank tak bisa disunting**: dashboard_app hanya SELECT, INSERT pada
--    mutasi_bank (tanpa UPDATE/DELETE). Cermin status di atas dijalankan
--    trigger RI sebagai pemilik tabel, bukan oleh dashboard_app.
-- 7. **Penarikan beralasan** (R31): kode dari master `reason_code`
--    (applies_to 'adjustment', idiom bayangan 0027/0049) + catatan wajib.
--
-- Idempoten / aman re-run.

CREATE TABLE IF NOT EXISTS "app"."rekening_koran" (
    "id"                        UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"                   SMALLINT NOT NULL,
    "account_id"                UUID NOT NULL,
    -- Hari pertama bulan e-statement.
    "periode"                   DATE NOT NULL,
    "saldo_awal"                DECIMAL(17,2) NOT NULL,
    "saldo_akhir"               DECIMAL(17,2) NOT NULL,
    "total_cr"                  DECIMAL(17,2) NOT NULL,
    "n_cr"                      INTEGER NOT NULL,
    "total_db"                  DECIMAL(17,2) NOT NULL,
    "n_db"                      INTEGER NOT NULL,
    "file_sha256"               TEXT NOT NULL,
    "uploaded_by_user_id"       INTEGER NOT NULL,
    "uploaded_at"               TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status"                    TEXT NOT NULL DEFAULT 'aktif',
    "ditarik_at"                TIMESTAMPTZ,
    "ditarik_by_user_id"        INTEGER,
    "ditarik_alasan"            TEXT,
    -- Bayangan `reason_code.applies_to` (idiom 0027/0049).
    "ditarik_alasan_applies_to" TEXT,
    "ditarik_catatan"           TEXT,

    CONSTRAINT "rekening_koran_pkey" PRIMARY KEY ("id"),
    -- FK komposit (idiom 0019/0029): rekening milik unit yang SAMA.
    CONSTRAINT "rekening_koran_account_fk" FOREIGN KEY ("account_id", "unit_id")
        REFERENCES "app"."cash_account"("id", "unit_id"),
    -- Target FK komposit baris mutasi (keputusan 4).
    CONSTRAINT "rekening_koran_cermin_uq" UNIQUE ("id", "unit_id", "account_id", "status"),
    CONSTRAINT "rekening_koran_status" CHECK ("status" IN ('aktif', 'ditarik')),
    CONSTRAINT "rekening_koran_periode_awal_bulan" CHECK (
        "periode" = date_trunc('month', "periode")::date
    ),
    CONSTRAINT "rekening_koran_kaki_positif" CHECK (
        "total_cr" >= 0 AND "total_db" >= 0 AND "n_cr" >= 0 AND "n_db" >= 0
    ),
    -- 🔴 R17 — keputusan 2.
    CONSTRAINT "rekening_koran_kaki_menutup" CHECK (
        "saldo_awal" + "total_cr" - "total_db" = "saldo_akhir"
    ),
    CONSTRAINT "rekening_koran_sha256" CHECK ("file_sha256" ~ '^[0-9a-f]{64}$'),
    -- Ditarik ⇔ kapan, siapa, alasan, catatan — semuanya, atau tak satu pun.
    CONSTRAINT "rekening_koran_tarik_audit" CHECK (
        ("status" = 'ditarik') = ("ditarik_at" IS NOT NULL)
        AND ("status" = 'ditarik') = ("ditarik_by_user_id" IS NOT NULL)
        AND ("status" = 'ditarik') = ("ditarik_alasan" IS NOT NULL)
        AND ("status" = 'ditarik') = (NULLIF(btrim("ditarik_catatan"), '') IS NOT NULL)
    ),
    CONSTRAINT "rekening_koran_alasan_fk" FOREIGN KEY ("ditarik_alasan", "ditarik_alasan_applies_to")
        REFERENCES "app"."reason_code"("code", "applies_to"),
    CONSTRAINT "rekening_koran_alasan_adjustment" CHECK (
        "ditarik_alasan_applies_to" IS NULL OR "ditarik_alasan_applies_to" = 'adjustment'
    ),
    CONSTRAINT "rekening_koran_alasan_pair" CHECK (
        ("ditarik_alasan" IS NULL) = ("ditarik_alasan_applies_to" IS NULL)
    )
);

-- 🔴 Keputusan 3: satu rekening koran aktif per (rekening, bulan).
CREATE UNIQUE INDEX IF NOT EXISTS "rekening_koran_aktif_uq"
    ON "app"."rekening_koran"("account_id", "periode") WHERE "status" = 'aktif';
CREATE INDEX IF NOT EXISTS "rekening_koran_unit_periode_idx"
    ON "app"."rekening_koran"("unit_id", "periode");

CREATE TABLE IF NOT EXISTS "app"."mutasi_bank" (
    "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"           SMALLINT NOT NULL,
    "rekening_koran_id" UUID NOT NULL,
    "account_id"        UUID NOT NULL,
    -- Cermin `rekening_koran.status` — diisi FK ON UPDATE CASCADE (keputusan 4).
    "rk_status"         TEXT NOT NULL DEFAULT 'aktif',
    "tanggal_bank"      DATE NOT NULL,
    -- Urutan cetak 1.. di dalam tanggal yang sama (U8).
    "urutan"            INTEGER NOT NULL,
    "keterangan"        TEXT NOT NULL,
    -- BERTANDA: CR positif, DB negatif.
    "amount"            DECIMAL(17,2) NOT NULL,
    -- Saldo berjalan bila dicetak di baris itu.
    "saldo_setelah"     DECIMAL(17,2),
    -- Nomor SO penebusan B2B Pertamina dari keterangan (KTD7), bila ada.
    "so"                TEXT,
    -- Nomor dokumen sesudah "KURANG BAYAR" (KTD7), bila ada.
    "dok_ref"           TEXT,
    -- R22 — keputusan 5.
    "pra_cutover"       BOOLEAN NOT NULL,
    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mutasi_bank_pkey" PRIMARY KEY ("id"),
    -- FK komposit (idiom 0019/0029) + cermin status (keputusan 4).
    CONSTRAINT "mutasi_bank_rekening_koran_fk"
        FOREIGN KEY ("rekening_koran_id", "unit_id", "account_id", "rk_status")
        REFERENCES "app"."rekening_koran"("id", "unit_id", "account_id", "status")
        ON UPDATE CASCADE,
    -- Target FK komposit kelompok cocok (U10).
    CONSTRAINT "mutasi_bank_unit_uq" UNIQUE ("id", "unit_id"),
    -- Kunci alami di dalam satu rekening koran.
    CONSTRAINT "mutasi_bank_alami_uq" UNIQUE ("rekening_koran_id", "tanggal_bank", "urutan"),
    CONSTRAINT "mutasi_bank_urutan_positif" CHECK ("urutan" >= 1)
);

-- 🔴 Keputusan 4: kunci alami per rekening di antara rekening koran AKTIF.
CREATE UNIQUE INDEX IF NOT EXISTS "mutasi_bank_aktif_uq"
    ON "app"."mutasi_bank"("account_id", "tanggal_bank", "urutan") WHERE "rk_status" = 'aktif';
CREATE INDEX IF NOT EXISTS "mutasi_bank_unit_tanggal_idx"
    ON "app"."mutasi_bank"("unit_id", "tanggal_bank");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "app"."rekening_koran" TO dashboard_app;
    REVOKE DELETE ON "app"."rekening_koran" FROM dashboard_app;
    -- Keputusan 6: baris bank tak bisa disunting aplikasi.
    GRANT SELECT, INSERT ON "app"."mutasi_bank" TO dashboard_app;
    REVOKE UPDATE, DELETE ON "app"."mutasi_bank" FROM dashboard_app;
  END IF;
END
$$;

-- Tanpa seed: kedua tabel lahir kosong (§4.1b c tetap dipatuhi — tak ada
-- INSERT ter-scope unit di bawah blok RLS).

-- RLS — cabang NULL DIPUTUSKAN SADAR: **TIDAK ADA**. Setiap rekening koran &
-- barisnya milik satu unit (`unit_id` NOT NULL). Predikat disalin PERSIS dari
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
  FOREACH t IN ARRAY ARRAY['rekening_koran', 'mutasi_bank'] LOOP
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
