-- 0045_titipan_bright — kategori kredit untuk MENYERAHKAN titipan outlet Bright.
--
-- KEPUTUSAN OWNER 26 Sep 2026 (KEUANGAN-HARIAN §10.27): "Setoran Bright" adalah
-- titipan outlet Bright, bukan pendapatan SPBU. Titipan diterima lewat Rincian
-- Penjualan (kategori operasional 'Titipan outlet Bright', tanpa migrasi — kolom
-- operational_category sudah ada sejak 0024 dan tak dibatasi CHECK). Saat uangnya
-- diserahkan ke outlet Bright/SPH, Keuangan mencatat KREDIT dengan kategori ini;
-- neraca mengurangi liabilitas titipan sebesar itu.
INSERT INTO "app"."cash_mutation_category" ("side", "label") VALUES
    ('kredit', 'Penyerahan titipan Bright')
ON CONFLICT ("side", "label") DO NOTHING;
