-- 0030_edc_settlement — sisi BATCH settlement EDC (§10.5).
--
-- Sisi transaksinya sudah ada (`public.edc`); yang belum ada adalah batch-nya:
-- nomor & tanggal settlement, acquirer, total bruto, dan potongan MDR.
--
-- Keputusan owner B5 (§10.5): `EDC Penampungan` adalah **akun kliring RIIL yang
-- cair H+1**, dan **MDR dipotong DI MUKA** (bank mentransfer neto).
--
-- ⛔ EMPAT HAL YANG MENGIKAT:
--
-- 1. **MDR TIDAK DIKETIK.** Ia selisih bruto − neto, dan di sini itu ditegakkan
--    kolom GENERATED: Postgres yang menghitungnya, sehingga angka yang sudah
--    diketahui sistem tak pernah punya kesempatan salah ketik.
--
-- 2. **Selisih transaksi vs settlement BERDIRI sebagai selisih ber-`reason_code`**,
--    tidak dibulatkan hilang. Kodenya dari grup `closing` (`CLS-EDC-TIMING`,
--    `CLS-EDC-MDR` sudah ada di master 0022), dikunci FK komposit.
--
-- 3. **Jurnal pencairan DITAWARKAN, bukan diposting** (§1.4). Tabel ini menyimpan
--    FAKTA settlement; barisnya di buku kas baru lahir saat ada yang MENYETUJUI.
--    `posted_by/at` adalah jejak persetujuan itu — bukan penanda otomatis.
--
-- 4. **Kontrol MDR% ikut dibangun**, bukan menyusul: persentase yang bergeser
--    tanpa perubahan perjanjian adalah temuan, dan ia hanya terlihat kalau
--    bruto & neto tersimpan berpasangan seperti di sini.
--
-- ⚠️ Konteks Bakau yang membuat ini mendesak: saldo `EDC Penampungan` naik dari
-- nol (2021) ke Rp 12.435.466.761 dan hanya turun pada 78 dari 2.067 hari —
-- akun yang cair tiap hari semestinya berisi ± SATU hari omzet non-tunai.
--
-- Idempoten / aman re-run.

CREATE TABLE IF NOT EXISTS "app"."edc_settlement" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"       SMALLINT NOT NULL,

    -- Acquirer = bank penerbit EDC. Teks, bukan enum: acquirer bertambah/berhenti
    -- sama seperti rekening (alasan yang sama dengan `cash_account`, 0029).
    "acquirer"      TEXT NOT NULL,
    "settlement_no" TEXT NOT NULL,
    -- Tanggal uang MASUK rekening (H+1).
    "settlement_date" DATE NOT NULL,
    -- Hari penjualan yang di-settle (H).
    "business_date" DATE NOT NULL,

    -- Akun kas tujuan neto. FK KOMPOSIT ke akun milik unit yang SAMA (idiom 0019
    -- / 0029): tanpa itu, settlement unit A bisa mendarat di rekening unit B dan
    -- RLS tidak menangkapnya — unit_id barisnya sendiri sudah benar.
    "to_account_id" UUID NOT NULL,

    "gross_rp"      DECIMAL(17,2) NOT NULL,
    "net_rp"        DECIMAL(17,2) NOT NULL,
    -- ⛔ TIDAK DIKETIK. Postgres yang menghitung.
    "mdr_rp"        DECIMAL(17,2) GENERATED ALWAYS AS ("gross_rp" - "net_rp") STORED,

    -- Total transaksi EDC menurut `public.edc` untuk batch ini, dicatat saat
    -- rekonsiliasi. Selisihnya terhadap bruto TIDAK boleh hilang.
    "txn_total_rp"  DECIMAL(17,2),
    "selisih_rp"    DECIMAL(17,2) GENERATED ALWAYS AS (
                        COALESCE("txn_total_rp", "gross_rp") - "gross_rp"
                    ) STORED,
    "reason_code"   TEXT,
    "reason_applies_to" TEXT,

    -- Jejak PERSETUJUAN jurnal yang ditawarkan (§1.4) — bukan penanda otomatis.
    "posted_by_user_id" INTEGER,
    "posted_at"     TIMESTAMPTZ,

    "void"          BOOLEAN NOT NULL DEFAULT false,
    "voided_by_user_id" INTEGER,
    "voided_at"     TIMESTAMPTZ,
    "created_by_user_id" INTEGER NOT NULL,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "edc_settlement_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "edc_settlement_account_fk" FOREIGN KEY ("to_account_id", "unit_id")
        REFERENCES "app"."cash_account"("id", "unit_id"),

    CONSTRAINT "edc_settlement_reason_fk"
        FOREIGN KEY ("reason_code", "reason_applies_to")
        REFERENCES "app"."reason_code"("code", "applies_to"),
    CONSTRAINT "edc_settlement_reason_closing" CHECK (
        "reason_applies_to" IS NULL OR "reason_applies_to" = 'closing'
    ),
    CONSTRAINT "edc_settlement_reason_pair" CHECK (
        ("reason_code" IS NULL) = ("reason_applies_to" IS NULL)
    ),

    -- Bruto & neto wajib masuk akal: neto tak boleh melebihi bruto (MDR ≥ 0),
    -- dan bruto nol bukan batch.
    CONSTRAINT "edc_settlement_gross_positif" CHECK ("gross_rp" > 0),
    CONSTRAINT "edc_settlement_net_wajar" CHECK ("net_rp" > 0 AND "net_rp" <= "gross_rp"),

    -- Persetujuan = pasangan (siapa, kapan).
    CONSTRAINT "edc_settlement_posted_pair" CHECK (
        ("posted_by_user_id" IS NULL) = ("posted_at" IS NULL)
    ),
    -- H+1: uang tak mungkin masuk sebelum hari penjualannya.
    CONSTRAINT "edc_settlement_urutan_tanggal" CHECK ("settlement_date" >= "business_date"),
    CONSTRAINT "edc_settlement_void_audit" CHECK (
        "void" = ("voided_at" IS NOT NULL) AND "void" = ("voided_by_user_id" IS NOT NULL)
    )
);

-- Satu batch per (unit, acquirer, nomor settlement) — nomor settlement adalah
-- identitas dari acquirer, jadi duplikatnya berarti batch yang sama dibukukan
-- dua kali.
CREATE UNIQUE INDEX IF NOT EXISTS "edc_settlement_no_uq"
    ON "app"."edc_settlement"("unit_id", "acquirer", "settlement_no") WHERE NOT "void";

-- Kontrol MDR% per acquirer per bulan (§10.5): murah, karena itu benar-benar
-- akan dijalankan.
CREATE INDEX IF NOT EXISTS "edc_settlement_mdr_idx"
    ON "app"."edc_settlement"("unit_id", "acquirer", "settlement_date") WHERE NOT "void";
CREATE INDEX IF NOT EXISTS "edc_settlement_belum_posting_idx"
    ON "app"."edc_settlement"("unit_id", "business_date") WHERE "posted_at" IS NULL AND NOT "void";

-- Tautan dari baris buku kas ke settlement yang melahirkannya. NULL untuk
-- mutasi biasa. Inilah yang membuat jurnal pencairan bisa ditelusuri balik ke
-- bukti settlement-nya, bukan sekadar "ada dua baris yang kebetulan cocok".
ALTER TABLE "app"."cash_ledger"
    ADD COLUMN IF NOT EXISTS "edc_settlement_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cash_ledger_settlement_fk') THEN
    ALTER TABLE "app"."cash_ledger"
      ADD CONSTRAINT "cash_ledger_settlement_fk"
      FOREIGN KEY ("edc_settlement_id") REFERENCES "app"."edc_settlement"("id");
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS "cash_ledger_settlement_idx"
    ON "app"."cash_ledger"("edc_settlement_id") WHERE "edc_settlement_id" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "app"."edc_settlement" TO dashboard_app;
    REVOKE DELETE ON "app"."edc_settlement" FROM dashboard_app;
  END IF;
END
$$;

-- RLS — cabang NULL DIPUTUSKAN SADAR: **TIDAK ADA**. Settlement selalu milik
-- satu unit (kolomnya NOT NULL); tak ada batch yang berlaku global. Predikat
-- disalin PERSIS dari 0016 (§4.1b).
DO $$
DECLARE
  predicate text := $p$unit_id = ANY (ARRAY(
      SELECT tok::int
      FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
      WHERE tok ~ '^-?[0-9]+$'
  ))$p$;
BEGIN
  EXECUTE 'ALTER TABLE "app"."edc_settlement" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "app"."edc_settlement" FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS unit_scope ON "app"."edc_settlement"';
  EXECUTE format(
    'CREATE POLICY unit_scope ON "app"."edc_settlement" USING (%s) WITH CHECK (%s)',
    predicate, predicate
  );
END
$$;

-- ⚠️ BATAS YANG BELUM DITUTUP — sebut apa adanya:
-- Jurnal pencairan H+1 berkaki TIGA (§10.5): Kas Bank neto D · Beban MDR
-- `7-1200` D · EDC Penampungan bruto K. Dua kaki pertama-dan-terakhir adalah
-- akun KAS dan mendarat di `app.cash_ledger`. Kaki **Beban MDR bukan akun kas**,
-- jadi ia TIDAK punya tempat di tabel itu — rumahnya `app.manual_entry`
-- (§10.8) dengan `operational_category = 'MDR'` → CoA `7-1200` (§10.3).
-- Menuliskannya otomatis berarti MESIN memilih `operational_category`, yang
-- §2.1/§10.8 tetapkan milik PENGAWAS. Karena itu kaki ketiga TIDAK diposting
-- di sini; lihat pertanyaan di badan PR.
