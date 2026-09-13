BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL app.unit_ids = '1';
\pset numericlocale off
\echo === 0. KONTROL POSITIF (identitas + RLS) ===
SELECT current_user,
       current_setting('system_identifier', true) AS sysid,
       (SELECT count(*) FROM public.unit) AS unit_count;
SELECT current_setting('app.unit_ids') AS unit_scope;
SELECT unit_id, code, name, timezone FROM public.unit WHERE unit_id = 1;
SELECT count(*) AS bppiut_ib FROM public.bppiut;

\echo === 1. POINTER + MANIFEST, unit 1, 10..13 Sep ===
SELECT p.as_of_date, p.generation_id, p.pending_replacement,
       m.status, m.formula_version, m.row_count, m.customer_key_count,
       m.source_cycle_sequence, m.published_at
FROM app.saldo_pelanggan_snapshot_pointer p
JOIN app.saldo_pelanggan_snapshot_manifest m
  ON m.unit_id = p.unit_id AND m.as_of_date = p.as_of_date AND m.generation_id = p.generation_id
WHERE p.unit_id = 1 AND p.as_of_date BETWEEN DATE '2026-09-01' AND DATE '2026-09-13'
ORDER BY p.as_of_date;

\echo === 1b. SEMUA manifest unit 1 (termasuk failed/building) ===
SELECT as_of_date, status, failure_code, left(coalesce(failure_summary,''),60) AS why,
       started_at, completed_at
FROM app.saldo_pelanggan_snapshot_manifest
WHERE unit_id = 1 ORDER BY as_of_date, started_at;

\echo === 1c. ANTREAN build_work unit 1 ===
SELECT as_of_date, state, attempt_count, available_at, left(coalesce(last_error,''),60) AS err
FROM app.saldo_pelanggan_build_work WHERE unit_id = 1 ORDER BY as_of_date;

\echo === 2. TOTAL MANIFEST 13-09 vs EasyMax ===
WITH easymax(bucket, debet, kredit, saldo) AS (VALUES
  ('piutang_lokal',  122381917656::numeric, 109293254106.5::numeric, 13088663549.5::numeric),
  ('piutang_online',      10505841::numeric,       9605841::numeric,       900000::numeric),
  ('hutang_lokal',  53550467678.5::numeric, 54222073216.5::numeric,   -671605538::numeric)
), snap AS (
  SELECT akhir_piutang_lokal_total AS piutang_lokal,
         akhir_piutang_online_total AS piutang_online,
         akhir_hutang_lokal_total  AS hutang_lokal,
         awal_piutang_lokal_total, awal_piutang_online_total, awal_hutang_lokal_total
  FROM app.saldo_pelanggan_snapshot_manifest m
  JOIN app.saldo_pelanggan_snapshot_pointer p USING (unit_id, as_of_date, generation_id)
  WHERE m.unit_id = 1 AND m.as_of_date = DATE '2026-09-13'
)
SELECT e.bucket, e.saldo AS easymax_saldo,
       CASE e.bucket WHEN 'piutang_lokal' THEN s.piutang_lokal
                     WHEN 'piutang_online' THEN s.piutang_online
                     ELSE s.hutang_lokal END AS solamax_akhir,
       e.saldo - CASE e.bucket WHEN 'piutang_lokal' THEN s.piutang_lokal
                     WHEN 'piutang_online' THEN s.piutang_online
                     ELSE s.hutang_lokal END AS selisih
FROM easymax e CROSS JOIN snap s;


\echo === 2b. SOURCE IDENTITY, SIX TOTALS, COUNTS ===
SELECT m.generation_id, m.source_cycle_id, m.source_completed_at, m.started_at, m.completed_at,
 m.awal_piutang_lokal_total, m.akhir_piutang_lokal_total,
 m.awal_piutang_online_total, m.akhir_piutang_online_total,
 m.awal_hutang_lokal_total, m.akhir_hutang_lokal_total,
 m.source_pelanggan_row_count, m.source_bppiut_row_count, m.source_bphut_row_count
FROM app.saldo_pelanggan_snapshot_manifest m JOIN app.saldo_pelanggan_snapshot_pointer p USING (unit_id,as_of_date,generation_id)
WHERE m.unit_id=1 AND m.as_of_date=DATE '2026-09-13';
SELECT count(*) AS actual_rows,
 sum(r.awal_piutang_lokal) AS awal_piutang_lokal, sum(r.akhir_piutang_lokal) AS akhir_piutang_lokal,
 sum(r.awal_piutang_online) AS awal_piutang_online, sum(r.akhir_piutang_online) AS akhir_piutang_online,
 sum(r.awal_hutang_lokal) AS awal_hutang_lokal, sum(r.akhir_hutang_lokal) AS akhir_hutang_lokal,
 count(*) FILTER (WHERE (r.awal_piutang_lokal<>0 OR r.awal_piutang_online<>0) AND r.awal_hutang_lokal<>0) AS overlap_awal,
 count(*) FILTER (WHERE (r.akhir_piutang_lokal<>0 OR r.akhir_piutang_online<>0) AND r.akhir_hutang_lokal<>0) AS overlap_akhir,
 count(*) FILTER (WHERE r.awal_piutang_lokal=0 AND r.awal_piutang_online=0 AND r.awal_hutang_lokal=0 AND r.akhir_piutang_lokal=0 AND r.akhir_piutang_online=0 AND r.akhir_hutang_lokal=0) AS zero_all_six
FROM app.saldo_pelanggan_snapshot_row r JOIN app.saldo_pelanggan_snapshot_pointer p USING(unit_id,as_of_date,generation_id)
WHERE r.unit_id=1 AND r.as_of_date=DATE '2026-09-13';
\echo === 2c. ROW EXPORT ===
\pset format csv
\o /tmp/solamax-piutang-fase2-gerbang-a/per-pelanggan.csv
SELECT r.customer_code,r.awal_piutang_lokal,r.akhir_piutang_lokal,r.awal_piutang_online,r.akhir_piutang_online,r.awal_hutang_lokal,r.akhir_hutang_lokal
FROM app.saldo_pelanggan_snapshot_row r JOIN app.saldo_pelanggan_snapshot_pointer p USING(unit_id,as_of_date,generation_id)
WHERE r.unit_id=1 AND r.as_of_date=DATE '2026-09-13' ORDER BY r.customer_code;
\o
\pset format aligned

\echo === 3. DEBET/KREDIT diturunkan dari SOURCE CUT manifest 13-09 ===
WITH gen AS (
  SELECT m.source_cycle_id FROM app.saldo_pelanggan_snapshot_manifest m
  JOIN app.saldo_pelanggan_snapshot_pointer p USING (unit_id, as_of_date, generation_id)
  WHERE m.unit_id = 1 AND m.as_of_date = DATE '2026-09-13'
), lk AS (
  SELECT btrim(ckdplg) AS cc FROM app.saldo_pelanggan_source_pelanggan m, gen
  WHERE m.unit_id = 1 AND m.source_cycle_id = gen.source_cycle_id AND m.sjenis IN (1,5)
), pi AS (
  SELECT btrim(b.ckdplg) AS cc, b.dtgl, b.njumlah, b.sjnsbp
  FROM app.saldo_pelanggan_source_bppiut b, gen
  WHERE b.unit_id = 1 AND b.source_cycle_id = gen.source_cycle_id
    AND b.dtgl <= DATE '2026-09-13' AND COALESCE(b.sbatal,0) = 0
), hu AS (
  SELECT btrim(h.ckdplg) AS cc, h.dtgl, h.njumlah, h.sjnsbp
  FROM app.saldo_pelanggan_source_bphut h, gen
  WHERE h.unit_id = 1 AND h.source_cycle_id = gen.source_cycle_id
    AND h.dtgl <= DATE '2026-09-13' AND COALESCE(h.sbatal,0) = 0
)
SELECT 'piutang_lokal' AS bucket,
  sum(njumlah) FILTER (WHERE sjnsbp=1 AND dtgl <  DATE '2026-09-13') AS awal_debet,
  sum(njumlah) FILTER (WHERE sjnsbp=2 AND dtgl <  DATE '2026-09-13') AS awal_kredit,
  sum(njumlah) FILTER (WHERE sjnsbp=1 AND dtgl <= DATE '2026-09-13') AS akhir_debet,
  sum(njumlah) FILTER (WHERE sjnsbp=2 AND dtgl <= DATE '2026-09-13') AS akhir_kredit,
  count(*) FILTER (WHERE (sjnsbp IS NULL OR sjnsbp NOT IN (1,2))) AS baris_sjnsbp_lain
FROM pi WHERE cc IN (SELECT cc FROM lk) AND position('.' in cc) = 0
UNION ALL
SELECT 'piutang_online',
  sum(njumlah) FILTER (WHERE sjnsbp=1 AND dtgl <  DATE '2026-09-13'),
  sum(njumlah) FILTER (WHERE sjnsbp=2 AND dtgl <  DATE '2026-09-13'),
  sum(njumlah) FILTER (WHERE sjnsbp=1 AND dtgl <= DATE '2026-09-13'),
  sum(njumlah) FILTER (WHERE sjnsbp=2 AND dtgl <= DATE '2026-09-13'),
  count(*) FILTER (WHERE (sjnsbp IS NULL OR sjnsbp NOT IN (1,2)))
FROM pi WHERE position('.' in cc) > 0
UNION ALL
SELECT 'hutang_lokal',
  sum(njumlah) FILTER (WHERE sjnsbp=1 AND dtgl <  DATE '2026-09-13'),
  sum(njumlah) FILTER (WHERE sjnsbp=2 AND dtgl <  DATE '2026-09-13'),
  sum(njumlah) FILTER (WHERE sjnsbp=1 AND dtgl <= DATE '2026-09-13'),
  sum(njumlah) FILTER (WHERE sjnsbp=2 AND dtgl <= DATE '2026-09-13'),
  count(*) FILTER (WHERE (sjnsbp IS NULL OR sjnsbp NOT IN (1,2)))
FROM hu
UNION ALL
SELECT 'piutang_YATIM_tak_masuk_bucket',
  NULL,NULL,
  sum(njumlah) FILTER (WHERE sjnsbp=1 AND dtgl <= DATE '2026-09-13'),
  sum(njumlah) FILTER (WHERE sjnsbp=2 AND dtgl <= DATE '2026-09-13'),
  count(*)
FROM pi WHERE position('.' in cc) = 0 AND cc NOT IN (SELECT cc FROM lk);
ROLLBACK;
