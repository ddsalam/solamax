-- 0031_noncash_expense — beban NON-KAS turunan-mesin. Keputusan owner
-- 13 Agustus 2026 (KEUANGAN-HARIAN.md §2.5).
--
-- Kaki ketiga jurnal pencairan EDC (§10.5) adalah **Beban MDR `7-1200`**. Dua
-- kaki lainnya akun kas dan mendarat di `app.cash_ledger`; yang ini bukan akun
-- kas, jadi ia butuh rumah sendiri.
--
-- ⛔ KENAPA BUKAN `app.manual_entry` — ini inti keputusannya:
-- `manual_entry` berarti **diketik manusia**. Begitu ada satu baris di dalamnya
-- yang lahir dari mesin, pertanyaan "SIAPA yang memasukkan ini" menjadi ambigu
-- **selamanya** — padahal seluruh model kepemilikan §2 berdiri di atas jawaban
-- itu yang tak ambigu. Aturan "jangan pernah menurunkan `operational_category`"
-- (§2.1/§10.8) tetap MUTLAK, tanpa kecuali yang harus diingat orang berikutnya.
--
-- ⛔ TABEL INI SENGAJA TIDAK PUNYA KOLOM `operational_category`.
-- Bukan NULL karena "belum diisi", melainkan karena **kolom itu TIDAK BERLAKU**:
-- tak ada pengawas yang memilikinya. Kalau kolomnya tidak ada, tak ada yang bisa
-- salah mengisinya — dan tak ada yang perlu mengingat larangannya.
--
-- Yang dibawa: `accounting_account` (milik Finance) saja.
--
-- ⚠️ MESIN yang MENGHITUNG, MANUSIA yang MENYETUJUI. Baris di sini hanya lahir
-- setelah jurnal yang DITAWARKAN (§1.4) disetujui — karena itu ada
-- `posted_by_user_id`, dan ia NOT NULL. Jadi "siapa yang menaruh ini" tetap
-- punya jawaban: seseorang menyetujui angka yang dihitung mesin. Yang tidak
-- pernah ditanyakan adalah "siapa yang MENGETIK ini", sebab tak ada yang
-- mengetiknya.
--
-- Idempoten / aman re-run. TANPA seed (tak ada baris ter-scope unit yang
-- disemai) — tetapi urutan §4.1b butir c tetap dipatuhi: seandainya kelak ada
-- seed, tempatnya SEBELUM blok RLS di bawah.

CREATE TABLE IF NOT EXISTS "app"."noncash_expense" (
    "id"            UUID NOT NULL DEFAULT gen_random_uuid(),
    "unit_id"       SMALLINT NOT NULL,
    "business_date" DATE NOT NULL,

    -- Milik FINANCE. Tidak ada pasangan `operational_category` di tabel ini —
    -- lihat kepala berkas.
    "accounting_account" TEXT NOT NULL,
    "amount_rp"     DECIMAL(17,2) NOT NULL,
    "keterangan"    TEXT NOT NULL,

    -- TAUTAN KE SUMBERNYA. NOT NULL: `7-1200` harus SELALU bisa ditelusuri ke
    -- selisih bruto−neto yang membentuknya. Tanpa tautan, angka beban ini jadi
    -- pernyataan tanpa bukti.
    --
    -- FK LANGSUNG, bukan polimorfik seperti `correction_entry` (0021/0025).
    -- Bedanya disengaja: di sana sumber kedua adalah JADWAL (buku kas besar,
    -- lima buku bank, settlement EDC sudah dikomitmen §1.3–§1.4), sedangkan di
    -- sini sumber kedua masih spekulatif ("kelak biaya admin bank"). Kalau
    -- sumber kedua benar-benar datang, ia keputusan owner + migrasi saat itu —
    -- bukan polimorfisme yang dibangun untuk pemakai yang belum ada.
    "edc_settlement_id" UUID NOT NULL,

    -- Jejak PERSETUJUAN (§1.4). NOT NULL: baris ini tidak pernah lahir tanpa
    -- ada yang menyetujuinya.
    "posted_by_user_id" INTEGER NOT NULL,
    "posted_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    "void"          BOOLEAN NOT NULL DEFAULT false,
    "voided_by_user_id" INTEGER,
    "voided_at"     TIMESTAMPTZ,

    CONSTRAINT "noncash_expense_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "noncash_expense_settlement_fk" FOREIGN KEY ("edc_settlement_id")
        REFERENCES "app"."edc_settlement"("id"),

    -- Beban nol bukan beban; beban negatif adalah pendapatan dan tidak boleh
    -- menyelinap lewat pintu ini.
    CONSTRAINT "noncash_expense_positif" CHECK ("amount_rp" > 0),
    CONSTRAINT "noncash_expense_akun_isi" CHECK (btrim("accounting_account") <> ''),
    CONSTRAINT "noncash_expense_keterangan_isi" CHECK (btrim("keterangan") <> ''),
    CONSTRAINT "noncash_expense_void_audit" CHECK (
        "void" = ("voided_at" IS NOT NULL) AND "void" = ("voided_by_user_id" IS NOT NULL)
    )
);

-- Satu beban AKTIF per (settlement, akun). Tanpa ini, satu batch bisa
-- menghasilkan dua baris MDR dan beban terhitung dua kali — kesalahan yang tak
-- memunculkan galat apa pun, hanya laba yang terlalu kecil.
CREATE UNIQUE INDEX IF NOT EXISTS "noncash_expense_settlement_uq"
    ON "app"."noncash_expense"("edc_settlement_id", "accounting_account") WHERE NOT "void";

-- Jalur baca Income Statement: per unit per tanggal per akun.
CREATE INDEX IF NOT EXISTS "noncash_expense_laporan_idx"
    ON "app"."noncash_expense"("unit_id", "business_date", "accounting_account")
    WHERE NOT "void";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dashboard_app') THEN
    GRANT SELECT, INSERT, UPDATE ON "app"."noncash_expense" TO dashboard_app;
    REVOKE DELETE ON "app"."noncash_expense" FROM dashboard_app;
  END IF;
END
$$;

-- RLS — cabang NULL DIPUTUSKAN SADAR: **TIDAK ADA**. Beban selalu milik satu
-- unit (kolomnya NOT NULL); tak ada beban yang berlaku global. Predikat disalin
-- PERSIS dari 0016 (§4.1b).
DO $$
DECLARE
  predicate text := $p$unit_id = ANY (ARRAY(
      SELECT tok::int
      FROM unnest(string_to_array(NULLIF(current_setting('app.unit_ids', true), ''), ',')) AS tok
      WHERE tok ~ '^-?[0-9]+$'
  ))$p$;
BEGIN
  EXECUTE 'ALTER TABLE "app"."noncash_expense" ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE "app"."noncash_expense" FORCE ROW LEVEL SECURITY';
  EXECUTE 'DROP POLICY IF EXISTS unit_scope ON "app"."noncash_expense"';
  EXECUTE format(
    'CREATE POLICY unit_scope ON "app"."noncash_expense" USING (%s) WITH CHECK (%s)',
    predicate, predicate
  );
END
$$;

-- ⚠️ KONSEKUENSI YANG DIBAYAR SADAR (§2.5): jalur baca Income Statement kini
-- menggabung DUA sumber beban — `app.manual_entry` (diketik pengawas/Finance)
-- dan tabel ini (dihitung mesin, disetujui manusia). Penggabungannya WAJIB di
-- SATU tempat: `apps/dashboard/src/lib/keuangan-beban.ts`. Beban yang hilang
-- dari laporan **tidak memunculkan galat apa pun** — ia hanya membuat laba
-- terlihat lebih besar.
--
-- Kategori operasional `MDR` (#13, §10.3) TETAP ADA untuk MDR yang ditagih
-- TERPISAH di luar pola potong-di-muka. Dua jalur, dua asal, satu akun
-- `7-1200` — dan itu benar.
