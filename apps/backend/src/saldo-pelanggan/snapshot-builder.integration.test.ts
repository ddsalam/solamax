import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "../prisma.service.js";
import { SnapshotBuilderService } from "./snapshot-builder.service.js";
import { SNAPSHOT_FORMULA_VERSION } from "./snapshot-config.js";
import {
  INSERT_BUILDING_MANIFEST_SQL,
  MATERIALIZE_DELTA_SQL,
  MATERIALIZE_FULL_HISTORY_SQL,
  READ_READY_SNAPSHOT_SQL,
  SET_UNIT_SCOPE_SQL,
} from "./snapshot-sql.js";

const LIVE = process.env.SNAPSHOT_B2_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const describeLive = LIVE ? describe.sequential : describe.skip;

type Tx = Prisma.TransactionClient;
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

function checksum(value: unknown): Buffer {
  return createHash("sha256").update(JSON.stringify(value)).digest();
}

function numeric(value: unknown): string {
  return String(value ?? "0");
}

function dbError(error: unknown): { code: string; message: string } {
  const record = (error ?? {}) as { code?: unknown; message?: unknown; meta?: { code?: unknown; message?: unknown } };
  return {
    code: String(record.meta?.code ?? record.code ?? ""),
    message: String(record.meta?.message ?? record.message ?? ""),
  };
}

const COMPARE_SQL = `
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
), oracle AS (
  SELECT k.customer_code,
    COALESCE(p.awal_piutang_lokal, 0) AS awal_piutang_lokal,
    COALESCE(p.akhir_piutang_lokal, 0) AS akhir_piutang_lokal,
    COALESCE(p.awal_piutang_online, 0) AS awal_piutang_online,
    COALESCE(p.akhir_piutang_online, 0) AS akhir_piutang_online,
    COALESCE(h.awal_hutang_lokal, 0) AS awal_hutang_lokal,
    COALESCE(h.akhir_hutang_lokal, 0) AS akhir_hutang_lokal
  FROM customer_keys k
  LEFT JOIN piut p ON p.customer_code IS NOT DISTINCT FROM k.customer_code
  LEFT JOIN hut h ON h.customer_code IS NOT DISTINCT FROM k.customer_code
), selected_generation AS (
  SELECT COALESCE($3::uuid, (
    SELECT generation_id
    FROM app.saldo_pelanggan_snapshot_pointer
    WHERE unit_id = $1::smallint AND as_of_date = $2::date
  )) AS generation_id
), snapshot AS (
  SELECT r.customer_code,
    r.awal_piutang_lokal, r.akhir_piutang_lokal,
    r.awal_piutang_online, r.akhir_piutang_online,
    r.awal_hutang_lokal, r.akhir_hutang_lokal
  FROM app.saldo_pelanggan_snapshot_row r
  WHERE r.unit_id = $1::smallint
    AND r.as_of_date = $2::date
    AND r.generation_id = (SELECT generation_id FROM selected_generation)
), paired AS (
  SELECT o.customer_code AS oracle_code, s.customer_code AS snapshot_code,
    o.awal_piutang_lokal AS o_apl, s.awal_piutang_lokal AS s_apl,
    o.akhir_piutang_lokal AS o_epl, s.akhir_piutang_lokal AS s_epl,
    o.awal_piutang_online AS o_apo, s.awal_piutang_online AS s_apo,
    o.akhir_piutang_online AS o_epo, s.akhir_piutang_online AS s_epo,
    o.awal_hutang_lokal AS o_ahl, s.awal_hutang_lokal AS s_ahl,
    o.akhir_hutang_lokal AS o_ehl, s.akhir_hutang_lokal AS s_ehl
  FROM oracle o FULL OUTER JOIN snapshot s USING (customer_code)
)
SELECT (SELECT count(*) FROM oracle)::bigint AS oracle_rows,
       (SELECT count(*) FROM snapshot)::bigint AS snapshot_rows,
       count(*) FILTER (WHERE snapshot_code IS NULL)::bigint AS missing_keys,
       count(*) FILTER (WHERE oracle_code IS NULL)::bigint AS extra_keys,
       COALESCE(sum(COALESCE(s_apl, 0) - COALESCE(o_apl, 0)), 0) AS delta_apl,
       COALESCE(sum(COALESCE(s_epl, 0) - COALESCE(o_epl, 0)), 0) AS delta_epl,
       COALESCE(sum(COALESCE(s_apo, 0) - COALESCE(o_apo, 0)), 0) AS delta_apo,
       COALESCE(sum(COALESCE(s_epo, 0) - COALESCE(o_epo, 0)), 0) AS delta_epo,
       COALESCE(sum(COALESCE(s_ahl, 0) - COALESCE(o_ahl, 0)), 0) AS delta_ahl,
       COALESCE(sum(COALESCE(s_ehl, 0) - COALESCE(o_ehl, 0)), 0) AS delta_ehl,
       count(*) FILTER (WHERE
         o_apl IS DISTINCT FROM s_apl OR o_epl IS DISTINCT FROM s_epl OR
         o_apo IS DISTINCT FROM s_apo OR o_epo IS DISTINCT FROM s_epo OR
         o_ahl IS DISTINCT FROM s_ahl OR o_ehl IS DISTINCT FROM s_ehl
       )::bigint AS mismatched_rows,
       COALESCE(sum(
         (o_apl IS DISTINCT FROM s_apl)::int + (o_epl IS DISTINCT FROM s_epl)::int +
         (o_apo IS DISTINCT FROM s_apo)::int + (o_epo IS DISTINCT FROM s_epo)::int +
         (o_ahl IS DISTINCT FROM s_ahl)::int + (o_ehl IS DISTINCT FROM s_ehl)::int
       ), 0)::bigint AS mismatched_cells,
       COALESCE(sum(
         ((o_apl::float8) IS DISTINCT FROM (s_apl::float8))::int +
         ((o_epl::float8) IS DISTINCT FROM (s_epl::float8))::int +
         ((o_apo::float8) IS DISTINCT FROM (s_apo::float8))::int +
         ((o_epo::float8) IS DISTINCT FROM (s_epo::float8))::int +
         ((o_ahl::float8) IS DISTINCT FROM (s_ahl::float8))::int +
         ((o_ehl::float8) IS DISTINCT FROM (s_ehl::float8))::int
       ), 0)::bigint AS float8_mismatched_cells
FROM paired`;

const SIGNATURE_SQL = `
SELECT p.generation_id,
       count(r.customer_code)::bigint AS row_count,
       COALESCE(sum(r.awal_piutang_lokal), 0) AS apl,
       COALESCE(sum(r.akhir_piutang_lokal), 0) AS epl,
       COALESCE(sum(r.awal_piutang_online), 0) AS apo,
       COALESCE(sum(r.akhir_piutang_online), 0) AS epo,
       COALESCE(sum(r.awal_hutang_lokal), 0) AS ahl,
       COALESCE(sum(r.akhir_hutang_lokal), 0) AS ehl
FROM app.saldo_pelanggan_snapshot_pointer p
JOIN app.saldo_pelanggan_snapshot_manifest m
  ON m.unit_id = p.unit_id AND m.as_of_date = p.as_of_date
 AND m.generation_id = p.generation_id
 AND m.status = 'complete' AND m.published AND m.validation_passed
JOIN app.saldo_pelanggan_snapshot_row r
  ON r.unit_id = p.unit_id AND r.as_of_date = p.as_of_date
 AND r.generation_id = p.generation_id
WHERE p.unit_id = $1::smallint AND p.as_of_date = $2::date
GROUP BY p.generation_id`;

interface ComparisonRow {
  oracle_rows: bigint;
  snapshot_rows: bigint;
  missing_keys: bigint;
  extra_keys: bigint;
  delta_apl: unknown;
  delta_epl: unknown;
  delta_apo: unknown;
  delta_epo: unknown;
  delta_ahl: unknown;
  delta_ehl: unknown;
  mismatched_rows: bigint;
  mismatched_cells: bigint;
  float8_mismatched_cells: bigint;
}

interface SignatureRow {
  generation_id: string;
  row_count: bigint;
  apl: unknown;
  epl: unknown;
  apo: unknown;
  epo: unknown;
  ahl: unknown;
  ehl: unknown;
}

async function scoped<T>(
  prisma: PrismaService,
  unitId: number,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(SET_UNIT_SCOPE_SQL, String(unitId));
    return run(tx);
  });
}

async function insertCycle(
  prisma: PrismaService,
  unitId: number,
  cycleId: string,
  sequence: bigint,
  previousCycleId: string | null,
  cut: Cut,
): Promise<void> {
  await scoped(prisma, unitId, async (tx) => {
    await tx.$executeRawUnsafe(
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
      unitId,
      cycleId,
      sequence,
      previousCycleId,
      cut.master.length,
      checksum(cut.master),
      cut.piut.length,
      checksum(cut.piut),
      cut.hut.length,
      checksum(cut.hut),
    );
    for (const row of cut.master) {
      await tx.$executeRawUnsafe(
        `INSERT INTO app.saldo_pelanggan_source_pelanggan (
           unit_id, source_cycle_id, ckdplg, vcnmplg, sjenis, saktif, row_keyed_checksum
         ) VALUES ($1::smallint, $2::uuid, $3, $4, $5::smallint, 1, $6::bytea)`,
        unitId, cycleId, row.code, row.name, row.sjenis, checksum(row),
      );
    }
    for (const row of cut.piut) {
      await tx.$executeRawUnsafe(
        `INSERT INTO app.saldo_pelanggan_source_bppiut (
           unit_id, source_cycle_id, ckdbppiut, dtgl, ckdplg,
           njumlah, sjnsbp, sbatal, row_keyed_checksum
         ) VALUES ($1::smallint, $2::uuid, $3, $4::date, $5,
                   $6::numeric, $7::smallint, $8::smallint, $9::bytea)`,
        unitId, cycleId, row.key, row.date, row.customer,
        row.amount, row.type, row.cancelled, checksum(row),
      );
    }
    for (const row of cut.hut) {
      await tx.$executeRawUnsafe(
        `INSERT INTO app.saldo_pelanggan_source_bphut (
           unit_id, source_cycle_id, ckdbphut, dtgl, ckdplg,
           njumlah, sjnsbp, sbatal, row_keyed_checksum
         ) VALUES ($1::smallint, $2::uuid, $3, $4::date, $5,
                   $6::numeric, $7::smallint, $8::smallint, $9::bytea)`,
        unitId, cycleId, row.key, row.date, row.customer,
        row.amount, row.type, row.cancelled, checksum(row),
      );
    }
  });
}

async function replaceMirror(
  prisma: PrismaService,
  unitId: number,
  cut: Cut,
): Promise<void> {
  await scoped(prisma, unitId, async (tx) => {
    await tx.$executeRawUnsafe("DELETE FROM public.bppiut WHERE unit_id = $1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM public.bphut WHERE unit_id = $1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM public.pelanggan_master WHERE unit_id = $1::smallint", unitId);
    for (const row of cut.master) {
      await tx.$executeRawUnsafe(
        `INSERT INTO public.pelanggan_master (unit_id, ckdplg, vcnmplg, sjenis, saktif)
         VALUES ($1::smallint, $2, $3, $4::smallint, 1)`,
        unitId, row.code, row.name, row.sjenis,
      );
    }
    for (const row of cut.piut) {
      await tx.$executeRawUnsafe(
        `INSERT INTO public.bppiut (
           unit_id, ckdbppiut, dtgl, ckdplg, njumlah, sjnsbp, sbatal
         ) VALUES ($1::smallint, $2, $3::date, $4, $5::numeric, $6::smallint, $7::smallint)`,
        unitId, row.key, row.date, row.customer, row.amount, row.type, row.cancelled,
      );
    }
    for (const row of cut.hut) {
      await tx.$executeRawUnsafe(
        `INSERT INTO public.bphut (
           unit_id, ckdbphut, dtgl, ckdplg, njumlah, sjnsbp, sbatal
         ) VALUES ($1::smallint, $2, $3::date, $4, $5::numeric, $6::smallint, $7::smallint)`,
        unitId, row.key, row.date, row.customer, row.amount, row.type, row.cancelled,
      );
    }
  });
}

async function compare(
  prisma: PrismaService,
  unitId: number,
  date: string,
  generationId: string | null = null,
): Promise<ComparisonRow> {
  return scoped(prisma, unitId, async (tx) => {
    const rows = await tx.$queryRawUnsafe<ComparisonRow[]>(
      COMPARE_SQL,
      unitId,
      date,
      generationId,
    );
    if (!rows[0]) throw new Error("comparison returned no row");
    return rows[0];
  });
}

function expectEqual(row: ComparisonRow): void {
  expect(row.missing_keys).toBe(0n);
  expect(row.extra_keys).toBe(0n);
  expect(row.mismatched_rows).toBe(0n);
  expect(row.mismatched_cells).toBe(0n);
  expect(row.float8_mismatched_cells).toBe(0n);
  expect(row.snapshot_rows).toBe(row.oracle_rows);
  for (const value of [
    row.delta_apl, row.delta_epl, row.delta_apo,
    row.delta_epo, row.delta_ahl, row.delta_ehl,
  ]) expect(Number(numeric(value))).toBe(0);
}

function reportComparison(label: string, row: ComparisonRow): Record<string, string> {
  return {
    case: label,
    oracle_rows: String(row.oracle_rows),
    snapshot_rows: String(row.snapshot_rows),
    missing_keys: String(row.missing_keys),
    extra_keys: String(row.extra_keys),
    delta_apl: numeric(row.delta_apl),
    delta_epl: numeric(row.delta_epl),
    delta_apo: numeric(row.delta_apo),
    delta_epo: numeric(row.delta_epo),
    delta_ahl: numeric(row.delta_ahl),
    delta_ehl: numeric(row.delta_ehl),
    mismatched_cells: String(row.mismatched_cells),
  };
}

async function signature(
  prisma: PrismaService,
  unitId: number,
  date: string,
): Promise<SignatureRow> {
  return scoped(prisma, unitId, async (tx) => {
    const rows = await tx.$queryRawUnsafe<SignatureRow[]>(SIGNATURE_SQL, unitId, date);
    if (!rows[0]) throw new Error("ready signature missing");
    return rows[0];
  });
}

function signatureText(row: SignatureRow): string {
  return [row.generation_id, String(row.row_count), numeric(row.apl), numeric(row.epl),
    numeric(row.apo), numeric(row.epo), numeric(row.ahl), numeric(row.ehl)].join("|");
}

interface CleanupRow {
  relation: string;
  row_count: bigint;
}

async function cleanupUnit(
  prisma: PrismaService,
  unitId: number,
): Promise<CleanupRow[]> {
  await scoped(prisma, unitId, async (tx) => {
    await tx.$executeRawUnsafe("DELETE FROM app.saldo_pelanggan_snapshot_pointer WHERE unit_id = $1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM app.saldo_pelanggan_build_work WHERE unit_id = $1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM app.saldo_pelanggan_dirty WHERE unit_id = $1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM app.saldo_pelanggan_snapshot_row WHERE unit_id = $1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM app.saldo_pelanggan_snapshot_manifest WHERE unit_id = $1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM app.saldo_pelanggan_source_change WHERE unit_id = $1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM app.saldo_pelanggan_source_bppiut WHERE unit_id = $1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM app.saldo_pelanggan_source_bphut WHERE unit_id = $1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM app.saldo_pelanggan_source_pelanggan WHERE unit_id = $1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM app.saldo_pelanggan_source_cycle WHERE unit_id = $1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM public.bppiut WHERE unit_id = $1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM public.bphut WHERE unit_id = $1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM public.pelanggan_master WHERE unit_id = $1::smallint", unitId);
  });
  await prisma.$executeRawUnsafe("DELETE FROM public.unit WHERE unit_id = $1::smallint", unitId);
  return scoped(prisma, unitId, async (tx) => tx.$queryRawUnsafe<CleanupRow[]>(
    `SELECT 'snapshot_pointer' AS relation, count(*)::bigint AS row_count
       FROM app.saldo_pelanggan_snapshot_pointer WHERE unit_id = $1::smallint
     UNION ALL SELECT 'build_work', count(*)::bigint FROM app.saldo_pelanggan_build_work WHERE unit_id = $1::smallint
     UNION ALL SELECT 'dirty', count(*)::bigint FROM app.saldo_pelanggan_dirty WHERE unit_id = $1::smallint
     UNION ALL SELECT 'snapshot_row', count(*)::bigint FROM app.saldo_pelanggan_snapshot_row WHERE unit_id = $1::smallint
     UNION ALL SELECT 'snapshot_manifest', count(*)::bigint FROM app.saldo_pelanggan_snapshot_manifest WHERE unit_id = $1::smallint
     UNION ALL SELECT 'source_change', count(*)::bigint FROM app.saldo_pelanggan_source_change WHERE unit_id = $1::smallint
     UNION ALL SELECT 'source_bppiut', count(*)::bigint FROM app.saldo_pelanggan_source_bppiut WHERE unit_id = $1::smallint
     UNION ALL SELECT 'source_bphut', count(*)::bigint FROM app.saldo_pelanggan_source_bphut WHERE unit_id = $1::smallint
     UNION ALL SELECT 'source_pelanggan', count(*)::bigint FROM app.saldo_pelanggan_source_pelanggan WHERE unit_id = $1::smallint
     UNION ALL SELECT 'source_cycle', count(*)::bigint FROM app.saldo_pelanggan_source_cycle WHERE unit_id = $1::smallint
     UNION ALL SELECT 'bppiut', count(*)::bigint FROM public.bppiut WHERE unit_id = $1::smallint
     UNION ALL SELECT 'bphut', count(*)::bigint FROM public.bphut WHERE unit_id = $1::smallint
     UNION ALL SELECT 'pelanggan_master', count(*)::bigint FROM public.pelanggan_master WHERE unit_id = $1::smallint
     UNION ALL SELECT 'unit', count(*)::bigint FROM public.unit WHERE unit_id = $1::smallint`,
    unitId,
  ));
}

describeLive("B2 synthetic snapshot equality on solamax-pg-rlsstg", () => {
  const prisma = new PrismaService();
  const builder = new SnapshotBuilderService(prisma);
  const runId = randomUUID();
  const offset = Number.parseInt(runId.slice(0, 4), 16) % 900;
  const unitA = -30_000 - offset;
  const unitB = -31_000 - offset;
  const tenantId = randomUUID();
  const cycleA1 = randomUUID();
  const cycleA2 = randomUUID();
  const cycleA3 = randomUUID();
  const cycleB1 = randomUUID();
  const equalityReport: Array<Record<string, string>> = [];
  const gateReport: Record<string, unknown> = {};

  beforeAll(async () => {
    await prisma.onModuleInit();
    const identity = await prisma.$queryRawUnsafe<Array<{
      database_name: string;
      current_user: string;
      system_identifier: bigint;
      database_bytes: bigint;
      migrations: bigint;
    }>>(`
      SELECT current_database() AS database_name,
             current_user,
             (SELECT system_identifier FROM pg_control_system()) AS system_identifier,
             pg_database_size(current_database())::bigint AS database_bytes,
             (SELECT count(*) FROM "_prisma_migrations"
               WHERE migration_name IN (
                 '0037_saldo_pelanggan_snapshot',
                 '0038_snapshot_manifest_row_count'
               ) AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::bigint AS migrations`);
    expect(identity[0]).toMatchObject({
      database_name: "solamax",
      current_user: "ingest",
      system_identifier: 7_659_054_651_798_528_016n,
      migrations: 2n,
    });
    expect(Number(identity[0]!.database_bytes)).toBeLessThan(9_000_000_000);

    const occupied = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      "SELECT count(*)::bigint AS count FROM public.unit WHERE unit_id IN ($1::smallint, $2::smallint)",
      unitA,
      unitB,
    );
    expect(occupied[0]?.count).toBe(0n);
    await prisma.$executeRawUnsafe(
      `INSERT INTO app.tenant (id, name, slug, status)
       VALUES ($1::uuid, $2, $3, 'active')`,
      tenantId,
      `B2 Synthetic ${runId}`,
      `b2-${runId}`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO public.unit (unit_id, code, name, api_key_hash, timezone, tenant_id)
       VALUES ($1::smallint, $2, $3, $4, 'Asia/Pontianak', $5::uuid),
              ($6::smallint, $7, $8, $9, 'Asia/Pontianak', $5::uuid)`,
      unitA, `B2A-${runId}`, "B2 Synthetic A", checksum(`key-a-${runId}`).toString("hex"), tenantId,
      unitB, `B2B-${runId}`, "B2 Synthetic B", checksum(`key-b-${runId}`).toString("hex"),
    );
    await insertCycle(prisma, unitA, cycleA1, 1n, null, CUT_A_C1);
    await insertCycle(prisma, unitA, cycleA2, 2n, cycleA1, CUT_A_C2);
    await insertCycle(prisma, unitA, cycleA3, 3n, cycleA2, CUT_A_C3);
    await insertCycle(prisma, unitB, cycleB1, 1n, null, CUT_B_C1);
  }, 60_000);

  afterAll(async () => {
    const cleanup: CleanupRow[] = [];
    for (const unitId of [unitA, unitB]) {
      try {
        cleanup.push(...await cleanupUnit(prisma, unitId));
      } catch (error) {
        process.stderr.write(`B2 cleanup failed for ${unitId}: ${dbError(error).message}\n`);
      }
    }
    await prisma.$executeRawUnsafe("DELETE FROM app.tenant WHERE id = $1::uuid", tenantId).catch(() => 0);
    if (cleanup.length > 0) {
      expect(cleanup).toHaveLength(28);
      for (const row of cleanup) expect(row.row_count, row.relation).toBe(0n);
      process.stdout.write(`B2_CLEANUP_REPORT=${JSON.stringify(
        cleanup.map((row) => ({ relation: row.relation, row_count: String(row.row_count) })),
      )}\n`);
    }
    await prisma.onModuleDestroy();
  }, 60_000);

  async function buildAndCompare(
    label: string,
    unitId: number,
    date: string,
    sourceCycleId: string,
    sequence: bigint,
  ): Promise<{ generationId: string; comparison: ComparisonRow }> {
    const result = await builder.build(
      {
        unitId,
        asOfDate: date,
        sourceCycleId,
        sourceCycleSequence: sequence,
        rebuildEpoch: 0n,
      },
      { syntheticWibMinutes: 180 },
    );
    const comparison = await compare(prisma, unitId, date);
    expectEqual(comparison);
    equalityReport.push(reportComparison(label, comparison));
    return { generationId: result.target.generationId, comparison };
  }

  it("proves equality, a red mutant, atomic publication, 0038, and readiness", async () => {
    await replaceMirror(prisma, unitA, CUT_A_C1);
    let c1Feb1Generation = "";
    for (const date of ["2026-01-31", "2026-02-01", "2026-02-15", "2026-02-20", "2026-02-28"]) {
      const result = await buildAndCompare(`A/C1/${date}`, unitA, date, cycleA1, 1n);
      if (date === "2026-02-01") c1Feb1Generation = result.generationId;
    }
    const c1Signature = await signature(prisma, unitA, "2026-02-01");
    expect(c1Signature.generation_id).toBe(c1Feb1Generation);
    expect([
      c1Signature.row_count,
      ...[c1Signature.apl, c1Signature.epl, c1Signature.apo,
        c1Signature.epo, c1Signature.ahl, c1Signature.ehl].map((v) => Number(numeric(v))),
    ]).toEqual([13n, 130, 132, 958, 897, 142, 127]);

    // Red control: mutate every akhir boundary to `< D` without changing the
    // production SQL, then ask the same equality checker to inspect it.
    const mutantGeneration = randomUUID();
    await scoped(prisma, unitA, async (tx) => {
      await tx.$queryRawUnsafe(
        INSERT_BUILDING_MANIFEST_SQL,
        unitA, "2026-02-01", mutantGeneration, SNAPSHOT_FORMULA_VERSION,
        cycleA1, 1n, 99n, null, null,
      );
      const mutantSql = MATERIALIZE_FULL_HISTORY_SQL.replaceAll("<= $2::date", "< $2::date");
      expect(mutantSql).not.toBe(MATERIALIZE_FULL_HISTORY_SQL);
      await tx.$executeRawUnsafe(mutantSql, unitA, "2026-02-01", mutantGeneration, cycleA1);
    });
    const mutant = await compare(prisma, unitA, "2026-02-01", mutantGeneration);
    if (process.env.SNAPSHOT_B2_REQUIRE_MUTANT_EQUALITY === "1") {
      // This command is deliberately run once and must exit nonzero.
      expect(mutant.mismatched_cells).toBe(0n);
    }
    expect(mutant.mismatched_rows).toBe(7n);
    expect(mutant.mismatched_cells).toBe(8n);
    gateReport.red_mutant = {
      mismatched_rows: String(mutant.mismatched_rows),
      mismatched_cells: String(mutant.mismatched_cells),
    };
    await scoped(prisma, unitA, async (tx) => {
      await tx.$executeRawUnsafe(
        "DELETE FROM app.saldo_pelanggan_snapshot_row WHERE unit_id=$1::smallint AND as_of_date=$2::date AND generation_id=$3::uuid",
        unitA, "2026-02-01", mutantGeneration,
      );
      await tx.$executeRawUnsafe(
        "DELETE FROM app.saldo_pelanggan_snapshot_manifest WHERE unit_id=$1::smallint AND as_of_date=$2::date AND generation_id=$3::uuid",
        unitA, "2026-02-01", mutantGeneration,
      );
    });

    await replaceMirror(prisma, unitA, CUT_A_C2);
    const c2Jan31 = await buildAndCompare("A/C2/2026-01-31", unitA, "2026-01-31", cycleA2, 2n);

    // Prepare G2 with production delta SQL, deliberately retain only six rows,
    // prove the reader still sees G1, restore all rows, then pause inside the
    // final transaction after manifest completion and before pointer CAS.
    const g2 = randomUUID();
    await scoped(prisma, unitA, async (tx) => {
      await tx.$queryRawUnsafe(
        INSERT_BUILDING_MANIFEST_SQL,
        unitA, "2026-02-01", g2, SNAPSHOT_FORMULA_VERSION,
        cycleA2, 2n, 0n, "2026-01-31", c2Jan31.generationId,
      );
      await tx.$executeRawUnsafe(
        MATERIALIZE_DELTA_SQL,
        unitA, "2026-02-01", g2, cycleA2, "2026-01-31", c2Jan31.generationId,
      );
      await tx.$executeRawUnsafe(
        `DELETE FROM app.saldo_pelanggan_snapshot_row r
         WHERE r.unit_id=$1::smallint AND r.as_of_date=$2::date AND r.generation_id=$3::uuid
           AND r.customer_code NOT IN (
             SELECT customer_code FROM app.saldo_pelanggan_snapshot_row
             WHERE unit_id=$1::smallint AND as_of_date=$2::date AND generation_id=$3::uuid
             ORDER BY customer_code LIMIT 6
           )`,
        unitA, "2026-02-01", g2,
      );
    });
    const beforePublish = await signature(prisma, unitA, "2026-02-01");
    expect(signatureText(beforePublish)).toBe(signatureText(c1Signature));
    await scoped(prisma, unitA, async (tx) => {
      await tx.$executeRawUnsafe(
        MATERIALIZE_DELTA_SQL,
        unitA, "2026-02-01", g2, cycleA2, "2026-01-31", c2Jan31.generationId,
      );
    });

    let enterBarrier!: () => void;
    let releaseBarrier!: () => void;
    const entered = new Promise<void>((resolve) => { enterBarrier = resolve; });
    const release = new Promise<void>((resolve) => { releaseBarrier = resolve; });
    const publish = builder.publishPreparedGeneration(
      {
        unitId: unitA,
        asOfDate: "2026-02-01",
        sourceCycleId: cycleA2,
        sourceCycleSequence: 2n,
        rebuildEpoch: 0n,
      },
      g2,
      {
        syntheticWibMinutes: 180,
        beforePointerSwap: async () => {
          enterBarrier();
          await release;
        },
      },
    );
    await entered;
    let duringPublish: SignatureRow;
    try {
      duringPublish = await signature(prisma, unitA, "2026-02-01");
      expect(signatureText(duringPublish)).toBe(signatureText(c1Signature));
    } finally {
      releaseBarrier();
    }
    expect(await publish).toBe(true);
    const afterPublish = await signature(prisma, unitA, "2026-02-01");
    expect(afterPublish.generation_id).toBe(g2);
    expect([
      afterPublish.row_count,
      ...[afterPublish.apl, afterPublish.epl, afterPublish.apo,
        afterPublish.epo, afterPublish.ahl, afterPublish.ehl].map((v) => Number(numeric(v))),
    ]).toEqual([13n, 180, 182, 958, 897, 142, 127]);
    gateReport.atomic_publication = {
      partial_build_reader: signatureText(beforePublish),
      final_transaction_reader: signatureText(duringPublish!),
      after_commit_reader: signatureText(afterPublish),
      allowed_generations: [c1Feb1Generation, g2],
    };

    const c2Feb1Comparison = await compare(prisma, unitA, "2026-02-01");
    expectEqual(c2Feb1Comparison);
    equalityReport.push(reportComparison("A/C2/2026-02-01", c2Feb1Comparison));
    for (const date of ["2026-02-15", "2026-02-20", "2026-02-28"]) {
      await buildAndCompare(`A/C2/${date}`, unitA, date, cycleA2, 2n);
    }

    await replaceMirror(prisma, unitA, CUT_A_C3);
    for (const date of ["2026-02-01", "2026-02-28"]) {
      await buildAndCompare(`A/C3/${date}`, unitA, date, cycleA3, 3n);
    }
    const c3Signature = await signature(prisma, unitA, "2026-02-01");
    expect([
      c3Signature.row_count,
      ...[c3Signature.apl, c3Signature.epl, c3Signature.apo,
        c3Signature.epo, c3Signature.ahl, c3Signature.ehl].map((v) => Number(numeric(v))),
    ]).toEqual([12n, 180, 182, 933, 872, 142, 127]);

    await replaceMirror(prisma, unitB, CUT_B_C1);
    let bBaselineGeneration = "";
    for (const date of ["2026-01-31", "2026-02-01", "2026-02-15"]) {
      const result = await builder.build(
        {
          unitId: unitB,
          asOfDate: date,
          sourceCycleId: cycleB1,
          sourceCycleSequence: 1n,
          rebuildEpoch: 0n,
        },
        { syntheticWibMinutes: 180 },
      );
      if (date === "2026-01-31") bBaselineGeneration = result.baseline.generationId;
      const comparison = await compare(prisma, unitB, date);
      expectEqual(comparison);
      equalityReport.push(reportComparison(`B/C1/${date}`, comparison));
    }
    const noDots = await scoped(prisma, unitB, async (tx) => tx.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT count(*)::bigint AS count FROM (
         SELECT btrim(ckdplg) AS code FROM public.pelanggan_master WHERE unit_id=$1::smallint
         UNION ALL SELECT btrim(ckdplg) FROM public.bppiut WHERE unit_id=$1::smallint
         UNION ALL SELECT btrim(ckdplg) FROM public.bphut WHERE unit_id=$1::smallint
         UNION ALL SELECT customer_code FROM app.saldo_pelanggan_snapshot_row WHERE unit_id=$1::smallint
       ) x WHERE position('.' in code) > 0`,
      unitB,
    ));
    expect(noDots[0]?.count).toBe(0n);

    // 0038: every other completion field is valid, but row_count remains NULL.
    const constraintDate = "2026-03-10";
    const constraintGeneration = randomUUID();
    let constraintError = { code: "", message: "" };
    await scoped(prisma, unitA, async (tx) => {
      await tx.$queryRawUnsafe(
        INSERT_BUILDING_MANIFEST_SQL,
        unitA, constraintDate, constraintGeneration, SNAPSHOT_FORMULA_VERSION,
        cycleA3, 3n, 0n, null, null,
      );
      await tx.$executeRawUnsafe("SAVEPOINT b2_constraint_probe");
      try {
        await tx.$executeRawUnsafe(
          `UPDATE app.saldo_pelanggan_snapshot_manifest m
           SET status='complete', computed_at=clock_timestamp(), completed_at=clock_timestamp(),
               published=true, published_at=clock_timestamp(), validation_passed=true,
               customer_key_count=13, row_count=NULL, row_keyed_checksum=$4::bytea,
               awal_piutang_lokal_total=0, akhir_piutang_lokal_total=0,
               awal_piutang_online_total=0, akhir_piutang_online_total=0,
               awal_hutang_lokal_total=0, akhir_hutang_lokal_total=0,
               source_pelanggan_row_count=c.pelanggan_row_count,
               source_pelanggan_keyed_checksum=c.pelanggan_keyed_checksum,
               source_bppiut_row_count=c.bppiut_row_count,
               source_bppiut_keyed_checksum=c.bppiut_keyed_checksum,
               source_bphut_row_count=c.bphut_row_count,
               source_bphut_keyed_checksum=c.bphut_keyed_checksum
           FROM app.saldo_pelanggan_source_cycle c
           WHERE m.unit_id=$1::smallint AND m.as_of_date=$2::date AND m.generation_id=$3::uuid
             AND c.unit_id=m.unit_id AND c.source_cycle_id=m.source_cycle_id`,
          unitA, constraintDate, constraintGeneration, checksum("0038-red"),
        );
      } catch (error) {
        constraintError = dbError(error);
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT b2_constraint_probe");
      }
    });
    expect(constraintError.code).toBe("23514");
    expect(constraintError.message).toContain("sps_manifest_complete_row_count_required");
    gateReport.constraint_0038 = constraintError;

    // Not-ready building state returns no numeric rows and cannot be pointed at.
    const notReadyDate = "2026-03-11";
    const notReadyGeneration = randomUUID();
    let pointerError = { code: "", message: "" };
    await scoped(prisma, unitA, async (tx) => {
      await tx.$queryRawUnsafe(
        INSERT_BUILDING_MANIFEST_SQL,
        unitA, notReadyDate, notReadyGeneration, SNAPSHOT_FORMULA_VERSION,
        cycleA3, 3n, 0n, null, null,
      );
      await tx.$executeRawUnsafe("SAVEPOINT b2_pointer_probe");
      try {
        await tx.$executeRawUnsafe(
          `INSERT INTO app.saldo_pelanggan_snapshot_pointer (
             unit_id, as_of_date, generation_id, generation_status,
             generation_published, generation_validation_passed,
             source_cycle_sequence, rebuild_epoch
           ) VALUES ($1::smallint,$2::date,$3::uuid,'complete',true,true,3,0)`,
          unitA, notReadyDate, notReadyGeneration,
        );
      } catch (error) {
        pointerError = dbError(error);
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT b2_pointer_probe");
      }
    });
    expect(pointerError.code).toBe("23503");
    const notReadyRows = await scoped(prisma, unitA, async (tx) => tx.$queryRawUnsafe<unknown[]>(
      READ_READY_SNAPSHOT_SQL, unitA, notReadyDate,
    ));
    expect(notReadyRows).toHaveLength(0);
    const buildingState = await scoped(prisma, unitA, async (tx) => tx.$queryRawUnsafe<Array<{ status: string }>>(
      "SELECT status FROM app.saldo_pelanggan_snapshot_manifest WHERE unit_id=$1::smallint AND as_of_date=$2::date AND generation_id=$3::uuid",
      unitA, notReadyDate, notReadyGeneration,
    ));
    expect(buildingState[0]?.status).toBe("building");

    const readyZeroRows = await scoped(prisma, unitB, async (tx) => tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
      READ_READY_SNAPSHOT_SQL, unitB, "2025-12-31",
    ));
    expect(readyZeroRows).toHaveLength(3);
    expect(readyZeroRows.every((row) => [
      row.awal_piutang_lokal, row.akhir_piutang_lokal,
      row.awal_piutang_online, row.akhir_piutang_online,
      row.awal_hutang_lokal, row.akhir_hutang_lokal,
    ].every((value) => Number(numeric(value)) === 0))).toBe(true);
    expect(readyZeroRows[0]?.generation_id).toBe(bBaselineGeneration);
    gateReport.readiness = {
      not_ready_status: buildingState[0]?.status,
      not_ready_numeric_rows: notReadyRows.length,
      pointer_rejection: pointerError.code,
      ready_zero_rows: readyZeroRows.length,
      ready_zero_generation: bBaselineGeneration,
    };

    expect(equalityReport).toHaveLength(15);
    gateReport.hard_cases = {
      zero_balance_customer: true,
      dotted_and_nondotted: true,
      sjenis_1_5_3_4_and_nondotted_4_excluded: true,
      sbatal_1_excluded: true,
      bppiut_orphan_left_join: true,
      unit_without_dotted_codes: true,
      backdated_correction_and_sbatal_flip: true,
      missing_ledger_key_across_cycles: true,
      month_start_and_end_boundaries: true,
      strict_vs_inclusive_date_boundaries: true,
    };
    process.stdout.write(`B2_EQUALITY_REPORT=${JSON.stringify(equalityReport)}\n`);
    process.stdout.write(`B2_GATE_REPORT=${JSON.stringify(gateReport)}\n`);
  }, 120_000);
});
