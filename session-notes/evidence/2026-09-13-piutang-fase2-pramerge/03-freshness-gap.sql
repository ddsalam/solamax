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

SELECT COALESCE(failure_summary, '<NULL>') AS failure_summary,
       count(*) AS cycle_count,
       min(source_cycle_sequence) AS min_sequence,
       max(source_cycle_sequence) AS max_sequence,
       min(started_at) AS first_started_at,
       max(started_at) AS last_started_at,
       min(failed_at) AS first_failed_at,
       max(failed_at) AS last_failed_at,
       min(now() - started_at) AS youngest_age,
       max(now() - started_at) AS oldest_age
FROM app.saldo_pelanggan_source_cycle
WHERE unit_id = 1 AND status = 'failed'
GROUP BY COALESCE(failure_summary, '<NULL>')
ORDER BY cycle_count DESC, failure_summary;

WITH bounds AS (
  SELECT max(source_cycle_sequence) AS latest_sequence
  FROM app.saldo_pelanggan_source_cycle
  WHERE unit_id = 1
)
SELECT c.source_cycle_id,
       c.source_cycle_sequence,
       c.started_at,
       now() - c.started_at AS age,
       c.source_cycle_sequence = b.latest_sequence AS is_latest_allocation,
       c.pelanggan_row_count,
       c.pelanggan_keyed_checksum IS NOT NULL AS pelanggan_claimed,
       c.bppiut_row_count,
       c.bppiut_keyed_checksum IS NOT NULL AS bppiut_claimed,
       c.bphut_row_count,
       c.bphut_keyed_checksum IS NOT NULL AS bphut_claimed,
       CASE
         WHEN c.source_cycle_sequence < b.latest_sequence THEN 'superseded_waiting_retirement'
         WHEN c.pelanggan_row_count IS NOT NULL
          AND c.pelanggan_keyed_checksum IS NOT NULL
          AND c.bppiut_row_count IS NOT NULL
          AND c.bppiut_keyed_checksum IS NOT NULL
          AND c.bphut_row_count IS NOT NULL
          AND c.bphut_keyed_checksum IS NOT NULL THEN 'latest_ready_for_finalize'
         ELSE 'latest_partial_or_in_flight'
       END AS observed_class
FROM app.saldo_pelanggan_source_cycle c
CROSS JOIN bounds b
WHERE c.unit_id = 1 AND c.status = 'staging'
ORDER BY c.source_cycle_sequence;

SELECT status,
       count(*) AS cycle_count,
       min(source_cycle_sequence) AS min_sequence,
       max(source_cycle_sequence) AS max_sequence,
       min(started_at) AS first_started_at,
       max(started_at) AS last_started_at
FROM app.saldo_pelanggan_source_cycle
WHERE unit_id = 1
GROUP BY status
ORDER BY status;

SELECT source_cycle_id, domain, change_kind,
       count(*) AS change_count,
       count(*) FILTER (WHERE invalid_from_date IS NOT NULL) AS invalidating_count,
       min(invalid_from_date) AS earliest_invalid_from,
       max(created_at) AS latest_change_at
FROM app.saldo_pelanggan_source_change
WHERE unit_id = 1
GROUP BY source_cycle_id, domain, change_kind
ORDER BY source_cycle_id, domain, change_kind;

SELECT count(*) AS source_change_count,
       count(*) FILTER (WHERE invalid_from_date IS NOT NULL) AS invalidating_change_count,
       max(created_at) AS latest_change_at
FROM app.saldo_pelanggan_source_change
WHERE unit_id = 1;

SELECT unit_id, dirty_invalid_from, dirty_source_cycle_id,
       dirty_source_cycle_sequence, dirty_since,
       covered_through_date, covered_by_generation_id,
       covered_source_cycle_sequence, version, updated_at
FROM app.saldo_pelanggan_dirty
WHERE unit_id = 1;

SELECT unit_id, as_of_date, generation_id, source_cycle_sequence,
       activated_at, stale_invalid_from, pending_replacement, pending_since
FROM app.saldo_pelanggan_snapshot_pointer
WHERE unit_id = 1
ORDER BY as_of_date;

WITH active_missing AS (
  SELECT 'bppiut'::text AS ledger, btrim(m.ckdplg) AS customer_code,
         m.dtgl, m.njumlah, m.sjnsbp, m.ingested_at
  FROM public.bppiut m
  WHERE m.unit_id = 1
    AND COALESCE(m.sbatal, 0) = 0
    AND m.dtgl = DATE '2026-09-13'
    AND btrim(m.ckdplg) IN ('PLG2952','PLG0036','PLG2234','PLG2707','PLG2960','PLG0032')
    AND NOT EXISTS (
      SELECT 1 FROM app.saldo_pelanggan_source_bppiut c
      WHERE c.unit_id = m.unit_id
        AND c.source_cycle_id = 'c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff'::uuid
        AND c.ckdbppiut = m.ckdbppiut
    )
  UNION ALL
  SELECT 'bphut', btrim(m.ckdplg), m.dtgl, m.njumlah, m.sjnsbp, m.ingested_at
  FROM public.bphut m
  WHERE m.unit_id = 1
    AND COALESCE(m.sbatal, 0) = 0
    AND m.dtgl = DATE '2026-09-13'
    AND btrim(m.ckdplg) = 'PLG2641'
    AND NOT EXISTS (
      SELECT 1 FROM app.saldo_pelanggan_source_bphut c
      WHERE c.unit_id = m.unit_id
        AND c.source_cycle_id = 'c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff'::uuid
        AND c.ckdbphut = m.ckdbphut
    )
)
SELECT ledger,
       count(*) AS active_rows_on_13_sep,
       count(*) FILTER (
         WHERE ingested_at <= TIMESTAMPTZ '2026-09-13 12:45:00+07'
       ) AS ingested_by_report_time,
       sum(CASE sjnsbp WHEN 1 THEN njumlah WHEN 2 THEN -njumlah END) AS amount_all,
       sum(CASE sjnsbp WHEN 1 THEN njumlah WHEN 2 THEN -njumlah END)
         FILTER (WHERE ingested_at <= TIMESTAMPTZ '2026-09-13 12:45:00+07') AS amount_by_report_time,
       min(ingested_at) AS first_ingested_at,
       min(ingested_at) AT TIME ZONE 'Asia/Pontianak' AS first_ingested_at_wib,
       max(ingested_at) AS last_ingested_at,
       max(ingested_at) AT TIME ZONE 'Asia/Pontianak' AS last_ingested_at_wib
FROM active_missing
GROUP BY ledger
ORDER BY ledger;

ROLLBACK;
