BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL app.unit_ids='1';
SELECT clock_timestamp() AS observed_at,current_user,current_setting('transaction_read_only') AS read_only,current_setting('app.unit_ids') AS unit_scope;
SELECT unit_id,code,name,timezone FROM public.unit WHERE unit_id=1;
SELECT source_cycle_id,count(*) AS positive_cut_rows FROM app.saldo_pelanggan_source_pelanggan WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff' GROUP BY source_cycle_id;
\echo === Y2_NULL_CREDIT_AND_EQUIVALENT_HUTANG ===
WITH master AS (
 SELECT btrim(ckdplg) AS cc,sjenis FROM app.saldo_pelanggan_source_pelanggan WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff'
), ledger AS (
 SELECT 'bppiut' AS ledger,btrim(ckdbppiut) AS entry_key,btrim(ckdplg) AS cc,dtgl,njumlah,sjnsbp FROM app.saldo_pelanggan_source_bppiut WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff' AND dtgl<=DATE '2026-09-13' AND COALESCE(sbatal,0)=0
 UNION ALL
 SELECT 'bphut',btrim(ckdbphut),btrim(ckdplg),dtgl,njumlah,sjnsbp FROM app.saldo_pelanggan_source_bphut WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff' AND dtgl<=DATE '2026-09-13' AND COALESCE(sbatal,0)=0
), classified AS (
 SELECT l.*,m.sjenis,CASE WHEN m.cc IS NULL THEN 'a_no_master' WHEN m.sjenis IS NULL THEN 'c_null_sjenis' WHEN m.sjenis NOT IN (1,5) THEN 'b_other_sjenis' ELSE 'local_master' END AS master_status,
 (position('.' IN l.cc)=0 AND l.cc NOT IN (SELECT cc FROM master WHERE sjenis IN (1,5))) AS outside_local_master_no_dot
 FROM ledger l LEFT JOIN master m ON m.cc=l.cc
)
SELECT ledger,count(*) AS rows,count(DISTINCT cc) AS customers,count(*) FILTER(WHERE sjnsbp=1) AS debit_rows,count(*) FILTER(WHERE sjnsbp=2) AS credit_rows,count(*) FILTER(WHERE njumlah IS NULL) AS amount_null_rows,count(*) FILTER(WHERE sjnsbp=2 AND njumlah IS NULL) AS credit_amount_null_rows,sum(njumlah) FILTER(WHERE sjnsbp=1) AS debit,sum(njumlah) FILTER(WHERE sjnsbp=2) AS credit,min(dtgl) AS first_date,max(dtgl) AS last_date
FROM classified WHERE outside_local_master_no_dot GROUP BY ledger ORDER BY ledger;
\echo === Y3_PREFIX ===
WITH master AS (
 SELECT btrim(ckdplg) AS cc,sjenis FROM app.saldo_pelanggan_source_pelanggan WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff'
), ledger AS (
 SELECT 'bppiut' AS ledger,btrim(ckdbppiut) AS entry_key,btrim(ckdplg) AS cc,dtgl,njumlah,sjnsbp FROM app.saldo_pelanggan_source_bppiut WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff' AND dtgl<=DATE '2026-09-13' AND COALESCE(sbatal,0)=0
 UNION ALL
 SELECT 'bphut',btrim(ckdbphut),btrim(ckdplg),dtgl,njumlah,sjnsbp FROM app.saldo_pelanggan_source_bphut WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff' AND dtgl<=DATE '2026-09-13' AND COALESCE(sbatal,0)=0
), classified AS (
 SELECT l.*,m.sjenis,CASE WHEN m.cc IS NULL THEN 'a_no_master' WHEN m.sjenis IS NULL THEN 'c_null_sjenis' WHEN m.sjenis NOT IN (1,5) THEN 'b_other_sjenis' ELSE 'local_master' END AS master_status,
 (position('.' IN l.cc)=0 AND l.cc NOT IN (SELECT cc FROM master WHERE sjenis IN (1,5))) AS outside_local_master_no_dot
 FROM ledger l LEFT JOIN master m ON m.cc=l.cc
)
SELECT ledger,left(btrim(entry_key),2) AS prefix,count(*) AS rows,count(DISTINCT cc) AS customers,count(*) FILTER(WHERE sjnsbp=2) AS credit_rows,count(*) FILTER(WHERE njumlah IS NULL) AS amount_null_rows,sum(njumlah) FILTER(WHERE sjnsbp=1) AS debit,sum(njumlah) FILTER(WHERE sjnsbp=2) AS credit
FROM classified WHERE outside_local_master_no_dot GROUP BY ledger,left(btrim(entry_key),2) ORDER BY ledger,rows DESC,prefix;
\echo === Y3_MASTER_STATUS ===
WITH master AS (
 SELECT btrim(ckdplg) AS cc,sjenis FROM app.saldo_pelanggan_source_pelanggan WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff'
), ledger AS (
 SELECT 'bppiut' AS ledger,btrim(ckdbppiut) AS entry_key,btrim(ckdplg) AS cc,dtgl,njumlah,sjnsbp FROM app.saldo_pelanggan_source_bppiut WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff' AND dtgl<=DATE '2026-09-13' AND COALESCE(sbatal,0)=0
 UNION ALL
 SELECT 'bphut',btrim(ckdbphut),btrim(ckdplg),dtgl,njumlah,sjnsbp FROM app.saldo_pelanggan_source_bphut WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff' AND dtgl<=DATE '2026-09-13' AND COALESCE(sbatal,0)=0
), classified AS (
 SELECT l.*,m.sjenis,CASE WHEN m.cc IS NULL THEN 'a_no_master' WHEN m.sjenis IS NULL THEN 'c_null_sjenis' WHEN m.sjenis NOT IN (1,5) THEN 'b_other_sjenis' ELSE 'local_master' END AS master_status,
 (position('.' IN l.cc)=0 AND l.cc NOT IN (SELECT cc FROM master WHERE sjenis IN (1,5))) AS outside_local_master_no_dot
 FROM ledger l LEFT JOIN master m ON m.cc=l.cc
)
SELECT ledger,master_status,sjenis,count(*) AS rows,count(DISTINCT cc) AS customers,sum(njumlah) FILTER(WHERE sjnsbp=1) AS debit,sum(njumlah) FILTER(WHERE sjnsbp=2) AS credit
FROM classified WHERE outside_local_master_no_dot GROUP BY ledger,master_status,sjenis ORDER BY ledger,master_status,sjenis;
\echo === Y3_MASTER_PREFIX_CROSS_TAB ===
WITH master AS (
 SELECT btrim(ckdplg) AS cc,sjenis FROM app.saldo_pelanggan_source_pelanggan WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff'
), ledger AS (
 SELECT 'bppiut' AS ledger,btrim(ckdbppiut) AS entry_key,btrim(ckdplg) AS cc,dtgl,njumlah,sjnsbp FROM app.saldo_pelanggan_source_bppiut WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff' AND dtgl<=DATE '2026-09-13' AND COALESCE(sbatal,0)=0
 UNION ALL
 SELECT 'bphut',btrim(ckdbphut),btrim(ckdplg),dtgl,njumlah,sjnsbp FROM app.saldo_pelanggan_source_bphut WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff' AND dtgl<=DATE '2026-09-13' AND COALESCE(sbatal,0)=0
), classified AS (
 SELECT l.*,m.sjenis,CASE WHEN m.cc IS NULL THEN 'a_no_master' WHEN m.sjenis IS NULL THEN 'c_null_sjenis' WHEN m.sjenis NOT IN (1,5) THEN 'b_other_sjenis' ELSE 'local_master' END AS master_status,
 (position('.' IN l.cc)=0 AND l.cc NOT IN (SELECT cc FROM master WHERE sjenis IN (1,5))) AS outside_local_master_no_dot
 FROM ledger l LEFT JOIN master m ON m.cc=l.cc
)
SELECT ledger,master_status,sjenis,left(btrim(entry_key),2) AS prefix,count(*) AS rows,count(DISTINCT cc) AS customers,sum(njumlah) FILTER(WHERE sjnsbp=1) AS debit,sum(njumlah) FILTER(WHERE sjnsbp=2) AS credit
FROM classified WHERE outside_local_master_no_dot GROUP BY ledger,master_status,sjenis,left(btrim(entry_key),2) ORDER BY ledger,master_status,sjenis,prefix;
\echo === H3_ALL_ACTIVE_LEDGER ===
WITH master AS (
 SELECT btrim(ckdplg) AS cc,sjenis FROM app.saldo_pelanggan_source_pelanggan WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff'
), ledger AS (
 SELECT 'bppiut' AS ledger,btrim(ckdbppiut) AS entry_key,btrim(ckdplg) AS cc,dtgl,njumlah,sjnsbp FROM app.saldo_pelanggan_source_bppiut WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff' AND dtgl<=DATE '2026-09-13' AND COALESCE(sbatal,0)=0
 UNION ALL
 SELECT 'bphut',btrim(ckdbphut),btrim(ckdplg),dtgl,njumlah,sjnsbp FROM app.saldo_pelanggan_source_bphut WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff' AND dtgl<=DATE '2026-09-13' AND COALESCE(sbatal,0)=0
), classified AS (
 SELECT l.*,m.sjenis,CASE WHEN m.cc IS NULL THEN 'a_no_master' WHEN m.sjenis IS NULL THEN 'c_null_sjenis' WHEN m.sjenis NOT IN (1,5) THEN 'b_other_sjenis' ELSE 'local_master' END AS master_status,
 (position('.' IN l.cc)=0 AND l.cc NOT IN (SELECT cc FROM master WHERE sjenis IN (1,5))) AS outside_local_master_no_dot
 FROM ledger l LEFT JOIN master m ON m.cc=l.cc
)
SELECT ledger,count(*) AS active_rows,count(*) FILTER(WHERE sjnsbp IS NULL) AS sjnsbp_null_rows,count(*) FILTER(WHERE sjnsbp NOT IN (1,2)) AS sjnsbp_other_rows,count(*) FILTER(WHERE njumlah IS NULL) AS amount_null_rows,count(*) FILTER(WHERE cc IS NULL) AS code_null_rows,count(*) FILTER(WHERE cc='') AS code_empty_rows
FROM ledger GROUP BY ledger ORDER BY ledger;
\echo === Y5_ALL_HUTANG_MASTER_STATUS_INCLUDING_DOTTED_CODES ===
WITH master AS (
 SELECT btrim(ckdplg) AS cc,sjenis FROM app.saldo_pelanggan_source_pelanggan WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff'
), ledger AS (
 SELECT 'bppiut' AS ledger,btrim(ckdbppiut) AS entry_key,btrim(ckdplg) AS cc,dtgl,njumlah,sjnsbp FROM app.saldo_pelanggan_source_bppiut WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff' AND dtgl<=DATE '2026-09-13' AND COALESCE(sbatal,0)=0
 UNION ALL
 SELECT 'bphut',btrim(ckdbphut),btrim(ckdplg),dtgl,njumlah,sjnsbp FROM app.saldo_pelanggan_source_bphut WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff' AND dtgl<=DATE '2026-09-13' AND COALESCE(sbatal,0)=0
), classified AS (
 SELECT l.*,m.sjenis,CASE WHEN m.cc IS NULL THEN 'a_no_master' WHEN m.sjenis IS NULL THEN 'c_null_sjenis' WHEN m.sjenis NOT IN (1,5) THEN 'b_other_sjenis' ELSE 'local_master' END AS master_status,
 (position('.' IN l.cc)=0 AND l.cc NOT IN (SELECT cc FROM master WHERE sjenis IN (1,5))) AS outside_local_master_no_dot
 FROM ledger l LEFT JOIN master m ON m.cc=l.cc
)
SELECT master_status,sjenis,count(*) AS rows,count(DISTINCT cc) AS customers,sum(njumlah) FILTER(WHERE sjnsbp=1) AS debit,sum(njumlah) FILTER(WHERE sjnsbp=2) AS credit
FROM classified WHERE ledger='bphut' GROUP BY master_status,sjenis ORDER BY master_status,sjenis;
\echo === Y4_TOP20_MIRROR_LABELS_ONLY_NOT_CUT_NUMERIC_EVIDENCE ===
WITH master AS (
 SELECT btrim(ckdplg) AS cc,sjenis FROM app.saldo_pelanggan_source_pelanggan WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff'
), ledger AS (
 SELECT 'bppiut' AS ledger,btrim(ckdbppiut) AS entry_key,btrim(ckdplg) AS cc,dtgl,njumlah,sjnsbp FROM app.saldo_pelanggan_source_bppiut WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff' AND dtgl<=DATE '2026-09-13' AND COALESCE(sbatal,0)=0
 UNION ALL
 SELECT 'bphut',btrim(ckdbphut),btrim(ckdplg),dtgl,njumlah,sjnsbp FROM app.saldo_pelanggan_source_bphut WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff' AND dtgl<=DATE '2026-09-13' AND COALESCE(sbatal,0)=0
), classified AS (
 SELECT l.*,m.sjenis,CASE WHEN m.cc IS NULL THEN 'a_no_master' WHEN m.sjenis IS NULL THEN 'c_null_sjenis' WHEN m.sjenis NOT IN (1,5) THEN 'b_other_sjenis' ELSE 'local_master' END AS master_status,
 (position('.' IN l.cc)=0 AND l.cc NOT IN (SELECT cc FROM master WHERE sjenis IN (1,5))) AS outside_local_master_no_dot
 FROM ledger l LEFT JOIN master m ON m.cc=l.cc
)
, top20 AS (SELECT * FROM classified WHERE ledger='bppiut' AND outside_local_master_no_dot ORDER BY njumlah DESC NULLS LAST,entry_key LIMIT 20)
SELECT t.entry_key,t.cc,t.dtgl AS cut_date,t.njumlah AS cut_amount,t.sjnsbp AS cut_sjnsbp,t.master_status,t.sjenis,b.vcref AS mirror_vcref,b.vcket AS mirror_vcket,(b.ckdbppiut IS NOT NULL) AS mirror_match
FROM top20 t LEFT JOIN public.bppiut b ON b.unit_id=1 AND btrim(b.ckdbppiut)=t.entry_key ORDER BY t.njumlah DESC NULLS LAST,t.entry_key;
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
