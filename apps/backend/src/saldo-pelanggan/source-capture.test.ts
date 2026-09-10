import { describe, expect, it, vi } from "vitest";
import type { IngestPayload } from "@solamax/shared";
import type { PrismaService } from "../prisma.service.js";
import {
  CLAIM_DOMAIN_COMPLETE_SQL,
  COMPLETE_DOMAIN_SQL,
  DOMAIN_EVIDENCE_SQL,
  ENQUEUE_STALE_POINTERS_SQL,
  FAIL_OBSOLETE_SOURCE_CYCLE_SQL,
  FAIL_SUPERSEDED_STAGING_CYCLES_SQL,
  PRUNE_RETIRED_SOURCE_ROWS_SQL,
  PROMOTE_SOURCE_CYCLE_SQL,
  READ_LATEST_COMPLETE_SEQUENCE_SQL,
  READ_READY_SOURCE_CYCLE_SQL,
  READ_SOURCE_CYCLE_SQL,
  REFRESH_PREVIOUS_CYCLE_SQL,
  SUPERSEDE_PENDING_WORK_SQL,
  UPSERT_DIRTY_WATERMARK_SQL,
} from "./source-capture-sql.js";
import {
  SnapshotCaptureError,
  SnapshotSourceCaptureService,
  type SnapshotCaptureStep,
} from "./source-capture.service.js";

const CYCLE_ID = "8d15c6cf-3e80-4db8-8104-8ea8b556be96";
const PREVIOUS_ID = "99a11941-3504-4d16-8f81-4273ce3b0c9a";

const PAYLOAD: IngestPayload = {
  unit_code: "6478111",
  domain: "hutang",
  watermark_high: null,
  source_cut: {
    cycle_id: CYCLE_ID,
    domain: "bphut",
    chunk_index: 0,
    chunk_count: 1,
    row_count: 1,
  },
  tables: {
    bphut: [{
      ckdbphut: "HU-1",
      dtgl: "2026-02-10",
      ckdplg: "P1",
      vcref: null,
      vcket: null,
      njumlah: 20,
      sjnsbp: 2,
      sbatal: 0,
    }],
  },
};

function cycleRow(overrides: Record<string, unknown> = {}) {
  return {
    source_cycle_id: CYCLE_ID,
    source_cycle_sequence: 2n,
    previous_source_cycle_id: PREVIOUS_ID,
    status: "staging",
    pelanggan_row_count: 1n,
    bppiut_row_count: 1n,
    bphut_row_count: null,
    ...overrides,
  };
}

function successfulPrisma(latestSequence = 1n) {
  const calls: string[] = [];
  let claimedBphut = 1n;
  const tx = {
    $executeRawUnsafe: vi.fn(async (sql: string) => {
      calls.push(sql);
      return 1;
    }),
    $queryRawUnsafe: vi.fn(async (sql: string, ...params: unknown[]) => {
      calls.push(sql);
      if (sql === READ_SOURCE_CYCLE_SQL) {
        return [cycleRow()];
      }
      if (sql === READ_READY_SOURCE_CYCLE_SQL) {
        return [cycleRow({ bphut_row_count: claimedBphut })];
      }
      if (Object.values(DOMAIN_EVIDENCE_SQL).includes(sql as never)) {
        return [{ row_count: 1n, keyed_checksum: Buffer.alloc(32, 7) }];
      }
      if (sql === CLAIM_DOMAIN_COMPLETE_SQL.bphut) {
        claimedBphut = BigInt(params[2] as number);
        return [cycleRow({ bphut_row_count: claimedBphut })];
      }
      if (Object.values(COMPLETE_DOMAIN_SQL).includes(sql as never)) {
        return [cycleRow({ bphut_row_count: claimedBphut })];
      }
      if (sql === READ_LATEST_COMPLETE_SEQUENCE_SQL) {
        return [{ source_cycle_sequence: latestSequence }];
      }
      if (sql === REFRESH_PREVIOUS_CYCLE_SQL) {
        return [{ previous_source_cycle_id: PREVIOUS_ID }];
      }
      if (sql === PROMOTE_SOURCE_CYCLE_SQL) {
        return [{ source_cycle_id: CYCLE_ID, source_cycle_sequence: 2n }];
      }
      if (sql === FAIL_OBSOLETE_SOURCE_CYCLE_SQL) {
        return [{ source_cycle_id: CYCLE_ID }];
      }
      return [];
    }),
  };
  const prisma = {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaService;
  return { prisma, calls };
}

describe("SnapshotSourceCaptureService", () => {
  it("captures quickly, then finalizes diff, dirty, promotion, and enqueue in a worker transaction", async () => {
    const { prisma, calls } = successfulPrisma();
    const steps: SnapshotCaptureStep[] = [];
    const service = new SnapshotSourceCaptureService(prisma);
    const captured = await service.capture(1, PAYLOAD, {
      beforeStep: (step) => {
        steps.push(step);
      },
    });
    const result = await service.finalizeReady(1, {
      beforeStep: (step) => {
        steps.push(step);
      },
    });

    expect(captured).toEqual({
      outcome: "ready",
      cycleId: CYCLE_ID,
      sourceCycleSequence: 2n,
    });
    expect(result).toEqual({
      outcome: "complete",
      cycleId: CYCLE_ID,
      sourceCycleSequence: 2n,
    });
    expect(steps).toEqual([
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
    ]);
    expect(calls.indexOf(UPSERT_DIRTY_WATERMARK_SQL)).toBeLessThan(
      calls.indexOf(PROMOTE_SOURCE_CYCLE_SQL),
    );
    expect(calls.indexOf(PROMOTE_SOURCE_CYCLE_SQL)).toBeLessThan(
      calls.indexOf(ENQUEUE_STALE_POINTERS_SQL),
    );
    expect(calls).toContain(FAIL_SUPERSEDED_STAGING_CYCLES_SQL);
    for (const sql of PRUNE_RETIRED_SOURCE_ROWS_SQL) expect(calls).toContain(sql);
  });

  it("rejects a final chunk whose staged full-key count is incomplete", async () => {
    const { prisma } = successfulPrisma();
    const wrong: IngestPayload = {
      ...PAYLOAD,
      source_cut: { ...PAYLOAD.source_cut!, row_count: 2 },
    };
    const service = new SnapshotSourceCaptureService(prisma);
    await expect(service.capture(1, wrong)).resolves.toMatchObject({ outcome: "ready" });
    await expect(service.finalizeReady(1)).rejects.toMatchObject({
      code: "domain_row_count_mismatch",
    } satisfies Partial<SnapshotCaptureError>);
  });

  it("fails an obsolete malformed cut before recalculating its domain evidence", async () => {
    const { prisma, calls } = successfulPrisma(3n);
    const result = await new SnapshotSourceCaptureService(prisma).finalizeReady(1);

    expect(result).toEqual({
      outcome: "obsolete",
      cycleId: CYCLE_ID,
      sourceCycleSequence: 2n,
    });
    expect(calls).not.toContain(DOMAIN_EVIDENCE_SQL.pelanggan_master);
    expect(calls).not.toContain(DOMAIN_EVIDENCE_SQL.bppiut);
    expect(calls).not.toContain(DOMAIN_EVIDENCE_SQL.bphut);
  });

  it.each<SnapshotCaptureStep>([
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
  ])("fault injection reaches and rejects atomic step %s", async (injected) => {
    const { prisma } = successfulPrisma();
    const reached: SnapshotCaptureStep[] = [];
    const service = new SnapshotSourceCaptureService(prisma);
    const run = ["ensure_cycle", "stage_rows", "complete_domain"].includes(injected)
      ? () => service.capture(1, PAYLOAD, {
          beforeStep: (step) => {
            reached.push(step);
            if (step === injected) throw new Error(`injected:${step}`);
          },
        })
      : () => service.finalizeReady(1, {
          beforeStep: (step) => {
            reached.push(step);
            if (step === injected) throw new Error(`injected:${step}`);
          },
        });
    await expect(
      run(),
    ).rejects.toThrow(`injected:${injected}`);
    expect(reached).toContain(injected);
  });
});
