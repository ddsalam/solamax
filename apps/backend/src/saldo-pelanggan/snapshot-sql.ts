/**
 * Raw SQL for the saldo-pelanggan background builder.
 *
 * Values are always positional parameters. The statements read only immutable
 * `app.saldo_pelanggan_source_*` cuts; capture/diff of the live mirror belongs
 * to Build B3, not this module.
 */

export const SET_UNIT_SCOPE_SQL =
  "SELECT set_config('app.unit_ids', $1, true)";

export const SET_BUILD_STATEMENT_TIMEOUT_SQL =
  "SET LOCAL statement_timeout = '600s'";

export const SET_PUBLISH_TIMEOUT_SQL =
  "SET LOCAL statement_timeout = '30s'";

export const SOURCE_CYCLE_EVIDENCE_SQL = `
SELECT c.unit_id,
       c.source_cycle_id,
       c.source_cycle_sequence,
       c.source_completed_at,
       c.pelanggan_row_count,
       c.pelanggan_keyed_checksum,
       c.bppiut_row_count,
       c.bppiut_keyed_checksum,
       c.bphut_row_count,
       c.bphut_keyed_checksum
FROM app.saldo_pelanggan_source_cycle c
WHERE c.unit_id = $1::smallint
  AND c.source_cycle_id = $2::uuid
  AND c.source_cycle_sequence = $3::bigint
  AND c.status = 'complete'
  AND c.source_completed_at IS NOT NULL
  AND c.pelanggan_row_count IS NOT NULL
  AND c.pelanggan_keyed_checksum IS NOT NULL
  AND c.bppiut_row_count IS NOT NULL
  AND c.bppiut_keyed_checksum IS NOT NULL
  AND c.bphut_row_count IS NOT NULL
  AND c.bphut_keyed_checksum IS NOT NULL
  AND c.pelanggan_row_count = (
    SELECT count(*) FROM app.saldo_pelanggan_source_pelanggan p
    WHERE p.unit_id = c.unit_id AND p.source_cycle_id = c.source_cycle_id
  )
  AND c.bppiut_row_count = (
    SELECT count(*) FROM app.saldo_pelanggan_source_bppiut p
    WHERE p.unit_id = c.unit_id AND p.source_cycle_id = c.source_cycle_id
  )
  AND c.bphut_row_count = (
    SELECT count(*) FROM app.saldo_pelanggan_source_bphut h
    WHERE h.unit_id = c.unit_id AND h.source_cycle_id = c.source_cycle_id
  )`;

/** $1 unit, $2 source cycle, $3 target date. */
export const ASSERT_VALID_SOURCE_KEYS_SQL = `
SELECT count(*)::bigint AS invalid_key_count
FROM (
  SELECT p.ckdplg::text
  FROM app.saldo_pelanggan_source_pelanggan p
  WHERE p.unit_id = $1::smallint
    AND p.source_cycle_id = $2::uuid
    AND NULLIF(btrim(p.ckdplg), '') IS NULL
  UNION ALL
  SELECT b.ckdplg
  FROM app.saldo_pelanggan_source_bppiut b
  WHERE b.unit_id = $1::smallint
    AND b.source_cycle_id = $2::uuid
    AND b.dtgl <= $3::date
    AND COALESCE(sbatal, 0) = 0
    AND NULLIF(btrim(ckdplg), '') IS NULL
  UNION ALL
  SELECT h.ckdplg
  FROM app.saldo_pelanggan_source_bphut h
  WHERE h.unit_id = $1::smallint
    AND h.source_cycle_id = $2::uuid
    AND h.dtgl <= $3::date
    AND COALESCE(sbatal, 0) = 0
    AND NULLIF(btrim(ckdplg), '') IS NULL
) invalid`;

/**
 * $1 unit, $2 date, $3 generation, $4 formula, $5 source cycle,
 * $6 source sequence, $7 rebuild epoch, $8 optional base date,
 * $9 optional base generation.
 */
export const INSERT_BUILDING_MANIFEST_SQL = `
INSERT INTO app.saldo_pelanggan_snapshot_manifest (
  unit_id, as_of_date, generation_id, formula_version, status,
  base_month_end, base_generation_id,
  source_cycle_id, source_cycle_sequence, source_cycle_status,
  source_completed_at, rebuild_epoch
)
SELECT $1::smallint, $2::date, $3::uuid, $4::text, 'building',
       $8::date, $9::uuid,
       c.source_cycle_id, c.source_cycle_sequence, c.status,
       c.source_completed_at, $7::bigint
FROM app.saldo_pelanggan_source_cycle c
WHERE c.unit_id = $1::smallint
  AND c.source_cycle_id = $5::uuid
  AND c.source_cycle_sequence = $6::bigint
  AND c.status = 'complete'
ON CONFLICT (unit_id, as_of_date, generation_id) DO NOTHING
RETURNING generation_id`;

/** $1 unit, $2 work id, $3 generation; called only for the target date. */
export const BIND_WORK_GENERATION_SQL = `
UPDATE app.saldo_pelanggan_build_work
SET generation_id = $3::uuid,
    updated_at = clock_timestamp()
WHERE unit_id = $1::smallint
  AND work_id = $2::uuid
  AND state = 'leased'
RETURNING work_id`;

/** $1 unit, $2 target date, $3 generation, $4 source cycle. */
export const MATERIALIZE_FULL_HISTORY_SQL = `
WITH master_keys AS (
  SELECT btrim(p.ckdplg) AS customer_code
  FROM app.saldo_pelanggan_source_pelanggan p
  WHERE p.unit_id = $1::smallint AND p.source_cycle_id = $4::uuid
), local_keys AS (
  SELECT btrim(p.ckdplg) AS customer_code
  FROM app.saldo_pelanggan_source_pelanggan p
  WHERE p.unit_id = $1::smallint
    AND p.source_cycle_id = $4::uuid
    AND p.sjenis IN (1, 5)
), live_piut AS (
  SELECT btrim(b.ckdplg) AS customer_code,
         b.dtgl,
         b.njumlah * CASE b.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END AS value
  FROM app.saldo_pelanggan_source_bppiut b
  WHERE b.unit_id = $1::smallint
    AND b.source_cycle_id = $4::uuid
    AND b.dtgl <= $2::date
    AND COALESCE(sbatal, 0) = 0
), live_hut AS (
  SELECT btrim(h.ckdplg) AS customer_code,
         h.dtgl,
         h.njumlah * CASE h.sjnsbp WHEN 2 THEN 1 WHEN 1 THEN -1 ELSE 0 END AS value
  FROM app.saldo_pelanggan_source_bphut h
  WHERE h.unit_id = $1::smallint
    AND h.source_cycle_id = $4::uuid
    AND h.dtgl <= $2::date
    AND COALESCE(sbatal, 0) = 0
), customer_keys AS (
  SELECT customer_code FROM master_keys
  UNION SELECT customer_code FROM live_piut
  UNION SELECT customer_code FROM live_hut
), piut AS (
  SELECT p.customer_code,
    COALESCE(sum(p.value) FILTER (
      WHERE l.customer_code IS NOT NULL
        AND position('.' in p.customer_code) = 0
        AND p.dtgl < $2::date
    ), 0) AS awal_piutang_lokal,
    COALESCE(sum(p.value) FILTER (
      WHERE l.customer_code IS NOT NULL
        AND position('.' in p.customer_code) = 0
        AND p.dtgl <= $2::date
    ), 0) AS akhir_piutang_lokal,
    COALESCE(sum(p.value) FILTER (
      WHERE position('.' in p.customer_code) > 0
        AND p.dtgl < $2::date
    ), 0) AS awal_piutang_online,
    COALESCE(sum(p.value) FILTER (
      WHERE position('.' in p.customer_code) > 0
        AND p.dtgl <= $2::date
    ), 0) AS akhir_piutang_online
  FROM live_piut p
  LEFT JOIN local_keys l ON l.customer_code = p.customer_code
  GROUP BY p.customer_code
), hut AS (
  SELECT h.customer_code,
    -COALESCE(sum(h.value) FILTER (WHERE h.dtgl < $2::date), 0)
      AS awal_hutang_lokal,
    -COALESCE(sum(h.value) FILTER (WHERE h.dtgl <= $2::date), 0)
      AS akhir_hutang_lokal
  FROM live_hut h
  GROUP BY h.customer_code
)
INSERT INTO app.saldo_pelanggan_snapshot_row (
  unit_id, as_of_date, generation_id, customer_code,
  awal_piutang_lokal, akhir_piutang_lokal,
  awal_piutang_online, akhir_piutang_online,
  awal_hutang_lokal, akhir_hutang_lokal
)
SELECT $1::smallint, $2::date, $3::uuid, k.customer_code,
       COALESCE(p.awal_piutang_lokal, 0), COALESCE(p.akhir_piutang_lokal, 0),
       COALESCE(p.awal_piutang_online, 0), COALESCE(p.akhir_piutang_online, 0),
       COALESCE(h.awal_hutang_lokal, 0), COALESCE(h.akhir_hutang_lokal, 0)
FROM customer_keys k
LEFT JOIN piut p ON p.customer_code = k.customer_code
LEFT JOIN hut h ON h.customer_code = k.customer_code
ON CONFLICT (unit_id, as_of_date, generation_id, customer_code) DO UPDATE SET
  awal_piutang_lokal = EXCLUDED.awal_piutang_lokal,
  akhir_piutang_lokal = EXCLUDED.akhir_piutang_lokal,
  awal_piutang_online = EXCLUDED.awal_piutang_online,
  akhir_piutang_online = EXCLUDED.akhir_piutang_online,
  awal_hutang_lokal = EXCLUDED.awal_hutang_lokal,
  akhir_hutang_lokal = EXCLUDED.akhir_hutang_lokal`;

/**
 * $1 unit, $2 target date, $3 generation, $4 source cycle,
 * $5 base month-end, $6 base generation.
 */
export const MATERIALIZE_DELTA_SQL = `
WITH base AS (
  SELECT r.customer_code,
         r.akhir_piutang_lokal, r.akhir_piutang_online, r.akhir_hutang_lokal
  FROM app.saldo_pelanggan_snapshot_row r
  WHERE r.unit_id = $1::smallint
    AND r.as_of_date = $5::date
    AND r.generation_id = $6::uuid
), master_keys AS (
  SELECT btrim(p.ckdplg) AS customer_code
  FROM app.saldo_pelanggan_source_pelanggan p
  WHERE p.unit_id = $1::smallint AND p.source_cycle_id = $4::uuid
), local_keys AS (
  SELECT btrim(p.ckdplg) AS customer_code
  FROM app.saldo_pelanggan_source_pelanggan p
  WHERE p.unit_id = $1::smallint
    AND p.source_cycle_id = $4::uuid
    AND p.sjenis IN (1, 5)
), month_piut AS (
  SELECT btrim(b.ckdplg) AS customer_code,
         b.dtgl,
         b.njumlah * CASE b.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END AS value
  FROM app.saldo_pelanggan_source_bppiut b
  WHERE b.unit_id = $1::smallint
    AND b.source_cycle_id = $4::uuid
    AND b.dtgl >= date_trunc('month', $2::date)::date
    AND b.dtgl <= $2::date
    AND COALESCE(sbatal, 0) = 0
), month_hut AS (
  SELECT btrim(h.ckdplg) AS customer_code,
         h.dtgl,
         h.njumlah * CASE h.sjnsbp WHEN 2 THEN 1 WHEN 1 THEN -1 ELSE 0 END AS value
  FROM app.saldo_pelanggan_source_bphut h
  WHERE h.unit_id = $1::smallint
    AND h.source_cycle_id = $4::uuid
    AND h.dtgl >= date_trunc('month', $2::date)::date
    AND h.dtgl <= $2::date
    AND COALESCE(sbatal, 0) = 0
), customer_keys AS (
  SELECT customer_code FROM base
  UNION SELECT customer_code FROM master_keys
  UNION SELECT customer_code FROM month_piut
  UNION SELECT customer_code FROM month_hut
), piut AS (
  SELECT p.customer_code,
    COALESCE(sum(p.value) FILTER (
      WHERE l.customer_code IS NOT NULL AND position('.' in p.customer_code) = 0
        AND p.dtgl < $2::date
    ), 0) AS awal_piutang_lokal,
    COALESCE(sum(p.value) FILTER (
      WHERE l.customer_code IS NOT NULL AND position('.' in p.customer_code) = 0
        AND p.dtgl <= $2::date
    ), 0) AS akhir_piutang_lokal,
    COALESCE(sum(p.value) FILTER (
      WHERE position('.' in p.customer_code) > 0 AND p.dtgl < $2::date
    ), 0) AS awal_piutang_online,
    COALESCE(sum(p.value) FILTER (
      WHERE position('.' in p.customer_code) > 0 AND p.dtgl <= $2::date
    ), 0) AS akhir_piutang_online
  FROM month_piut p
  LEFT JOIN local_keys l ON l.customer_code = p.customer_code
  GROUP BY p.customer_code
), hut AS (
  SELECT h.customer_code,
    -COALESCE(sum(h.value) FILTER (WHERE h.dtgl < $2::date), 0)
      AS awal_hutang_lokal,
    -COALESCE(sum(h.value) FILTER (WHERE h.dtgl <= $2::date), 0)
      AS akhir_hutang_lokal
  FROM month_hut h
  GROUP BY h.customer_code
)
INSERT INTO app.saldo_pelanggan_snapshot_row (
  unit_id, as_of_date, generation_id, customer_code,
  awal_piutang_lokal, akhir_piutang_lokal,
  awal_piutang_online, akhir_piutang_online,
  awal_hutang_lokal, akhir_hutang_lokal
)
SELECT $1::smallint, $2::date, $3::uuid, k.customer_code,
       COALESCE(b.akhir_piutang_lokal, 0) + COALESCE(p.awal_piutang_lokal, 0),
       COALESCE(b.akhir_piutang_lokal, 0) + COALESCE(p.akhir_piutang_lokal, 0),
       COALESCE(b.akhir_piutang_online, 0) + COALESCE(p.awal_piutang_online, 0),
       COALESCE(b.akhir_piutang_online, 0) + COALESCE(p.akhir_piutang_online, 0),
       COALESCE(b.akhir_hutang_lokal, 0) + COALESCE(h.awal_hutang_lokal, 0),
       COALESCE(b.akhir_hutang_lokal, 0) + COALESCE(h.akhir_hutang_lokal, 0)
FROM customer_keys k
LEFT JOIN base b ON b.customer_code = k.customer_code
LEFT JOIN piut p ON p.customer_code = k.customer_code
LEFT JOIN hut h ON h.customer_code = k.customer_code
ON CONFLICT (unit_id, as_of_date, generation_id, customer_code) DO UPDATE SET
  awal_piutang_lokal = EXCLUDED.awal_piutang_lokal,
  akhir_piutang_lokal = EXCLUDED.akhir_piutang_lokal,
  awal_piutang_online = EXCLUDED.awal_piutang_online,
  akhir_piutang_online = EXCLUDED.akhir_piutang_online,
  awal_hutang_lokal = EXCLUDED.awal_hutang_lokal,
  akhir_hutang_lokal = EXCLUDED.akhir_hutang_lokal`;

/** $1 unit, $2 date, $3 generation. */
export const VALIDATE_GENERATION_SQL = `
SELECT count(*)::bigint AS row_count,
       sha256(convert_to(COALESCE(string_agg(
         concat_ws('|', unit_id::text, as_of_date::text, customer_code,
           awal_piutang_lokal::text, akhir_piutang_lokal::text,
           awal_piutang_online::text, akhir_piutang_online::text,
           awal_hutang_lokal::text, akhir_hutang_lokal::text),
         E'\\n' ORDER BY customer_code
       ), ''), 'UTF8')) AS row_keyed_checksum,
       COALESCE(sum(awal_piutang_lokal), 0) AS awal_piutang_lokal_total,
       COALESCE(sum(akhir_piutang_lokal), 0) AS akhir_piutang_lokal_total,
       COALESCE(sum(awal_piutang_online), 0) AS awal_piutang_online_total,
       COALESCE(sum(akhir_piutang_online), 0) AS akhir_piutang_online_total,
       COALESCE(sum(awal_hutang_lokal), 0) AS awal_hutang_lokal_total,
       COALESCE(sum(akhir_hutang_lokal), 0) AS akhir_hutang_lokal_total
FROM app.saldo_pelanggan_snapshot_row
WHERE unit_id = $1::smallint
  AND as_of_date = $2::date
  AND generation_id = $3::uuid`;

/** $1 unit, $2 base date, $3 formula, $4 source cycle. */
export const VALIDATE_BASELINE_SQL = `
WITH candidate AS (
  SELECT m.generation_id, m.row_count, m.row_keyed_checksum
FROM app.saldo_pelanggan_snapshot_pointer p
JOIN app.saldo_pelanggan_snapshot_manifest m
  ON m.unit_id = p.unit_id
 AND m.as_of_date = p.as_of_date
 AND m.generation_id = p.generation_id
WHERE p.unit_id = $1::smallint
  AND p.as_of_date = $2::date
  AND NOT p.pending_replacement
  AND m.status = 'complete'
  AND m.published
  AND m.validation_passed
  AND m.formula_version = $3::text
  AND m.source_cycle_id = $4::uuid
), actual AS (
  SELECT c.generation_id,
         count(r.generation_id)::bigint AS row_count,
         sha256(convert_to(COALESCE(string_agg(
           concat_ws('|', r.unit_id::text, r.as_of_date::text, r.customer_code,
             r.awal_piutang_lokal::text, r.akhir_piutang_lokal::text,
             r.awal_piutang_online::text, r.akhir_piutang_online::text,
             r.awal_hutang_lokal::text, r.akhir_hutang_lokal::text),
           E'\\n' ORDER BY r.customer_code
         ), ''), 'UTF8')) AS row_keyed_checksum
  FROM candidate c
  LEFT JOIN app.saldo_pelanggan_snapshot_row r
    ON r.unit_id = $1::smallint
   AND r.as_of_date = $2::date
   AND r.generation_id = c.generation_id
  GROUP BY c.generation_id
)
SELECT c.generation_id
FROM candidate c
JOIN actual a USING (generation_id)
WHERE c.row_count = a.row_count
  AND c.row_keyed_checksum = a.row_keyed_checksum`;

/** $1 unit, $2 date, $3 generation. */
export const LOCK_PUBLICATION_SQL = `
SELECT source_cycle_id, source_cycle_sequence, rebuild_epoch, status
FROM app.saldo_pelanggan_snapshot_manifest
WHERE unit_id = $1::smallint AND as_of_date = $2::date AND generation_id = $3::uuid
FOR UPDATE`;

/** $1 unit, $2 date. */
export const LOCK_POINTER_SQL = `
SELECT generation_id, source_cycle_sequence, rebuild_epoch
FROM app.saldo_pelanggan_snapshot_pointer
WHERE unit_id = $1::smallint AND as_of_date = $2::date
FOR UPDATE`;

/** $1 unit, $2 optional work id. */
export const LOCK_WORK_SQL = `
SELECT work_id, state, lease_owner
FROM app.saldo_pelanggan_build_work
WHERE unit_id = $1::smallint AND work_id = $2::uuid
FOR UPDATE`;

/** Rechecked inside the final transaction. */
export const PUBLICATION_OPERATIONAL_GATE_SQL = `
SELECT (extract(hour FROM clock_timestamp() AT TIME ZONE 'Asia/Pontianak') * 60
        + extract(minute FROM clock_timestamp() AT TIME ZONE 'Asia/Pontianak'))::int
         AS wib_minutes,
       pg_database_size(current_database())::bigint AS database_bytes`;

/**
 * $1 unit, $2 date, $3 generation, $4 row count, $5 checksum,
 * $6..$11 six totals.
 */
export const COMPLETE_MANIFEST_SQL = `
UPDATE app.saldo_pelanggan_snapshot_manifest m
SET status = 'complete',
    computed_at = clock_timestamp(),
    completed_at = clock_timestamp(),
    published = true,
    published_at = clock_timestamp(),
    validation_passed = true,
    customer_key_count = $4::bigint,
    row_count = $4::bigint,
    row_keyed_checksum = $5::bytea,
    awal_piutang_lokal_total = $6::numeric,
    akhir_piutang_lokal_total = $7::numeric,
    awal_piutang_online_total = $8::numeric,
    akhir_piutang_online_total = $9::numeric,
    awal_hutang_lokal_total = $10::numeric,
    akhir_hutang_lokal_total = $11::numeric,
    source_pelanggan_row_count = c.pelanggan_row_count,
    source_pelanggan_keyed_checksum = c.pelanggan_keyed_checksum,
    source_bppiut_row_count = c.bppiut_row_count,
    source_bppiut_keyed_checksum = c.bppiut_keyed_checksum,
    source_bphut_row_count = c.bphut_row_count,
    source_bphut_keyed_checksum = c.bphut_keyed_checksum,
    failure_code = NULL,
    failure_summary = NULL,
    retryable = false
FROM app.saldo_pelanggan_source_cycle c
WHERE m.unit_id = $1::smallint
  AND m.as_of_date = $2::date
  AND m.generation_id = $3::uuid
  AND m.status = 'building'
  AND c.unit_id = m.unit_id
  AND c.source_cycle_id = m.source_cycle_id
  AND c.source_cycle_sequence = m.source_cycle_sequence
  AND c.status = 'complete'
RETURNING m.generation_id, m.source_cycle_sequence, m.rebuild_epoch`;

/** $1 unit, $2 date, $3 generation, $4 sequence, $5 epoch. */
export const UPSERT_POINTER_SQL = `
INSERT INTO app.saldo_pelanggan_snapshot_pointer (
  unit_id, as_of_date, generation_id,
  generation_status, generation_published, generation_validation_passed,
  source_cycle_sequence, rebuild_epoch, activated_at,
  stale_invalid_from, pending_replacement, pending_since
)
VALUES ($1::smallint, $2::date, $3::uuid,
        'complete', true, true, $4::bigint, $5::bigint, clock_timestamp(),
        NULL, false, NULL)
ON CONFLICT (unit_id, as_of_date) DO UPDATE
SET generation_id = EXCLUDED.generation_id,
    generation_status = EXCLUDED.generation_status,
    generation_published = EXCLUDED.generation_published,
    generation_validation_passed = EXCLUDED.generation_validation_passed,
    source_cycle_sequence = EXCLUDED.source_cycle_sequence,
    rebuild_epoch = EXCLUDED.rebuild_epoch,
    activated_at = EXCLUDED.activated_at,
    stale_invalid_from = NULL,
    pending_replacement = false,
    pending_since = NULL
WHERE (EXCLUDED.source_cycle_sequence, EXCLUDED.rebuild_epoch) >
      (saldo_pelanggan_snapshot_pointer.source_cycle_sequence,
       saldo_pelanggan_snapshot_pointer.rebuild_epoch)
   OR (
      (EXCLUDED.source_cycle_sequence, EXCLUDED.rebuild_epoch) =
      (saldo_pelanggan_snapshot_pointer.source_cycle_sequence,
       saldo_pelanggan_snapshot_pointer.rebuild_epoch)
      AND saldo_pelanggan_snapshot_pointer.generation_id = EXCLUDED.generation_id
   )
RETURNING generation_id`;

/** $1 unit, $2 work id, $3 generation. */
export const COMPLETE_WORK_SQL = `
UPDATE app.saldo_pelanggan_build_work
SET generation_id = $3::uuid,
    state = 'done',
    lease_owner = NULL,
    lease_expires_at = NULL,
    heartbeat_at = NULL,
    last_error = NULL,
    updated_at = clock_timestamp(),
    completed_at = clock_timestamp()
WHERE unit_id = $1::smallint
  AND work_id = $2::uuid
  AND state = 'leased'
RETURNING work_id`;

/** $1 unit, $2 date, $3 generation, $4 code, $5 summary, $6 retryable. */
export const FAIL_MANIFEST_SQL = `
UPDATE app.saldo_pelanggan_snapshot_manifest
SET status = 'failed',
    completed_at = clock_timestamp(),
    failure_code = $4::text,
    failure_summary = $5::text,
    retryable = $6::boolean
WHERE unit_id = $1::smallint AND as_of_date = $2::date
  AND generation_id = $3::uuid AND status = 'building'
RETURNING generation_id`;

/** One read statement: an absent result is not-ready, never numeric zero. */
export const READ_READY_SNAPSHOT_SQL = `
SELECT p.generation_id,
       m.source_cycle_id,
       m.source_completed_at,
       r.customer_code,
       r.awal_piutang_lokal,
       r.akhir_piutang_lokal,
       r.awal_piutang_online,
       r.akhir_piutang_online,
       r.awal_hutang_lokal,
       r.akhir_hutang_lokal
FROM app.saldo_pelanggan_snapshot_pointer p
JOIN app.saldo_pelanggan_snapshot_manifest m
  ON m.unit_id = p.unit_id
 AND m.as_of_date = p.as_of_date
 AND m.generation_id = p.generation_id
 AND m.status = 'complete'
 AND m.published
 AND m.validation_passed
JOIN app.saldo_pelanggan_snapshot_row r
  ON r.unit_id = m.unit_id
 AND r.as_of_date = m.as_of_date
 AND r.generation_id = m.generation_id
WHERE p.unit_id = $1::smallint
  AND p.as_of_date = $2::date
ORDER BY r.customer_code`;
