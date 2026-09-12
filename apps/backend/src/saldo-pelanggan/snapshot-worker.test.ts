import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PrismaService } from "../prisma.service.js";
import {
  SnapshotBuildError,
  SnapshotBuilderService,
} from "./snapshot-builder.service.js";
import { PUBLICATION_OPERATIONAL_GATE_SQL, SET_UNIT_SCOPE_SQL } from "./snapshot-sql.js";
import {
  FAIL_EXPIRED_MANIFEST_SQL,
  FAIL_ORPHAN_MANIFEST_SQL,
  HEARTBEAT_WORK_SQL,
  LEASE_WORK_SQL,
  REAP_EXPIRED_WORK_SQL,
  RETRY_WORK_SQL,
} from "./snapshot-worker-sql.js";
import { SNAPSHOT_OPERATIONAL_LIMITS } from "./snapshot-config.js";
import { SnapshotWorkerService } from "./snapshot-worker.service.js";
import type { SnapshotSourceCaptureService } from "./source-capture.service.js";

const work = {
  unit_id: 1,
  work_id: "11111111-1111-4111-8111-111111111111",
  as_of_date: "2026-02-01",
  source_cycle_id: "22222222-2222-4222-8222-222222222222",
  source_cycle_sequence: 2n,
  rebuild_epoch: 0n,
  attempt_count: 1,
};

interface HarnessOptions {
  gateMinutes?: number;
  leased?: typeof work | null;
  leaseError?: unknown;
  retryRow?: { work_id: string; state: "retry_wait" | "dead_letter" };
}

function harness(options: HarnessOptions = {}) {
  const txQuery = vi.fn(async (sql: string, ...params: unknown[]) => {
    if (sql === SET_UNIT_SCOPE_SQL) return [];
    if ([FAIL_EXPIRED_MANIFEST_SQL, FAIL_ORPHAN_MANIFEST_SQL, REAP_EXPIRED_WORK_SQL].includes(sql)) return [];
    if (sql === LEASE_WORK_SQL) {
      if (options.leaseError) throw options.leaseError;
      return options.leased === undefined ? [] : options.leased === null ? [] : [options.leased];
    }
    if (sql === RETRY_WORK_SQL) return options.retryRow ? [options.retryRow] : [];
    if (sql === HEARTBEAT_WORK_SQL) return [{ work_id: work.work_id }];
    throw new Error(`unexpected transaction SQL: ${sql.slice(0, 40)} ${JSON.stringify(params)}`);
  });
  const tx = { $queryRawUnsafe: txQuery };
  const prisma = {
    $transaction: vi.fn(async (run: (client: typeof tx) => Promise<unknown>) => run(tx)),
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      if (sql !== PUBLICATION_OPERATIONAL_GATE_SQL) throw new Error("unexpected direct SQL");
      return [{ wib_minutes: options.gateMinutes ?? 180, database_bytes: 1n }];
    }),
  };
  const builder = { build: vi.fn() };
  const sourceCapture = { finalizeReady: vi.fn(async () => null) };
  const service = new SnapshotWorkerService(
    prisma as unknown as PrismaService,
    builder as unknown as SnapshotBuilderService,
    sourceCapture as unknown as SnapshotSourceCaptureService,
  );
  return { service, prisma, builder, sourceCapture, txQuery };
}

describe("snapshot worker durable queue", () => {
  it("builds capped exponential backoff policy from the fixed limits", () => {
    expect(RETRY_WORK_SQL).toContain(`LEAST(${SNAPSHOT_OPERATIONAL_LIMITS.retryInitialSeconds} * power`);
    expect(RETRY_WORK_SQL).toContain(`, ${SNAPSHOT_OPERATIONAL_LIMITS.attemptSeconds})`);
    expect(RETRY_WORK_SQL).toContain(`random() * ${SNAPSHOT_OPERATIONAL_LIMITS.retryJitterFraction}`);
  });

  it("leases only one exact-unit item inside the fixed WIB/disk gates", () => {
    expect(LEASE_WORK_SQL).toContain("FOR UPDATE OF w SKIP LOCKED");
    expect(LEASE_WORK_SQL).toContain("unit_id = $1::smallint");
    expect(LEASE_WORK_SQL).toContain("Asia/Pontianak");
    expect(LEASE_WORK_SQL).toContain("< 285");
    expect(LEASE_WORK_SQL).toContain("g.database_bytes < 9000000000");
    expect(LEASE_WORK_SQL).toContain("state = 'leased'");
    expect(LEASE_WORK_SQL).toContain("attempt_count = attempt_count + 1");
  });

  it("heartbeats and recovers only the matching owner lease", () => {
    expect(HEARTBEAT_WORK_SQL).toContain("lease_owner = $3::text");
    expect(HEARTBEAT_WORK_SQL).toContain("state = 'leased'");
    expect(HEARTBEAT_WORK_SQL).toContain("lease_expires_at >= clock_timestamp()");
    expect(REAP_EXPIRED_WORK_SQL).toContain("lease_expires_at < clock_timestamp()");
    expect(REAP_EXPIRED_WORK_SQL).toContain("superseded_by_pending_successor");
    expect(RETRY_WORK_SQL).toContain("dead_letter");
    expect(RETRY_WORK_SQL).toContain("retry_wait");
    expect(RETRY_WORK_SQL).toContain("attempt_count >= 5");
    expect(RETRY_WORK_SQL).toContain("NOT $5::boolean");
    expect(FAIL_EXPIRED_MANIFEST_SQL).toContain("date_trunc('month', w.as_of_date)");
    expect(FAIL_EXPIRED_MANIFEST_SQL).not.toContain("w.generation_id IS NOT NULL");
  });

  it("stops at the operational gate before leasing", async () => {
    const { service, builder, sourceCapture, txQuery } = harness({ gateMinutes: 300 });
    await expect(service.runOnce(1, "worker-1")).resolves.toEqual({
      status: "skipped",
      reason: "outside_build_window",
    });
    expect(txQuery).not.toHaveBeenCalledWith(LEASE_WORK_SQL, expect.anything(), expect.anything());
    expect(sourceCapture.finalizeReady).not.toHaveBeenCalled();
    expect(builder.build).not.toHaveBeenCalled();
  });

  it("returns idle when no exact-unit work can be leased", async () => {
    const { service, builder, sourceCapture } = harness();
    await expect(service.runOnce(1, "worker-1")).resolves.toEqual({ status: "idle" });
    expect(sourceCapture.finalizeReady).toHaveBeenCalledWith(1);
    expect(builder.build).not.toHaveBeenCalled();
  });

  it("keeps leasing queued work when ready-cut finalization fails", async () => {
    const warning = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const { service, builder, sourceCapture } = harness({ leased: work });
      sourceCapture.finalizeReady.mockRejectedValueOnce(new Error("injected:diff_changes"));
      builder.build.mockResolvedValue({
        baseline: { asOfDate: "2026-01-31", generationId: randomUUID() },
        target: {
          asOfDate: "2026-02-01",
          generationId: "33333333-3333-4333-8333-333333333333",
        },
        outcome: "published",
      });

      await expect(service.runOnce(1, "worker-1")).resolves.toMatchObject({ status: "done" });
      expect(builder.build).toHaveBeenCalledOnce();
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining("snapshot source finalization warning: injected:diff_changes"),
      );

      await service.runOnce(1, "worker-1");
      expect(sourceCapture.finalizeReady).toHaveBeenCalledTimes(2);
    } finally {
      warning.mockRestore();
    }
  });

  it("reports busy when the database global-one lease guard wins elsewhere", async () => {
    const { service, builder } = harness({ leaseError: { code: "P2002" } });
    await expect(service.runOnce(1, "worker-1")).resolves.toEqual({ status: "busy" });
    expect(builder.build).not.toHaveBeenCalled();
  });

  it("passes exact provenance and lease ownership to a successful build", async () => {
    const { service, builder } = harness({ leased: work });
    builder.build.mockResolvedValue({
      baseline: { asOfDate: "2026-01-31", generationId: randomUUID() },
      target: { asOfDate: "2026-02-01", generationId: "33333333-3333-4333-8333-333333333333" },
      outcome: "published",
    });
    await expect(service.runOnce(1, "worker-1")).resolves.toEqual({
      status: "done",
      workId: work.work_id,
      generationId: "33333333-3333-4333-8333-333333333333",
    });
    expect(builder.build).toHaveBeenCalledWith(expect.objectContaining({
      unitId: 1,
      asOfDate: "2026-02-01",
      sourceCycleId: work.source_cycle_id,
      sourceCycleSequence: 2n,
      rebuildEpoch: 0n,
      workId: work.work_id,
      leaseOwner: "worker-1",
    }), expect.objectContaining({ attemptDeadlineEpochMs: expect.any(Number) }));
  });

  it("caps the build to an earlier deadline supplied by the HTTP caller", async () => {
    const { service, builder } = harness({ leased: work });
    const callerDeadline = Date.now() + 60_000;
    builder.build.mockResolvedValue({
      baseline: { asOfDate: "2026-01-31", generationId: randomUUID() },
      target: { asOfDate: "2026-02-01", generationId: "33333333-3333-4333-8333-333333333333" },
      outcome: "published",
    });

    await expect(service.runOnce(1, "worker-1", {
      attemptDeadlineEpochMs: callerDeadline,
    })).resolves.toMatchObject({ status: "done" });

    expect(builder.build).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ attemptDeadlineEpochMs: callerDeadline }),
    );
  });

  it("reports a superseded publication as a successful terminal outcome", async () => {
    const { service, builder } = harness({ leased: work });
    builder.build.mockResolvedValue({
      baseline: { asOfDate: "2026-01-31", generationId: randomUUID() },
      target: { asOfDate: "2026-02-01", generationId: randomUUID() },
      outcome: "superseded",
    });
    await expect(service.runOnce(1, "worker-1")).resolves.toEqual({
      status: "superseded",
      workId: work.work_id,
    });
  });

  it("heartbeats a running build and stops the timer after completion", async () => {
    vi.useFakeTimers();
    try {
      const { service, builder, txQuery } = harness({ leased: work });
      let finish!: (value: Awaited<ReturnType<SnapshotBuilderService["build"]>>) => void;
      builder.build.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      const running = service.runOnce(1, "worker-1");
      await vi.advanceTimersByTimeAsync(0);
      expect(builder.build).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(SNAPSHOT_OPERATIONAL_LIMITS.heartbeatSeconds * 1_000);
      expect(txQuery).toHaveBeenCalledWith(
        HEARTBEAT_WORK_SQL,
        1,
        work.work_id,
        "worker-1",
      );
      finish({
        baseline: { asOfDate: "2026-01-31", generationId: randomUUID() },
        target: { asOfDate: "2026-02-01", generationId: "33333333-3333-4333-8333-333333333333" },
        outcome: "published",
      });
      await expect(running).resolves.toMatchObject({ status: "done" });

      const heartbeatCalls = txQuery.mock.calls.filter(([sql]) => sql === HEARTBEAT_WORK_SQL).length;
      await vi.advanceTimersByTimeAsync(SNAPSHOT_OPERATIONAL_LIMITS.heartbeatSeconds * 2_000);
      expect(txQuery.mock.calls.filter(([sql]) => sql === HEARTBEAT_WORK_SQL)).toHaveLength(heartbeatCalls);
    } finally {
      vi.useRealTimers();
    }
  });

  it("dead-letters nonretryable builder failures immediately", async () => {
    const { service, builder, txQuery } = harness({
      leased: work,
      retryRow: { work_id: work.work_id, state: "dead_letter" },
    });
    builder.build.mockRejectedValue(new SnapshotBuildError("invalid_customer_key", "bad source", false));
    await expect(service.runOnce(1, "worker-1")).resolves.toMatchObject({
      status: "dead_letter",
      workId: work.work_id,
    });
    expect(txQuery).toHaveBeenCalledWith(
      RETRY_WORK_SQL,
      1,
      work.work_id,
      "worker-1",
      "invalid_customer_key: bad source",
      false,
    );
  });

  it("requeues retryable failures and surfaces lease loss as terminal", async () => {
    const retryable = harness({
      leased: work,
      retryRow: { work_id: work.work_id, state: "retry_wait" },
    });
    retryable.builder.build.mockRejectedValue(new Error("transient"));
    await expect(retryable.service.runOnce(1, "worker-1")).resolves.toMatchObject({
      status: "retry_wait",
      error: "transient",
    });
    expect(retryable.txQuery).toHaveBeenCalledWith(
      RETRY_WORK_SQL,
      1,
      work.work_id,
      "worker-1",
      "transient",
      true,
    );

    const lost = harness({ leased: work });
    lost.builder.build.mockRejectedValue(new Error("transient"));
    await expect(lost.service.runOnce(1, "worker-1")).resolves.toMatchObject({
      status: "dead_letter",
      error: "lease lost while handling: transient",
    });
  });
});
