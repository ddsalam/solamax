import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { IngestPayload } from "@solamax/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IngestService } from "../ingest/ingest.service.js";
import { PrismaService } from "../prisma.service.js";
import {
  SnapshotBuildError,
  SnapshotBuilderService,
} from "./snapshot-builder.service.js";
import {
  SnapshotSourceCaptureService,
  type SnapshotCaptureStep,
} from "./source-capture.service.js";

const LIVE = process.env.SNAPSHOT_B3_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const describeLive = LIVE ? describe.sequential : describe.skip;

type Tx = Prisma.TransactionClient;
type MasterRow = {
  ckdplg: string;
  vcnmplg: string | null;
  sjenis: number | null;
  saktif: number | null;
};
type LedgerRow = {
  key: string;
  dtgl: string;
  ckdplg: string | null;
  njumlah: number;
  sjnsbp: number;
  sbatal: number;
};
type Cut = { master: MasterRow[]; piut: LedgerRow[]; hut: LedgerRow[] };

const TARGET_DATES = ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-15"];
const FAULT_STEPS: SnapshotCaptureStep[] = [
  "ensure_cycle",
  "stage_rows",
  "complete_domain",
  "verify_domains",
  "diff_changes",
  "dirty_watermark",
  "mark_pointers",
  "promote_cycle",
  "enqueue_work",
  "prune_source_cuts",
];

const INITIAL_A: Cut = {
  master: [
    { ckdplg: "P1", vcnmplg: "Local One", sjenis: 1, saktif: 1 },
    { ckdplg: "P2", vcnmplg: "Online Class", sjenis: 3, saktif: 1 },
    { ckdplg: "P3", vcnmplg: "Local Three", sjenis: 1, saktif: 1 },
    { ckdplg: "03.000.0001", vcnmplg: "Dotted", sjenis: 3, saktif: 1 },
  ],
  piut: [
    { key: "PI-BACK", dtgl: "2026-01-10", ckdplg: "P1", njumlah: 100, sjnsbp: 1, sbatal: 0 },
    { key: "PI-FLIP-OFF", dtgl: "2026-02-05", ckdplg: "P1", njumlah: 50, sjnsbp: 1, sbatal: 0 },
    { key: "PI-FLIP-ON", dtgl: "2026-02-06", ckdplg: "P1", njumlah: 40, sjnsbp: 1, sbatal: 1 },
    { key: "PI-DELETE", dtgl: "2026-03-10", ckdplg: "P1", njumlah: 30, sjnsbp: 1, sbatal: 0 },
    { key: "PI-CLASS", dtgl: "2026-01-20", ckdplg: "P3", njumlah: 70, sjnsbp: 1, sbatal: 0 },
    { key: "PI-DOT", dtgl: "2026-01-21", ckdplg: "03.000.0001", njumlah: 80, sjnsbp: 1, sbatal: 0 },
  ],
  hut: [
    { key: "HU-ZERO", dtgl: "2026-02-10", ckdplg: "P1", njumlah: 20, sjnsbp: 2, sbatal: 0 },
  ],
};

const INITIAL_B: Cut = {
  master: [{ ckdplg: "B1", vcnmplg: "Unit B", sjenis: 1, saktif: 1 }],
  piut: [{ key: "B-PI", dtgl: "2026-01-15", ckdplg: "B1", njumlah: 11, sjnsbp: 1, sbatal: 0 }],
  hut: [],
};

function cloneCut(cut: Cut): Cut {
  return structuredClone(cut);
}

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function masterPayload(unitCode: string, cycleId: string, rows: MasterRow[]): IngestPayload {
  return {
    unit_code: unitCode,
    domain: "masters",
    watermark_high: null,
    source_cut: {
      cycle_id: cycleId,
      domain: "pelanggan_master",
      chunk_index: 0,
      chunk_count: 1,
      row_count: rows.length,
    },
    tables: { pelanggan_master: rows },
  };
}

function ledgerPayload(
  unitCode: string,
  cycleId: string,
  domain: "bppiut" | "bphut",
  rows: LedgerRow[],
): IngestPayload {
  const mapped = rows.map((row) => ({
    [domain === "bppiut" ? "ckdbppiut" : "ckdbphut"]: row.key,
    dtgl: row.dtgl,
    ckdplg: row.ckdplg,
    vcref: null,
    vcket: null,
    njumlah: row.njumlah,
    sjnsbp: row.sjnsbp,
    sbatal: row.sbatal,
  }));
  return {
    unit_code: unitCode,
    domain: domain === "bppiut" ? "piutang" : "hutang",
    watermark_high: null,
    source_cut: {
      cycle_id: cycleId,
      domain,
      chunk_index: 0,
      chunk_count: 1,
      row_count: rows.length,
    },
    tables: { [domain]: mapped } as IngestPayload["tables"],
  };
}

async function scoped<T>(
  prisma: PrismaService,
  unitId: number,
  run: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      "SELECT set_config('app.unit_ids', $1, true)",
      String(unitId),
    );
    return run(tx);
  });
}

interface CycleEvidence {
  source_cycle_sequence: bigint;
  status: string;
  previous_source_cycle_id: string | null;
}

async function sendCut(
  service: IngestService,
  finalizer: SnapshotSourceCaptureService,
  unitId: number,
  unitCode: string,
  cycleId: string,
  cut: Cut,
): Promise<CycleEvidence> {
  await service.ingest(unitId, masterPayload(unitCode, cycleId, cut.master));
  await service.ingest(unitId, ledgerPayload(unitCode, cycleId, "bppiut", cut.piut));
  await service.ingest(unitId, ledgerPayload(unitCode, cycleId, "bphut", cut.hut));
  await finalizer.finalizeReady(unitId);
  return scoped(prisma, unitId, async (tx) => {
    const rows = await tx.$queryRawUnsafe<CycleEvidence[]>(
      `SELECT source_cycle_sequence, status, previous_source_cycle_id
       FROM app.saldo_pelanggan_source_cycle
       WHERE unit_id=$1::smallint AND source_cycle_id=$2::uuid`,
      unitId,
      cycleId,
    );
    if (!rows[0]) throw new Error("source cycle missing after complete cut");
    return rows[0];
  });
}

interface PointerRow {
  as_of_date: Date;
  generation_id: string;
  pending_replacement: boolean;
  stale_invalid_from: Date | null;
  source_cycle_sequence: bigint;
}

async function pointers(prisma: PrismaService, unitId: number): Promise<PointerRow[]> {
  return scoped(prisma, unitId, (tx) => tx.$queryRawUnsafe<PointerRow[]>(
    `SELECT as_of_date, generation_id, pending_replacement,
            stale_invalid_from, source_cycle_sequence
     FROM app.saldo_pelanggan_snapshot_pointer
     WHERE unit_id=$1::smallint ORDER BY as_of_date`,
    unitId,
  ));
}

async function buildTargets(
  prisma: PrismaService,
  builder: SnapshotBuilderService,
  unitId: number,
  cycleId: string,
  sequence: bigint,
  dates: readonly string[],
): Promise<void> {
  for (const asOfDate of dates) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await builder.build(
          {
            unitId,
            asOfDate,
            sourceCycleId: cycleId,
            sourceCycleSequence: sequence,
            rebuildEpoch: 0n,
          },
          { syntheticWibMinutes: 180 },
        );
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        if (!(error instanceof SnapshotBuildError)
          || error.code !== "pool_acquire_timeout"
          || attempt === 3) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    if (lastError) throw lastError;
  }
}

async function rebuildPending(
  prisma: PrismaService,
  builder: SnapshotBuilderService,
  unitId: number,
  cycleId: string,
  sequence: bigint,
): Promise<string[]> {
  const pending = (await pointers(prisma, unitId))
    .filter((row) => row.pending_replacement)
    .map((row) => row.as_of_date.toISOString().slice(0, 10));
  await buildTargets(prisma, builder, unitId, cycleId, sequence, pending);
  return pending;
}

const DIRECT_COMPARE_SQL = `
WITH master_keys AS (
  SELECT btrim(ckdplg) AS customer_code
  FROM app.saldo_pelanggan_source_pelanggan
  WHERE unit_id=$1::smallint AND source_cycle_id=$2::uuid
), local_keys AS (
  SELECT btrim(ckdplg) AS customer_code
  FROM app.saldo_pelanggan_source_pelanggan
  WHERE unit_id=$1::smallint AND source_cycle_id=$2::uuid AND sjenis IN (1,5)
), live_piut AS (
  SELECT btrim(ckdplg) AS customer_code, dtgl,
         njumlah * CASE sjnsbp WHEN 1 THEN 1 WHEN 2 THEN -1 ELSE 0 END AS value
  FROM app.saldo_pelanggan_source_bppiut
  WHERE unit_id=$1::smallint AND source_cycle_id=$2::uuid
    AND dtgl <= $3::date AND COALESCE(sbatal,0)=0
), live_hut AS (
  SELECT btrim(ckdplg) AS customer_code, dtgl,
         njumlah * CASE sjnsbp WHEN 2 THEN 1 WHEN 1 THEN -1 ELSE 0 END AS value
  FROM app.saldo_pelanggan_source_bphut
  WHERE unit_id=$1::smallint AND source_cycle_id=$2::uuid
    AND dtgl <= $3::date AND COALESCE(sbatal,0)=0
), keys AS (
  SELECT customer_code FROM master_keys
  UNION SELECT customer_code FROM live_piut
  UNION SELECT customer_code FROM live_hut
), piut AS (
  SELECT p.customer_code,
    COALESCE(sum(value) FILTER (WHERE l.customer_code IS NOT NULL
      AND position('.' in p.customer_code)=0 AND dtgl < $3::date),0) apl,
    COALESCE(sum(value) FILTER (WHERE l.customer_code IS NOT NULL
      AND position('.' in p.customer_code)=0 AND dtgl <= $3::date),0) epl,
    COALESCE(sum(value) FILTER (WHERE position('.' in p.customer_code)>0
      AND dtgl < $3::date),0) apo,
    COALESCE(sum(value) FILTER (WHERE position('.' in p.customer_code)>0
      AND dtgl <= $3::date),0) epo
  FROM live_piut p LEFT JOIN local_keys l USING (customer_code)
  GROUP BY p.customer_code
), hut AS (
  SELECT customer_code,
    -COALESCE(sum(value) FILTER (WHERE dtgl < $3::date),0) ahl,
    -COALESCE(sum(value) FILTER (WHERE dtgl <= $3::date),0) ehl
  FROM live_hut GROUP BY customer_code
), direct AS (
  SELECT k.customer_code, COALESCE(p.apl,0) apl, COALESCE(p.epl,0) epl,
         COALESCE(p.apo,0) apo, COALESCE(p.epo,0) epo,
         COALESCE(h.ahl,0) ahl, COALESCE(h.ehl,0) ehl
  FROM keys k LEFT JOIN piut p USING (customer_code) LEFT JOIN hut h USING (customer_code)
), snap AS (
  SELECT r.customer_code, r.awal_piutang_lokal apl, r.akhir_piutang_lokal epl,
         r.awal_piutang_online apo, r.akhir_piutang_online epo,
         r.awal_hutang_lokal ahl, r.akhir_hutang_lokal ehl
  FROM app.saldo_pelanggan_snapshot_pointer p
  JOIN app.saldo_pelanggan_snapshot_row r
    ON r.unit_id=p.unit_id AND r.as_of_date=p.as_of_date
   AND r.generation_id=p.generation_id
  WHERE p.unit_id=$1::smallint AND p.as_of_date=$3::date
), paired AS (
  SELECT d.customer_code direct_key, s.customer_code snapshot_key,
         d.apl d_apl, s.apl s_apl, d.epl d_epl, s.epl s_epl,
         d.apo d_apo, s.apo s_apo, d.epo d_epo, s.epo s_epo,
         d.ahl d_ahl, s.ahl s_ahl, d.ehl d_ehl, s.ehl s_ehl
  FROM direct d FULL OUTER JOIN snap s USING (customer_code)
)
SELECT (SELECT count(*) FROM direct)::bigint direct_rows,
       (SELECT count(*) FROM snap)::bigint snapshot_rows,
       count(*) FILTER (WHERE direct_key IS NULL OR snapshot_key IS NULL)::bigint key_mismatches,
       count(*) FILTER (WHERE d_apl IS DISTINCT FROM s_apl
         OR d_epl IS DISTINCT FROM s_epl OR d_apo IS DISTINCT FROM s_apo
         OR d_epo IS DISTINCT FROM s_epo OR d_ahl IS DISTINCT FROM s_ahl
         OR d_ehl IS DISTINCT FROM s_ehl)::bigint row_mismatches
FROM paired`;

interface CompareRow {
  direct_rows: bigint;
  snapshot_rows: bigint;
  key_mismatches: bigint;
  row_mismatches: bigint;
}

async function expectDirectEquality(
  prisma: PrismaService,
  unitId: number,
  cycleId: string,
  dates: readonly string[],
  label: string,
  report: Array<Record<string, string>>,
): Promise<void> {
  await scoped(prisma, unitId, async (tx) => {
    for (const date of dates) {
      const rows = await tx.$queryRawUnsafe<CompareRow[]>(
        DIRECT_COMPARE_SQL,
        unitId,
        cycleId,
        date,
      );
      const row = rows[0]!;
      expect(row.direct_rows).toBe(row.snapshot_rows);
      expect(row.key_mismatches).toBe(0n);
      expect(row.row_mismatches).toBe(0n);
      report.push({
        case: label,
        date,
        direct_rows: String(row.direct_rows),
        snapshot_rows: String(row.snapshot_rows),
        key_mismatches: String(row.key_mismatches),
        row_mismatches: String(row.row_mismatches),
      });
    }
  });
}

async function minimumChangeDate(
  prisma: PrismaService,
  unitId: number,
  cycleId: string,
): Promise<{ min_date: Date | null; max_date: Date | null }> {
  return scoped(prisma, unitId, async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<{ min_date: Date | null; max_date: Date | null }>>(
      `SELECT min(invalid_from_date)::date min_date, max(invalid_from_date)::date max_date
       FROM app.saldo_pelanggan_source_change
       WHERE unit_id=$1::smallint AND source_cycle_id=$2::uuid`,
      unitId,
      cycleId,
    );
    return rows[0]!;
  });
}

async function dirtyDate(prisma: PrismaService, unitId: number): Promise<Date | null> {
  return scoped(prisma, unitId, async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<{ dirty_invalid_from: Date | null }>>(
      `SELECT dirty_invalid_from FROM app.saldo_pelanggan_dirty
       WHERE unit_id=$1::smallint`,
      unitId,
    );
    return rows[0]?.dirty_invalid_from ?? null;
  });
}

async function cleanupUnit(prisma: PrismaService, unitId: number): Promise<void> {
  await scoped(prisma, unitId, async (tx) => {
    await tx.$executeRawUnsafe("DELETE FROM app.saldo_pelanggan_snapshot_pointer WHERE unit_id=$1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM app.saldo_pelanggan_build_work WHERE unit_id=$1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM app.saldo_pelanggan_dirty WHERE unit_id=$1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM app.saldo_pelanggan_snapshot_row WHERE unit_id=$1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM app.saldo_pelanggan_snapshot_manifest WHERE unit_id=$1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM app.saldo_pelanggan_source_change WHERE unit_id=$1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM app.saldo_pelanggan_source_bppiut WHERE unit_id=$1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM app.saldo_pelanggan_source_bphut WHERE unit_id=$1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM app.saldo_pelanggan_source_pelanggan WHERE unit_id=$1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM app.saldo_pelanggan_source_cycle WHERE unit_id=$1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM public.bppiut WHERE unit_id=$1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM public.bphut WHERE unit_id=$1::smallint", unitId);
    await tx.$executeRawUnsafe("DELETE FROM public.pelanggan_master WHERE unit_id=$1::smallint", unitId);
  });
  await prisma.$executeRawUnsafe("DELETE FROM public.unit WHERE unit_id=$1::smallint", unitId);
}

const prisma = new PrismaService();

describeLive("B3 capture/diff on solamax-pg-rlsstg synthetic units", () => {
  const runId = randomUUID();
  const offset = Number.parseInt(runId.slice(0, 4), 16) % 700;
  const unitA = -28_000 - offset;
  const unitB = -29_000 - offset;
  const unitCodeA = `B3A-${runId}`;
  const unitCodeB = `B3B-${runId}`;
  const tenantId = randomUUID();
  const capture = new SnapshotSourceCaptureService(prisma);
  const ingest = new IngestService(prisma, capture);
  (ingest as unknown as { logger: { log(): void; error(): void } }).logger = {
    log() {},
    error() {},
  };
  const builder = new SnapshotBuilderService(prisma);
  const report: Array<Record<string, string>> = [];
  let cutA = cloneCut(INITIAL_A);
  let cutB = cloneCut(INITIAL_B);
  let currentCycleA = "";
  let currentSequenceA = 0n;
  let currentCycleB = "";
  let currentSequenceB = 0n;

  beforeAll(async () => {
    await prisma.onModuleInit();
    const identity = await prisma.$queryRawUnsafe<Array<{
      database_name: string;
      current_user: string;
      system_identifier: bigint;
      migrations: bigint;
    }>>(`
      SELECT current_database() database_name, current_user,
             (SELECT system_identifier FROM pg_control_system()) system_identifier,
             (SELECT count(*) FROM "_prisma_migrations"
              WHERE migration_name IN ('0037_saldo_pelanggan_snapshot','0038_snapshot_manifest_row_count')
                AND finished_at IS NOT NULL AND rolled_back_at IS NULL)::bigint migrations`);
    expect(identity[0]).toMatchObject({
      database_name: "solamax",
      current_user: "ingest",
      system_identifier: 7_659_054_651_798_528_016n,
      migrations: 2n,
    });
    const occupied = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      "SELECT count(*)::bigint count FROM public.unit WHERE unit_id IN ($1::smallint,$2::smallint)",
      unitA,
      unitB,
    );
    expect(occupied[0]!.count).toBe(0n);
    await prisma.$executeRawUnsafe(
      `INSERT INTO app.tenant (id,name,slug,status) VALUES ($1::uuid,$2,$3,'active')`,
      tenantId,
      `B3 Synthetic ${runId}`,
      `b3-${runId}`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO public.unit (unit_id,code,name,api_key_hash,timezone,tenant_id)
       VALUES ($1::smallint,$2,'B3 Synthetic A',$3,'Asia/Pontianak',$4::uuid),
              ($5::smallint,$6,'B3 Synthetic B',$7,'Asia/Pontianak',$4::uuid)`,
      unitA,
      unitCodeA,
      sha(`A-${runId}`),
      tenantId,
      unitB,
      unitCodeB,
      sha(`B-${runId}`),
    );

    currentCycleA = randomUUID();
    const a = await sendCut(ingest, capture, unitA, unitCodeA, currentCycleA, cutA);
    expect(a.status).toBe("complete");
    currentSequenceA = a.source_cycle_sequence;
    currentCycleB = randomUUID();
    const b = await sendCut(ingest, capture, unitB, unitCodeB, currentCycleB, cutB);
    expect(b.status).toBe("complete");
    currentSequenceB = b.source_cycle_sequence;
    await buildTargets(prisma, builder, unitA, currentCycleA, currentSequenceA, TARGET_DATES);
    await buildTargets(prisma, builder, unitB, currentCycleB, currentSequenceB, TARGET_DATES);
  }, 120_000);

  afterAll(async () => {
    const failures: unknown[] = [];
    try {
      for (const unitId of [unitA, unitB]) {
        try {
          await cleanupUnit(prisma, unitId);
        } catch (error) {
          failures.push(error);
        }
      }
      try {
        await prisma.$executeRawUnsafe("DELETE FROM app.tenant WHERE id=$1::uuid", tenantId);
      } catch (error) {
        failures.push(error);
      }
      const leftovers = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT (
           (SELECT count(*) FROM public.unit WHERE unit_id IN ($1::smallint,$2::smallint)) +
           (SELECT count(*) FROM app.tenant WHERE id=$3::uuid)
         )::bigint count`,
        unitA,
        unitB,
        tenantId,
      );
      expect(leftovers[0]!.count).toBe(0n);
      process.stdout.write(`B3_CASE_REPORT=${JSON.stringify(report)}\n`);
      process.stdout.write("B3_CLEANUP_REPORT={\"remaining_fixture_roots\":\"0\"}\n");
    } finally {
      await prisma.onModuleDestroy();
    }
    if (failures.length > 0) throw new AggregateError(failures, "B3 cleanup failed");
  }, 120_000);

  async function applyNumericCase(
    label: string,
    mutate: (next: Cut) => void,
    expectedDate: string | (() => Promise<string>),
  ): Promise<void> {
    const next = cloneCut(cutA);
    mutate(next);
    const expected = typeof expectedDate === "string" ? expectedDate : await expectedDate();
    const before = new Map((await pointers(prisma, unitA)).map((p) => [
      p.as_of_date.toISOString().slice(0, 10),
      p.generation_id,
    ]));
    const cycleId = randomUUID();
    const evidence = await sendCut(ingest, capture, unitA, unitCodeA, cycleId, next);
    expect(evidence.status).toBe("complete");
    const changes = await minimumChangeDate(prisma, unitA, cycleId);
    expect(changes.min_date?.toISOString().slice(0, 10)).toBe(expected);
    expect((await dirtyDate(prisma, unitA))?.toISOString().slice(0, 10)).toBe(expected);
    const marked = (await pointers(prisma, unitA)).filter((p) => p.pending_replacement);
    expect(marked.length).toBeGreaterThan(0);
    for (const pointer of marked) {
      const date = pointer.as_of_date.toISOString().slice(0, 10);
      expect(pointer.stale_invalid_from?.toISOString().slice(0, 10)).toBe(expected);
      expect(pointer.generation_id).toBe(before.get(date));
    }
    const rebuilt = await rebuildPending(
      prisma,
      builder,
      unitA,
      cycleId,
      evidence.source_cycle_sequence,
    );
    expect(await dirtyDate(prisma, unitA)).toBeNull();
    await expectDirectEquality(prisma, unitA, cycleId, rebuilt, label, report);
    cutA = next;
    currentCycleA = cycleId;
    currentSequenceA = evidence.source_cycle_sequence;
  }

  const oldestStoredA = async () => {
    const rows = await pointers(prisma, unitA);
    return rows[0]!.as_of_date.toISOString().slice(0, 10);
  };

  it("case 1: update back-dated lintas bulan memakai min(old.dtgl,new.dtgl)", async () => {
    await applyNumericCase("cross-month-backdated", (next) => {
      next.piut.find((r) => r.key === "PI-BACK")!.dtgl = "2025-12-15";
    }, "2025-12-15");
  }, 120_000);

  it("case 2: flip sbatal 0→1 menginvalidasi tanggal ledger", async () => {
    await applyNumericCase("sbatal-0-to-1", (next) => {
      next.piut.find((r) => r.key === "PI-FLIP-OFF")!.sbatal = 1;
    }, "2026-02-05");
  }, 120_000);

  it("case 3: flip sbatal 1→0 menginvalidasi tanggal ledger", async () => {
    await applyNumericCase("sbatal-1-to-0", (next) => {
      next.piut.find((r) => r.key === "PI-FLIP-ON")!.sbatal = 0;
    }, "2026-02-06");
  }, 120_000);

  it("case 4: key ledger hilang direkam DELETE dengan old.dtgl", async () => {
    await applyNumericCase("ledger-delete", (next) => {
      next.piut = next.piut.filter((r) => r.key !== "PI-DELETE");
    }, "2026-03-10");
    const change = await scoped(prisma, unitA, (tx) => tx.$queryRawUnsafe<Array<{
      change_kind: string;
      old_business_date: Date;
      new_business_date: Date | null;
    }>>(
      `SELECT change_kind,old_business_date,new_business_date
       FROM app.saldo_pelanggan_source_change
       WHERE unit_id=$1::smallint AND source_cycle_id=$2::uuid
         AND domain='bppiut' AND source_key='PI-DELETE'`,
      unitA,
      currentCycleA,
    ));
    expect(change[0]).toMatchObject({ change_kind: "delete", new_business_date: null });
    expect(change[0]!.old_business_date.toISOString().slice(0, 10)).toBe("2026-03-10");
  }, 120_000);

  it("case 5: full-sync hutang nol tetap lengkap dan merekam DELETE", async () => {
    await applyNumericCase("empty-full-sync-delete", (next) => {
      next.hut = [];
    }, "2026-02-10");
  }, 120_000);

  it("case 6: sjenis lokal→online menginvalidasi snapshot tertua tersimpan", async () => {
    await applyNumericCase("sjenis-local-to-online", (next) => {
      next.master.find((r) => r.ckdplg === "P3")!.sjenis = 3;
    }, oldestStoredA);
  }, 120_000);

  it("case 7: sjenis online→lokal menginvalidasi snapshot tertua tersimpan", async () => {
    await applyNumericCase("sjenis-online-to-local", (next) => {
      next.master.find((r) => r.ckdplg === "P2")!.sjenis = 1;
    }, oldestStoredA);
  }, 120_000);

  it("case 8: perubahan nama saja menjadi label_only tanpa invalidasi numerik", async () => {
    const next = cloneCut(cutA);
    next.master.find((r) => r.ckdplg === "P1")!.vcnmplg = "Renamed Only";
    const before = await pointers(prisma, unitA);
    const cycleId = randomUUID();
    const evidence = await sendCut(ingest, capture, unitA, unitCodeA, cycleId, next);
    const changes = await minimumChangeDate(prisma, unitA, cycleId);
    expect(changes.min_date).toBeNull();
    expect(await dirtyDate(prisma, unitA)).toBeNull();
    const after = await pointers(prisma, unitA);
    expect(after.map((p) => p.generation_id)).toEqual(before.map((p) => p.generation_id));
    const label = await scoped(prisma, unitA, (tx) => tx.$queryRawUnsafe<Array<{
      label_only: boolean;
      classification_changed: boolean;
    }>>(
      `SELECT label_only,classification_changed
       FROM app.saldo_pelanggan_source_change
       WHERE unit_id=$1::smallint AND source_cycle_id=$2::uuid
         AND domain='pelanggan_master' AND source_key='P1'`,
      unitA,
      cycleId,
    ));
    expect(label[0]).toEqual({ label_only: true, classification_changed: false });
    await expectDirectEquality(
      prisma,
      unitA,
      cycleId,
      [TARGET_DATES.at(-1)!],
      "name-only-no-rebuild",
      report,
    );
    cutA = next;
    currentCycleA = cycleId;
    currentSequenceA = evidence.source_cycle_sequence;
  }, 120_000);

  it("case 9: re-key pelanggan menginvalidasi dari snapshot tertua", async () => {
    await applyNumericCase("customer-rekey", (next) => {
      const customer = next.master.find((r) => r.ckdplg === "P3")!;
      customer.ckdplg = "P3-NEW";
      for (const row of next.piut) if (row.ckdplg === "P3") row.ckdplg = "P3-NEW";
    }, oldestStoredA);
  }, 120_000);

  it("case 10: fault tiap tahap tetap 200-equivalent + mirror commit; dirty bertahan lalu pulih", async () => {
    const dirtySeed = cloneCut(cutA);
    dirtySeed.piut.find((r) => r.key === "PI-BACK")!.njumlah += 1;
    const dirtyCycle = randomUUID();
    const dirtyEvidence = await sendCut(ingest, capture, unitA, unitCodeA, dirtyCycle, dirtySeed);
    const durableBefore = (await dirtyDate(prisma, unitA))!.toISOString().slice(0, 10);

    let failedCut = cloneCut(dirtySeed);
    const survival: Array<Record<string, string>> = [];
    for (const [index, injected] of FAULT_STEPS.entries()) {
      failedCut = cloneCut(failedCut);
      failedCut.hut = [{
        key: "HU-FAULT",
        dtgl: "2026-04-01",
        ckdplg: "P1",
        njumlah: 100 + index,
        sjnsbp: 2,
        sbatal: 0,
      }];
      const cycleId = randomUUID();
      await ingest.ingest(unitA, masterPayload(unitCodeA, cycleId, failedCut.master));
      await ingest.ingest(unitA, ledgerPayload(unitCodeA, cycleId, "bppiut", failedCut.piut));
      const captureStep = ["ensure_cycle", "stage_rows", "complete_domain"].includes(injected);
      let response;
      if (captureStep) {
        const injectedCapture = {
          capture: (id: number, payload: IngestPayload) => capture.capture(id, payload, {
            beforeStep: (step) => {
              if (step === injected) throw new Error(`injected:${step}`);
            },
          }),
        } as SnapshotSourceCaptureService;
        const injectedIngest = new IngestService(prisma, injectedCapture);
        (injectedIngest as unknown as { logger: { log(): void; error(): void } }).logger = {
          log() {},
          error() {},
        };
        response = await injectedIngest.ingest(
          unitA,
          ledgerPayload(unitCodeA, cycleId, "bphut", failedCut.hut),
        );
      } else {
        response = await ingest.ingest(
          unitA,
          ledgerPayload(unitCodeA, cycleId, "bphut", failedCut.hut),
        );
        await expect(capture.finalizeReady(unitA, {
          beforeStep: (step) => {
            if (step === injected) throw new Error(`injected:${step}`);
          },
        })).rejects.toThrow(`injected:${injected}`);
      }
      expect(response.upserted).toEqual({ bphut: 1 });
      const mirror = await scoped(prisma, unitA, (tx) =>
        tx.$queryRawUnsafe<Array<{ njumlah: unknown }>>(
          "SELECT njumlah FROM public.bphut WHERE unit_id=$1::smallint AND ckdbphut='HU-FAULT'",
          unitA,
        ));
      expect(Number(mirror[0]!.njumlah)).toBe(100 + index);
      expect((await dirtyDate(prisma, unitA))!.toISOString().slice(0, 10)).toBe(durableBefore);
      survival.push({ step: injected, ingest: "200", mirror: "committed", capture: "rolled_back" });
    }

    const recoveryCycle = randomUUID();
    const recovered = await sendCut(ingest, capture, unitA, unitCodeA, recoveryCycle, failedCut);
    expect((await dirtyDate(prisma, unitA))!.toISOString().slice(0, 10)).toBe(durableBefore);
    const rebuilt = await rebuildPending(
      prisma,
      builder,
      unitA,
      recoveryCycle,
      recovered.source_cycle_sequence,
    );
    expect(await dirtyDate(prisma, unitA)).toBeNull();
    await expectDirectEquality(
      prisma,
      unitA,
      recoveryCycle,
      rebuilt,
      "failure-survival-next-success",
      report,
    );
    process.stdout.write(`B3_INGEST_SURVIVAL=${JSON.stringify(survival)}\n`);
    cutA = failedCut;
    currentCycleA = recoveryCycle;
    currentSequenceA = recovered.source_cycle_sequence;
    expect(dirtyEvidence.status).toBe("complete");
  }, 180_000);

  it("red control MAX memilih tanggal lebih lambat dan gagal terhadap earliest invalidation", async () => {
    const next = cloneCut(cutA);
    next.piut.find((r) => r.key === "PI-BACK")!.njumlah += 2;
    next.piut.find((r) => r.key === "PI-FLIP-ON")!.njumlah += 3;
    // PI-DELETE existed in an older cut but not the immediately previous cut.
    // Reintroducing it proves the filtered old/new FULL JOIN emits INSERT.
    next.piut.push({
      key: "PI-DELETE",
      dtgl: "2026-03-10",
      ckdplg: "P1",
      njumlah: 33,
      sjnsbp: 1,
      sbatal: 0,
    });
    const cycleId = randomUUID();
    const evidence = await sendCut(ingest, capture, unitA, unitCodeA, cycleId, next);
    const dates = await minimumChangeDate(prisma, unitA, cycleId);
    const green = dates.min_date!.toISOString().slice(0, 10);
    const redMax = dates.max_date!.toISOString().slice(0, 10);
    expect(green).toBe("2025-12-15");
    expect(redMax).toBe("2026-03-10");
    expect(redMax).not.toBe(green);
    const resurrected = await scoped(prisma, unitA, (tx) =>
      tx.$queryRawUnsafe<Array<{ change_kind: string }>>(
        `SELECT change_kind FROM app.saldo_pelanggan_source_change
         WHERE unit_id=$1::smallint AND source_cycle_id=$2::uuid
           AND domain='bppiut' AND source_key='PI-DELETE'`,
        unitA,
        cycleId,
      ));
    expect(resurrected[0]?.change_kind).toBe("insert");
    process.stdout.write(`B3_RED_CONTROL=${JSON.stringify({ green_least: green, red_max: redMax, result: "red" })}\n`);
    const rebuilt = await rebuildPending(
      prisma,
      builder,
      unitA,
      cycleId,
      evidence.source_cycle_sequence,
    );
    await expectDirectEquality(prisma, unitA, cycleId, rebuilt, "red-control-green-path", report);
    cutA = next;
    currentCycleA = cycleId;
    currentSequenceA = evidence.source_cycle_sequence;
  }, 120_000);

  it("isolasi dua unit berlaku dua arah", async () => {
    const pointerA = (await pointers(prisma, unitA)).map((p) => p.generation_id);
    const pointerBBefore = (await pointers(prisma, unitB)).map((p) => p.generation_id);
    expect(await dirtyDate(prisma, unitB)).toBeNull();
    const nextB = cloneCut(cutB);
    nextB.piut[0]!.dtgl = "2025-12-20";
    const cycleId = randomUUID();
    const evidence = await sendCut(ingest, capture, unitB, unitCodeB, cycleId, nextB);
    expect((await dirtyDate(prisma, unitB))?.toISOString().slice(0, 10)).toBe("2025-12-20");
    expect((await pointers(prisma, unitA)).map((p) => p.generation_id)).toEqual(pointerA);
    const pointerBAfterCapture = await pointers(prisma, unitB);
    expect(pointerBAfterCapture.map((p) => p.generation_id)).toEqual(pointerBBefore);
    expect(pointerBAfterCapture.some((p) => p.pending_replacement)).toBe(true);
    const rebuilt = await rebuildPending(
      prisma,
      builder,
      unitB,
      cycleId,
      evidence.source_cycle_sequence,
    );
    await expectDirectEquality(prisma, unitB, cycleId, rebuilt, "two-unit-isolation", report);
    expect(await dirtyDate(prisma, unitA)).toBeNull();
    cutB = nextB;
    currentCycleB = cycleId;
    currentSequenceB = evidence.source_cycle_sequence;
    expect(currentCycleA).not.toBe("");
    expect(currentSequenceA).toBeGreaterThan(0n);
    expect(currentCycleB).not.toBe("");
    expect(currentSequenceB).toBeGreaterThan(0n);
  }, 120_000);
});
