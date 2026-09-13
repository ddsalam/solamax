BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL app.unit_ids='1';
SELECT unit_id,code,name FROM public.unit WHERE unit_id=1;
\echo === B_ACTUAL_RELATION_AND_DATABASE_BYTES ===
SELECT clock_timestamp() AS observed_at,current_database(),pg_database_size(current_database()) AS database_bytes;
SELECT n.nspname AS schema,c.relname AS relation,pg_table_size(c.oid) AS table_bytes,pg_indexes_size(c.oid) AS index_bytes,pg_total_relation_size(c.oid) AS total_bytes
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind='r' AND ((n.nspname='app' AND c.relname LIKE 'saldo_pelanggan_%') OR (n.nspname='public' AND c.relname IN ('bppiut','bphut','pelanggan')))
ORDER BY n.nspname,pg_total_relation_size(c.oid) DESC,c.relname;
\echo === B_SNAPSHOT_GENERATION_FOOTPRINT_AND_BASELINE_ROLE ===
SELECT r.as_of_date,r.generation_id,count(*) AS row_count,sum(pg_column_size(r)) AS row_payload_bytes
FROM app.saldo_pelanggan_snapshot_row r WHERE unit_id=1 GROUP BY r.as_of_date,r.generation_id ORDER BY r.as_of_date,r.generation_id;
SELECT m.as_of_date,m.generation_id,m.status,m.source_cycle_id,m.source_completed_at,m.base_month_end,m.base_generation_id,m.formula_version,m.row_count,(p.generation_id IS NOT NULL) AS has_pointer
FROM app.saldo_pelanggan_snapshot_manifest m LEFT JOIN app.saldo_pelanggan_snapshot_pointer p USING(unit_id,as_of_date,generation_id)
WHERE m.unit_id=1 ORDER BY m.as_of_date,m.generation_id;
ROLLBACK;
