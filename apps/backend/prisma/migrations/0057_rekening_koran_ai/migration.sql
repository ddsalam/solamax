-- 0057_rekening_koran_ai — rekening koran bank lain lewat pembaca AI / input
-- manual, berstatus "menunggu konfirmasi HoF".
--
-- Rencana: docs/plans/2026-11-02-1804-feat-keuangan-buku-besar-posting-otomatis-plan.html
-- (U10; R29, R30, AE8, KTD9).
--
-- ⛔ KEPUTUSAN YANG MENGIKAT:
--
-- 1. **Status ketiga `menunggu`** pada `rekening_koran`. Bacaan AI (atau baris
--    ketikan manual) yang lolos gerbang angka kontrol disimpan `menunggu`;
--    barisnya ikut `rk_status = 'menunggu'` lewat FK cermin 0051 (ON UPDATE
--    CASCADE), jadi TIDAK ikut pencocokan (pencocok menuntut `aktif`) dan tidak
--    dihitung tutup bulan (`status = 'aktif'`) sampai HoF mengonfirmasi.
--    Konfirmasi = UPDATE status → `aktif`; Tolak = tarik (status → `ditarik`,
--    kode alasan + catatan, CHECK 0051 tetap berlaku).
-- 2. **Asal tercatat** (`sumber`): 'bca' (parser e-statement, DEFAULT — baris
--    lama & jalur BCA tak berubah), 'ai', 'manual'. BCA tidak pernah
--    `menunggu`.
-- 3. **Konfirmasi tercatat & tak bisa dilompati**: bacaan bank lain yang
--    `aktif` WAJIB punya `dikonfirmasi_at` + `dikonfirmasi_by_user_id`; yang
--    `menunggu` wajib belum. Jalan pintas "INSERT langsung aktif" untuk
--    sumber ai/manual ditolak DB.
-- 4. **Satu rekening koran hidup per (rekening, bulan)**: partial unique 0051
--    diperluas ke `menunggu` — bacaan kedua ditolak selama yang pertama
--    menunggu, dan konfirmasi tak bisa bertabrakan dengan yang aktif.
--    Namanya dipertahankan (`rekening_koran_aktif_uq`, dirujuk aksi).
-- 5. **Batas 10 bacaan AI per rekening per bulan** TIDAK butuh tabel: setiap
--    percobaan dicatat di `audit_log` (action 'rekening_koran.baca_ai') dan
--    dihitung di sana, di bawah kunci advisory per rekening.
--
-- Idempoten / aman re-run.

ALTER TABLE "app"."rekening_koran"
    ADD COLUMN IF NOT EXISTS "sumber"                  TEXT NOT NULL DEFAULT 'bca',
    ADD COLUMN IF NOT EXISTS "dikonfirmasi_at"         TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS "dikonfirmasi_by_user_id" INTEGER;

-- Keputusan 1.
ALTER TABLE "app"."rekening_koran" DROP CONSTRAINT IF EXISTS "rekening_koran_status";
ALTER TABLE "app"."rekening_koran" ADD CONSTRAINT "rekening_koran_status"
    CHECK ("status" IN ('aktif', 'menunggu', 'ditarik'));

-- Keputusan 2.
ALTER TABLE "app"."rekening_koran" DROP CONSTRAINT IF EXISTS "rekening_koran_sumber";
ALTER TABLE "app"."rekening_koran" ADD CONSTRAINT "rekening_koran_sumber"
    CHECK ("sumber" IN ('bca', 'ai', 'manual'));
ALTER TABLE "app"."rekening_koran" DROP CONSTRAINT IF EXISTS "rekening_koran_bca_tak_menunggu";
ALTER TABLE "app"."rekening_koran" ADD CONSTRAINT "rekening_koran_bca_tak_menunggu"
    CHECK (NOT ("sumber" = 'bca' AND "status" = 'menunggu'));

-- 🔴 Keputusan 3.
ALTER TABLE "app"."rekening_koran" DROP CONSTRAINT IF EXISTS "rekening_koran_konfirmasi_pair";
ALTER TABLE "app"."rekening_koran" ADD CONSTRAINT "rekening_koran_konfirmasi_pair"
    CHECK (("dikonfirmasi_at" IS NULL) = ("dikonfirmasi_by_user_id" IS NULL));
ALTER TABLE "app"."rekening_koran" DROP CONSTRAINT IF EXISTS "rekening_koran_konfirmasi_wajib";
ALTER TABLE "app"."rekening_koran" ADD CONSTRAINT "rekening_koran_konfirmasi_wajib"
    CHECK (
        NOT ("sumber" <> 'bca' AND "status" = 'aktif' AND "dikonfirmasi_at" IS NULL)
        AND NOT ("status" = 'menunggu' AND "dikonfirmasi_at" IS NOT NULL)
    );

-- 🔴 Keputusan 4.
DROP INDEX IF EXISTS "app"."rekening_koran_aktif_uq";
CREATE UNIQUE INDEX IF NOT EXISTS "rekening_koran_aktif_uq"
    ON "app"."rekening_koran"("account_id", "periode") WHERE "status" IN ('aktif', 'menunggu');

-- Hak dashboard_app tidak berubah (0051: SELECT, INSERT, UPDATE pada
-- rekening_koran; SELECT, INSERT pada mutasi_bank). RLS 0051 tetap berlaku.
-- Tanpa seed.
