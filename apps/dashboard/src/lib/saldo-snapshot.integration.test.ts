import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import {
  COMPLETE_MANIFEST_SQL,
  INSERT_BUILDING_MANIFEST_SQL,
  MATERIALIZE_FULL_HISTORY_SQL,
  UPSERT_POINTER_SQL,
  VALIDATE_GENERATION_SQL,
} from "../../../backend/src/saldo-pelanggan/snapshot-sql";
import { SNAPSHOT_FORMULA_VERSION } from "../../../backend/src/saldo-pelanggan/snapshot-config";
import type { ScopedUnitId } from "./scope-rule";
import type { SaldoSnapshot, SaldoSnapshotRow } from "./saldo-snapshot";
import { PENULIS, ukur } from "./ukur-kueri";

/**
 * B4 release proof: a self-seeding, synthetic-only exercise of the public
 * `getSaldoSnapshot` -> `qScoped` path as the real non-superuser dashboard role.
 *
 * It is deliberately opt-in because it needs the local Cloud SQL Auth Proxy:
 *   SNAPSHOT_B4_LIVE_DB=1
 *   DATABASE_URL=<dashboard_app URL>
 *   SNAPSHOT_B4_SEED_URL=<ingest URL>
 *
 * The identity/system-id/size/migration gate runs before the first write. All
 * fixture units are random negative SMALLINTs and cleanup is fail-closed.
 */
const LIVE =
  process.env.SNAPSHOT_B4_LIVE_DB === "1" &&
  !!process.env.DATABASE_URL &&
  !!process.env.SNAPSHOT_B4_SEED_URL;
const describeLive = LIVE ? describe.sequential : describe.skip;

type MasterRow = { code: string; name: string; sjenis: number };
type LedgerRow = {
  key: string;
  date: string;
  customer: string;
  amount: string;
  type: number;
  cancelled: number | null;
};
type Cut = { master: MasterRow[]; piut: LedgerRow[]; hut: LedgerRow[] };

const MASTER_A: MasterRow[] = [
  { code: "L1", name: "Local One", sjenis: 1 },
  { code: "L5", name: "Local Five", sjenis: 5 },
  { code: "N3", name: "Nondotted Three", sjenis: 3 },
  { code: "N4", name: "Nondotted Four", sjenis: 4 },
  { code: "01.000.0003", name: "Online Three", sjenis: 3 },
  { code: "01.000.0004", name: "Online Four", sjenis: 4 },
  { code: "01.000.0001", name: "Online One", sjenis: 1 },
  { code: "ZERO", name: "Zero Balance", sjenis: 5 },
  { code: "CANCEL", name: "Cancelled Only", sjenis: 1 },
];

const PIUT_C1: LedgerRow[] = [
  { key: "P01", date: "2026-01-30", customer: "L1", amount: "100.00", type: 1, cancelled: 0 },
  { key: "P02", date: "2026-01-31", customer: "L1", amount: "20.00", type: 2, cancelled: 0 },
  { key: "P03", date: "2026-02-01", customer: "L1", amount: "10.00", type: 1, cancelled: 0 },
  { key: "P04", date: "2026-02-15", customer: "L1", amount: "5.50", type: 2, cancelled: 0 },
  { key: "P05", date: "2026-02-28", customer: "L1", amount: "0.10", type: 1, cancelled: 0 },
  { key: "P06", date: "2026-02-28", customer: "L1", amount: "0.20", type: 1, cancelled: 0 },
  { key: "P07", date: "2026-01-31", customer: "L5", amount: "50.00", type: 1, cancelled: null },
  { key: "P08", date: "2026-02-01", customer: "L5", amount: "8.00", type: 2, cancelled: 0 },
  { key: "P09", date: "2026-01-31", customer: "N3", amount: "900.00", type: 1, cancelled: 0 },
  { key: "P10", date: "2026-01-31", customer: "N4", amount: "800.00", type: 1, cancelled: 0 },
  { key: "P11", date: "2026-01-31", customer: "01.000.0003", amount: "200.00", type: 1, cancelled: 0 },
  { key: "P12", date: "2026-02-01", customer: "01.000.0003", amount: "25.00", type: 2, cancelled: 0 },
  { key: "P13", date: "2026-02-15", customer: "01.000.0003", amount: "2.25", type: 1, cancelled: 0 },
  { key: "P14", date: "2026-01-31", customer: "01.000.0004", amount: "300.00", type: 1, cancelled: 0 },
  { key: "P15", date: "2026-02-01", customer: "01.000.0004", amount: "7.00", type: 1, cancelled: 0 },
  { key: "P16", date: "2026-01-31", customer: "01.000.0001", amount: "400.00", type: 1, cancelled: 0 },
  { key: "P17", date: "2026-02-01", customer: "01.000.0001", amount: "40.00", type: 2, cancelled: 0 },
  { key: "P18", date: "2026-01-31", customer: "99.000.0001", amount: "33.00", type: 1, cancelled: 0 },
  { key: "P19", date: "2026-02-01", customer: "99.000.0001", amount: "3.00", type: 2, cancelled: 0 },
  { key: "P20", date: "2026-01-31", customer: "ORPHAN-ND", amount: "44.00", type: 1, cancelled: 0 },
  { key: "P21", date: "2026-02-01", customer: "CANCEL", amount: "999.00", type: 1, cancelled: 1 },
  { key: "P22", date: "2026-01-31", customer: "88.000.0001", amount: "25.00", type: 1, cancelled: 0 },
];

const HUT_A: LedgerRow[] = [
  { key: "H01", date: "2026-01-31", customer: "L1", amount: "60.00", type: 1, cancelled: 0 },
  { key: "H02", date: "2026-02-01", customer: "L1", amount: "10.00", type: 2, cancelled: 0 },
  { key: "H03", date: "2026-02-15", customer: "L1", amount: "4.00", type: 1, cancelled: 0 },
  { key: "H04", date: "2026-01-31", customer: "HUT-ONLY", amount: "70.00", type: 1, cancelled: 0 },
  { key: "H05", date: "2026-02-01", customer: "HUT-ONLY", amount: "5.00", type: 2, cancelled: 0 },
  { key: "H06", date: "2026-02-01", customer: "CANCEL", amount: "777.00", type: 1, cancelled: 1 },
  { key: "H07", date: "2026-01-31", customer: "N4", amount: "12.00", type: 1, cancelled: 0 },
];

const PIUT_C2 = PIUT_C1.map((row) => row.key === "P01"
  ? { ...row, amount: "130.00" }
  : row.key === "P02" ? { ...row, cancelled: 1 } : { ...row });
const PIUT_C3 = PIUT_C2.filter((row) => row.key !== "P22");

const CUT_A_C1: Cut = { master: MASTER_A, piut: PIUT_C1, hut: HUT_A };
const CUT_A_C2: Cut = { master: MASTER_A, piut: PIUT_C2, hut: HUT_A };
const CUT_A_C3: Cut = { master: MASTER_A, piut: PIUT_C3, hut: HUT_A };
const CUT_B_C1: Cut = {
  master: [
    { code: "AS-L1", name: "AS Local", sjenis: 1 },
    { code: "AS-N3", name: "AS Nondotted Three", sjenis: 3 },
    { code: "AS-ZERO", name: "AS Zero", sjenis: 5 },
  ],
  piut: [
    { key: "BP01", date: "2026-01-31", customer: "AS-L1", amount: "12", type: 1, cancelled: 0 },
    { key: "BP02", date: "2026-02-01", customer: "AS-L1", amount: "2", type: 2, cancelled: 0 },
    { key: "BP03", date: "2026-01-31", customer: "AS-N3", amount: "50", type: 1, cancelled: 0 },
    { key: "BP04", date: "2026-02-01", customer: "AS-ZERO", amount: "999", type: 1, cancelled: 1 },
  ],
  hut: [
    { key: "BH01", date: "2026-02-01", customer: "AS-N3", amount: "9", type: 1, cancelled: 0 },
  ],
};
const EMPTY_CUT: Cut = { master: [], piut: [], hut: [] };

const ORACLE_ROWS_SQL = `
WITH customer_keys AS (
  SELECT btrim(ckdplg) AS customer_code
  FROM public.pelanggan_master WHERE unit_id = $1::smallint
  UNION
  SELECT btrim(ckdplg) FROM public.bppiut
  WHERE unit_id = $1::smallint AND COALESCE(sbatal, 0) = 0 AND dtgl <= $2::date
  UNION
  SELECT btrim(ckdplg) FROM public.bphut
  WHERE unit_id = $1::smallint AND COALESCE(sbatal, 0) = 0 AND dtgl <= $2::date
), local_keys AS (
  SELECT btrim(ckdplg) AS customer_code
  FROM public.pelanggan_master
  WHERE unit_id = $1::smallint AND sjenis IN (1, 5)
), piut AS (
  SELECT btrim(b.ckdplg) AS customer_code,
    COALESCE(sum(b.njumlah * CASE b.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END)
      FILTER (WHERE l.customer_code IS NOT NULL
        AND position('.' in btrim(b.ckdplg)) = 0 AND b.dtgl < $2::date), 0)
      AS awal_piutang_lokal,
    COALESCE(sum(b.njumlah * CASE b.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END)
      FILTER (WHERE l.customer_code IS NOT NULL
        AND position('.' in btrim(b.ckdplg)) = 0 AND b.dtgl <= $2::date), 0)
      AS akhir_piutang_lokal,
    COALESCE(sum(b.njumlah * CASE b.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END)
      FILTER (WHERE position('.' in btrim(b.ckdplg)) > 0 AND b.dtgl < $2::date), 0)
      AS awal_piutang_online,
    COALESCE(sum(b.njumlah * CASE b.sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END)
      FILTER (WHERE position('.' in btrim(b.ckdplg)) > 0 AND b.dtgl <= $2::date), 0)
      AS akhir_piutang_online
  FROM public.bppiut b
  LEFT JOIN local_keys l ON l.customer_code = btrim(b.ckdplg)
  WHERE b.unit_id = $1::smallint
    AND COALESCE(b.sbatal, 0) = 0
    AND b.dtgl <= $2::date
  GROUP BY btrim(b.ckdplg)
), hut AS (
  SELECT btrim(h.ckdplg) AS customer_code,
    -COALESCE(sum(h.njumlah * CASE h.sjnsbp WHEN 2 THEN 1 WHEN 1 THEN -1 ELSE 0 END)
      FILTER (WHERE h.dtgl < $2::date), 0) AS awal_hutang_lokal,
    -COALESCE(sum(h.njumlah * CASE h.sjnsbp WHEN 2 THEN 1 WHEN 1 THEN -1 ELSE 0 END)
      FILTER (WHERE h.dtgl <= $2::date), 0) AS akhir_hutang_lokal
  FROM public.bphut h
  WHERE h.unit_id = $1::smallint
    AND COALESCE(h.sbatal, 0) = 0
    AND h.dtgl <= $2::date
  GROUP BY btrim(h.ckdplg)
)
SELECT k.customer_code AS "customerCode",
       COALESCE(p.awal_piutang_lokal, 0)::text AS "awalPiutangLokal",
       COALESCE(p.akhir_piutang_lokal, 0)::text AS "akhirPiutangLokal",
       COALESCE(p.awal_piutang_online, 0)::text AS "awalPiutangOnline",
       COALESCE(p.akhir_piutang_online, 0)::text AS "akhirPiutangOnline",
       COALESCE(h.awal_hutang_lokal, 0)::text AS "awalHutangLokal",
       COALESCE(h.akhir_hutang_lokal, 0)::text AS "akhirHutangLokal"
FROM customer_keys k
LEFT JOIN piut p ON p.customer_code IS NOT DISTINCT FROM k.customer_code
LEFT JOIN hut h ON h.customer_code IS NOT DISTINCT FROM k.customer_code
ORDER BY k.customer_code`;

const NUMERIC_FIELDS = [
  "awalPiutangLokal",
  "akhirPiutangLokal",
  "awalPiutangOnline",
  "akhirPiutangOnline",
  "awalHutangLokal",
  "akhirHutangLokal",
] as const;
type NumericField = (typeof NUMERIC_FIELDS)[number];
type OracleRow = { customerCode: string } & Record<NumericField, string>;
type ValidationRow = {
  row_count: string;
  row_keyed_checksum: Buffer;
  awal_piutang_lokal_total: string;
  akhir_piutang_lokal_total: string;
  awal_piutang_online_total: string;
  akhir_piutang_online_total: string;
  awal_hutang_lokal_total: string;
  akhir_hutang_lokal_total: string;
};
type ReadySnapshot = Extract<SaldoSnapshot, { status: "ready" }>;

function checksum(value: unknown): Buffer {
  return createHash("sha256").update(JSON.stringify(value)).digest();
}

async function scoped<T>(
  pool: Pool,
  units: number | readonly number[],
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.unit_ids', $1, true)", [
      (Array.isArray(units) ? units : [units]).join(","),
    ]);
    const value = await run(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function insertCycle(
  pool: Pool,
  unitId: number,
  cycleId: string,
  sequence: number,
  previousCycleId: string | null,
  cut: Cut,
): Promise<void> {
  await scoped(pool, unitId, async (client) => {
    await client.query(
      `INSERT INTO app.saldo_pelanggan_source_cycle (
         unit_id, source_cycle_id, source_cycle_sequence, previous_source_cycle_id,
         status, source_completed_at, promoted_at,
         pelanggan_row_count, pelanggan_keyed_checksum,
         bppiut_row_count, bppiut_keyed_checksum,
         bphut_row_count, bphut_keyed_checksum
       ) VALUES (
         $1::smallint, $2::uuid, $3::bigint, $4::uuid,
         'complete', clock_timestamp(), clock_timestamp(),
         $5::bigint, $6::bytea, $7::bigint, $8::bytea, $9::bigint, $10::bytea
       )`,
      [
        unitId, cycleId, sequence, previousCycleId,
        cut.master.length, checksum(cut.master), cut.piut.length, checksum(cut.piut),
        cut.hut.length, checksum(cut.hut),
      ],
    );
    for (const row of cut.master) {
      await client.query(
        `INSERT INTO app.saldo_pelanggan_source_pelanggan (
           unit_id, source_cycle_id, ckdplg, vcnmplg, sjenis, saktif, row_keyed_checksum
         ) VALUES ($1::smallint, $2::uuid, $3, $4, $5::smallint, 1, $6::bytea)`,
        [unitId, cycleId, row.code, row.name, row.sjenis, checksum(row)],
      );
    }
    for (const row of cut.piut) {
      await client.query(
        `INSERT INTO app.saldo_pelanggan_source_bppiut (
           unit_id, source_cycle_id, ckdbppiut, dtgl, ckdplg,
           njumlah, sjnsbp, sbatal, row_keyed_checksum
         ) VALUES ($1::smallint, $2::uuid, $3, $4::date, $5,
                   $6::numeric, $7::smallint, $8::smallint, $9::bytea)`,
        [unitId, cycleId, row.key, row.date, row.customer, row.amount, row.type, row.cancelled, checksum(row)],
      );
    }
    for (const row of cut.hut) {
      await client.query(
        `INSERT INTO app.saldo_pelanggan_source_bphut (
           unit_id, source_cycle_id, ckdbphut, dtgl, ckdplg,
           njumlah, sjnsbp, sbatal, row_keyed_checksum
         ) VALUES ($1::smallint, $2::uuid, $3, $4::date, $5,
                   $6::numeric, $7::smallint, $8::smallint, $9::bytea)`,
        [unitId, cycleId, row.key, row.date, row.customer, row.amount, row.type, row.cancelled, checksum(row)],
      );
    }
  });
}

async function replaceMirror(pool: Pool, unitId: number, cut: Cut): Promise<void> {
  await scoped(pool, unitId, async (client) => {
    await client.query("DELETE FROM public.bppiut WHERE unit_id = $1::smallint", [unitId]);
    await client.query("DELETE FROM public.bphut WHERE unit_id = $1::smallint", [unitId]);
    await client.query("DELETE FROM public.pelanggan_master WHERE unit_id = $1::smallint", [unitId]);
    for (const row of cut.master) {
      await client.query(
        `INSERT INTO public.pelanggan_master (unit_id, ckdplg, vcnmplg, sjenis, saktif)
         VALUES ($1::smallint, $2, $3, $4::smallint, 1)`,
        [unitId, row.code, row.name, row.sjenis],
      );
    }
    for (const row of cut.piut) {
      await client.query(
        `INSERT INTO public.bppiut (
           unit_id, ckdbppiut, dtgl, ckdplg, njumlah, sjnsbp, sbatal
         ) VALUES ($1::smallint, $2, $3::date, $4, $5::numeric, $6::smallint, $7::smallint)`,
        [unitId, row.key, row.date, row.customer, row.amount, row.type, row.cancelled],
      );
    }
    for (const row of cut.hut) {
      await client.query(
        `INSERT INTO public.bphut (
           unit_id, ckdbphut, dtgl, ckdplg, njumlah, sjnsbp, sbatal
         ) VALUES ($1::smallint, $2, $3::date, $4, $5::numeric, $6::smallint, $7::smallint)`,
        [unitId, row.key, row.date, row.customer, row.amount, row.type, row.cancelled],
      );
    }
  });
}

async function buildReady(
  pool: Pool,
  unitId: number,
  asOfDate: string,
  cycleId: string,
  sequence: number,
): Promise<string> {
  const generationId = randomUUID();
  await scoped(pool, unitId, async (client) => {
    const inserted = await client.query(
      INSERT_BUILDING_MANIFEST_SQL,
      [unitId, asOfDate, generationId, SNAPSHOT_FORMULA_VERSION, cycleId, sequence, 0, null, null],
    );
    if (inserted.rowCount !== 1) throw new Error("B4 building manifest was not inserted");
    await client.query(MATERIALIZE_FULL_HISTORY_SQL, [unitId, asOfDate, generationId, cycleId]);
    const validation = await client.query<ValidationRow>(
      VALIDATE_GENERATION_SQL,
      [unitId, asOfDate, generationId],
    );
    const row = validation.rows[0];
    if (!row) throw new Error("B4 generation validation returned no row");
    const completed = await client.query(
      COMPLETE_MANIFEST_SQL,
      [
        unitId, asOfDate, generationId, row.row_count, row.row_keyed_checksum,
        row.awal_piutang_lokal_total, row.akhir_piutang_lokal_total,
        row.awal_piutang_online_total, row.akhir_piutang_online_total,
        row.awal_hutang_lokal_total, row.akhir_hutang_lokal_total,
      ],
    );
    if (completed.rowCount !== 1) throw new Error("B4 manifest was not completed");
    const pointed = await client.query(
      UPSERT_POINTER_SQL,
      [unitId, asOfDate, generationId, sequence, 0],
    );
    if (pointed.rowCount !== 1) throw new Error("B4 pointer was not published");
  });
  return generationId;
}

async function createBuilding(
  pool: Pool,
  unitId: number,
  asOfDate: string,
  cycleId: string,
  sequence: number,
): Promise<string> {
  const generationId = randomUUID();
  await scoped(pool, unitId, async (client) => {
    const inserted = await client.query(
      INSERT_BUILDING_MANIFEST_SQL,
      [unitId, asOfDate, generationId, SNAPSHOT_FORMULA_VERSION, cycleId, sequence, 0, null, null],
    );
    if (inserted.rowCount !== 1) throw new Error("B4 non-ready manifest was not inserted");
  });
  return generationId;
}

const DECIMAL_SCALE = 1_000_000n;

function scaled(value: string | number): bigint {
  const text = String(value);
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const magnitude = BigInt(whole || "0") * DECIMAL_SCALE
    + BigInt((fraction + "000000").slice(0, 6));
  return negative ? -magnitude : magnitude;
}

function scaledText(value: bigint): string {
  if (value === 0n) return "0";
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const whole = magnitude / DECIMAL_SCALE;
  const fraction = String(magnitude % DECIMAL_SCALE).padStart(6, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function compareReaderRows(actual: SaldoSnapshotRow[], expected: OracleRow[]) {
  const actualByCode = new Map(actual.map((row) => [row.customerCode, row]));
  const expectedByCode = new Map(expected.map((row) => [row.customerCode, row]));
  const codes = [...new Set([...actualByCode.keys(), ...expectedByCode.keys()])].sort();
  let mismatchedRows = 0;
  let mismatchedCells = 0;
  let float8MismatchedCells = 0;
  const deltas = Object.fromEntries(NUMERIC_FIELDS.map((field) => [field, 0n])) as Record<NumericField, bigint>;
  for (const code of codes) {
    const a = actualByCode.get(code);
    const e = expectedByCode.get(code);
    let rowMismatch = !a || !e;
    for (const field of NUMERIC_FIELDS) {
      const av = a ? scaled(a[field]) : 0n;
      const ev = e ? scaled(e[field]) : 0n;
      deltas[field] += av - ev;
      if (!a || !e || av !== ev) {
        mismatchedCells += 1;
        rowMismatch = true;
      }
      if (!a || !e || a[field] !== Number(e[field])) float8MismatchedCells += 1;
    }
    if (rowMismatch) mismatchedRows += 1;
  }
  return {
    oracle_rows: String(expected.length),
    read_rows: String(actual.length),
    missing_keys: String(expected.filter((row) => !actualByCode.has(row.customerCode)).length),
    extra_keys: String(actual.filter((row) => !expectedByCode.has(row.customerCode)).length),
    delta_apl: scaledText(deltas.awalPiutangLokal),
    delta_epl: scaledText(deltas.akhirPiutangLokal),
    delta_apo: scaledText(deltas.awalPiutangOnline),
    delta_epo: scaledText(deltas.akhirPiutangOnline),
    delta_ahl: scaledText(deltas.awalHutangLokal),
    delta_ehl: scaledText(deltas.akhirHutangLokal),
    mismatched_rows: String(mismatchedRows),
    mismatched_cells: String(mismatchedCells),
    float8_mismatched_cells: String(float8MismatchedCells),
  };
}

function isZeroRow(row: SaldoSnapshotRow): boolean {
  return NUMERIC_FIELDS.every((field) => row[field] === 0);
}

function dbCode(error: unknown): string {
  return String((error as { code?: unknown } | null)?.code ?? "");
}

async function deniedCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "allowed";
  } catch (error) {
    return dbCode(error);
  }
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.ceil(sorted.length * p) - 1]!;
}

describeLive("B4 synthetic snapshot read proof on solamax-pg-rlsstg", () => {
  const runId = randomUUID();
  const offset = Number.parseInt(runId.slice(0, 4), 16) % 700;
  const unitA = -26_000 - offset;
  const unitB = -27_000 - offset;
  const unitC = -28_000 - offset;
  const units = [unitA, unitB, unitC] as const;
  const tenantId = randomUUID();
  const cycleA1 = randomUUID();
  const cycleA2 = randomUUID();
  const cycleA3 = randomUUID();
  const cycleB1 = randomUUID();
  const cycleC1 = randomUUID();
  const equalityCases: Array<Record<string, unknown>> = [];
  const snapshots = new Map<string, ReadySnapshot>();
  const generations = new Map<string, string>();
  const equalityReport: Record<string, unknown> = {
    schema_version: "b4-proof/v1",
    source: "synthetic",
  };
  const readinessReport: Record<string, unknown> = { schema_version: "b4-proof/v1" };
  const accessReport: Record<string, unknown> = { schema_version: "b4-proof/v1" };
  const presenceReport: Record<string, unknown> = { schema_version: "b4-proof/v1" };
  const runtimeReport: Record<string, unknown> = { schema_version: "b4-proof/v1" };
  let cleanupReport: Record<string, unknown> = {
    schema_version: "b4-proof/v1",
    remaining_fixture_rows: "not_run",
  };
  let seed: Pool;
  let dashboardRaw: Pool;
  let dashboardAppPool: Pool;
  let getSaldoSnapshot: typeof import("./saldo-snapshot").getSaldoSnapshot;
  let getSaldoPelanggan: typeof import("./queries").getSaldoPelanggan;
  let readSaldoPelangganLegacy: typeof import("./queries").readSaldoPelangganLegacy;
  let safeToClean = false;

  const U = (unit: number) => unit as unknown as ScopedUnitId;

  async function cleanup(): Promise<void> {
    let remaining = 0;
    for (const unitId of units) {
      await scoped(seed, unitId, async (client) => {
        for (const table of [
          "app.saldo_pelanggan_snapshot_pointer",
          "app.saldo_pelanggan_build_work",
          "app.saldo_pelanggan_dirty",
          "app.saldo_pelanggan_snapshot_row",
          "app.saldo_pelanggan_snapshot_manifest",
          "app.saldo_pelanggan_source_change",
          "app.saldo_pelanggan_source_bppiut",
          "app.saldo_pelanggan_source_bphut",
          "app.saldo_pelanggan_source_pelanggan",
          "app.saldo_pelanggan_source_cycle",
          "public.bppiut",
          "public.bphut",
          "public.pelanggan_master",
        ]) {
          await client.query(`DELETE FROM ${table} WHERE unit_id = $1::smallint`, [unitId]);
        }
      });
      await seed.query("DELETE FROM public.unit WHERE unit_id = $1::smallint", [unitId]);
    }
    await seed.query("DELETE FROM app.tenant WHERE id = $1::uuid", [tenantId]);
    for (const unitId of units) {
      const count = await scoped(seed, unitId, async (client) => client.query<{ count: string }>(
        `SELECT (
           (SELECT count(*) FROM app.saldo_pelanggan_snapshot_pointer WHERE unit_id=$1::smallint) +
           (SELECT count(*) FROM app.saldo_pelanggan_snapshot_row WHERE unit_id=$1::smallint) +
           (SELECT count(*) FROM app.saldo_pelanggan_snapshot_manifest WHERE unit_id=$1::smallint) +
           (SELECT count(*) FROM app.saldo_pelanggan_build_work WHERE unit_id=$1::smallint) +
           (SELECT count(*) FROM app.saldo_pelanggan_dirty WHERE unit_id=$1::smallint) +
           (SELECT count(*) FROM app.saldo_pelanggan_source_change WHERE unit_id=$1::smallint) +
           (SELECT count(*) FROM app.saldo_pelanggan_source_bppiut WHERE unit_id=$1::smallint) +
           (SELECT count(*) FROM app.saldo_pelanggan_source_bphut WHERE unit_id=$1::smallint) +
           (SELECT count(*) FROM app.saldo_pelanggan_source_pelanggan WHERE unit_id=$1::smallint) +
           (SELECT count(*) FROM app.saldo_pelanggan_source_cycle WHERE unit_id=$1::smallint) +
           (SELECT count(*) FROM public.bppiut WHERE unit_id=$1::smallint) +
           (SELECT count(*) FROM public.bphut WHERE unit_id=$1::smallint) +
           (SELECT count(*) FROM public.pelanggan_master WHERE unit_id=$1::smallint) +
           (SELECT count(*) FROM public.unit WHERE unit_id=$1::smallint)
         )::bigint AS count`,
        [unitId],
      ));
      remaining += Number(count.rows[0]?.count ?? "0");
    }
    remaining += Number((await seed.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM app.tenant WHERE id=$1::uuid",
      [tenantId],
    )).rows[0]?.count ?? "0");
    cleanupReport = {
      schema_version: "b4-proof/v1",
      remaining_fixture_rows: String(remaining),
      result: remaining === 0 ? "pass" : "fail",
    };
    if (remaining !== 0) throw new Error(`B4 cleanup left ${remaining} fixture rows`);
  }

  async function buildAndCompare(
    label: string,
    unitId: number,
    date: string,
    cycleId: string,
    sequence: number,
  ): Promise<void> {
    const generationId = await buildReady(seed, unitId, date, cycleId, sequence);
    generations.set(label, generationId);
    const snapshot = await getSaldoSnapshot(U(unitId), date);
    expect(snapshot.status).toBe("ready");
    if (snapshot.status !== "ready") throw new Error(`${label} was not reader-ready`);
    const oracle = await scoped(seed, unitId, async (client) => {
      const result = await client.query<OracleRow>(ORACLE_ROWS_SQL, [unitId, date]);
      return result.rows;
    });
    const comparison = compareReaderRows(snapshot.rows, oracle);
    expect(comparison).toMatchObject({
      missing_keys: "0",
      extra_keys: "0",
      delta_apl: "0",
      delta_epl: "0",
      delta_apo: "0",
      delta_epo: "0",
      delta_ahl: "0",
      delta_ehl: "0",
      mismatched_rows: "0",
      mismatched_cells: "0",
      float8_mismatched_cells: "0",
    });
    expect(comparison.read_rows).toBe(comparison.oracle_rows);
    equalityCases.push({ case: label, unit: unitId === unitA ? "A" : "B", date, ...comparison });
    snapshots.set(label, snapshot);
  }

  beforeAll(async () => {
    seed = new Pool({ connectionString: process.env.SNAPSHOT_B4_SEED_URL, max: 2 });
    dashboardRaw = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

    const identity = await seed.query<{
      database_name: string;
      current_user: string;
      system_identifier: string;
      database_bytes: string;
      migrations: string;
    }>(`
      SELECT current_database() AS database_name,
             current_user,
             (SELECT system_identifier FROM pg_control_system())::text AS system_identifier,
             pg_database_size(current_database())::text AS database_bytes,
             (SELECT count(*) FROM "_prisma_migrations"
               WHERE migration_name IN (
                 '0037_saldo_pelanggan_snapshot',
                 '0038_snapshot_manifest_row_count'
               ) AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::text AS migrations`);
    expect(identity.rows[0]).toMatchObject({
      database_name: "solamax",
      current_user: "ingest",
      system_identifier: "7659054651798528016",
      migrations: "2",
    });
    expect(Number(identity.rows[0]!.database_bytes)).toBeLessThan(9_000_000_000);

    const occupied = await seed.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM public.unit WHERE unit_id = ANY($1::smallint[])",
      [units],
    );
    expect(occupied.rows[0]?.count).toBe("0");
    safeToClean = true;
    await seed.query(
      `INSERT INTO app.tenant (id, name, slug, status)
       VALUES ($1::uuid, $2, $3, 'active')`,
      [tenantId, `B4 Synthetic ${runId}`, `b4-${runId}`],
    );
    await seed.query(
      `INSERT INTO public.unit (unit_id, code, name, api_key_hash, timezone, tenant_id)
       VALUES ($1::smallint,$2,$3,$4,'Asia/Pontianak',$10::uuid),
              ($5::smallint,$6,$7,$8,'Asia/Pontianak',$10::uuid),
              ($9::smallint,$11,$12,$13,'Asia/Pontianak',$10::uuid)`,
      [
        unitA, `B4A-${runId}`, "B4 Synthetic A", checksum(`a-${runId}`).toString("hex"),
        unitB, `B4B-${runId}`, "B4 Synthetic B", checksum(`b-${runId}`).toString("hex"),
        unitC, tenantId,
        `B4C-${runId}`, "B4 Synthetic C", checksum(`c-${runId}`).toString("hex"),
      ],
    );
    await insertCycle(seed, unitA, cycleA1, 1, null, CUT_A_C1);
    await insertCycle(seed, unitA, cycleA2, 2, cycleA1, CUT_A_C2);
    await insertCycle(seed, unitA, cycleA3, 3, cycleA2, CUT_A_C3);
    await insertCycle(seed, unitB, cycleB1, 1, null, CUT_B_C1);
    await insertCycle(seed, unitC, cycleC1, 1, null, EMPTY_CUT);
    ({ getSaldoSnapshot } = await import("./saldo-snapshot"));
    ({ getSaldoPelanggan, readSaldoPelangganLegacy } = await import("./queries"));
    ({ pool: dashboardAppPool } = await import("./db"));
  }, 60_000);

  afterAll(async () => {
    const errors: unknown[] = [];
    if (safeToClean) {
      try {
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    process.stdout.write(`B4_EQUALITY_REPORT=${JSON.stringify(equalityReport)}\n`);
    process.stdout.write(`B4_READINESS_REPORT=${JSON.stringify(readinessReport)}\n`);
    process.stdout.write(`B4_ACCESS_REPORT=${JSON.stringify(accessReport)}\n`);
    process.stdout.write(`B4_PRESENCE_REPORT=${JSON.stringify(presenceReport)}\n`);
    process.stdout.write(`B4_RUNTIME_REPORT=${JSON.stringify(runtimeReport)}\n`);
    process.stdout.write(`B4_CLEANUP_REPORT=${JSON.stringify(cleanupReport)}\n`);
    await dashboardAppPool?.end().catch((error) => errors.push(error));
    if (globalThis.__solamaxPool === dashboardAppPool) globalThis.__solamaxPool = undefined;
    await dashboardRaw?.end().catch((error) => errors.push(error));
    await seed?.end().catch((error) => errors.push(error));
    if (errors.length > 0) throw new AggregateError(errors, "B4 cleanup/disconnect failed");
  }, 60_000);

  it("matches the independent oracle across all ten hard cases and date boundaries", async () => {
    await replaceMirror(seed, unitA, CUT_A_C1);
    for (const date of ["2026-01-31", "2026-02-01", "2026-02-15", "2026-02-20", "2026-02-28"]) {
      await buildAndCompare(`A/C1/${date}`, unitA, date, cycleA1, 1);
    }
    await replaceMirror(seed, unitA, CUT_A_C2);
    for (const date of ["2026-01-31", "2026-02-01", "2026-02-15", "2026-02-20", "2026-02-28"]) {
      await buildAndCompare(`A/C2/${date}`, unitA, date, cycleA2, 2);
    }
    await replaceMirror(seed, unitA, CUT_A_C3);
    for (const date of ["2026-02-01", "2026-02-28"]) {
      await buildAndCompare(`A/C3/${date}`, unitA, date, cycleA3, 3);
    }
    await replaceMirror(seed, unitB, CUT_B_C1);
    for (const date of ["2026-01-31", "2026-02-01", "2026-02-15"]) {
      await buildAndCompare(`B/C1/${date}`, unitB, date, cycleB1, 1);
    }

    const c1Jan31 = snapshots.get("A/C1/2026-01-31")!;
    const c1Feb1 = snapshots.get("A/C1/2026-02-01")!;
    const c2Feb1 = snapshots.get("A/C2/2026-02-01")!;
    const c3Feb1 = snapshots.get("A/C3/2026-02-01")!;
    const byCode = (snapshot: ReadySnapshot, code: string) =>
      snapshot.rows.find((row) => row.customerCode === code)!;
    expect(isZeroRow(byCode(c1Feb1, "ZERO"))).toBe(true);
    expect(isZeroRow(byCode(c1Feb1, "CANCEL"))).toBe(true);
    expect(byCode(c1Feb1, "N3").akhirPiutangLokal).toBe(0);
    expect(byCode(c1Feb1, "N4").akhirPiutangLokal).toBe(0);
    expect(byCode(c1Feb1, "01.000.0003").akhirPiutangOnline).toBe(175);
    expect(byCode(c1Feb1, "01.000.0004").akhirPiutangOnline).toBe(307);
    expect(byCode(c1Feb1, "99.000.0001").akhirPiutangOnline).toBe(30);
    expect(isZeroRow(byCode(c1Feb1, "ORPHAN-ND"))).toBe(true);
    expect(c1Feb1.rows.some((row) => row.customerCode === "HUT-ONLY")).toBe(true);
    expect(byCode(snapshots.get("A/C1/2026-02-28")!, "L1").akhirPiutangLokal).toBe(84.8);
    expect(snapshots.get("B/C1/2026-02-15")!.hasOnlineCustomer).toBe(false);
    expect(byCode(c1Feb1, "L1").akhirPiutangLokal).toBe(90);
    expect(byCode(c2Feb1, "L1").akhirPiutangLokal).toBe(140);
    expect(c2Feb1.rows.some((row) => row.customerCode === "88.000.0001")).toBe(true);
    expect(c3Feb1.rows.some((row) => row.customerCode === "88.000.0001")).toBe(false);
    expect(byCode(c1Jan31, "L1").akhirPiutangLokal).toBe(byCode(c1Feb1, "L1").awalPiutangLokal);
    expect(byCode(c1Jan31, "L1")).toMatchObject({
      awalPiutangLokal: 100,
      akhirPiutangLokal: 80,
    });

    const hardCases = {
      zero_balance_customer: true,
      dotted_and_nondotted: true,
      sjenis_1_5_3_4_and_nondotted_4_excluded: true,
      sbatal_1_excluded: true,
      bppiut_orphan_left_join: true,
      nondotted_piutang_orphan_retained_as_six_zero: true,
      hutang_only_customer: true,
      exact_decimal_0_10_plus_0_20: true,
      unit_without_dotted_codes: true,
      backdated_correction_and_sbatal_flip: true,
      missing_ledger_key_across_cycles: true,
      month_start_and_end_boundaries: true,
      strict_vs_inclusive_date_boundaries: true,
    };
    Object.assign(equalityReport, {
      case_date_count: equalityCases.length,
      hard_cases: hardCases,
      cases: equalityCases,
      all_equal: true,
    });
    expect(equalityCases).toHaveLength(15);
    expect(Object.keys(hardCases).length).toBeGreaterThanOrEqual(10);
  }, 120_000);

  it("cuts aggregate readers over per unit/date while keeping both sources equal", async () => {
    await replaceMirror(seed, unitA, CUT_A_C3);

    const completeDate = "2026-02-01";
    const fromPublishedSnapshot = await getSaldoPelanggan(U(unitA), completeDate);
    const sameLedgerTotals = await readSaldoPelangganLegacy(U(unitA), completeDate);
    expect(fromPublishedSnapshot).toEqual(sameLedgerTotals);

    const noSnapshotDate = "2026-03-10";
    const fromFallback = await getSaldoPelanggan(U(unitA), noSnapshotDate);
    const expectedFallback = await readSaldoPelangganLegacy(U(unitA), noSnapshotDate);
    expect(fromFallback).toEqual(expectedFallback);
    expect(fromFallback.akhir.piutangLokal).not.toBe(0);

    Object.assign(equalityReport, {
      transition: {
        complete_snapshot_matches_legacy: true,
        no_snapshot_uses_legacy_aggregate: true,
        per_customer_fallback_used: false,
        result: "pass",
      },
    });
  }, 60_000);

  it("distinguishes readiness and rejects count, checksum, and manifest-total corruption", async () => {
    const noPointer = await getSaldoSnapshot(U(unitA), "2026-03-10");
    expect(noPointer).toEqual({
      status: "not_ready",
      asOfDate: "2026-03-10",
      reason: "no_published_snapshot",
    });

    await createBuilding(seed, unitA, "2026-03-11", cycleA3, 3);
    const building = await getSaldoSnapshot(U(unitA), "2026-03-11");
    expect(building.status).toBe("not_ready");

    const failedGeneration = await createBuilding(seed, unitA, "2026-03-12", cycleA3, 3);
    await scoped(seed, unitA, (client) => client.query(
      `UPDATE app.saldo_pelanggan_snapshot_manifest
       SET status='failed', completed_at=clock_timestamp(),
           failure_code='b4_synthetic_failure', failure_summary='synthetic proof', retryable=false
       WHERE unit_id=$1::smallint AND as_of_date=$2::date AND generation_id=$3::uuid`,
      [unitA, "2026-03-12", failedGeneration],
    ).then(() => undefined));
    const failed = await getSaldoSnapshot(U(unitA), "2026-03-12");
    expect(failed.status).toBe("not_ready");

    await scoped(seed, unitA, (client) => client.query(
      `UPDATE app.saldo_pelanggan_snapshot_pointer
       SET pending_replacement=true, stale_invalid_from='2026-02-01', pending_since=clock_timestamp()
       WHERE unit_id=$1::smallint AND as_of_date='2026-02-20'`,
      [unitA],
    ).then(() => undefined));
    const stale = await getSaldoSnapshot(U(unitA), "2026-02-20");
    expect(stale).toMatchObject({
      status: "ready",
      metadata: { pendingReplacement: true, staleInvalidFrom: "2026-02-01" },
    });

    const allZeroGeneration = await buildReady(seed, unitB, "2025-12-31", cycleB1, 1);
    const allZero = await getSaldoSnapshot(U(unitB), "2025-12-31");
    expect(allZero.status).toBe("ready");
    if (allZero.status !== "ready") throw new Error("B4 all-zero snapshot was not ready");
    expect(allZero.rows).toHaveLength(3);
    expect(allZero.rows.every(isZeroRow)).toBe(true);

    const emptyGeneration = await buildReady(seed, unitC, "2026-02-15", cycleC1, 1);
    const empty = await getSaldoSnapshot(U(unitC), "2026-02-15");
    expect(empty).toMatchObject({ status: "ready", rows: [], hasOnlineCustomer: false });

    const corruptDate = "2026-02-28";
    const corruptGeneration = generations.get("A/C3/2026-02-28")!;
    const saved = await scoped(seed, unitA, async (client) => {
      const result = await client.query<Record<string, string>>(
        `SELECT customer_code,
                awal_piutang_lokal::text, akhir_piutang_lokal::text,
                awal_piutang_online::text, akhir_piutang_online::text,
                awal_hutang_lokal::text, akhir_hutang_lokal::text
         FROM app.saldo_pelanggan_snapshot_row
         WHERE unit_id=$1::smallint AND as_of_date=$2::date
           AND generation_id=$3::uuid AND customer_code='L1'`,
        [unitA, corruptDate, corruptGeneration],
      );
      return result.rows[0]!;
    });

    let deleted: SaldoSnapshot | undefined;
    try {
      await scoped(seed, unitA, (client) => client.query(
        `DELETE FROM app.saldo_pelanggan_snapshot_row
         WHERE unit_id=$1::smallint AND as_of_date=$2::date
           AND generation_id=$3::uuid AND customer_code='L1'`,
        [unitA, corruptDate, corruptGeneration],
      ).then(() => undefined));
      deleted = await getSaldoSnapshot(U(unitA), corruptDate);
      expect(deleted).toMatchObject({ status: "not_ready", reason: "incomplete_snapshot" });
    } finally {
      await scoped(seed, unitA, (client) => client.query(
        `INSERT INTO app.saldo_pelanggan_snapshot_row (
           unit_id, as_of_date, generation_id, customer_code,
           awal_piutang_lokal, akhir_piutang_lokal,
           awal_piutang_online, akhir_piutang_online,
           awal_hutang_lokal, akhir_hutang_lokal
         ) VALUES ($1::smallint,$2::date,$3::uuid,$4,$5::numeric,$6::numeric,
                   $7::numeric,$8::numeric,$9::numeric,$10::numeric)`,
        [
          unitA, corruptDate, corruptGeneration, saved.customer_code,
          saved.awal_piutang_lokal, saved.akhir_piutang_lokal,
          saved.awal_piutang_online, saved.akhir_piutang_online,
          saved.awal_hutang_lokal, saved.akhir_hutang_lokal,
        ],
      ).then(() => undefined));
    }

    let checksumMutation: SaldoSnapshot | undefined;
    try {
      await scoped(seed, unitA, (client) => client.query(
        `UPDATE app.saldo_pelanggan_snapshot_row
         SET akhir_piutang_lokal=akhir_piutang_lokal+1
         WHERE unit_id=$1::smallint AND as_of_date=$2::date
           AND generation_id=$3::uuid AND customer_code='L1'`,
        [unitA, corruptDate, corruptGeneration],
      ).then(() => undefined));
      checksumMutation = await getSaldoSnapshot(U(unitA), corruptDate);
      readinessReport.red_control = {
        mutation: "same_count_numeric_cell",
        detected: checksumMutation.status === "not_ready",
      };
      if (process.env.SNAPSHOT_B4_REQUIRE_MUTANT_ACCEPTED !== "1") {
        expect(checksumMutation).toMatchObject({ status: "not_ready", reason: "incomplete_snapshot" });
      }
    } finally {
      await scoped(seed, unitA, (client) => client.query(
        `UPDATE app.saldo_pelanggan_snapshot_row
         SET akhir_piutang_lokal=$4::numeric
         WHERE unit_id=$1::smallint AND as_of_date=$2::date
           AND generation_id=$3::uuid AND customer_code='L1'`,
        [unitA, corruptDate, corruptGeneration, saved.akhir_piutang_lokal],
      ).then(() => undefined));
    }

    const manifestTotal = await scoped(seed, unitA, async (client) => {
      const result = await client.query<{ value: string }>(
        `SELECT akhir_piutang_lokal_total::text AS value
         FROM app.saldo_pelanggan_snapshot_manifest
         WHERE unit_id=$1::smallint AND as_of_date=$2::date AND generation_id=$3::uuid`,
        [unitA, corruptDate, corruptGeneration],
      );
      return result.rows[0]!.value;
    });
    let totalMutation: SaldoSnapshot | undefined;
    try {
      await scoped(seed, unitA, (client) => client.query(
        `UPDATE app.saldo_pelanggan_snapshot_manifest
         SET akhir_piutang_lokal_total=akhir_piutang_lokal_total+1
         WHERE unit_id=$1::smallint AND as_of_date=$2::date AND generation_id=$3::uuid`,
        [unitA, corruptDate, corruptGeneration],
      ).then(() => undefined));
      totalMutation = await getSaldoSnapshot(U(unitA), corruptDate);
      expect(totalMutation).toMatchObject({ status: "not_ready", reason: "incomplete_snapshot" });
    } finally {
      await scoped(seed, unitA, (client) => client.query(
        `UPDATE app.saldo_pelanggan_snapshot_manifest
         SET akhir_piutang_lokal_total=$4::numeric
         WHERE unit_id=$1::smallint AND as_of_date=$2::date AND generation_id=$3::uuid`,
        [unitA, corruptDate, corruptGeneration, manifestTotal],
      ).then(() => undefined));
    }

    Object.assign(readinessReport, {
      no_pointer: noPointer.status,
      building_without_previous: building.status,
      failed_without_previous: failed.status,
      stale_old: stale.status === "ready" ? "stale_ready" : stale.status,
      complete_all_zero: allZero.status,
      all_zero_generation: allZeroGeneration,
      complete_zero_customer: empty.status,
      zero_customer_generation: emptyGeneration,
      deleted_row_count_mismatch: deleted?.status,
      same_count_checksum_mutation: checksumMutation?.status,
      manifest_total_mutation: totalMutation?.status,
      result: "pass",
    });
    if (process.env.SNAPSHOT_B4_REQUIRE_MUTANT_ACCEPTED === "1") {
      // Deliberately inverted command: this assertion must make the proof red.
      expect(checksumMutation?.status).toBe("ready");
    }
  }, 120_000);

  it("proves fail-closed RLS without GUC, cross-unit isolation, and denied writes", async () => {
    const identity = await dashboardRaw.query<{
      database_name: string;
      current_user: string;
      system_identifier: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(`
      SELECT current_database() AS database_name, current_user,
             (SELECT system_identifier FROM pg_control_system())::text AS system_identifier,
             r.rolsuper, r.rolbypassrls
      FROM pg_roles r WHERE r.rolname=current_user`);
    expect(identity.rows[0]).toMatchObject({
      database_name: "solamax",
      current_user: "dashboard_app",
      system_identifier: "7659054651798528016",
      rolsuper: false,
      rolbypassrls: false,
    });

    const writerCounts = await scoped(seed, units, async (client) => {
      const result = await client.query<Record<string, string>>(`
        SELECT
          (SELECT count(*)::text FROM app.saldo_pelanggan_snapshot_manifest
            WHERE unit_id=ANY($1::smallint[])) AS manifest,
          (SELECT count(*)::text FROM app.saldo_pelanggan_snapshot_pointer
            WHERE unit_id=ANY($1::smallint[])) AS pointer,
          (SELECT count(*)::text FROM app.saldo_pelanggan_snapshot_row
            WHERE unit_id=ANY($1::smallint[])) AS row`, [units]);
      return result.rows[0]!;
    });
    expect(Number(writerCounts.manifest)).toBeGreaterThan(0);
    expect(Number(writerCounts.pointer)).toBeGreaterThan(0);
    expect(Number(writerCounts.row)).toBeGreaterThan(0);

    const noGuc = await dashboardRaw.query<Record<string, string>>(`
      SELECT
        (SELECT count(*)::text FROM app.saldo_pelanggan_snapshot_manifest) AS manifest,
        (SELECT count(*)::text FROM app.saldo_pelanggan_snapshot_pointer) AS pointer,
        (SELECT count(*)::text FROM app.saldo_pelanggan_snapshot_row) AS row`);
    expect(noGuc.rows[0]).toEqual({ manifest: "0", pointer: "0", row: "0" });

    const client = await dashboardRaw.connect();
    let scopedA = "0";
    let foreignB = "0";
    let postCommit = "-1";
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.unit_ids', $1, true)", [String(unitA)]);
      scopedA = (await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM app.saldo_pelanggan_snapshot_row WHERE unit_id=$1::smallint",
        [unitA],
      )).rows[0]!.count;
      foreignB = (await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM app.saldo_pelanggan_snapshot_row WHERE unit_id=$1::smallint",
        [unitB],
      )).rows[0]!.count;
      await client.query("COMMIT");
      postCommit = (await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM app.saldo_pelanggan_snapshot_row",
      )).rows[0]!.count;
    } finally {
      client.release();
    }
    expect(Number(scopedA)).toBeGreaterThan(0);
    expect(foreignB).toBe("0");
    expect(postCommit).toBe("0");

    const actual = await getSaldoSnapshot(U(unitA), "2026-02-28");
    expect(actual.status).toBe("ready");
    const denied = {
      source_select: await deniedCode(() => dashboardRaw.query(
        "SELECT 1 FROM app.saldo_pelanggan_source_cycle LIMIT 1",
      )),
      snapshot_insert: await deniedCode(() => dashboardRaw.query(
        "INSERT INTO app.saldo_pelanggan_snapshot_manifest DEFAULT VALUES",
      )),
      snapshot_update: await deniedCode(() => dashboardRaw.query(
        "UPDATE app.saldo_pelanggan_snapshot_pointer SET activated_at=activated_at",
      )),
      snapshot_delete: await deniedCode(() => dashboardRaw.query(
        "DELETE FROM app.saldo_pelanggan_snapshot_row",
      )),
    };
    expect(denied).toEqual({
      source_select: "42501",
      snapshot_insert: "42501",
      snapshot_update: "42501",
      snapshot_delete: "42501",
    });
    Object.assign(accessReport, {
      role: {
        current_user: identity.rows[0]!.current_user,
        rolsuper: identity.rows[0]!.rolsuper,
        rolbypassrls: identity.rows[0]!.rolbypassrls,
      },
      writer_fixture_counts: writerCounts,
      no_guc: noGuc.rows[0],
      scoped: { unit_a_rows: scopedA, foreign_rows: foreignB, post_commit_rows: postCommit },
      denied,
      result: "pass",
    });
  }, 60_000);

  it("computes the online presence gate from the complete snapshot before filtering", async () => {
    await replaceMirror(seed, unitA, CUT_A_C1);
    await buildReady(seed, unitA, "2025-12-31", cycleA1, 1);
    const dottedZero = await getSaldoSnapshot(U(unitA), "2025-12-31");
    expect(dottedZero.status).toBe("ready");
    if (dottedZero.status !== "ready") throw new Error("B4 dotted-zero snapshot was not ready");
    const dottedSentinel = dottedZero.rows.find((row) => row.customerCode === "01.000.0003");
    expect(dottedSentinel && isZeroRow(dottedSentinel)).toBe(true);
    expect(dottedZero.hasOnlineCustomer).toBe(true);

    const filteredPage = dottedZero.rows
      .filter((row) => !row.customerCode.includes("."))
      .slice(0, 1);
    expect(filteredPage).toHaveLength(1);
    expect(filteredPage.some((row) => row.customerCode.includes("."))).toBe(false);
    expect(dottedZero.hasOnlineCustomer).toBe(true);

    const dottedOrphan = snapshots.get("A/C1/2026-02-01")!;
    expect(dottedOrphan.rows.some((row) => row.customerCode === "99.000.0001")).toBe(true);
    const nondottedOrphan = dottedOrphan.rows.find((row) => row.customerCode === "ORPHAN-ND")!;
    expect(isZeroRow(nondottedOrphan)).toBe(true);
    expect(nondottedOrphan.customerCode.includes(".")).toBe(false);

    const noDots = snapshots.get("B/C1/2026-02-15")!;
    expect(noDots.hasOnlineCustomer).toBe(false);
    Object.assign(presenceReport, {
      dotted_six_zero_customer: true,
      dotted_orphan: true,
      nondotted_orphan_is_online: false,
      unit_without_dotted: false,
      filtered_page_excludes_dotted_sentinel: true,
      presence_survives_filter: true,
      result: "pass",
    });
  }, 60_000);

  it("measures the real uncached pointer-plus-generation read path with n=30", async () => {
    const date = "2026-02-28";
    for (let i = 0; i < 3; i += 1) {
      const warm = await getSaldoSnapshot(U(unitA), date);
      expect(warm.status).toBe("ready");
    }

    const samples: number[] = [];
    const logicalQueries: number[] = [];
    const statements: number[] = [];
    const oldWriter = PENULIS.tulis;
    try {
      PENULIS.tulis = (line) => {
        const match = /kueri=(\d+) pernyataan=(\d+) ms=(\d+)$/.exec(line);
        if (!match) throw new Error(`unexpected measurement line: ${line}`);
        logicalQueries.push(Number(match[1]));
        statements.push(Number(match[2]));
      };
      for (let i = 0; i < 30; i += 1) {
        const start = performance.now();
        const snapshot = await ukur("lain", () => getSaldoSnapshot(U(unitA), date));
        samples.push(performance.now() - start);
        expect(snapshot.status).toBe("ready");
      }
    } finally {
      PENULIS.tulis = oldWriter;
    }
    samples.sort((a, b) => a - b);
    expect(samples).toHaveLength(30);
    expect(logicalQueries).toEqual(Array(30).fill(2));
    expect(statements).toEqual(Array(30).fill(8));
    Object.assign(runtimeReport, {
      environment: {
        instance: "solamax:asia-southeast2:solamax-pg-rlsstg",
        database: "solamax",
        role: "dashboard_app",
        fixture: "synthetic",
        path: "getSaldoSnapshot/qScoped/pointer+exact-generation",
        cache: "bypassed",
      },
      warmup: 3,
      n: 30,
      successes: 30,
      errors: 0,
      logical_queries_per_call: logicalQueries[0],
      sql_round_trips_per_call: statements[0],
      samples_ms: samples.map((value) => Number(value.toFixed(3))),
      min_ms: Number(samples[0]!.toFixed(3)),
      p50_ms: Number(percentile(samples, 0.5).toFixed(3)),
      p95_ms: Number(percentile(samples, 0.95).toFixed(3)),
      max_ms: Number(samples.at(-1)!.toFixed(3)),
      representativeness: {
        production_cardinality: false,
        production_distribution: false,
        production_concurrency: false,
        production_network: false,
        claim: "functional read-path timing only; not production SLO or capacity evidence",
      },
      result: "pass",
    });
  }, 120_000);
});
