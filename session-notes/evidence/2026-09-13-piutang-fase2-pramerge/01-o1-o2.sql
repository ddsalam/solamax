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

SELECT source_cycle_id, source_cycle_sequence, status, source_completed_at,
       source_completed_at AT TIME ZONE 'Asia/Pontianak' AS source_completed_at_wib
FROM app.saldo_pelanggan_source_cycle
WHERE unit_id = 1
  AND source_cycle_id = 'c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff'::uuid;

WITH missing AS (
  SELECT
    'bppiut'::text AS ledger,
    btrim(m.ckdbppiut) AS entry_key,
    btrim(m.ckdplg) AS customer_code,
    m.dtgl,
    m.njumlah,
    m.sjnsbp,
    m.sbatal,
    m.vcref,
    m.vcket,
    m.ingested_at
  FROM public.bppiut m
  WHERE m.unit_id = 1
    AND btrim(m.ckdplg) IN ('PLG2952','PLG0036','PLG2234','PLG2707','PLG2960','PLG0032')
    AND NOT EXISTS (
      SELECT 1
      FROM app.saldo_pelanggan_source_bppiut c
      WHERE c.unit_id = m.unit_id
        AND c.source_cycle_id = 'c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff'::uuid
        AND c.ckdbppiut = m.ckdbppiut
    )
  UNION ALL
  SELECT
    'bphut'::text,
    btrim(m.ckdbphut),
    btrim(m.ckdplg),
    m.dtgl,
    m.njumlah,
    m.sjnsbp,
    m.sbatal,
    m.vcref,
    m.vcket,
    m.ingested_at
  FROM public.bphut m
  WHERE m.unit_id = 1
    AND btrim(m.ckdplg) = 'PLG2641'
    AND NOT EXISTS (
      SELECT 1
      FROM app.saldo_pelanggan_source_bphut c
      WHERE c.unit_id = m.unit_id
        AND c.source_cycle_id = 'c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff'::uuid
        AND c.ckdbphut = m.ckdbphut
    )
)
SELECT *
FROM missing
ORDER BY ledger, customer_code, dtgl, entry_key;

WITH missing AS (
  SELECT 'bppiut'::text AS ledger, btrim(m.ckdplg) AS customer_code,
         m.dtgl, m.njumlah, m.sjnsbp, m.sbatal, m.ingested_at
  FROM public.bppiut m
  WHERE m.unit_id = 1
    AND btrim(m.ckdplg) IN ('PLG2952','PLG0036','PLG2234','PLG2707','PLG2960','PLG0032')
    AND NOT EXISTS (
      SELECT 1 FROM app.saldo_pelanggan_source_bppiut c
      WHERE c.unit_id = m.unit_id
        AND c.source_cycle_id = 'c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff'::uuid
        AND c.ckdbppiut = m.ckdbppiut
    )
  UNION ALL
  SELECT 'bphut', btrim(m.ckdplg), m.dtgl, m.njumlah, m.sjnsbp, m.sbatal, m.ingested_at
  FROM public.bphut m
  WHERE m.unit_id = 1
    AND btrim(m.ckdplg) = 'PLG2641'
    AND NOT EXISTS (
      SELECT 1 FROM app.saldo_pelanggan_source_bphut c
      WHERE c.unit_id = m.unit_id
        AND c.source_cycle_id = 'c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff'::uuid
        AND c.ckdbphut = m.ckdbphut
    )
)
SELECT ledger,
       customer_code,
       count(*) AS row_count,
       min(dtgl) AS min_dtgl,
       max(dtgl) AS max_dtgl,
       sum(njumlah) AS gross_amount,
       sum(CASE sjnsbp WHEN 1 THEN njumlah WHEN 2 THEN -njumlah END) AS debet_minus_kredit,
       count(*) FILTER (WHERE dtgl = DATE '2026-09-13') AS rows_on_13_sep,
       count(*) FILTER (WHERE dtgl <= DATE '2026-09-12') AS rows_on_or_before_12_sep,
       min(ingested_at) AS first_ingested_at,
       max(ingested_at) AS last_ingested_at,
       count(*) FILTER (WHERE COALESCE(sbatal, 0) <> 0) AS cancelled_rows
FROM missing
GROUP BY ledger, customer_code
ORDER BY ledger, customer_code;

WITH missing AS (
  SELECT 'bppiut'::text AS ledger, m.dtgl, m.njumlah, m.sjnsbp, m.sbatal, m.ingested_at
  FROM public.bppiut m
  WHERE m.unit_id = 1
    AND btrim(m.ckdplg) IN ('PLG2952','PLG0036','PLG2234','PLG2707','PLG2960','PLG0032')
    AND NOT EXISTS (
      SELECT 1 FROM app.saldo_pelanggan_source_bppiut c
      WHERE c.unit_id = m.unit_id
        AND c.source_cycle_id = 'c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff'::uuid
        AND c.ckdbppiut = m.ckdbppiut
    )
  UNION ALL
  SELECT 'bphut', m.dtgl, m.njumlah, m.sjnsbp, m.sbatal, m.ingested_at
  FROM public.bphut m
  WHERE m.unit_id = 1
    AND btrim(m.ckdplg) = 'PLG2641'
    AND NOT EXISTS (
      SELECT 1 FROM app.saldo_pelanggan_source_bphut c
      WHERE c.unit_id = m.unit_id
        AND c.source_cycle_id = 'c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff'::uuid
        AND c.ckdbphut = m.ckdbphut
    )
)
SELECT ledger,
       count(*) AS row_count,
       min(dtgl) AS min_dtgl,
       max(dtgl) AS max_dtgl,
       sum(njumlah) AS gross_amount,
       sum(CASE sjnsbp WHEN 1 THEN njumlah WHEN 2 THEN -njumlah END) AS debet_minus_kredit,
       count(*) FILTER (WHERE dtgl = DATE '2026-09-13') AS rows_on_13_sep,
       count(*) FILTER (WHERE dtgl <= DATE '2026-09-12') AS rows_on_or_before_12_sep,
       min(ingested_at) AS first_ingested_at,
       max(ingested_at) AS last_ingested_at,
       count(*) FILTER (WHERE COALESCE(sbatal, 0) <> 0) AS cancelled_rows
FROM missing
GROUP BY ledger
ORDER BY ledger;

WITH active_missing AS (
  SELECT 'bppiut'::text AS ledger, btrim(m.ckdplg) AS customer_code,
         m.dtgl, m.njumlah, m.sjnsbp, m.ingested_at
  FROM public.bppiut m
  WHERE m.unit_id = 1
    AND COALESCE(m.sbatal, 0) = 0
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
    AND btrim(m.ckdplg) = 'PLG2641'
    AND NOT EXISTS (
      SELECT 1 FROM app.saldo_pelanggan_source_bphut c
      WHERE c.unit_id = m.unit_id
        AND c.source_cycle_id = 'c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff'::uuid
        AND c.ckdbphut = m.ckdbphut
    )
)
SELECT ledger,
       customer_code,
       dtgl,
       count(*) AS active_row_count,
       sum(CASE sjnsbp WHEN 1 THEN njumlah WHEN 2 THEN -njumlah END) AS active_debet_minus_kredit,
       min(ingested_at) AS first_ingested_at,
       min(ingested_at) AT TIME ZONE 'Asia/Pontianak' AS first_ingested_at_wib,
       max(ingested_at) AS last_ingested_at,
       max(ingested_at) AT TIME ZONE 'Asia/Pontianak' AS last_ingested_at_wib
FROM active_missing
GROUP BY ledger, customer_code, dtgl
ORDER BY ledger, customer_code, dtgl;

WITH active_missing AS (
  SELECT 'bppiut'::text AS ledger, m.dtgl, m.njumlah, m.sjnsbp, m.ingested_at
  FROM public.bppiut m
  WHERE m.unit_id = 1
    AND COALESCE(m.sbatal, 0) = 0
    AND btrim(m.ckdplg) IN ('PLG2952','PLG0036','PLG2234','PLG2707','PLG2960','PLG0032')
    AND NOT EXISTS (
      SELECT 1 FROM app.saldo_pelanggan_source_bppiut c
      WHERE c.unit_id = m.unit_id
        AND c.source_cycle_id = 'c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff'::uuid
        AND c.ckdbppiut = m.ckdbppiut
    )
  UNION ALL
  SELECT 'bphut', m.dtgl, m.njumlah, m.sjnsbp, m.ingested_at
  FROM public.bphut m
  WHERE m.unit_id = 1
    AND COALESCE(m.sbatal, 0) = 0
    AND btrim(m.ckdplg) = 'PLG2641'
    AND NOT EXISTS (
      SELECT 1 FROM app.saldo_pelanggan_source_bphut c
      WHERE c.unit_id = m.unit_id
        AND c.source_cycle_id = 'c33b0dd5-0bfe-4b4e-a86a-0109d080a8ff'::uuid
        AND c.ckdbphut = m.ckdbphut
    )
)
SELECT ledger,
       dtgl,
       count(*) AS active_row_count,
       sum(CASE sjnsbp WHEN 1 THEN njumlah WHEN 2 THEN -njumlah END) AS active_debet_minus_kredit,
       min(ingested_at) AS first_ingested_at,
       min(ingested_at) AT TIME ZONE 'Asia/Pontianak' AS first_ingested_at_wib,
       max(ingested_at) AS last_ingested_at,
       max(ingested_at) AT TIME ZONE 'Asia/Pontianak' AS last_ingested_at_wib
FROM active_missing
GROUP BY ledger, dtgl
ORDER BY ledger, dtgl;

ROLLBACK;
