-- 0036 — SALDO PEMBUKA per rekening (§10.24)
--
-- Saldo pembuka adalah BARIS `cash_ledger` ber-`jenis='adjustment'` yang
-- DITANDAI, bukan tabel tersendiri. Keputusan itu, berikut alasannya, ada di
-- KEUANGAN-HARIAN.md §10.24 — ringkasnya:
--
-- ⛔ MIGRASI 0029 SUDAH MENAMAI JALUR INI, DUA KALI:
--      "Sisi kategori; NULL untuk `adjustment` (mis. baris \"Saldo Awal\")"
--      "`adjustment` bebas tanda (saldo awal bisa negatif)"
--    CHECK `cash_ledger_tanda` sengaja dilonggarkan untuknya. Tabel tersendiri
--    akan membatalkan keputusan itu tanpa sengaja, dan melonggarkan CHECK untuk
--    sesuatu yang tak pernah datang.
--
-- ⛔ DAN BUTIR 2 KEPUTUSAN 0029 JUSTRU MENUNTUT BENTUK INI. Larangannya bukan
--    "jangan simpan angka saldo" melainkan "saldo adalah TURUNAN: SUM(amount),
--    satu operasi, TANPA CABANG". Anchor di tabel terpisah membuat setiap
--    pembaca saldo jadi `SUM(mutasi) + anchor` — sebuah cabang, di setiap
--    pembaca, selamanya. Baris ledger menjaga aturan satu-operasi itu utuh.
--
-- Tanggal cut-over rekening = `business_date` baris saldo awalnya.
--
-- ⚠️ TIDAK ADA KOLOM SALDO yang ditambahkan di sini. `saldo_awal` adalah
--    PENANDA (boolean), bukan angka; angkanya tetap di `amount`, dan saldo tetap
--    `SUM(amount)`.

ALTER TABLE "app"."cash_ledger"
    ADD COLUMN IF NOT EXISTS "saldo_awal" BOOLEAN NOT NULL DEFAULT false;

-- Hanya `adjustment` yang boleh jadi saldo awal: ia tak berkategori dan bebas
-- tanda, dua sifat yang memang dibutuhkan titik awal sebuah rekening.
ALTER TABLE "app"."cash_ledger"
    DROP CONSTRAINT IF EXISTS "cash_ledger_saldo_awal_jenis";
ALTER TABLE "app"."cash_ledger"
    ADD CONSTRAINT "cash_ledger_saldo_awal_jenis" CHECK (
        NOT "saldo_awal" OR "jenis" = 'adjustment'
    );

-- SATU saldo pembuka non-void per rekening. Ini yang membuatnya FAKTA, bukan
-- sekadar penyesuaian bernama: dua titik awal untuk satu rekening membuat
-- saldonya bergantung pada baris mana yang kebetulan terbaca lebih dulu.
--
-- Penggantian tetap mungkin (§10.24 butir 3) justru KARENA indeks ini parsial:
-- anchor lama di-void → keluar dari indeks → anchor baru boleh masuk.
CREATE UNIQUE INDEX IF NOT EXISTS "cash_ledger_satu_saldo_awal"
    ON "app"."cash_ledger"("unit_id", "account_id")
    WHERE "saldo_awal" AND NOT "void";

-- Hak `dashboard_app` atas `cash_ledger` sudah diberikan 0029
-- (SELECT/INSERT/UPDATE, DELETE di-REVOKE). Kolom baru ikut hak tabelnya;
-- tak ada GRANT baru yang dibutuhkan — diperiksa, bukan diasumsikan.
