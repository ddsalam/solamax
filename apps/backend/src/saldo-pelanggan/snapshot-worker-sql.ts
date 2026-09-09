/** Durable single-item worker SQL. Values remain positional parameters. */

/** $1 unit, $2 lease owner. */
export const LEASE_WORK_SQL = `
WITH operational_gate AS (
  SELECT (extract(hour FROM clock_timestamp() AT TIME ZONE 'Asia/Pontianak') * 60
          + extract(minute FROM clock_timestamp() AT TIME ZONE 'Asia/Pontianak'))::int
           AS wib_minutes,
         pg_database_size(current_database())::bigint AS database_bytes
), candidate AS (
  SELECT w.unit_id, w.work_id
  FROM app.saldo_pelanggan_build_work w
  CROSS JOIN operational_gate g
  WHERE w.unit_id = $1::smallint
    AND w.state IN ('queued', 'retry_wait')
    AND w.available_at <= clock_timestamp()
    AND g.wib_minutes >= 120
    AND g.wib_minutes < 285
    AND pg_database_size(current_database()) < 9000000000
  ORDER BY w.as_of_date, w.created_at
  LIMIT 1
  FOR UPDATE OF w SKIP LOCKED
)
UPDATE app.saldo_pelanggan_build_work w
SET state = 'leased',
    attempt_count = attempt_count + 1,
    lease_owner = $2::text,
    lease_expires_at = clock_timestamp() + interval '120 seconds',
    heartbeat_at = clock_timestamp(),
    last_error = NULL,
    updated_at = clock_timestamp()
FROM candidate c
WHERE w.unit_id = c.unit_id AND w.work_id = c.work_id
RETURNING w.unit_id, w.work_id, w.as_of_date, w.source_cycle_id,
          w.source_cycle_sequence, w.rebuild_epoch, w.attempt_count`;

/** $1 unit, $2 work id, $3 owner. */
export const HEARTBEAT_WORK_SQL = `
UPDATE app.saldo_pelanggan_build_work
SET heartbeat_at = clock_timestamp(),
    lease_expires_at = clock_timestamp() + interval '120 seconds',
    updated_at = clock_timestamp()
WHERE unit_id = $1::smallint
  AND work_id = $2::uuid
  AND lease_owner = $3::text
  AND state = 'leased'
RETURNING work_id`;

/** Fail the generation bound to an expired lease before making it retryable. */
export const FAIL_EXPIRED_MANIFEST_SQL = `
UPDATE app.saldo_pelanggan_snapshot_manifest m
SET status = 'failed',
    completed_at = clock_timestamp(),
    failure_code = 'lease_expired',
    failure_summary = 'builder lease expired before atomic publication',
    retryable = true
FROM app.saldo_pelanggan_build_work w
WHERE w.unit_id = $1::smallint
  AND w.state = 'leased'
  AND w.lease_expires_at < clock_timestamp()
  AND w.generation_id IS NOT NULL
  AND m.unit_id = w.unit_id
  AND m.as_of_date = w.as_of_date
  AND m.generation_id = w.generation_id
  AND m.status = 'building'
RETURNING m.generation_id`;

/** An unbound baseline can be reaped only while the unit has no active lease. */
export const FAIL_ORPHAN_MANIFEST_SQL = `
UPDATE app.saldo_pelanggan_snapshot_manifest m
SET status = 'failed',
    completed_at = clock_timestamp(),
    failure_code = 'attempt_expired',
    failure_summary = 'unbound baseline exceeded the 15 minute attempt budget',
    retryable = true
WHERE m.unit_id = $1::smallint
  AND m.status = 'building'
  AND m.started_at < clock_timestamp() - interval '900 seconds'
  AND NOT EXISTS (
    SELECT 1 FROM app.saldo_pelanggan_build_work w
    WHERE w.unit_id = m.unit_id AND w.state = 'leased'
  )
RETURNING m.generation_id`;

/** $1 unit. */
export const REAP_EXPIRED_WORK_SQL = `
UPDATE app.saldo_pelanggan_build_work
SET state = CASE WHEN attempt_count >= 5 THEN 'dead_letter' ELSE 'retry_wait' END,
    available_at = CASE WHEN attempt_count >= 5 THEN available_at ELSE
      clock_timestamp() + make_interval(secs => ceil(
        LEAST(30 * power(2, GREATEST(attempt_count - 1, 0)), 900)
        * (1 + random() * 0.25)
      )::int) END,
    lease_owner = NULL,
    lease_expires_at = NULL,
    heartbeat_at = NULL,
    last_error = 'lease_expired',
    updated_at = clock_timestamp(),
    completed_at = CASE WHEN attempt_count >= 5 THEN clock_timestamp() ELSE NULL END
WHERE unit_id = $1::smallint
  AND state = 'leased'
  AND lease_expires_at < clock_timestamp()
RETURNING work_id, state`;

/** $1 unit, $2 work, $3 owner, $4 error. */
export const RETRY_WORK_SQL = `
UPDATE app.saldo_pelanggan_build_work
SET state = CASE WHEN attempt_count >= 5 THEN 'dead_letter' ELSE 'retry_wait' END,
    available_at = CASE WHEN attempt_count >= 5 THEN available_at ELSE
      clock_timestamp() + make_interval(secs => ceil(
        LEAST(30 * power(2, GREATEST(attempt_count - 1, 0)), 900)
        * (1 + random() * 0.25)
      )::int) END,
    lease_owner = NULL,
    lease_expires_at = NULL,
    heartbeat_at = NULL,
    last_error = left($4::text, 2000),
    updated_at = clock_timestamp(),
    completed_at = CASE WHEN attempt_count >= 5 THEN clock_timestamp() ELSE NULL END
WHERE unit_id = $1::smallint
  AND work_id = $2::uuid
  AND lease_owner = $3::text
  AND state = 'leased'
RETURNING work_id, state`;
