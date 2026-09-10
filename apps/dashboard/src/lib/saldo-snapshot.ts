import { qScoped } from "./db";
import type { ScopedUnitId } from "./scope-rule";

export interface SaldoTrio {
  /** Piutang Lokal pada batas yang disebut pemilik objek (`awal` atau `akhir`). */
  piutangLokal: number;
  /** Piutang Online pada batas yang disebut pemilik objek; tidak dinetokan ke Lokal. */
  piutangOnline: number;
  /** Hutang Lokal pada batas yang disebut pemilik objek; tidak dinetokan ke piutang. */
  hutangLokal: number;
}

export interface SaldoPelanggan {
  /** Saldo awal hari: seluruh posting dengan tanggal `< D`. */
  awal: SaldoTrio;
  /** Saldo akhir hari: seluruh posting dengan tanggal `<= D`. */
  akhir: SaldoTrio;
}

export interface SaldoSnapshotRow {
  customerCode: string;
  customerName: string | null;
  awalPiutangLokal: number;
  akhirPiutangLokal: number;
  awalPiutangOnline: number;
  akhirPiutangOnline: number;
  awalHutangLokal: number;
  akhirHutangLokal: number;
}

export interface SaldoSnapshotMetadata {
  generationId: string;
  rowCount: number;
  formulaVersion: string;
  computedAt: string;
  sourceCycleId: string;
  sourceCompletedAt: string;
  pendingReplacement: boolean;
  staleInvalidFrom: string | null;
  totals: SaldoPelanggan;
}

export interface SaldoSnapshotAttempt {
  status: "building" | "complete" | "failed";
  attemptedAt: string;
  failureSummary: string | null;
}

export type SaldoSnapshotNotReadyReason =
  | "no_published_snapshot"
  | "building_snapshot"
  | "failed_snapshot"
  | "incomplete_snapshot";

export type SaldoSnapshot =
  | {
      status: "not_ready";
      asOfDate: string;
      reason: SaldoSnapshotNotReadyReason;
      /** Present when a manifest attempt exists; omitted for no-cut/integrity-only states. */
      latestAttempt?: SaldoSnapshotAttempt | null;
    }
  | {
      status: "ready";
      asOfDate: string;
      metadata: SaldoSnapshotMetadata;
      rows: SaldoSnapshotRow[];
      hasOnlineCustomer: boolean;
      /** Latest replacement attempt; explanatory only while the active pointer remains readable. */
      latestAttempt?: SaldoSnapshotAttempt | null;
    };

/** Pointer-first: only the published, validated immutable generation may be read. */
export const READ_SALDO_SNAPSHOT_POINTER_SQL = `
SELECT p.generation_id::text AS "generationId",
       m.row_count::float8 AS "rowCount",
       m.formula_version AS "formulaVersion",
       to_char(m.computed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "computedAt",
       m.source_cycle_id::text AS "sourceCycleId",
       to_char(m.source_completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "sourceCompletedAt",
       p.pending_replacement AS "pendingReplacement",
       to_char(p.stale_invalid_from, 'YYYY-MM-DD') AS "staleInvalidFrom",
       m.awal_piutang_lokal_total::float8 AS "awalPiutangLokal",
       m.akhir_piutang_lokal_total::float8 AS "akhirPiutangLokal",
       m.awal_piutang_online_total::float8 AS "awalPiutangOnline",
       m.akhir_piutang_online_total::float8 AS "akhirPiutangOnline",
       m.awal_hutang_lokal_total::float8 AS "awalHutangLokal",
       m.akhir_hutang_lokal_total::float8 AS "akhirHutangLokal"
FROM app.saldo_pelanggan_snapshot_pointer p
JOIN app.saldo_pelanggan_snapshot_manifest m
  ON m.unit_id = p.unit_id
 AND m.as_of_date = p.as_of_date
 AND m.generation_id = p.generation_id
 AND m.status = 'complete'
 AND m.published
 AND m.validation_passed
WHERE p.unit_id = $1::smallint AND p.as_of_date = $2::date`;

/** Latest build evidence is explanatory only; it can never make numeric rows readable. */
export const READ_SALDO_SNAPSHOT_READINESS_SQL = `
SELECT m.status,
       to_char(COALESCE(m.completed_at, m.started_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "attemptedAt",
       m.failure_summary AS "failureSummary"
FROM app.saldo_pelanggan_snapshot_manifest m
WHERE m.unit_id = $1::smallint AND m.as_of_date = $2::date
ORDER BY m.source_cycle_sequence DESC,
         m.rebuild_epoch DESC,
         m.started_at DESC,
         m.generation_id DESC
LIMIT 1`;

/** Exact generation rows only; the live master is labels-only and never numeric input. */
export const READ_SALDO_SNAPSHOT_ROWS_SQL = `
WITH candidate AS (
  SELECT m.generation_id, m.row_count, m.row_keyed_checksum,
         m.awal_piutang_lokal_total, m.akhir_piutang_lokal_total,
         m.awal_piutang_online_total, m.akhir_piutang_online_total,
         m.awal_hutang_lokal_total, m.akhir_hutang_lokal_total
  FROM app.saldo_pelanggan_snapshot_manifest m
  WHERE m.unit_id = $1::smallint AND m.as_of_date = $2::date AND m.generation_id = $3::uuid
    AND m.status = 'complete' AND m.published AND m.validation_passed
), snapshot_rows AS MATERIALIZED (
  SELECT unit_id, as_of_date, generation_id, customer_code,
         awal_piutang_lokal, akhir_piutang_lokal,
         awal_piutang_online, akhir_piutang_online,
         awal_hutang_lokal, akhir_hutang_lokal
  FROM app.saldo_pelanggan_snapshot_row
  WHERE unit_id = $1::smallint
    AND as_of_date = $2::date
    AND generation_id = $3::uuid
), actual AS (
  SELECT c.generation_id,
         count(r.generation_id)::bigint AS row_count,
         sha256(convert_to(COALESCE(string_agg(
           concat_ws('|', r.unit_id::text, r.as_of_date::text, r.customer_code,
             r.awal_piutang_lokal::text, r.akhir_piutang_lokal::text,
             r.awal_piutang_online::text, r.akhir_piutang_online::text,
             r.awal_hutang_lokal::text, r.akhir_hutang_lokal::text),
           E'\\n' ORDER BY r.customer_code
         ), ''), 'UTF8')) AS row_keyed_checksum,
         COALESCE(sum(r.awal_piutang_lokal), 0) AS awal_piutang_lokal_total,
         COALESCE(sum(r.akhir_piutang_lokal), 0) AS akhir_piutang_lokal_total,
         COALESCE(sum(r.awal_piutang_online), 0) AS awal_piutang_online_total,
         COALESCE(sum(r.akhir_piutang_online), 0) AS akhir_piutang_online_total,
         COALESCE(sum(r.awal_hutang_lokal), 0) AS awal_hutang_lokal_total,
         COALESCE(sum(r.akhir_hutang_lokal), 0) AS akhir_hutang_lokal_total
  FROM candidate c
  LEFT JOIN snapshot_rows r ON r.generation_id = c.generation_id
  GROUP BY c.generation_id
), verified AS (
  SELECT c.generation_id
  FROM candidate c JOIN actual a USING (generation_id)
  WHERE c.row_count = a.row_count AND c.row_keyed_checksum = a.row_keyed_checksum
    AND c.awal_piutang_lokal_total = a.awal_piutang_lokal_total
    AND c.akhir_piutang_lokal_total = a.akhir_piutang_lokal_total
    AND c.awal_piutang_online_total = a.awal_piutang_online_total
    AND c.akhir_piutang_online_total = a.akhir_piutang_online_total
    AND c.awal_hutang_lokal_total = a.awal_hutang_lokal_total
    AND c.akhir_hutang_lokal_total = a.akhir_hutang_lokal_total
)
SELECT true AS "integrityVerified",
       NULL::text AS "customerCode",
       NULL::text AS "customerName",
       NULL::float8 AS "awalPiutangLokal",
       NULL::float8 AS "akhirPiutangLokal",
       NULL::float8 AS "awalPiutangOnline",
       NULL::float8 AS "akhirPiutangOnline",
       NULL::float8 AS "awalHutangLokal",
       NULL::float8 AS "akhirHutangLokal"
FROM verified
UNION ALL
SELECT false AS "integrityVerified",
       btrim(r.customer_code) AS "customerCode",
       p.vcnmplg AS "customerName",
       r.awal_piutang_lokal::float8 AS "awalPiutangLokal",
       r.akhir_piutang_lokal::float8 AS "akhirPiutangLokal",
       r.awal_piutang_online::float8 AS "awalPiutangOnline",
       r.akhir_piutang_online::float8 AS "akhirPiutangOnline",
       r.awal_hutang_lokal::float8 AS "awalHutangLokal",
       r.akhir_hutang_lokal::float8 AS "akhirHutangLokal"
FROM verified v
JOIN snapshot_rows r ON r.generation_id = v.generation_id
LEFT JOIN (
  SELECT btrim(ckdplg) AS customer_code, max(vcnmplg) AS vcnmplg
  FROM public.pelanggan_master p
  WHERE unit_id = $1::smallint
    AND EXISTS (
      SELECT 1 FROM snapshot_rows candidate_row
      WHERE candidate_row.generation_id = $3::uuid
        AND btrim(candidate_row.customer_code) = btrim(p.ckdplg)
    )
  GROUP BY btrim(ckdplg)
) p ON p.customer_code = btrim(r.customer_code)
WHERE r.unit_id = $1::smallint AND r.as_of_date = $2::date AND r.generation_id = $3::uuid
ORDER BY "integrityVerified" DESC, "customerCode"`;

export interface SaldoSnapshotPointer extends Omit<SaldoSnapshotMetadata, "totals"> {
  awalPiutangLokal: number;
  akhirPiutangLokal: number;
  awalPiutangOnline: number;
  akhirPiutangOnline: number;
  awalHutangLokal: number;
  akhirHutangLokal: number;
}

export function saldoFromSnapshotTotals(row: Pick<SaldoSnapshotPointer,
  "awalPiutangLokal" | "akhirPiutangLokal" | "awalPiutangOnline" | "akhirPiutangOnline" | "awalHutangLokal" | "akhirHutangLokal"
>): SaldoPelanggan {
  return {
    awal: { piutangLokal: row.awalPiutangLokal, piutangOnline: row.awalPiutangOnline, hutangLokal: row.awalHutangLokal },
    akhir: { piutangLokal: row.akhirPiutangLokal, piutangOnline: row.akhirPiutangOnline, hutangLokal: row.akhirHutangLokal },
  };
}

interface IntegritySentinel {
  integrityVerified: true;
  customerCode: null;
  customerName: null;
  awalPiutangLokal: null;
  akhirPiutangLokal: null;
  awalPiutangOnline: null;
  akhirPiutangOnline: null;
  awalHutangLokal: null;
  akhirHutangLokal: null;
}

type IntegrityDataRow = SaldoSnapshotRow & { integrityVerified: false };
type IntegrityRow = IntegritySentinel | IntegrityDataRow;

/** Pointer stage, independently reusable by cache orchestration. */
export async function getSaldoSnapshotPointer(
  unit: ScopedUnitId,
  asOfDate: string,
): Promise<SaldoSnapshotPointer | null> {
  const rows = await qScoped<SaldoSnapshotPointer>(unit, READ_SALDO_SNAPSHOT_POINTER_SQL, [unit, asOfDate]);
  return rows[0] ?? null;
}

/** Read-only explanation for a missing published pointer. */
export async function getSaldoSnapshotLatestAttempt(
  unit: ScopedUnitId,
  asOfDate: string,
): Promise<SaldoSnapshotAttempt | null> {
  const rows = await qScoped<SaldoSnapshotAttempt>(unit, READ_SALDO_SNAPSHOT_READINESS_SQL, [unit, asOfDate]);
  return rows[0] ?? null;
}

/** Exact immutable generation stage; `not_ready` means an integrity proof failed. */
export async function getSaldoSnapshotGeneration(
  unit: ScopedUnitId,
  asOfDate: string,
  pointer: SaldoSnapshotPointer,
): Promise<
  | { status: "ready"; rows: SaldoSnapshotRow[]; hasOnlineCustomer: boolean }
  | { status: "not_ready"; reason: "incomplete_snapshot" }
> {
  const result = await qScoped<IntegrityRow>(unit, READ_SALDO_SNAPSHOT_ROWS_SQL, [unit, asOfDate, pointer.generationId]);
  let integrityVerified = false;
  let hasOnlineCustomer = false;
  const rows: SaldoSnapshotRow[] = [];
  for (const row of result) {
    if (row.integrityVerified) {
      integrityVerified = true;
      continue;
    }
    const { integrityVerified: _integrityVerified, ...snapshotRow } = row;
    rows.push(snapshotRow);
    hasOnlineCustomer ||= snapshotRow.customerCode.includes(".");
  }
  if (!integrityVerified) return { status: "not_ready", reason: "incomplete_snapshot" };
  if (rows.length !== pointer.rowCount) return { status: "not_ready", reason: "incomplete_snapshot" };
  return { status: "ready", rows, hasOnlineCustomer };
}

type ReadyGeneration = Extract<
  Awaited<ReturnType<typeof getSaldoSnapshotGeneration>>,
  { status: "ready" }
>;

/** One assembler keeps direct and cached readers on the same public contract. */
export function assembleReadySaldoSnapshot(
  asOfDate: string,
  pointer: SaldoSnapshotPointer,
  generation: ReadyGeneration,
  latestAttempt?: SaldoSnapshotAttempt | null,
): Extract<SaldoSnapshot, { status: "ready" }> {
  const {
    awalPiutangLokal,
    akhirPiutangLokal,
    awalPiutangOnline,
    akhirPiutangOnline,
    awalHutangLokal,
    akhirHutangLokal,
    ...metadata
  } = pointer;
  return {
    status: "ready",
    asOfDate,
    metadata: {
      ...metadata,
      totals: saldoFromSnapshotTotals({
        awalPiutangLokal,
        akhirPiutangLokal,
        awalPiutangOnline,
        akhirPiutangOnline,
        awalHutangLokal,
        akhirHutangLokal,
      }),
    },
    rows: generation.rows,
    hasOnlineCustomer: generation.hasOnlineCustomer,
    ...(latestAttempt === undefined ? {} : { latestAttempt }),
  };
}

export async function getSaldoSnapshot(unit: ScopedUnitId, asOfDate: string): Promise<SaldoSnapshot> {
  const pointer = await getSaldoSnapshotPointer(unit, asOfDate);
  if (!pointer) {
    const latestAttempt = await getSaldoSnapshotLatestAttempt(unit, asOfDate);
    if (!latestAttempt) return { status: "not_ready", asOfDate, reason: "no_published_snapshot" };
    const reason: SaldoSnapshotNotReadyReason = latestAttempt.status === "building"
      ? "building_snapshot"
      : latestAttempt.status === "failed"
        ? "failed_snapshot"
        : latestAttempt.status === "complete"
          ? "incomplete_snapshot"
          : "no_published_snapshot";
    return { status: "not_ready", asOfDate, reason, latestAttempt };
  }

  const generationPromise = getSaldoSnapshotGeneration(unit, asOfDate, pointer);
  const latestAttemptPromise = pointer.pendingReplacement
    ? getSaldoSnapshotLatestAttempt(unit, asOfDate)
    : Promise.resolve(undefined);
  const [generation, latestAttempt] = await Promise.all([generationPromise, latestAttemptPromise]);
  if (generation.status === "not_ready") {
    // Publication and retirement can land between the pointer and generation
    // reads. Follow one changed pointer, but never weaken exact-generation
    // integrity and never retry the same failed generation.
    const refreshedPointer = await getSaldoSnapshotPointer(unit, asOfDate);
    if (!refreshedPointer || refreshedPointer.generationId === pointer.generationId) {
      return { status: "not_ready", asOfDate, reason: generation.reason };
    }
    const refreshedGeneration = await getSaldoSnapshotGeneration(unit, asOfDate, refreshedPointer);
    if (refreshedGeneration.status === "not_ready") {
      return { status: "not_ready", asOfDate, reason: refreshedGeneration.reason };
    }
    const refreshedAttempt = refreshedPointer.pendingReplacement
      ? await getSaldoSnapshotLatestAttempt(unit, asOfDate)
      : undefined;
    return assembleReadySaldoSnapshot(asOfDate, refreshedPointer, refreshedGeneration, refreshedAttempt);
  }
  return assembleReadySaldoSnapshot(asOfDate, pointer, generation, latestAttempt);
}
