BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL app.unit_ids = '1';
SELECT clock_timestamp() AS observed_at, current_user, current_database(), current_setting('transaction_read_only') AS read_only, current_setting('app.unit_ids') AS unit_scope;
SELECT unit_id, code, name, timezone FROM public.unit WHERE unit_id = 1;
SELECT count(*) AS bppiut_ib FROM public.bppiut WHERE unit_id = 1;
SELECT n.nspname || '.' || c.relname AS relation, has_table_privilege(current_user,c.oid,'SELECT') AS can_select FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relname IN ('saldo_pelanggan_snapshot_manifest','saldo_pelanggan_snapshot_pointer','saldo_pelanggan_snapshot_row','saldo_pelanggan_build_work','saldo_pelanggan_source_cycle','saldo_pelanggan_source_pelanggan','saldo_pelanggan_source_bppiut','saldo_pelanggan_source_bphut') ORDER BY relation;
ROLLBACK;
