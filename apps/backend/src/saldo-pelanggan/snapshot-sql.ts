import { SNAPSHOT_OPERATIONAL_LIMITS } from "./snapshot-config.js";

/**
 * Raw SQL for the saldo-pelanggan background builder.
 *
 * Values are always positional parameters. The statements read only immutable
 * `app.saldo_pelanggan_source_*` cuts; capture/diff of the live mirror belongs
 * to Build B3, not this module.
 */

export const SET_UNIT_SCOPE_SQL =
  "SELECT set_config('app.unit_ids', $1, true)";

/** $1 unit, $2 source cut, $3 sequence, $4 target date. */
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
  AND $4::date <= (c.source_completed_at AT TIME ZONE '${SNAPSHOT_OPERATIONAL_LIMITS.timezone}')::date
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

/** $1 unit, $2 source cycle, $3 target date. Excluded orphan piutang stays excluded. */
export const ASSERT_VALID_SOURCE_SIDES_SQL = `
SELECT count(*)::bigint AS invalid_side_count
FROM (
  SELECT b.sjnsbp
  FROM app.saldo_pelanggan_source_bppiut b
  WHERE b.unit_id = $1::smallint AND b.source_cycle_id = $2::uuid
    AND b.dtgl <= $3::date AND COALESCE(b.sbatal, 0) = 0
    AND (b.sjnsbp IS NULL OR b.sjnsbp NOT IN (1, 2))
    AND (position('.' in btrim(b.ckdplg)) > 0 OR EXISTS (
      SELECT 1 FROM app.saldo_pelanggan_source_pelanggan p
      WHERE p.unit_id = b.unit_id AND p.source_cycle_id = b.source_cycle_id
        AND btrim(p.ckdplg) = btrim(b.ckdplg) AND p.sjenis IN (1, 5)
    ))
  UNION ALL
  SELECT h.sjnsbp
  FROM app.saldo_pelanggan_source_bphut h
  WHERE h.unit_id = $1::smallint AND h.source_cycle_id = $2::uuid
    AND h.dtgl <= $3::date AND COALESCE(h.sbatal, 0) = 0
    AND (h.sjnsbp IS NULL OR h.sjnsbp NOT IN (1, 2))
) invalid`;

/** Same included populations; a missing amount is not a zero amount. */
export const ASSERT_VALID_SOURCE_AMOUNTS_SQL = `
SELECT count(*)::bigint AS invalid_amount_count
FROM (
  SELECT b.njumlah
  FROM app.saldo_pelanggan_source_bppiut b
  WHERE b.unit_id = $1::smallint AND b.source_cycle_id = $2::uuid
    AND b.dtgl <= $3::date AND COALESCE(b.sbatal, 0) = 0
    AND b.njumlah IS NULL
    AND (position('.' in btrim(b.ckdplg)) > 0 OR EXISTS (
      SELECT 1 FROM app.saldo_pelanggan_source_pelanggan p
      WHERE p.unit_id = b.unit_id AND p.source_cycle_id = b.source_cycle_id
        AND btrim(p.ckdplg) = btrim(b.ckdplg) AND p.sjenis IN (1, 5)
    ))
  UNION ALL
  SELECT h.njumlah
  FROM app.saldo_pelanggan_source_bphut h
  WHERE h.unit_id = $1::smallint AND h.source_cycle_id = $2::uuid
    AND h.dtgl <= $3::date AND COALESCE(h.sbatal, 0) = 0
    AND h.njumlah IS NULL
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

/** $1 unit, $2 work id, $3 lease owner. */
export const ASSERT_WORK_LEASE_SQL = `
SELECT work_id
FROM app.saldo_pelanggan_build_work
WHERE unit_id = $1::smallint
  AND work_id = $2::uuid
  AND lease_owner = $3::text
  AND state = 'leased'
  AND lease_expires_at >= clock_timestamp()
FOR UPDATE`;

/** $1 unit, $2 work id, $3 generation, $4 lease owner; target only. */
export const BIND_WORK_GENERATION_SQL = `
UPDATE app.saldo_pelanggan_build_work
SET generation_id = $3::uuid,
    updated_at = clock_timestamp()
WHERE unit_id = $1::smallint
  AND work_id = $2::uuid
  AND lease_owner = $4::text
  AND state = 'leased'
  AND lease_expires_at >= clock_timestamp()
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
         b.dtgl, b.sjnsbp, b.njumlah,
         b.njumlah * CASE b.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END AS value
  FROM app.saldo_pelanggan_source_bppiut b
  WHERE b.unit_id = $1::smallint
    AND b.source_cycle_id = $4::uuid
    AND b.dtgl <= $2::date
    AND COALESCE(sbatal, 0) = 0
), live_hut AS (
  SELECT btrim(h.ckdplg) AS customer_code,
         h.dtgl, h.sjnsbp, h.njumlah,
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
    COALESCE(sum(p.njumlah) FILTER (WHERE l.customer_code IS NOT NULL AND position('.' in p.customer_code) = 0 AND p.dtgl < $2::date AND p.sjnsbp = 1), 0) AS awal_piutang_lokal_debet,
    COALESCE(sum(p.njumlah) FILTER (WHERE l.customer_code IS NOT NULL AND position('.' in p.customer_code) = 0 AND p.dtgl < $2::date AND p.sjnsbp = 2), 0) AS awal_piutang_lokal_kredit,
    COALESCE(sum(p.njumlah) FILTER (WHERE l.customer_code IS NOT NULL AND position('.' in p.customer_code) = 0 AND p.dtgl <= $2::date AND p.sjnsbp = 1), 0) AS akhir_piutang_lokal_debet,
    COALESCE(sum(p.njumlah) FILTER (WHERE l.customer_code IS NOT NULL AND position('.' in p.customer_code) = 0 AND p.dtgl <= $2::date AND p.sjnsbp = 2), 0) AS akhir_piutang_lokal_kredit,
    COALESCE(sum(p.value) FILTER (
      WHERE position('.' in p.customer_code) > 0
        AND p.dtgl < $2::date
    ), 0) AS awal_piutang_online,
    COALESCE(sum(p.value) FILTER (
      WHERE position('.' in p.customer_code) > 0
        AND p.dtgl <= $2::date
    ), 0) AS akhir_piutang_online,
    COALESCE(sum(p.njumlah) FILTER (WHERE position('.' in p.customer_code) > 0 AND p.dtgl < $2::date AND p.sjnsbp = 1), 0) AS awal_piutang_online_debet,
    COALESCE(sum(p.njumlah) FILTER (WHERE position('.' in p.customer_code) > 0 AND p.dtgl < $2::date AND p.sjnsbp = 2), 0) AS awal_piutang_online_kredit,
    COALESCE(sum(p.njumlah) FILTER (WHERE position('.' in p.customer_code) > 0 AND p.dtgl <= $2::date AND p.sjnsbp = 1), 0) AS akhir_piutang_online_debet,
    COALESCE(sum(p.njumlah) FILTER (WHERE position('.' in p.customer_code) > 0 AND p.dtgl <= $2::date AND p.sjnsbp = 2), 0) AS akhir_piutang_online_kredit
  FROM live_piut p
  LEFT JOIN local_keys l ON l.customer_code = p.customer_code
  GROUP BY p.customer_code
), hut AS (
  SELECT h.customer_code,
    -COALESCE(sum(h.value) FILTER (WHERE h.dtgl < $2::date), 0)
      AS awal_hutang_lokal,
    -COALESCE(sum(h.value) FILTER (WHERE h.dtgl <= $2::date), 0)
      AS akhir_hutang_lokal,
    COALESCE(sum(h.njumlah) FILTER (WHERE h.dtgl < $2::date AND h.sjnsbp = 1), 0) AS awal_hutang_lokal_debet,
    COALESCE(sum(h.njumlah) FILTER (WHERE h.dtgl < $2::date AND h.sjnsbp = 2), 0) AS awal_hutang_lokal_kredit,
    COALESCE(sum(h.njumlah) FILTER (WHERE h.dtgl <= $2::date AND h.sjnsbp = 1), 0) AS akhir_hutang_lokal_debet,
    COALESCE(sum(h.njumlah) FILTER (WHERE h.dtgl <= $2::date AND h.sjnsbp = 2), 0) AS akhir_hutang_lokal_kredit
  FROM live_hut h
  GROUP BY h.customer_code
)
INSERT INTO app.saldo_pelanggan_snapshot_row (
  unit_id, as_of_date, generation_id, customer_code,
  awal_piutang_lokal, akhir_piutang_lokal,
  awal_piutang_online, akhir_piutang_online,
  awal_hutang_lokal, akhir_hutang_lokal,
  awal_piutang_lokal_debet,
  awal_piutang_lokal_kredit,
  akhir_piutang_lokal_debet,
  akhir_piutang_lokal_kredit,
  awal_piutang_online_debet,
  awal_piutang_online_kredit,
  akhir_piutang_online_debet,
  akhir_piutang_online_kredit,
  awal_hutang_lokal_debet,
  awal_hutang_lokal_kredit,
  akhir_hutang_lokal_debet,
  akhir_hutang_lokal_kredit
)
SELECT $1::smallint, $2::date, $3::uuid, k.customer_code,
       COALESCE(p.awal_piutang_lokal, 0), COALESCE(p.akhir_piutang_lokal, 0),
       COALESCE(p.awal_piutang_online, 0), COALESCE(p.akhir_piutang_online, 0),
       COALESCE(h.awal_hutang_lokal, 0), COALESCE(h.akhir_hutang_lokal, 0),
       COALESCE(p.awal_piutang_lokal_debet, 0),
       COALESCE(p.awal_piutang_lokal_kredit, 0),
       COALESCE(p.akhir_piutang_lokal_debet, 0),
       COALESCE(p.akhir_piutang_lokal_kredit, 0),
       COALESCE(p.awal_piutang_online_debet, 0),
       COALESCE(p.awal_piutang_online_kredit, 0),
       COALESCE(p.akhir_piutang_online_debet, 0),
       COALESCE(p.akhir_piutang_online_kredit, 0),
       COALESCE(h.awal_hutang_lokal_debet, 0),
       COALESCE(h.awal_hutang_lokal_kredit, 0),
       COALESCE(h.akhir_hutang_lokal_debet, 0),
       COALESCE(h.akhir_hutang_lokal_kredit, 0)
FROM customer_keys k
LEFT JOIN piut p ON p.customer_code = k.customer_code
LEFT JOIN hut h ON h.customer_code = k.customer_code
ON CONFLICT (unit_id, as_of_date, generation_id, customer_code) DO UPDATE SET
  awal_piutang_lokal = EXCLUDED.awal_piutang_lokal,
  akhir_piutang_lokal = EXCLUDED.akhir_piutang_lokal,
  awal_piutang_online = EXCLUDED.awal_piutang_online,
  akhir_piutang_online = EXCLUDED.akhir_piutang_online,
  awal_hutang_lokal = EXCLUDED.awal_hutang_lokal,
  akhir_hutang_lokal = EXCLUDED.akhir_hutang_lokal,
  awal_piutang_lokal_debet = EXCLUDED.awal_piutang_lokal_debet,
  awal_piutang_lokal_kredit = EXCLUDED.awal_piutang_lokal_kredit,
  akhir_piutang_lokal_debet = EXCLUDED.akhir_piutang_lokal_debet,
  akhir_piutang_lokal_kredit = EXCLUDED.akhir_piutang_lokal_kredit,
  awal_piutang_online_debet = EXCLUDED.awal_piutang_online_debet,
  awal_piutang_online_kredit = EXCLUDED.awal_piutang_online_kredit,
  akhir_piutang_online_debet = EXCLUDED.akhir_piutang_online_debet,
  akhir_piutang_online_kredit = EXCLUDED.akhir_piutang_online_kredit,
  awal_hutang_lokal_debet = EXCLUDED.awal_hutang_lokal_debet,
  awal_hutang_lokal_kredit = EXCLUDED.awal_hutang_lokal_kredit,
  akhir_hutang_lokal_debet = EXCLUDED.akhir_hutang_lokal_debet,
  akhir_hutang_lokal_kredit = EXCLUDED.akhir_hutang_lokal_kredit`;

/**
 * $1 unit, $2 target date, $3 generation, $4 source cycle,
 * $5 base month-end, $6 base generation.
 */
export const MATERIALIZE_DELTA_SQL = `
WITH base AS (
  SELECT r.customer_code,
         r.akhir_piutang_lokal, r.akhir_piutang_online, r.akhir_hutang_lokal,
         r.akhir_piutang_lokal_debet, r.akhir_piutang_lokal_kredit, r.akhir_piutang_online_debet, r.akhir_piutang_online_kredit, r.akhir_hutang_lokal_debet, r.akhir_hutang_lokal_kredit
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
         b.dtgl, b.sjnsbp, b.njumlah,
         b.njumlah * CASE b.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END AS value
  FROM app.saldo_pelanggan_source_bppiut b
  WHERE b.unit_id = $1::smallint
    AND b.source_cycle_id = $4::uuid
    AND b.dtgl >= date_trunc('month', $2::date)::date
    AND b.dtgl <= $2::date
    AND COALESCE(sbatal, 0) = 0
), month_hut AS (
  SELECT btrim(h.ckdplg) AS customer_code,
         h.dtgl, h.sjnsbp, h.njumlah,
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
    COALESCE(sum(p.njumlah) FILTER (WHERE l.customer_code IS NOT NULL AND position('.' in p.customer_code) = 0 AND p.dtgl < $2::date AND p.sjnsbp = 1), 0) AS awal_piutang_lokal_debet,
    COALESCE(sum(p.njumlah) FILTER (WHERE l.customer_code IS NOT NULL AND position('.' in p.customer_code) = 0 AND p.dtgl < $2::date AND p.sjnsbp = 2), 0) AS awal_piutang_lokal_kredit,
    COALESCE(sum(p.njumlah) FILTER (WHERE l.customer_code IS NOT NULL AND position('.' in p.customer_code) = 0 AND p.dtgl <= $2::date AND p.sjnsbp = 1), 0) AS akhir_piutang_lokal_debet,
    COALESCE(sum(p.njumlah) FILTER (WHERE l.customer_code IS NOT NULL AND position('.' in p.customer_code) = 0 AND p.dtgl <= $2::date AND p.sjnsbp = 2), 0) AS akhir_piutang_lokal_kredit,
    COALESCE(sum(p.value) FILTER (
      WHERE position('.' in p.customer_code) > 0 AND p.dtgl < $2::date
    ), 0) AS awal_piutang_online,
    COALESCE(sum(p.value) FILTER (
      WHERE position('.' in p.customer_code) > 0 AND p.dtgl <= $2::date
    ), 0) AS akhir_piutang_online,
    COALESCE(sum(p.njumlah) FILTER (WHERE position('.' in p.customer_code) > 0 AND p.dtgl < $2::date AND p.sjnsbp = 1), 0) AS awal_piutang_online_debet,
    COALESCE(sum(p.njumlah) FILTER (WHERE position('.' in p.customer_code) > 0 AND p.dtgl < $2::date AND p.sjnsbp = 2), 0) AS awal_piutang_online_kredit,
    COALESCE(sum(p.njumlah) FILTER (WHERE position('.' in p.customer_code) > 0 AND p.dtgl <= $2::date AND p.sjnsbp = 1), 0) AS akhir_piutang_online_debet,
    COALESCE(sum(p.njumlah) FILTER (WHERE position('.' in p.customer_code) > 0 AND p.dtgl <= $2::date AND p.sjnsbp = 2), 0) AS akhir_piutang_online_kredit
  FROM month_piut p
  LEFT JOIN local_keys l ON l.customer_code = p.customer_code
  GROUP BY p.customer_code
), hut AS (
  SELECT h.customer_code,
    -COALESCE(sum(h.value) FILTER (WHERE h.dtgl < $2::date), 0)
      AS awal_hutang_lokal,
    -COALESCE(sum(h.value) FILTER (WHERE h.dtgl <= $2::date), 0)
      AS akhir_hutang_lokal,
    COALESCE(sum(h.njumlah) FILTER (WHERE h.dtgl < $2::date AND h.sjnsbp = 1), 0) AS awal_hutang_lokal_debet,
    COALESCE(sum(h.njumlah) FILTER (WHERE h.dtgl < $2::date AND h.sjnsbp = 2), 0) AS awal_hutang_lokal_kredit,
    COALESCE(sum(h.njumlah) FILTER (WHERE h.dtgl <= $2::date AND h.sjnsbp = 1), 0) AS akhir_hutang_lokal_debet,
    COALESCE(sum(h.njumlah) FILTER (WHERE h.dtgl <= $2::date AND h.sjnsbp = 2), 0) AS akhir_hutang_lokal_kredit
  FROM month_hut h
  GROUP BY h.customer_code
)
INSERT INTO app.saldo_pelanggan_snapshot_row (
  unit_id, as_of_date, generation_id, customer_code,
  awal_piutang_lokal, akhir_piutang_lokal,
  awal_piutang_online, akhir_piutang_online,
  awal_hutang_lokal, akhir_hutang_lokal,
  awal_piutang_lokal_debet,
  awal_piutang_lokal_kredit,
  akhir_piutang_lokal_debet,
  akhir_piutang_lokal_kredit,
  awal_piutang_online_debet,
  awal_piutang_online_kredit,
  akhir_piutang_online_debet,
  akhir_piutang_online_kredit,
  awal_hutang_lokal_debet,
  awal_hutang_lokal_kredit,
  akhir_hutang_lokal_debet,
  akhir_hutang_lokal_kredit
)
SELECT $1::smallint, $2::date, $3::uuid, k.customer_code,
       COALESCE(b.akhir_piutang_lokal, 0) + COALESCE(p.awal_piutang_lokal, 0),
       COALESCE(b.akhir_piutang_lokal, 0) + COALESCE(p.akhir_piutang_lokal, 0),
       COALESCE(b.akhir_piutang_online, 0) + COALESCE(p.awal_piutang_online, 0),
       COALESCE(b.akhir_piutang_online, 0) + COALESCE(p.akhir_piutang_online, 0),
       COALESCE(b.akhir_hutang_lokal, 0) + COALESCE(h.awal_hutang_lokal, 0),
       COALESCE(b.akhir_hutang_lokal, 0) + COALESCE(h.akhir_hutang_lokal, 0),
       COALESCE(b.akhir_piutang_lokal_debet, 0) + COALESCE(p.awal_piutang_lokal_debet, 0),
       COALESCE(b.akhir_piutang_lokal_kredit, 0) + COALESCE(p.awal_piutang_lokal_kredit, 0),
       COALESCE(b.akhir_piutang_lokal_debet, 0) + COALESCE(p.akhir_piutang_lokal_debet, 0),
       COALESCE(b.akhir_piutang_lokal_kredit, 0) + COALESCE(p.akhir_piutang_lokal_kredit, 0),
       COALESCE(b.akhir_piutang_online_debet, 0) + COALESCE(p.awal_piutang_online_debet, 0),
       COALESCE(b.akhir_piutang_online_kredit, 0) + COALESCE(p.awal_piutang_online_kredit, 0),
       COALESCE(b.akhir_piutang_online_debet, 0) + COALESCE(p.akhir_piutang_online_debet, 0),
       COALESCE(b.akhir_piutang_online_kredit, 0) + COALESCE(p.akhir_piutang_online_kredit, 0),
       COALESCE(b.akhir_hutang_lokal_debet, 0) + COALESCE(h.awal_hutang_lokal_debet, 0),
       COALESCE(b.akhir_hutang_lokal_kredit, 0) + COALESCE(h.awal_hutang_lokal_kredit, 0),
       COALESCE(b.akhir_hutang_lokal_debet, 0) + COALESCE(h.akhir_hutang_lokal_debet, 0),
       COALESCE(b.akhir_hutang_lokal_kredit, 0) + COALESCE(h.akhir_hutang_lokal_kredit, 0)
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
  akhir_hutang_lokal = EXCLUDED.akhir_hutang_lokal,
  awal_piutang_lokal_debet = EXCLUDED.awal_piutang_lokal_debet,
  awal_piutang_lokal_kredit = EXCLUDED.awal_piutang_lokal_kredit,
  akhir_piutang_lokal_debet = EXCLUDED.akhir_piutang_lokal_debet,
  akhir_piutang_lokal_kredit = EXCLUDED.akhir_piutang_lokal_kredit,
  awal_piutang_online_debet = EXCLUDED.awal_piutang_online_debet,
  awal_piutang_online_kredit = EXCLUDED.awal_piutang_online_kredit,
  akhir_piutang_online_debet = EXCLUDED.akhir_piutang_online_debet,
  akhir_piutang_online_kredit = EXCLUDED.akhir_piutang_online_kredit,
  awal_hutang_lokal_debet = EXCLUDED.awal_hutang_lokal_debet,
  awal_hutang_lokal_kredit = EXCLUDED.awal_hutang_lokal_kredit,
  akhir_hutang_lokal_debet = EXCLUDED.akhir_hutang_lokal_debet,
  akhir_hutang_lokal_kredit = EXCLUDED.akhir_hutang_lokal_kredit`;

/** $1 unit, $2 date, $3 generation. */
export const VALIDATE_GENERATION_SQL = `
SELECT count(*)::bigint AS row_count,
       sha256(convert_to(COALESCE(string_agg(
         concat_ws('|', unit_id::text, as_of_date::text, customer_code,
           awal_piutang_lokal::text, akhir_piutang_lokal::text,
           awal_piutang_online::text, akhir_piutang_online::text,
           awal_hutang_lokal::text, akhir_hutang_lokal::text,
           awal_piutang_lokal_debet::text,
           awal_piutang_lokal_kredit::text,
           akhir_piutang_lokal_debet::text,
           akhir_piutang_lokal_kredit::text,
           awal_piutang_online_debet::text,
           awal_piutang_online_kredit::text,
           akhir_piutang_online_debet::text,
           akhir_piutang_online_kredit::text,
           awal_hutang_lokal_debet::text,
           awal_hutang_lokal_kredit::text,
           akhir_hutang_lokal_debet::text,
           akhir_hutang_lokal_kredit::text),
         E'\\n' ORDER BY customer_code
       ), ''), 'UTF8')) AS row_keyed_checksum,
       COALESCE(sum(awal_piutang_lokal), 0) AS awal_piutang_lokal_total,
       COALESCE(sum(akhir_piutang_lokal), 0) AS akhir_piutang_lokal_total,
       COALESCE(sum(awal_piutang_online), 0) AS awal_piutang_online_total,
       COALESCE(sum(akhir_piutang_online), 0) AS akhir_piutang_online_total,
       COALESCE(sum(awal_hutang_lokal), 0) AS awal_hutang_lokal_total,
       COALESCE(sum(akhir_hutang_lokal), 0) AS akhir_hutang_lokal_total,
       COALESCE(sum(awal_piutang_lokal_debet), 0) AS awal_piutang_lokal_debet_total,
       COALESCE(sum(awal_piutang_lokal_kredit), 0) AS awal_piutang_lokal_kredit_total,
       COALESCE(sum(akhir_piutang_lokal_debet), 0) AS akhir_piutang_lokal_debet_total,
       COALESCE(sum(akhir_piutang_lokal_kredit), 0) AS akhir_piutang_lokal_kredit_total,
       COALESCE(sum(awal_piutang_online_debet), 0) AS awal_piutang_online_debet_total,
       COALESCE(sum(awal_piutang_online_kredit), 0) AS awal_piutang_online_kredit_total,
       COALESCE(sum(akhir_piutang_online_debet), 0) AS akhir_piutang_online_debet_total,
       COALESCE(sum(akhir_piutang_online_kredit), 0) AS akhir_piutang_online_kredit_total,
       COALESCE(sum(awal_hutang_lokal_debet), 0) AS awal_hutang_lokal_debet_total,
       COALESCE(sum(awal_hutang_lokal_kredit), 0) AS awal_hutang_lokal_kredit_total,
       COALESCE(sum(akhir_hutang_lokal_debet), 0) AS akhir_hutang_lokal_debet_total,
       COALESCE(sum(akhir_hutang_lokal_kredit), 0) AS akhir_hutang_lokal_kredit_total
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
  -- Baseline tidak boleh berasal dari cut yang LEBIH BARU dari build ini;
  -- kalau itu terjadi, build inilah yang basi, bukan baseline-nya.
  AND m.source_cycle_sequence <= $4::bigint
  -- ⛔ DULU: m.source_cycle_id = $4::uuid — baseline hanya sah bila berasal
  -- dari potongan sumber yang SAMA PERSIS. Itu menolak jangkar yang masih benar
  -- semata karena UUID cut-nya berganti, sehingga tiap malam tiap unit
  -- membangun ulang jangkar akhir-bulannya dari riwayat penuh. Unit 2-7
  -- membangun ulang 31-08 tujuh kali dengan checksum yang sama persis.
  --
  -- Kode itu juga BERTENTANGAN dengan dirinya sendiri: MARK_STALE_POINTERS_SQL
  -- hanya menandai pointer as_of_date >= dirty_invalid_from, jadi sistem SUDAH
  -- percaya pointer yang lebih tua tetap benar lintas cut — lalu menolak pointer
  -- yang sama itu sebagai baseline.
  --
  -- SEKARANG: syarat yang sebenarnya, yaitu tidak ada perubahan sumber sejak cut
  -- baseline yang menjangkau mundur sampai <= tanggal baseline. Buktinya sudah
  -- ada di skema (source_change.invalid_from_date, ditulis DIFF_*_SQL) dan
  -- tabel itu TIDAK ikut dipensiunkan, jadi buktinya awet.
  --
  -- ⚠️ Ini memindahkan deteksi dari gaya-kasar ke berbasis-bukti. Kalau DIFF_*
  -- punya celah, rebuild membabi-buta dulu masih menangkapnya; kini tidak.
  -- Penawarnya WAJIB dan sudah terpasang: gerbang G6 di
  -- scripts/piutang-verifikasi/01-build-malam.sql ("bukti bilang harus bergerak
  -- tapi tak ada rebuild = MERAH"), plus uji merah baseline-dipakai-ulang vs
  -- full-history di p1-baseline.postgres.test.ts.
  AND NOT EXISTS (
    SELECT 1
    FROM app.saldo_pelanggan_source_change ch
    JOIN app.saldo_pelanggan_source_cycle c
      ON c.unit_id = ch.unit_id AND c.source_cycle_id = ch.source_cycle_id
    WHERE ch.unit_id = m.unit_id
      AND ch.invalid_from_date IS NOT NULL
      AND ch.invalid_from_date <= m.as_of_date
      AND c.source_cycle_sequence > m.source_cycle_sequence
  )
), actual AS (
  SELECT c.generation_id,
         count(r.generation_id)::bigint AS row_count,
         sha256(convert_to(COALESCE(string_agg(
           concat_ws('|', r.unit_id::text, r.as_of_date::text, r.customer_code,
             r.awal_piutang_lokal::text, r.akhir_piutang_lokal::text,
             r.awal_piutang_online::text, r.akhir_piutang_online::text,
             r.awal_hutang_lokal::text, r.akhir_hutang_lokal::text,
           r.awal_piutang_lokal_debet::text,
           r.awal_piutang_lokal_kredit::text,
           r.akhir_piutang_lokal_debet::text,
           r.akhir_piutang_lokal_kredit::text,
           r.awal_piutang_online_debet::text,
           r.awal_piutang_online_kredit::text,
           r.akhir_piutang_online_debet::text,
           r.akhir_piutang_online_kredit::text,
           r.awal_hutang_lokal_debet::text,
           r.awal_hutang_lokal_kredit::text,
           r.akhir_hutang_lokal_debet::text,
           r.akhir_hutang_lokal_kredit::text),
           E'\\n' ORDER BY r.customer_code
         ) FILTER (WHERE r.generation_id IS NOT NULL), ''), 'UTF8')) AS row_keyed_checksum
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

/** $1 unit. Read after the shared advisory lock. */
export const LOCK_DIRTY_WATERMARK_SQL = `
SELECT dirty_invalid_from, dirty_source_cycle_sequence
FROM app.saldo_pelanggan_dirty
WHERE unit_id = $1::smallint
FOR UPDATE`;

/** Rechecked inside the final transaction. */
export const PUBLICATION_OPERATIONAL_GATE_SQL = `
SELECT (extract(hour FROM clock_timestamp() AT TIME ZONE '${SNAPSHOT_OPERATIONAL_LIMITS.timezone}') * 60
        + extract(minute FROM clock_timestamp() AT TIME ZONE '${SNAPSHOT_OPERATIONAL_LIMITS.timezone}'))::int
         AS wib_minutes,
       pg_database_size(current_database())::bigint AS database_bytes`;

/**
 * $1 unit, $2 date, $3 generation, $4 row count, $5 checksum,
 * $6..$11 six saldo totals, $12..$23 twelve debet/kredit totals.
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
    awal_piutang_lokal_debet_total = $12::numeric,
    awal_piutang_lokal_kredit_total = $13::numeric,
    akhir_piutang_lokal_debet_total = $14::numeric,
    akhir_piutang_lokal_kredit_total = $15::numeric,
    awal_piutang_online_debet_total = $16::numeric,
    awal_piutang_online_kredit_total = $17::numeric,
    akhir_piutang_online_debet_total = $18::numeric,
    akhir_piutang_online_kredit_total = $19::numeric,
    awal_hutang_lokal_debet_total = $20::numeric,
    awal_hutang_lokal_kredit_total = $21::numeric,
    akhir_hutang_lokal_debet_total = $22::numeric,
    akhir_hutang_lokal_kredit_total = $23::numeric,
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

/**
 * Merekam pergerakan angka pada tanggal yang SUDAH TERBIT, di dalam transaksi
 * publikasi yang sama — bukan sebagai perbandingan pasca-fakta.
 *
 * Kenapa di sini, bukan sebagai kueri terjadwal: perbandingan pasca-fakta hanya
 * pernah melihat DUA generasi terakhir. Unit 1 tanggal 31-08 bergeser tiga kali;
 * pergeseran -690.068.731 sudah TIDAK TERLIHAT lagi hari ini oleh siapa pun yang
 * membandingkan dua build terakhir. Peristiwa yang direkam saat terjadi tidak
 * bisa tertimpa oleh pergeseran berikutnya.
 *
 * Dipanggil SETELAH manifest baru complete dan SEBELUM pointer bertukar, jadi
 * pointer di sini masih menunjuk generasi LAMA — itulah angka yang pengguna
 * benar-benar lihat sampai detik ini.
 *
 * Ambang >= 1 rupiah pada salah satu dari ENAM total. COALESCE(...,0) dipakai
 * supaya transisi NULL -> nilai terbaca sebagai pergeseran alih-alih menguap
 * jadi NULL dan lolos senyap.
 *
 * BEKU memakai definisi tunggal milik G5 (01-build-malam.sql):
 * as_of_date < source_completed_at::date - 7. Jangan membuat definisi kedua.
 *
 * $1 unit, $2 date, $3 generation.
 */
export const RECORD_SHIFT_SQL = `
INSERT INTO app.saldo_pelanggan_shift (
  unit_id, as_of_date, generation_id, previous_generation_id,
  source_cycle_sequence, rebuild_epoch, source_completed_at, frozen,
  before_awal_piutang_lokal, before_akhir_piutang_lokal,
  before_awal_piutang_online, before_akhir_piutang_online,
  before_awal_hutang_lokal, before_akhir_hutang_lokal,
  after_awal_piutang_lokal, after_akhir_piutang_lokal,
  after_awal_piutang_online, after_akhir_piutang_online,
  after_awal_hutang_lokal, after_akhir_hutang_lokal
)
SELECT n.unit_id, n.as_of_date, n.generation_id, o.generation_id,
       n.source_cycle_sequence, n.rebuild_epoch, n.source_completed_at,
       (n.as_of_date < n.source_completed_at::date - 7),
       o.awal_piutang_lokal_total,  o.akhir_piutang_lokal_total,
       o.awal_piutang_online_total, o.akhir_piutang_online_total,
       o.awal_hutang_lokal_total,   o.akhir_hutang_lokal_total,
       n.awal_piutang_lokal_total,  n.akhir_piutang_lokal_total,
       n.awal_piutang_online_total, n.akhir_piutang_online_total,
       n.awal_hutang_lokal_total,   n.akhir_hutang_lokal_total
FROM app.saldo_pelanggan_snapshot_manifest n
JOIN app.saldo_pelanggan_snapshot_pointer p
  ON p.unit_id = n.unit_id AND p.as_of_date = n.as_of_date
JOIN app.saldo_pelanggan_snapshot_manifest o
  ON o.unit_id = p.unit_id AND o.as_of_date = p.as_of_date
 AND o.generation_id = p.generation_id
WHERE n.unit_id = $1::smallint
  AND n.as_of_date = $2::date
  AND n.generation_id = $3::uuid
  AND o.generation_id <> n.generation_id
  AND (
       abs(COALESCE(n.awal_piutang_lokal_total, 0)   - COALESCE(o.awal_piutang_lokal_total, 0))   >= 1
    OR abs(COALESCE(n.akhir_piutang_lokal_total, 0)  - COALESCE(o.akhir_piutang_lokal_total, 0))  >= 1
    OR abs(COALESCE(n.awal_piutang_online_total, 0)  - COALESCE(o.awal_piutang_online_total, 0))  >= 1
    OR abs(COALESCE(n.akhir_piutang_online_total, 0) - COALESCE(o.akhir_piutang_online_total, 0)) >= 1
    OR abs(COALESCE(n.awal_hutang_lokal_total, 0)    - COALESCE(o.awal_hutang_lokal_total, 0))    >= 1
    OR abs(COALESCE(n.akhir_hutang_lokal_total, 0)   - COALESCE(o.akhir_hutang_lokal_total, 0))   >= 1
  )
ON CONFLICT (unit_id, as_of_date, generation_id) DO NOTHING
RETURNING generation_id`;

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

/**
 * A leased older build may publish after a newer cut marked this date dirty.
 * Reassert pending state in the same publication transaction so stale is never
 * externally cleared by a generation that does not cover the dirty sequence.
 * $1 unit, $2 date.
 */
export const REASSERT_POINTER_DIRTY_SQL = `
UPDATE app.saldo_pelanggan_snapshot_pointer p
SET stale_invalid_from = LEAST(
      COALESCE(p.stale_invalid_from, d.dirty_invalid_from),
      d.dirty_invalid_from
    ),
    pending_replacement = true,
    pending_since = COALESCE(p.pending_since, clock_timestamp())
FROM app.saldo_pelanggan_dirty d
WHERE p.unit_id = $1::smallint
  AND p.as_of_date = $2::date
  AND d.unit_id = p.unit_id
  AND d.dirty_invalid_from IS NOT NULL
  AND p.as_of_date >= d.dirty_invalid_from
  AND p.source_cycle_sequence < d.dirty_source_cycle_sequence
RETURNING p.generation_id`;

/** $1 unit, $2 work id, $3 generation, $4 lease owner. */
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
  AND lease_owner = $4::text
  AND state = 'leased'
  AND lease_expires_at >= clock_timestamp()
RETURNING work_id`;

/**
 * Clear the durable watermark only after every stored target at/after the
 * invalidation boundary points to a complete cut that covers it. The coverage
 * tuple remains as durable evidence. $1 unit, $2 just-published target date.
 */
export const CLEAR_DIRTY_IF_COVERED_SQL = `
WITH candidate AS (
  SELECT p.unit_id, p.as_of_date, p.generation_id, p.source_cycle_sequence
  FROM app.saldo_pelanggan_snapshot_pointer p
  JOIN app.saldo_pelanggan_dirty d ON d.unit_id = p.unit_id
  WHERE p.unit_id = $1::smallint
    AND p.as_of_date = $2::date
    AND d.dirty_invalid_from IS NOT NULL
    AND p.as_of_date >= d.dirty_invalid_from
    AND p.source_cycle_sequence >= d.dirty_source_cycle_sequence
    AND NOT p.pending_replacement
    AND NOT EXISTS (
      SELECT 1
      FROM app.saldo_pelanggan_snapshot_pointer pending
      WHERE pending.unit_id = p.unit_id
        AND pending.as_of_date >= d.dirty_invalid_from
        AND (
          pending.pending_replacement
          OR pending.source_cycle_sequence < d.dirty_source_cycle_sequence
        )
    )
)
UPDATE app.saldo_pelanggan_dirty d
SET dirty_invalid_from = NULL,
    dirty_source_cycle_id = NULL,
    dirty_source_cycle_sequence = NULL,
    dirty_since = NULL,
    covered_through_date = c.as_of_date,
    covered_by_generation_id = c.generation_id,
    covered_source_cycle_sequence = c.source_cycle_sequence,
    version = d.version + 1,
    updated_at = clock_timestamp()
FROM candidate c
WHERE d.unit_id = c.unit_id
RETURNING d.unit_id`;

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
WITH candidate AS (
  SELECT m.*
  FROM app.saldo_pelanggan_snapshot_pointer p
  JOIN app.saldo_pelanggan_snapshot_manifest m
    ON m.unit_id = p.unit_id AND m.as_of_date = p.as_of_date AND m.generation_id = p.generation_id
  WHERE p.unit_id = $1::smallint AND p.as_of_date = $2::date
    AND m.status = 'complete' AND m.published AND m.validation_passed
    AND m.formula_version = 'saldo-pelanggan-v2'
), actual AS (
  SELECT m.generation_id, count(r.generation_id)::bigint AS row_count,
    sha256(convert_to(COALESCE(string_agg(
      concat_ws('|', r.unit_id::text, r.as_of_date::text, r.customer_code,
        r.awal_piutang_lokal::text,
        r.akhir_piutang_lokal::text,
        r.awal_piutang_online::text,
        r.akhir_piutang_online::text,
        r.awal_hutang_lokal::text,
        r.akhir_hutang_lokal::text,
        r.awal_piutang_lokal_debet::text,
        r.awal_piutang_lokal_kredit::text,
        r.akhir_piutang_lokal_debet::text,
        r.akhir_piutang_lokal_kredit::text,
        r.awal_piutang_online_debet::text,
        r.awal_piutang_online_kredit::text,
        r.akhir_piutang_online_debet::text,
        r.akhir_piutang_online_kredit::text,
        r.awal_hutang_lokal_debet::text,
        r.awal_hutang_lokal_kredit::text,
        r.akhir_hutang_lokal_debet::text,
        r.akhir_hutang_lokal_kredit::text),
      E'\\n' ORDER BY r.customer_code) FILTER (WHERE r.generation_id IS NOT NULL), ''), 'UTF8')) AS row_keyed_checksum,
    COALESCE(sum(r.awal_piutang_lokal), 0) AS awal_piutang_lokal_total,
    COALESCE(sum(r.akhir_piutang_lokal), 0) AS akhir_piutang_lokal_total,
    COALESCE(sum(r.awal_piutang_online), 0) AS awal_piutang_online_total,
    COALESCE(sum(r.akhir_piutang_online), 0) AS akhir_piutang_online_total,
    COALESCE(sum(r.awal_hutang_lokal), 0) AS awal_hutang_lokal_total,
    COALESCE(sum(r.akhir_hutang_lokal), 0) AS akhir_hutang_lokal_total,
    COALESCE(sum(r.awal_piutang_lokal_debet), 0) AS awal_piutang_lokal_debet_total,
    COALESCE(sum(r.awal_piutang_lokal_kredit), 0) AS awal_piutang_lokal_kredit_total,
    COALESCE(sum(r.akhir_piutang_lokal_debet), 0) AS akhir_piutang_lokal_debet_total,
    COALESCE(sum(r.akhir_piutang_lokal_kredit), 0) AS akhir_piutang_lokal_kredit_total,
    COALESCE(sum(r.awal_piutang_online_debet), 0) AS awal_piutang_online_debet_total,
    COALESCE(sum(r.awal_piutang_online_kredit), 0) AS awal_piutang_online_kredit_total,
    COALESCE(sum(r.akhir_piutang_online_debet), 0) AS akhir_piutang_online_debet_total,
    COALESCE(sum(r.akhir_piutang_online_kredit), 0) AS akhir_piutang_online_kredit_total,
    COALESCE(sum(r.awal_hutang_lokal_debet), 0) AS awal_hutang_lokal_debet_total,
    COALESCE(sum(r.awal_hutang_lokal_kredit), 0) AS awal_hutang_lokal_kredit_total,
    COALESCE(sum(r.akhir_hutang_lokal_debet), 0) AS akhir_hutang_lokal_debet_total,
    COALESCE(sum(r.akhir_hutang_lokal_kredit), 0) AS akhir_hutang_lokal_kredit_total
  FROM candidate m
  LEFT JOIN app.saldo_pelanggan_snapshot_row r ON r.unit_id = m.unit_id
    AND r.as_of_date = m.as_of_date AND r.generation_id = m.generation_id
  GROUP BY m.generation_id
)
SELECT m.generation_id, m.source_cycle_id, m.source_completed_at, r.customer_code,
       r.awal_piutang_lokal,
       r.akhir_piutang_lokal,
       r.awal_piutang_online,
       r.akhir_piutang_online,
       r.awal_hutang_lokal,
       r.akhir_hutang_lokal,
       r.awal_piutang_lokal_debet,
       r.awal_piutang_lokal_kredit,
       r.akhir_piutang_lokal_debet,
       r.akhir_piutang_lokal_kredit,
       r.awal_piutang_online_debet,
       r.awal_piutang_online_kredit,
       r.akhir_piutang_online_debet,
       r.akhir_piutang_online_kredit,
       r.awal_hutang_lokal_debet,
       r.awal_hutang_lokal_kredit,
       r.akhir_hutang_lokal_debet,
       r.akhir_hutang_lokal_kredit
FROM candidate m
JOIN actual a ON a.generation_id = m.generation_id
  AND a.row_count = m.row_count AND a.row_keyed_checksum = m.row_keyed_checksum
  AND ROW(a.awal_piutang_lokal_total, a.akhir_piutang_lokal_total, a.awal_piutang_online_total, a.akhir_piutang_online_total, a.awal_hutang_lokal_total, a.akhir_hutang_lokal_total, a.awal_piutang_lokal_debet_total, a.awal_piutang_lokal_kredit_total, a.akhir_piutang_lokal_debet_total, a.akhir_piutang_lokal_kredit_total, a.awal_piutang_online_debet_total, a.awal_piutang_online_kredit_total, a.akhir_piutang_online_debet_total, a.akhir_piutang_online_kredit_total, a.awal_hutang_lokal_debet_total, a.awal_hutang_lokal_kredit_total, a.akhir_hutang_lokal_debet_total, a.akhir_hutang_lokal_kredit_total)
    = ROW(m.awal_piutang_lokal_total, m.akhir_piutang_lokal_total, m.awal_piutang_online_total, m.akhir_piutang_online_total, m.awal_hutang_lokal_total, m.akhir_hutang_lokal_total, m.awal_piutang_lokal_debet_total, m.awal_piutang_lokal_kredit_total, m.akhir_piutang_lokal_debet_total, m.akhir_piutang_lokal_kredit_total, m.awal_piutang_online_debet_total, m.awal_piutang_online_kredit_total, m.akhir_piutang_online_debet_total, m.akhir_piutang_online_kredit_total, m.awal_hutang_lokal_debet_total, m.awal_hutang_lokal_kredit_total, m.akhir_hutang_lokal_debet_total, m.akhir_hutang_lokal_kredit_total)
JOIN app.saldo_pelanggan_snapshot_row r ON r.unit_id = m.unit_id
  AND r.as_of_date = m.as_of_date AND r.generation_id = m.generation_id
ORDER BY r.customer_code`;
