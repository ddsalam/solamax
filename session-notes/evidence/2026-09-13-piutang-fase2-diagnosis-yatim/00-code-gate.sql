BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL app.unit_ids='1';
SELECT clock_timestamp() AS observed_at, current_user, current_database(), current_setting('transaction_read_only') AS read_only, current_setting('app.unit_ids') AS unit_scope;
SELECT unit_id,code,name,timezone FROM public.unit WHERE unit_id=1;
SELECT source_cycle_id,count(*) AS positive_cut_rows FROM app.saldo_pelanggan_source_pelanggan WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff' GROUP BY source_cycle_id;
\pset format csv
\o session-notes/evidence/2026-09-13-piutang-fase2-diagnosis-yatim/orphan-codes.csv
WITH lk AS (
 SELECT btrim(ckdplg) AS cc FROM app.saldo_pelanggan_source_pelanggan WHERE unit_id=1 AND source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff' AND sjenis IN (1,5)
)
SELECT DISTINCT btrim(b.ckdplg) AS customer_code
FROM app.saldo_pelanggan_source_bppiut b
WHERE b.unit_id=1 AND b.source_cycle_id='c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff'
 AND b.dtgl <= DATE '2026-09-13' AND COALESCE(b.sbatal,0)=0
 AND position('.' IN btrim(b.ckdplg))=0 AND btrim(b.ckdplg) NOT IN (SELECT cc FROM lk)
ORDER BY customer_code;
\o
ROLLBACK;
