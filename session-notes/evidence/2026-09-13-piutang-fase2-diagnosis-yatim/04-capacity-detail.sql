BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL app.unit_ids='1';
SELECT unit_id,code,name FROM public.unit WHERE unit_id=1;
SELECT pg_relation_size('app.saldo_pelanggan_snapshot_row') AS heap_bytes,pg_table_size('app.saldo_pelanggan_snapshot_row') AS table_bytes,pg_indexes_size('app.saldo_pelanggan_snapshot_row') AS index_bytes,pg_total_relation_size('app.saldo_pelanggan_snapshot_row') AS total_bytes;
SELECT count(*) AS visible_snapshot_rows,count(DISTINCT generation_id) AS visible_generations,count(DISTINCT unit_id) AS visible_units FROM app.saldo_pelanggan_snapshot_row;
SELECT status,count(*) AS visible_source_cycles FROM app.saldo_pelanggan_source_cycle WHERE unit_id=1 GROUP BY status ORDER BY status;
SELECT SUM(pg_total_relation_size(c.oid)) AS source_relations_total_bytes FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relkind='r' AND c.relname LIKE 'saldo_pelanggan_source_%';
ROLLBACK;
