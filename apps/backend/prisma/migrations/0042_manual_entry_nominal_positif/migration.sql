-- 0042_manual_entry_nominal_positif — SATU konvensi tanda untuk app.manual_entry.
--
-- Nominal SELALU positif; ARAH ditentukan `section` (pengeluaran = keluar,
-- pendapatan_lain / setoran_tunai = masuk). Konvensi ini sejak awal dipakai
-- pintu pengawas (addManualEntry menolak <= 0) dan dihitung rekonsiliasi
-- Rincian/Ketaatan. Pintu Finance (0034) menyimpan pengeluaran NEGATIF, dan
-- laporan keuangan membalik tanda semua pengeluaran — biaya pengawas akhirnya
-- MENAMBAH laba bersih (produksi IB 24-09-2026). Kodenya diperbaiki bersama
-- migrasi ini; migrasi ini memastikan penulis MANA PUN berikutnya tak bisa
-- mengulanginya tanpa ditolak database.
--
-- ⛔ NOT VALID, dengan sengaja:
--   · baris lama TIDAK dipindai dan TIDAK disunting. Baris Finance yang
--     terlanjur negatif dinormalkan SAAT DIBACA (NOMINAL_MANUAL_ENTRY_SQL di
--     apps/dashboard/src/lib/manual-entry-nominal.ts). Menyunting sejarah di
--     sini akan menabrak kunci hari tertutup (0026/0027) dan bukan tugas
--     migrasi skema.
--   · tanpa pemindaian, ALTER ini hanya butuh kunci singkat — aman untuk
--     tabel yang dipakai tujuh unit setiap hari.
--
-- ⚠️ `"void" OR` — sebab NOT VALID tetap diperiksa pada UPDATE baris LAMA.
--   Tanpa suku ini, membatalkan baris lama yang terlanjur negatif (satu-satunya
--   UPDATE yang ada: voidManualEntry) akan DITOLAK — pengawas tak bisa lagi
--   membetulkan salah ketiknya sendiri. Baris yang dibatalkan tak dihitung di
--   mana pun, jadi tandanya tak lagi berarti.
ALTER TABLE "app"."manual_entry"
    DROP CONSTRAINT IF EXISTS "manual_entry_nominal_positif";
ALTER TABLE "app"."manual_entry"
    ADD CONSTRAINT "manual_entry_nominal_positif" CHECK ("void" OR "amount" > 0) NOT VALID;
