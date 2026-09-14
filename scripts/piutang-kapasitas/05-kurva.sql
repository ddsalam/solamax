-- KAPASITAS · §5 SATU TITIK KURVA — read-only, satu baris per subjek.
--
-- Bentuknya sengaja ringkas dan ber-tag supaya deretnya dapat di-`grep` dan
-- dibaca sebagai KURVA. Satu titik tidak menjawab apa pun; yang menjawab adalah
-- deretnya. Dipanggil berulang oleh `05-kurva.sh`.
--
-- Menguji dua hal sekaligus:
--   (b) apakah job per jam benar-benar MENAHAN LAJU  -> kolom heap_bytes
--   (a) apakah autovacuum tertinggal                 -> n_dead_tup + sejak_av_detik
\set ON_ERROR_STOP on
\pset format unaligned
\pset fieldsep '|'
\pset tuples_only on
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '60s';

-- Lewat DO supaya tidak ikut mencetak baris ke kurva. Scope RLS tetap WAJIB:
-- tanpa itu kuerinya memulangkan nol baris tanpa galat, dan nol itu akan
-- terbaca sebagai "tabelnya menyusut".
DO $scope$
BEGIN
  PERFORM set_config('app.unit_ids',
    (SELECT string_agg(unit_id::text, ',' ORDER BY unit_id) FROM public.unit), true);
END
$scope$;

SELECT concat_ws('|', 'KURVA',
  to_char(now() AT TIME ZONE 'Asia/Pontianak', 'YYYY-MM-DD HH24:MI'),
  c.relname,
  pg_relation_size(c.oid),
  s.n_live_tup, s.n_dead_tup, s.autovacuum_count,
  COALESCE(round(extract(epoch FROM now() - s.last_autovacuum))::text, 'never'))
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_stat_user_tables s ON s.relid = c.oid
WHERE (n.nspname = 'app' AND c.relname LIKE 'saldo_pelanggan_source_%')
   OR (n.nspname = 'public' AND c.relname IN ('bppiut', 'bphut'))
ORDER BY pg_relation_size(c.oid) DESC;

SELECT concat_ws('|', 'KURVA_DB',
  to_char(now() AT TIME ZONE 'Asia/Pontianak', 'YYYY-MM-DD HH24:MI'),
  pg_database_size(current_database()),
  (pg_database_size(current_database()) < 9000000000)::text,
  (SELECT count(*) FROM app.saldo_pelanggan_source_cycle WHERE status = 'staging'),
  (SELECT count(*) FROM app.saldo_pelanggan_source_cycle WHERE status = 'failed'));

ROLLBACK;
