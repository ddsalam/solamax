/**
 * SQL for full-sync source-cut capture and invalidation.
 *
 * Identifiers are fixed constants. All runtime values remain positional
 * parameters so source rows can never become SQL syntax.
 */

/** $1 unit. Serialises cycle numbering and promotion for one unit. */
export const LOCK_SOURCE_CAPTURE_SQL =
  "SELECT pg_advisory_xact_lock(hashtextextended('saldo-pelanggan-source:' || $1::text, 0))";

/**
 * $1 unit. Cycle numbering is independent from the longer publication lock:
 * immutable staging must not wait behind a snapshot build/finalization.
 */
export const LOCK_SOURCE_CYCLE_ALLOCATION_SQL =
  "SELECT pg_advisory_xact_lock(hashtextextended('saldo-pelanggan-source-sequence:' || $1::text, 0))";

/** $1 unit, $2 cycle UUID. */
export const ENSURE_SOURCE_CYCLE_SQL = `
INSERT INTO app.saldo_pelanggan_source_cycle (
  unit_id, source_cycle_id, source_cycle_sequence, previous_source_cycle_id
)
SELECT $1::smallint,
       $2::uuid,
       COALESCE(max(c.source_cycle_sequence), 0) + 1,
       (
         SELECT latest.source_cycle_id
         FROM app.saldo_pelanggan_source_cycle latest
         WHERE latest.unit_id = $1::smallint AND latest.status = 'complete'
         ORDER BY latest.source_cycle_sequence DESC
         LIMIT 1
       )
FROM app.saldo_pelanggan_source_cycle c
WHERE c.unit_id = $1::smallint
ON CONFLICT (unit_id, source_cycle_id) DO NOTHING`;

/** $1 unit, $2 cycle UUID. */
export const READ_SOURCE_CYCLE_SQL = `
SELECT source_cycle_id, source_cycle_sequence, previous_source_cycle_id, status,
       pelanggan_row_count, bppiut_row_count, bphut_row_count
FROM app.saldo_pelanggan_source_cycle
WHERE unit_id = $1::smallint AND source_cycle_id = $2::uuid
FOR UPDATE`;

/** $1 unit. Newest complete-input staging cut is finalized first. */
export const READ_READY_SOURCE_CYCLE_SQL = `
SELECT source_cycle_id, source_cycle_sequence, previous_source_cycle_id, status,
       pelanggan_row_count, bppiut_row_count, bphut_row_count
FROM app.saldo_pelanggan_source_cycle
WHERE unit_id = $1::smallint
  AND status = 'staging'
  AND pelanggan_row_count IS NOT NULL
  AND pelanggan_keyed_checksum IS NOT NULL
  AND bppiut_row_count IS NOT NULL
  AND bppiut_keyed_checksum IS NOT NULL
  AND bphut_row_count IS NOT NULL
  AND bphut_keyed_checksum IS NOT NULL
ORDER BY source_cycle_sequence DESC
LIMIT 1
FOR UPDATE`;

/** $1 unit. Unit advisory lock makes this stable for the transaction. */
export const READ_LATEST_COMPLETE_SEQUENCE_SQL = `
SELECT source_cycle_sequence
FROM app.saldo_pelanggan_source_cycle
WHERE unit_id = $1::smallint AND status = 'complete'
ORDER BY source_cycle_sequence DESC
LIMIT 1`;

/** $1 unit, $2 cycle UUID, $3 rows JSON. */
export const STAGE_PELANGGAN_SQL = `
INSERT INTO app.saldo_pelanggan_source_pelanggan (
  unit_id, source_cycle_id, ckdplg, vcnmplg, sjenis, saktif,
  row_keyed_checksum
)
SELECT $1::smallint,
       $2::uuid,
       r.ckdplg,
       r.vcnmplg,
       r.sjenis,
       r.saktif,
       sha256(convert_to(jsonb_build_array(
         btrim(r.ckdplg), r.vcnmplg, r.sjenis, r.saktif
       )::text, 'UTF8'))
FROM jsonb_to_recordset($3::jsonb) AS r(
  ckdplg text, vcnmplg text, sjenis smallint, saktif smallint
)
ON CONFLICT (unit_id, source_cycle_id, ckdplg) DO NOTHING`;

/** $1 unit, $2 cycle UUID, $3 rows JSON. */
export const STAGE_BPPIUT_SQL = `
INSERT INTO app.saldo_pelanggan_source_bppiut (
  unit_id, source_cycle_id, ckdbppiut, dtgl, ckdplg, njumlah, sjnsbp,
  sbatal, row_keyed_checksum
)
SELECT $1::smallint,
       $2::uuid,
       r.ckdbppiut,
       r.dtgl,
       r.ckdplg,
       r.njumlah,
       r.sjnsbp,
       r.sbatal,
       sha256(convert_to(jsonb_build_array(
         btrim(r.ckdbppiut), r.dtgl, btrim(r.ckdplg), r.njumlah,
         r.sjnsbp, r.sbatal
       )::text, 'UTF8'))
FROM jsonb_to_recordset($3::jsonb) AS r(
  ckdbppiut text, dtgl date, ckdplg text, njumlah numeric,
  sjnsbp smallint, sbatal smallint
)
ON CONFLICT (unit_id, source_cycle_id, ckdbppiut) DO NOTHING`;

/** $1 unit, $2 cycle UUID, $3 rows JSON. */
export const STAGE_BPHUT_SQL = `
INSERT INTO app.saldo_pelanggan_source_bphut (
  unit_id, source_cycle_id, ckdbphut, dtgl, ckdplg, njumlah, sjnsbp,
  sbatal, row_keyed_checksum
)
SELECT $1::smallint,
       $2::uuid,
       r.ckdbphut,
       r.dtgl,
       r.ckdplg,
       r.njumlah,
       r.sjnsbp,
       r.sbatal,
       sha256(convert_to(jsonb_build_array(
         btrim(r.ckdbphut), r.dtgl, btrim(r.ckdplg), r.njumlah,
         r.sjnsbp, r.sbatal
       )::text, 'UTF8'))
FROM jsonb_to_recordset($3::jsonb) AS r(
  ckdbphut text, dtgl date, ckdplg text, njumlah numeric,
  sjnsbp smallint, sbatal smallint
)
ON CONFLICT (unit_id, source_cycle_id, ckdbphut) DO NOTHING`;

/** $1 unit, $2 cycle UUID. */
export const DOMAIN_EVIDENCE_SQL = {
  pelanggan_master: `
SELECT count(*)::bigint AS row_count,
       sha256(
         int8send(count(*)::bigint)
         || int8send(COALESCE(bit_xor((('x' || encode(substring(row_keyed_checksum FROM 1 FOR 8), 'hex'))::bit(64))::bigint), 0))
         || int8send(COALESCE(bit_xor((('x' || encode(substring(row_keyed_checksum FROM 9 FOR 8), 'hex'))::bit(64))::bigint), 0))
         || int8send(COALESCE(bit_xor((('x' || encode(substring(row_keyed_checksum FROM 17 FOR 8), 'hex'))::bit(64))::bigint), 0))
         || int8send(COALESCE(bit_xor((('x' || encode(substring(row_keyed_checksum FROM 25 FOR 8), 'hex'))::bit(64))::bigint), 0))
       ) AS keyed_checksum
FROM app.saldo_pelanggan_source_pelanggan
WHERE unit_id = $1::smallint AND source_cycle_id = $2::uuid`,
  bppiut: `
SELECT count(*)::bigint AS row_count,
       sha256(
         int8send(count(*)::bigint)
         || int8send(COALESCE(bit_xor((('x' || encode(substring(row_keyed_checksum FROM 1 FOR 8), 'hex'))::bit(64))::bigint), 0))
         || int8send(COALESCE(bit_xor((('x' || encode(substring(row_keyed_checksum FROM 9 FOR 8), 'hex'))::bit(64))::bigint), 0))
         || int8send(COALESCE(bit_xor((('x' || encode(substring(row_keyed_checksum FROM 17 FOR 8), 'hex'))::bit(64))::bigint), 0))
         || int8send(COALESCE(bit_xor((('x' || encode(substring(row_keyed_checksum FROM 25 FOR 8), 'hex'))::bit(64))::bigint), 0))
       ) AS keyed_checksum
FROM app.saldo_pelanggan_source_bppiut
WHERE unit_id = $1::smallint AND source_cycle_id = $2::uuid`,
  bphut: `
SELECT count(*)::bigint AS row_count,
       sha256(
         int8send(count(*)::bigint)
         || int8send(COALESCE(bit_xor((('x' || encode(substring(row_keyed_checksum FROM 1 FOR 8), 'hex'))::bit(64))::bigint), 0))
         || int8send(COALESCE(bit_xor((('x' || encode(substring(row_keyed_checksum FROM 9 FOR 8), 'hex'))::bit(64))::bigint), 0))
         || int8send(COALESCE(bit_xor((('x' || encode(substring(row_keyed_checksum FROM 17 FOR 8), 'hex'))::bit(64))::bigint), 0))
         || int8send(COALESCE(bit_xor((('x' || encode(substring(row_keyed_checksum FROM 25 FOR 8), 'hex'))::bit(64))::bigint), 0))
       ) AS keyed_checksum
FROM app.saldo_pelanggan_source_bphut
WHERE unit_id = $1::smallint AND source_cycle_id = $2::uuid`,
} as const;

/**
 * $1 unit, $2 cycle UUID, $3 agent-declared full-domain row count.
 * A zero SHA-256 sentinel marks a durable final-chunk claim. The worker replaces
 * it with independently calculated evidence before the cut can be promoted.
 */
export const CLAIM_DOMAIN_COMPLETE_SQL = {
  pelanggan_master: `
UPDATE app.saldo_pelanggan_source_cycle
SET pelanggan_row_count = $3::bigint,
    pelanggan_keyed_checksum = decode(repeat('00', 32), 'hex')
WHERE unit_id = $1::smallint AND source_cycle_id = $2::uuid
  AND status = 'staging'
  AND (pelanggan_row_count IS NULL OR pelanggan_row_count = $3::bigint)
RETURNING source_cycle_id, source_cycle_sequence, previous_source_cycle_id, status,
          pelanggan_row_count, bppiut_row_count, bphut_row_count`,
  bppiut: `
UPDATE app.saldo_pelanggan_source_cycle
SET bppiut_row_count = $3::bigint,
    bppiut_keyed_checksum = decode(repeat('00', 32), 'hex')
WHERE unit_id = $1::smallint AND source_cycle_id = $2::uuid
  AND status = 'staging'
  AND (bppiut_row_count IS NULL OR bppiut_row_count = $3::bigint)
RETURNING source_cycle_id, source_cycle_sequence, previous_source_cycle_id, status,
          pelanggan_row_count, bppiut_row_count, bphut_row_count`,
  bphut: `
UPDATE app.saldo_pelanggan_source_cycle
SET bphut_row_count = $3::bigint,
    bphut_keyed_checksum = decode(repeat('00', 32), 'hex')
WHERE unit_id = $1::smallint AND source_cycle_id = $2::uuid
  AND status = 'staging'
  AND (bphut_row_count IS NULL OR bphut_row_count = $3::bigint)
RETURNING source_cycle_id, source_cycle_sequence, previous_source_cycle_id, status,
          pelanggan_row_count, bppiut_row_count, bphut_row_count`,
} as const;

/** $1 unit, $2 cycle UUID, $3 verified count, $4 verified checksum. */
export const COMPLETE_DOMAIN_SQL = {
  pelanggan_master: `
UPDATE app.saldo_pelanggan_source_cycle
SET pelanggan_row_count = $3::bigint,
    pelanggan_keyed_checksum = $4::bytea
WHERE unit_id = $1::smallint AND source_cycle_id = $2::uuid
  AND status = 'staging'
  AND pelanggan_row_count = $3::bigint
  AND (pelanggan_keyed_checksum = decode(repeat('00', 32), 'hex')
       OR pelanggan_keyed_checksum = $4::bytea)
RETURNING source_cycle_id, source_cycle_sequence, previous_source_cycle_id, status,
          pelanggan_row_count, bppiut_row_count, bphut_row_count`,
  bppiut: `
UPDATE app.saldo_pelanggan_source_cycle
SET bppiut_row_count = $3::bigint,
    bppiut_keyed_checksum = $4::bytea
WHERE unit_id = $1::smallint AND source_cycle_id = $2::uuid
  AND status = 'staging'
  AND bppiut_row_count = $3::bigint
  AND (bppiut_keyed_checksum = decode(repeat('00', 32), 'hex')
       OR bppiut_keyed_checksum = $4::bytea)
RETURNING source_cycle_id, source_cycle_sequence, previous_source_cycle_id, status,
          pelanggan_row_count, bppiut_row_count, bphut_row_count`,
  bphut: `
UPDATE app.saldo_pelanggan_source_cycle
SET bphut_row_count = $3::bigint,
    bphut_keyed_checksum = $4::bytea
WHERE unit_id = $1::smallint AND source_cycle_id = $2::uuid
  AND status = 'staging'
  AND bphut_row_count = $3::bigint
  AND (bphut_keyed_checksum = decode(repeat('00', 32), 'hex')
       OR bphut_keyed_checksum = $4::bytea)
RETURNING source_cycle_id, source_cycle_sequence, previous_source_cycle_id, status,
          pelanggan_row_count, bppiut_row_count, bphut_row_count`,
} as const;

/** $1 unit, $2 new cycle, $3 previous complete cycle. */
export const DIFF_LEDGER_SQL = {
  bppiut: `
WITH old_rows AS (
  SELECT * FROM app.saldo_pelanggan_source_bppiut
  WHERE unit_id = $1::smallint AND source_cycle_id = $3::uuid
), new_rows AS (
  SELECT * FROM app.saldo_pelanggan_source_bppiut
  WHERE unit_id = $1::smallint AND source_cycle_id = $2::uuid
)
INSERT INTO app.saldo_pelanggan_source_change (
  unit_id, source_cycle_id, domain, source_key, change_kind,
  old_business_date, new_business_date,
  old_customer_code, new_customer_code,
  old_row_keyed_checksum, new_row_keyed_checksum,
  classification_changed, label_only, invalid_from_date
)
SELECT $1::smallint, $2::uuid, 'bppiut',
       btrim(COALESCE(n.ckdbppiut, o.ckdbppiut)),
       CASE WHEN o.ckdbppiut IS NULL THEN 'insert'
            WHEN n.ckdbppiut IS NULL THEN 'delete' ELSE 'update' END,
       o.dtgl, n.dtgl, btrim(o.ckdplg), btrim(n.ckdplg),
       o.row_keyed_checksum, n.row_keyed_checksum,
       false, false,
       CASE WHEN o.ckdbppiut IS NULL THEN n.dtgl
            WHEN n.ckdbppiut IS NULL THEN o.dtgl
            ELSE LEAST(o.dtgl, n.dtgl) END
FROM old_rows o
FULL OUTER JOIN new_rows n ON n.ckdbppiut = o.ckdbppiut
WHERE (o.ckdbppiut IS NULL OR n.ckdbppiut IS NULL
       OR o.row_keyed_checksum <> n.row_keyed_checksum)
ON CONFLICT DO NOTHING`,
  bphut: `
WITH old_rows AS (
  SELECT * FROM app.saldo_pelanggan_source_bphut
  WHERE unit_id = $1::smallint AND source_cycle_id = $3::uuid
), new_rows AS (
  SELECT * FROM app.saldo_pelanggan_source_bphut
  WHERE unit_id = $1::smallint AND source_cycle_id = $2::uuid
)
INSERT INTO app.saldo_pelanggan_source_change (
  unit_id, source_cycle_id, domain, source_key, change_kind,
  old_business_date, new_business_date,
  old_customer_code, new_customer_code,
  old_row_keyed_checksum, new_row_keyed_checksum,
  classification_changed, label_only, invalid_from_date
)
SELECT $1::smallint, $2::uuid, 'bphut',
       btrim(COALESCE(n.ckdbphut, o.ckdbphut)),
       CASE WHEN o.ckdbphut IS NULL THEN 'insert'
            WHEN n.ckdbphut IS NULL THEN 'delete' ELSE 'update' END,
       o.dtgl, n.dtgl, btrim(o.ckdplg), btrim(n.ckdplg),
       o.row_keyed_checksum, n.row_keyed_checksum,
       false, false,
       CASE WHEN o.ckdbphut IS NULL THEN n.dtgl
            WHEN n.ckdbphut IS NULL THEN o.dtgl
            ELSE LEAST(o.dtgl, n.dtgl) END
FROM old_rows o
FULL OUTER JOIN new_rows n ON n.ckdbphut = o.ckdbphut
WHERE (o.ckdbphut IS NULL OR n.ckdbphut IS NULL
       OR o.row_keyed_checksum <> n.row_keyed_checksum)
ON CONFLICT DO NOTHING`,
} as const;

/**
 * Master key insert/delete and sjenis change affect all stored numeric history.
 * Updates limited to non-numeric fields (name/saktif) remain audit evidence but
 * carry no invalidation date.
 * $1 unit, $2 new cycle, $3 previous complete cycle.
 */
export const DIFF_PELANGGAN_SQL = `
WITH old_rows AS (
  SELECT * FROM app.saldo_pelanggan_source_pelanggan
  WHERE unit_id = $1::smallint AND source_cycle_id = $3::uuid
), new_rows AS (
  SELECT * FROM app.saldo_pelanggan_source_pelanggan
  WHERE unit_id = $1::smallint AND source_cycle_id = $2::uuid
), oldest AS (
  SELECT min(as_of_date)::date AS invalid_from_date
  FROM app.saldo_pelanggan_snapshot_pointer
  WHERE unit_id = $1::smallint
), changes AS (
  SELECT btrim(COALESCE(n.ckdplg, o.ckdplg)) AS source_key,
         CASE WHEN o.ckdplg IS NULL THEN 'insert'
              WHEN n.ckdplg IS NULL THEN 'delete' ELSE 'update' END AS change_kind,
         o.ckdplg AS old_customer_code,
         n.ckdplg AS new_customer_code,
         o.row_keyed_checksum AS old_checksum,
         n.row_keyed_checksum AS new_checksum,
         (o.ckdplg IS NULL OR n.ckdplg IS NULL
          OR o.sjenis <> n.sjenis
          OR (o.sjenis IS NULL) <> (n.sjenis IS NULL))
           AS classification_changed
  FROM old_rows o
  FULL OUTER JOIN new_rows n ON n.ckdplg = o.ckdplg
  WHERE (o.ckdplg IS NULL OR n.ckdplg IS NULL
         OR o.row_keyed_checksum <> n.row_keyed_checksum)
)
INSERT INTO app.saldo_pelanggan_source_change (
  unit_id, source_cycle_id, domain, source_key, change_kind,
  old_customer_code, new_customer_code,
  old_row_keyed_checksum, new_row_keyed_checksum,
  classification_changed, label_only, invalid_from_date
)
SELECT $1::smallint, $2::uuid, 'pelanggan_master', c.source_key, c.change_kind,
       btrim(c.old_customer_code), btrim(c.new_customer_code),
       c.old_checksum, c.new_checksum,
       c.classification_changed,
       NOT c.classification_changed,
       CASE WHEN c.classification_changed THEN o.invalid_from_date ELSE NULL END
FROM changes c CROSS JOIN oldest o
WHERE NOT c.classification_changed OR o.invalid_from_date IS NOT NULL
ON CONFLICT DO NOTHING`;

/** $1 unit, $2 cycle, $3 sequence. Durable minimum date + latest provenance. */
export const UPSERT_DIRTY_WATERMARK_SQL = `
WITH changed AS (
  SELECT min(invalid_from_date)::date AS invalid_from_date
  FROM app.saldo_pelanggan_source_change
  WHERE unit_id = $1::smallint
    AND source_cycle_id = $2::uuid
    AND invalid_from_date IS NOT NULL
)
INSERT INTO app.saldo_pelanggan_dirty (
  unit_id, dirty_invalid_from, dirty_source_cycle_id,
  dirty_source_cycle_sequence, dirty_since, version, updated_at
)
SELECT $1::smallint, invalid_from_date, $2::uuid, $3::bigint,
       clock_timestamp(), 1, clock_timestamp()
FROM changed
WHERE invalid_from_date IS NOT NULL
ON CONFLICT (unit_id) DO UPDATE
SET dirty_invalid_from = LEAST(
      COALESCE(app.saldo_pelanggan_dirty.dirty_invalid_from, EXCLUDED.dirty_invalid_from),
      EXCLUDED.dirty_invalid_from
    ),
    dirty_source_cycle_id = EXCLUDED.dirty_source_cycle_id,
    dirty_source_cycle_sequence = EXCLUDED.dirty_source_cycle_sequence,
    dirty_since = COALESCE(app.saldo_pelanggan_dirty.dirty_since, EXCLUDED.dirty_since),
    covered_through_date = NULL,
    covered_by_generation_id = NULL,
    covered_source_cycle_sequence = NULL,
    version = app.saldo_pelanggan_dirty.version + 1,
    updated_at = clock_timestamp()
`;

/** $1 unit. Pointer stays active; only its replacement state changes. */
export const MARK_STALE_POINTERS_SQL = `
UPDATE app.saldo_pelanggan_snapshot_pointer p
SET stale_invalid_from = LEAST(
      COALESCE(p.stale_invalid_from, d.dirty_invalid_from),
      d.dirty_invalid_from
    ),
    pending_replacement = true,
    pending_since = COALESCE(p.pending_since, clock_timestamp())
FROM app.saldo_pelanggan_dirty d
WHERE p.unit_id = $1::smallint
  AND d.unit_id = p.unit_id
  AND d.dirty_invalid_from IS NOT NULL
  AND p.as_of_date >= d.dirty_invalid_from
  AND (
    NOT p.pending_replacement
    OR p.stale_invalid_from IS NULL
    OR p.stale_invalid_from > d.dirty_invalid_from
  )`;

/** $1 unit, $2 cycle UUID. Refresh predecessor immediately before promotion. */
export const REFRESH_PREVIOUS_CYCLE_SQL = `
UPDATE app.saldo_pelanggan_source_cycle c
SET previous_source_cycle_id = (
  SELECT p.source_cycle_id
  FROM app.saldo_pelanggan_source_cycle p
  WHERE p.unit_id = $1::smallint
    AND p.status = 'complete'
    AND p.source_cycle_sequence < c.source_cycle_sequence
  ORDER BY p.source_cycle_sequence DESC
  LIMIT 1
)
WHERE c.unit_id = $1::smallint
  AND c.source_cycle_id = $2::uuid
  AND c.status = 'staging'
RETURNING c.previous_source_cycle_id`;

/** $1 unit, $2 cycle. Complete only when all three domain proofs exist. */
export const PROMOTE_SOURCE_CYCLE_SQL = `
UPDATE app.saldo_pelanggan_source_cycle
SET status = 'complete',
    source_completed_at = clock_timestamp(),
    promoted_at = clock_timestamp()
WHERE unit_id = $1::smallint
  AND source_cycle_id = $2::uuid
  AND status = 'staging'
  AND pelanggan_row_count IS NOT NULL
  AND pelanggan_keyed_checksum IS NOT NULL
  AND bppiut_row_count IS NOT NULL
  AND bppiut_keyed_checksum IS NOT NULL
  AND bphut_row_count IS NOT NULL
  AND bphut_keyed_checksum IS NOT NULL
  AND source_cycle_sequence > COALESCE((
    SELECT max(newer.source_cycle_sequence)
    FROM app.saldo_pelanggan_source_cycle newer
    WHERE newer.unit_id = $1::smallint AND newer.status = 'complete'
  ), 0)
RETURNING source_cycle_id, source_cycle_sequence`;

/** $1 unit, $2 cycle UUID. Preserve an audit row for an obsolete staged cut. */
export const FAIL_OBSOLETE_SOURCE_CYCLE_SQL = `
UPDATE app.saldo_pelanggan_source_cycle c
SET status = 'failed',
    failed_at = clock_timestamp(),
    failure_summary = 'superseded by a newer complete source cycle before promotion'
WHERE c.unit_id = $1::smallint
  AND c.source_cycle_id = $2::uuid
  AND c.status = 'staging'
  AND EXISTS (
    SELECT 1 FROM app.saldo_pelanggan_source_cycle newer
    WHERE newer.unit_id = c.unit_id
      AND newer.status = 'complete'
      AND newer.source_cycle_sequence > c.source_cycle_sequence
  )
RETURNING source_cycle_id`;

/** $1 unit, $2 winning sequence. Any older incomplete cut can no longer win. */
export const FAIL_SUPERSEDED_STAGING_CYCLES_SQL = `
UPDATE app.saldo_pelanggan_source_cycle
SET status = 'failed',
    failed_at = clock_timestamp(),
    failure_summary = 'superseded by a newer complete-input source cycle'
WHERE unit_id = $1::smallint
  AND status = 'staging'
  AND source_cycle_sequence < $2::bigint`;

/**
 * $1 unit. Preserve source-cycle audit metadata, but release bulky immutable
 * rows once a cut failed or an older complete cut has no active consumer.
 * The newest complete cut is retained as the predecessor for the next diff.
 */
const retiredSourceRowsPredicate = `
  AND c.unit_id = $1::smallint
  AND c.source_cycle_id = s.source_cycle_id
  AND (
    c.status = 'failed'
    OR (
      c.status = 'complete'
      AND c.source_cycle_sequence < COALESCE((
        SELECT max(latest.source_cycle_sequence)
        FROM app.saldo_pelanggan_source_cycle latest
        WHERE latest.unit_id = $1::smallint AND latest.status = 'complete'
      ), c.source_cycle_sequence)
      AND NOT EXISTS (
        SELECT 1 FROM app.saldo_pelanggan_snapshot_manifest m
        WHERE m.unit_id = c.unit_id
          AND m.source_cycle_id = c.source_cycle_id
          AND m.status = 'building'
      )
      AND NOT EXISTS (
        SELECT 1 FROM app.saldo_pelanggan_build_work w
        WHERE w.unit_id = c.unit_id
          AND w.source_cycle_id = c.source_cycle_id
          AND w.state IN ('queued', 'leased', 'retry_wait')
      )
      AND NOT EXISTS (
        SELECT 1 FROM app.saldo_pelanggan_dirty d
        WHERE d.unit_id = c.unit_id
          AND d.dirty_source_cycle_id = c.source_cycle_id
      )
    )
  )`;

export const PRUNE_RETIRED_SOURCE_ROWS_SQL = [
  `DELETE FROM app.saldo_pelanggan_source_pelanggan s
   USING app.saldo_pelanggan_source_cycle c
   WHERE s.unit_id = $1::smallint${retiredSourceRowsPredicate}`,
  `DELETE FROM app.saldo_pelanggan_source_bppiut s
   USING app.saldo_pelanggan_source_cycle c
   WHERE s.unit_id = $1::smallint${retiredSourceRowsPredicate}`,
  `DELETE FROM app.saldo_pelanggan_source_bphut s
   USING app.saldo_pelanggan_source_cycle c
   WHERE s.unit_id = $1::smallint${retiredSourceRowsPredicate}`,
] as const;

/** $1 unit. Retire unleased work before inserting the latest source cut. */
export const SUPERSEDE_PENDING_WORK_SQL = `
UPDATE app.saldo_pelanggan_build_work w
SET state = 'dead_letter',
    last_error = 'superseded_by_new_source_cut',
    completed_at = clock_timestamp(),
    updated_at = clock_timestamp()
WHERE w.unit_id = $1::smallint
  AND w.state IN ('queued', 'retry_wait')
  AND EXISTS (
    SELECT 1
    FROM app.saldo_pelanggan_snapshot_pointer p
    WHERE p.unit_id = w.unit_id
      AND p.as_of_date = w.as_of_date
      AND p.pending_replacement
  )`;

/** $1 unit, $2 new cycle, $3 sequence. */
export const ENQUEUE_STALE_POINTERS_SQL = `
WITH target_dates AS (
  SELECT p.unit_id, p.as_of_date
  FROM app.saldo_pelanggan_snapshot_pointer p
  WHERE p.unit_id = $1::smallint AND p.pending_replacement

  UNION ALL

  -- A first complete cut has no pointer to mark stale. Seed exactly the unit's
  -- current business date once; later cuts flow through the pointer branch.
  SELECT u.unit_id,
         (clock_timestamp() AT TIME ZONE u.timezone)::date AS as_of_date
  FROM public.unit u
  WHERE u.unit_id = $1::smallint
    AND NOT EXISTS (
      SELECT 1
      FROM app.saldo_pelanggan_snapshot_pointer p
      WHERE p.unit_id = u.unit_id
        AND p.as_of_date = (clock_timestamp() AT TIME ZONE u.timezone)::date
    )
)
INSERT INTO app.saldo_pelanggan_build_work (
  unit_id, work_id, as_of_date, source_cycle_id,
  source_cycle_sequence, source_cycle_status, rebuild_epoch, state
)
SELECT t.unit_id, gen_random_uuid(), t.as_of_date, $2::uuid,
       $3::bigint, 'complete', 0, 'queued'
FROM target_dates t
ON CONFLICT (unit_id, as_of_date, source_cycle_id, rebuild_epoch) DO NOTHING`;
