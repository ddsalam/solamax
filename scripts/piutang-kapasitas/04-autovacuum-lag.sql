-- KAPASITAS · §4 UKUR LAG AUTOVACUUM — read-only, aman diulang.
--
-- ⚠️ KENAPA INI ADA. Saya menulis premis ini tanpa mengukurnya:
--
--   "sesudah aliran benar, ruang mati dipakai ulang INSERT berikutnya, jadi
--    berkasnya berhenti tumbuh pada tanda-airnya."
--
-- Premis itu yang menopang klaim "VACUUM FULL berhenti jadi kebutuhan rutin".
-- Ia masuk akal, tetapi ruang mati baru dapat dipakai ulang SESUDAH autovacuum
-- menandainya, dan pada tabel 3-9 GB dengan hapus-massal puluhan kali sehari
-- autovacuum bisa tertinggal jauh. Selama lag itu belum diukur, klaimnya
-- adalah dugaan berbaju kesimpulan.
--
-- PREDIKSI YANG DIKUNCI SEBELUM PENGUKURAN (14-09-2026):
--   Dengan pemensiunan berjalan tiap jam,
--   `pg_relation_size('app.saldo_pelanggan_source_bppiut')` MENDATAR dalam
--   <= 6 jam, pada tingkat <= ~1 GB.
--   Bila ia naik monoton selama 24 jam, prediksi ini SALAH, lag autovacuum
--   nyata, dan tuning autovacuum berhenti menjadi "migrasi tanpa pengukuran" —
--   ia menjadi bagian dari perbaikan aliran.
--
-- CARA PAKAI: jalankan tiap jam (mis. `watch -n 3600`) dan simpan keluarannya
-- berurutan. Satu jalanan tunggal TIDAK menjawab apa pun — yang dibaca adalah
-- deretnya.
--
--   psql "$DATABASE_URL_PILOT" -X -f scripts/piutang-kapasitas/04-autovacuum-lag.sql >> lag.log
\set ON_ERROR_STOP on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';

SELECT set_config('app.unit_ids',
                  (SELECT string_agg(unit_id::text, ',' ORDER BY unit_id) FROM public.unit),
                  true) AS scope;

-- Satu baris per tabel, sengaja ringkas supaya mudah dibandingkan antar jalanan.
SELECT
  now() AT TIME ZONE 'Asia/Pontianak' AS wib,
  c.relname,
  pg_size_pretty(pg_relation_size(c.oid))      AS heap,
  pg_relation_size(c.oid)                      AS heap_bytes,
  s.n_live_tup,
  s.n_dead_tup,
  -- Bagian mati; inilah yang menentukan apakah autovacuum terpicu.
  round(100.0 * s.n_dead_tup / NULLIF(s.n_live_tup + s.n_dead_tup, 0), 1) AS persen_mati,
  s.autovacuum_count,
  s.last_autovacuum AT TIME ZONE 'Asia/Pontianak' AS autovacuum_terakhir,
  -- Lag yang dimaksud: berapa lama ruang mati menunggu ditandai dapat dipakai.
  justify_interval(now() - s.last_autovacuum)  AS sejak_autovacuum,
  -- Ambang picu efektif Postgres untuk tabel ini.
  (current_setting('autovacuum_vacuum_threshold')::bigint
   + current_setting('autovacuum_vacuum_scale_factor')::float8 * s.n_live_tup)::bigint
    AS ambang_picu,
  s.n_dead_tup > (current_setting('autovacuum_vacuum_threshold')::bigint
   + current_setting('autovacuum_vacuum_scale_factor')::float8 * s.n_live_tup)
    AS sudah_melewati_ambang
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE (n.nspname = 'app' AND c.relname LIKE 'saldo_pelanggan_source_%')
   OR (n.nspname = 'public' AND c.relname IN ('bppiut', 'bphut'))
ORDER BY pg_relation_size(c.oid) DESC;

-- Vacuum yang sedang berjalan: bila kolom ini sering terisi, autovacuum
-- memang sedang berjuang dan bukan sekadar terlambat dipicu.
SELECT p.relid::regclass AS tabel, p.phase,
       pg_size_pretty(p.heap_blks_total * 8192::bigint)   AS total,
       pg_size_pretty(p.heap_blks_scanned * 8192::bigint) AS terpindai
FROM pg_stat_progress_vacuum p;

-- Cut staging yang hidup — angka laju dari §a rancangan. Sehat = 1, maks 2.
SELECT unit_id, count(*) AS staging_hidup
FROM app.saldo_pelanggan_source_cycle
WHERE status = 'staging' GROUP BY unit_id ORDER BY unit_id;

SELECT pg_size_pretty(pg_database_size(current_database())) AS database_size,
       pg_database_size(current_database()) < 9000000000 AS gerbang_terbuka;

ROLLBACK;
