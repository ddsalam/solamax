BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL app.unit_ids = '1';
SET LOCAL statement_timeout = '120s';

SELECT now() AS observed_at,
       now() AT TIME ZONE 'Asia/Pontianak' AS observed_at_wib,
       current_user,
       current_setting('transaction_read_only') AS transaction_read_only;

SELECT unit_id, code, name, timezone
FROM public.unit
WHERE unit_id = 1;

SELECT
  m.unit_id,
  m.as_of_date,
  m.generation_id,
  m.formula_version,
  m.status AS manifest_status,
  m.source_cycle_id,
  m.source_cycle_sequence,
  c.status AS cycle_status,
  m.source_completed_at AS manifest_source_completed_at,
  c.source_completed_at AS cycle_source_completed_at,
  c.source_completed_at = m.source_completed_at AS source_completed_at_equal,
  c.pelanggan_keyed_checksum IS NOT NULL AS pelanggan_checksum_present,
  c.bppiut_keyed_checksum IS NOT NULL AS bppiut_checksum_present,
  c.bphut_keyed_checksum IS NOT NULL AS bphut_checksum_present,
  c.pelanggan_row_count AS pelanggan_expected,
  (SELECT count(*) FROM app.saldo_pelanggan_source_pelanggan p
   WHERE p.unit_id = c.unit_id AND p.source_cycle_id = c.source_cycle_id) AS pelanggan_actual,
  c.bppiut_row_count AS bppiut_expected,
  (SELECT count(*) FROM app.saldo_pelanggan_source_bppiut p
   WHERE p.unit_id = c.unit_id AND p.source_cycle_id = c.source_cycle_id) AS bppiut_actual,
  c.bphut_row_count AS bphut_expected,
  (SELECT count(*) FROM app.saldo_pelanggan_source_bphut h
   WHERE h.unit_id = c.unit_id AND h.source_cycle_id = c.source_cycle_id) AS bphut_actual,
  EXISTS (
    SELECT 1
    FROM app.saldo_pelanggan_source_cycle exact_c
    WHERE exact_c.unit_id = m.unit_id
      AND exact_c.source_cycle_id = m.source_cycle_id
      AND exact_c.source_cycle_sequence = m.source_cycle_sequence
      AND exact_c.status = 'complete'
      AND exact_c.source_completed_at = m.source_completed_at
      AND exact_c.pelanggan_keyed_checksum IS NOT NULL
      AND exact_c.bppiut_keyed_checksum IS NOT NULL
      AND exact_c.bphut_keyed_checksum IS NOT NULL
      AND exact_c.pelanggan_row_count = (
        SELECT count(*) FROM app.saldo_pelanggan_source_pelanggan p
        WHERE p.unit_id = exact_c.unit_id AND p.source_cycle_id = exact_c.source_cycle_id
      )
      AND exact_c.bppiut_row_count = (
        SELECT count(*) FROM app.saldo_pelanggan_source_bppiut p
        WHERE p.unit_id = exact_c.unit_id AND p.source_cycle_id = exact_c.source_cycle_id
      )
      AND exact_c.bphut_row_count = (
        SELECT count(*) FROM app.saldo_pelanggan_source_bphut h
        WHERE h.unit_id = exact_c.unit_id AND h.source_cycle_id = exact_c.source_cycle_id
      )
  ) AS exact_source_cut_predicate_pass
FROM app.saldo_pelanggan_snapshot_manifest m
LEFT JOIN app.saldo_pelanggan_source_cycle c
  ON c.unit_id = m.unit_id
 AND c.source_cycle_id = m.source_cycle_id
 AND c.source_cycle_sequence = m.source_cycle_sequence
WHERE m.unit_id = 1
ORDER BY m.as_of_date, m.generation_id;

SELECT
  count(*) AS manifest_count,
  count(*) FILTER (WHERE status = 'building') AS building_manifest_count,
  count(*) FILTER (WHERE formula_version <> 'saldo-pelanggan-v1') AS unexpected_formula_count
FROM app.saldo_pelanggan_snapshot_manifest
WHERE unit_id = 1;

SELECT
  count(*) AS work_count,
  count(*) FILTER (WHERE state = 'leased') AS leased_work_count
FROM app.saldo_pelanggan_build_work
WHERE unit_id = 1;

SELECT state, count(*) AS work_count
FROM app.saldo_pelanggan_build_work
WHERE unit_id = 1
GROUP BY state
ORDER BY state;

ROLLBACK;
