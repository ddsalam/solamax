import { SNAPSHOT_OPERATIONAL_LIMITS } from "./snapshot-config.js";

/** Durable single-item worker SQL. Values remain positional parameters. */

/** $1 unit, $2 lease owner. */
export const LEASE_WORK_SQL = `
WITH operational_gate AS (
  SELECT (extract(hour FROM clock_timestamp() AT TIME ZONE '${SNAPSHOT_OPERATIONAL_LIMITS.timezone}') * 60
          + extract(minute FROM clock_timestamp() AT TIME ZONE '${SNAPSHOT_OPERATIONAL_LIMITS.timezone}'))::int
           AS wib_minutes,
         pg_database_size(current_database())::bigint AS database_bytes
), candidate AS (
  SELECT w.unit_id, w.work_id
  FROM app.saldo_pelanggan_build_work w
  CROSS JOIN operational_gate g
  WHERE w.unit_id = $1::smallint
    AND w.state IN ('queued', 'retry_wait')
    AND w.available_at <= clock_timestamp()
    AND g.wib_minutes >= ${SNAPSHOT_OPERATIONAL_LIMITS.buildWindowStartMinutes}
    AND g.wib_minutes < ${SNAPSHOT_OPERATIONAL_LIMITS.latestLeaseMinutes}
    AND g.database_bytes < ${SNAPSHOT_OPERATIONAL_LIMITS.databaseReviewBytes}
  ORDER BY w.as_of_date, w.created_at
  LIMIT 1
  FOR UPDATE OF w SKIP LOCKED
)
UPDATE app.saldo_pelanggan_build_work w
SET state = 'leased',
    attempt_count = attempt_count + 1,
    lease_owner = $2::text,
    lease_expires_at = clock_timestamp() + interval '${SNAPSHOT_OPERATIONAL_LIMITS.leaseSeconds} seconds',
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
    lease_expires_at = clock_timestamp() + interval '${SNAPSHOT_OPERATIONAL_LIMITS.leaseSeconds} seconds',
    updated_at = clock_timestamp()
WHERE unit_id = $1::smallint
  AND work_id = $2::uuid
  AND lease_owner = $3::text
  AND state = 'leased'
  AND lease_expires_at >= clock_timestamp()
RETURNING work_id`;

/** Fail target and previous-month baseline generations owned by an expired attempt. */
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
  AND m.unit_id = w.unit_id
  AND m.as_of_date IN (
    w.as_of_date,
    (date_trunc('month', w.as_of_date)::date - 1)
  )
  AND m.source_cycle_id = w.source_cycle_id
  AND m.source_cycle_sequence = w.source_cycle_sequence
  AND m.rebuild_epoch = w.rebuild_epoch
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
  AND m.started_at < clock_timestamp() - interval '${SNAPSHOT_OPERATIONAL_LIMITS.attemptSeconds} seconds'
  AND NOT EXISTS (
    SELECT 1 FROM app.saldo_pelanggan_build_work w
    WHERE w.unit_id = m.unit_id AND w.state = 'leased'
  )
RETURNING m.generation_id`;

/** $1 unit. */
export const REAP_EXPIRED_WORK_SQL = `
WITH decision AS (
  SELECT w.unit_id,
         w.work_id,
         w.attempt_count >= ${SNAPSHOT_OPERATIONAL_LIMITS.maxAttempts} AS exhausted,
         EXISTS (
           SELECT 1
           FROM app.saldo_pelanggan_build_work successor
           WHERE successor.unit_id = w.unit_id
             AND successor.as_of_date = w.as_of_date
             AND successor.work_id <> w.work_id
             AND successor.state IN ('queued', 'retry_wait')
         ) AS has_successor
  FROM app.saldo_pelanggan_build_work w
  WHERE w.unit_id = $1::smallint
    AND w.state = 'leased'
    AND w.lease_expires_at < clock_timestamp()
  FOR UPDATE OF w
)
UPDATE app.saldo_pelanggan_build_work w
SET state = CASE WHEN d.exhausted OR d.has_successor THEN 'dead_letter' ELSE 'retry_wait' END,
    available_at = CASE WHEN d.exhausted OR d.has_successor THEN w.available_at ELSE
      clock_timestamp() + make_interval(secs => ceil(
        LEAST(${SNAPSHOT_OPERATIONAL_LIMITS.retryInitialSeconds} * power(2, GREATEST(w.attempt_count - 1, 0)), ${SNAPSHOT_OPERATIONAL_LIMITS.attemptSeconds})
        * (1 + random() * ${SNAPSHOT_OPERATIONAL_LIMITS.retryJitterFraction})
      )::int) END,
    lease_owner = NULL,
    lease_expires_at = NULL,
    heartbeat_at = NULL,
    last_error = CASE WHEN d.has_successor THEN 'superseded_by_pending_successor' ELSE 'lease_expired' END,
    updated_at = clock_timestamp(),
    completed_at = CASE WHEN d.exhausted OR d.has_successor THEN clock_timestamp() ELSE NULL END
FROM decision d
WHERE w.unit_id = d.unit_id
  AND w.work_id = d.work_id
RETURNING w.work_id, w.state`;

/** $1 unit, $2 work, $3 owner, $4 error, $5 retryable. */
export const RETRY_WORK_SQL = `
WITH decision AS (
  SELECT w.unit_id,
         w.work_id,
         w.attempt_count >= ${SNAPSHOT_OPERATIONAL_LIMITS.maxAttempts} AS exhausted,
         EXISTS (
           SELECT 1
           FROM app.saldo_pelanggan_build_work successor
           WHERE successor.unit_id = w.unit_id
             AND successor.as_of_date = w.as_of_date
             AND successor.work_id <> w.work_id
             AND successor.state IN ('queued', 'retry_wait')
         ) AS has_successor
  FROM app.saldo_pelanggan_build_work w
  WHERE w.unit_id = $1::smallint
    AND w.work_id = $2::uuid
    AND w.lease_owner = $3::text
    AND w.state = 'leased'
  FOR UPDATE OF w
)
UPDATE app.saldo_pelanggan_build_work w
SET state = CASE WHEN d.exhausted OR d.has_successor OR NOT $5::boolean THEN 'dead_letter' ELSE 'retry_wait' END,
    available_at = CASE WHEN d.exhausted OR d.has_successor OR NOT $5::boolean THEN w.available_at ELSE
      clock_timestamp() + make_interval(secs => ceil(
        LEAST(${SNAPSHOT_OPERATIONAL_LIMITS.retryInitialSeconds} * power(2, GREATEST(w.attempt_count - 1, 0)), ${SNAPSHOT_OPERATIONAL_LIMITS.attemptSeconds})
        * (1 + random() * ${SNAPSHOT_OPERATIONAL_LIMITS.retryJitterFraction})
      )::int) END,
    lease_owner = NULL,
    lease_expires_at = NULL,
    heartbeat_at = NULL,
    last_error = CASE WHEN d.has_successor THEN 'superseded_by_pending_successor' ELSE left($4::text, 2000) END,
    updated_at = clock_timestamp(),
    completed_at = CASE WHEN d.exhausted OR d.has_successor OR NOT $5::boolean THEN clock_timestamp() ELSE NULL END
FROM decision d
WHERE w.unit_id = d.unit_id
  AND w.work_id = d.work_id
RETURNING w.work_id, w.state`;
