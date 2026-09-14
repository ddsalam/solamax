-- KAPASITAS · §1 UKUR — read-only, tidak mengubah apa pun.
--
-- Dijalankan sebagai `ingest` terhadap produksi lewat cloud-sql-proxy.
-- Tujuannya BUKAN mengulang pengukuran Dion, melainkan memisahkan dua angka
-- yang selama ini bercampur:
--   · `n_live_tup` / `n_dead_tup` di pg_stat_user_tables adalah PERKIRAAN yang
--     di-update autovacuum/analyze. Pada tabel dengan churn setinggi ini ia
--     bisa meleset jauh.
--   · `count(*)` per status cycle adalah angka SEBENARNYA, dan itulah yang
--     menentukan apakah pengurasan saja sudah cukup.
-- Kalau keduanya berbeda jauh, yang dipercaya adalah count(*).
\set ON_ERROR_STOP on
\timing on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '300s';

SELECT set_config('app.unit_ids',
                  (SELECT string_agg(unit_id::text, ',' ORDER BY unit_id) FROM public.unit),
                  true) AS scope;

\echo '--- ukuran fisik & perkiraan tuple ---'
SELECT c.relname,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
       pg_size_pretty(pg_relation_size(c.oid))       AS heap,
       s.n_live_tup AS perkiraan_hidup,
       s.n_dead_tup AS perkiraan_mati,
       s.last_vacuum, s.last_autovacuum, s.last_analyze, s.last_autoanalyze
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE n.nspname = 'app' AND c.relname LIKE 'saldo_pelanggan_source_%'
ORDER BY pg_total_relation_size(c.oid) DESC;

\echo '--- cycle per status ---'
SELECT unit_id, status, count(*) AS cycles,
       min(source_cycle_sequence) AS seq_min, max(source_cycle_sequence) AS seq_max
FROM app.saldo_pelanggan_source_cycle
GROUP BY unit_id, status ORDER BY unit_id, status;

\echo '--- BARIS SEBENARNYA per status cycle (angka yang menentukan) ---'
SELECT c.status,
       count(*) FILTER (WHERE t.tbl = 'pelanggan') AS pelanggan,
       count(*) FILTER (WHERE t.tbl = 'bppiut')   AS bppiut,
       count(*) FILTER (WHERE t.tbl = 'bphut')    AS bphut
FROM (
  SELECT unit_id, source_cycle_id, 'pelanggan' AS tbl FROM app.saldo_pelanggan_source_pelanggan
  UNION ALL SELECT unit_id, source_cycle_id, 'bppiut' FROM app.saldo_pelanggan_source_bppiut
  UNION ALL SELECT unit_id, source_cycle_id, 'bphut'  FROM app.saldo_pelanggan_source_bphut
) t
JOIN app.saldo_pelanggan_source_cycle c
  ON c.unit_id = t.unit_id AND c.source_cycle_id = t.source_cycle_id
GROUP BY c.status ORDER BY c.status;

\echo '--- gerbang kapasitas ---'
SELECT pg_database_size(current_database())            AS database_bytes,
       9000000000                                      AS databaseReviewBytes,
       pg_database_size(current_database()) >= 9000000000 AS gerbang_menutup,
       pg_size_pretty(pg_database_size(current_database())) AS terbaca;

ROLLBACK;
