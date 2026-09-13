-- KAPASITAS · §3 KEMBALIKAN RUANG KE OS — MENULIS, MENGUNCI.
--
-- ⚠️ `DELETE` tidak pernah mengecilkan berkas. Autovacuum menandai ruangnya
-- DAPAT DIPAKAI ULANG oleh tabel yang sama, tetapi `pg_database_size` — yang
-- persis dibaca gerbang `databaseReviewBytes` — tetap tinggi. Karena itu §2
-- saja TIDAK membuka gerbangnya; §3 yang membukanya.
--
-- ⚠️ `VACUUM FULL` mengambil ACCESS EXCLUSIVE: selama ia berjalan, /ingest
-- untuk piutang/hutang MEMBLOKIR. Jalankan pada jendela sepi. Karena §2 sudah
-- membuang baris cycle `failed`, yang ditulis ulang hanyalah baris yang masih
-- hidup — jauh lebih kecil dan jauh lebih cepat daripada menulis ulang 8 GB.
--
-- ⚠️ URUTAN MENGIKAT: §2 DULU, baru §3. Terbalik berarti menulis ulang seluruh
-- bangkai ke berkas baru dan mengunci jauh lebih lama tanpa hasil.
--
-- Ruang bebas yang dibutuhkan ≈ ukuran baris HIDUP + indeksnya. Disk instance
-- 25 GB dengan database ~14 GB, jadi kepala ruangnya cukup — tetapi periksa
-- keluaran §1 sebelum menjalankan.
--
-- ⛔ JANGAN mendekati 02:00 WIB. 14-09-2026 01:02 WIB ia menahan tujuh sesi,
-- termasuk LIMA backend agent di pg_advisory_xact_lock selama 9-14 menit.
-- ⚠️ Puncak ruang = lama + baru; terpantau 13,97 GB -> 16 GB saat berjalan.
-- Peran berkas ini JARANG dipakai; lihat README.md di direktori ini.
--
-- Jalankan TANPA transaksi pembungkus (VACUUM tidak sah di dalam transaksi).
\set ON_ERROR_STOP on
\timing on

\echo '--- SEBELUM ---'
SELECT c.relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS total
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'app' AND c.relname LIKE 'saldo_pelanggan_source_%'
ORDER BY pg_total_relation_size(c.oid) DESC;
SELECT pg_size_pretty(pg_database_size(current_database())) AS database_sebelum;

VACUUM (FULL, ANALYZE) app.saldo_pelanggan_source_bppiut;
VACUUM (FULL, ANALYZE) app.saldo_pelanggan_source_bphut;
VACUUM (FULL, ANALYZE) app.saldo_pelanggan_source_pelanggan;

-- Gratis sekalian, dan ia membuka pertanyaan F1: `pg_stats` untuk
-- `public.bppiut.ingested_at` memulangkan NOL BARIS, artinya kolom itu tidak
-- punya statistik sama sekali. Tanpa statistik, planner memakai selektivitas
-- default untuk `ingested_at > konstanta`, sehingga keputusan "btree atau BRIN"
-- diambil di atas tebakan planner, bukan di atas distribusi sebenarnya.
-- ANALYZE tidak mengunci dan murah.
ANALYZE public.bppiut;
ANALYZE public.bphut;

\echo '--- SESUDAH ---'
SELECT c.relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS total
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'app' AND c.relname LIKE 'saldo_pelanggan_source_%'
ORDER BY pg_total_relation_size(c.oid) DESC;
SELECT pg_database_size(current_database())               AS database_bytes,
       pg_size_pretty(pg_database_size(current_database())) AS database_sesudah,
       pg_database_size(current_database()) < 9000000000    AS gerbang_terbuka;

\echo '--- statistik ingested_at yang tadinya kosong ---'
SELECT tablename, attname, correlation, n_distinct
FROM pg_stats WHERE schemaname='public' AND tablename IN ('bppiut','bphut')
  AND attname = 'ingested_at';
