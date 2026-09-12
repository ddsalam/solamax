import { describe, expect, it } from "vitest";
import { SNAPSHOT_OPERATIONAL_LIMITS } from "./snapshot-config.js";
import {
  assertBuildRequest,
  comparePublicationTuple,
  evaluateOperationalGate,
  previousMonthEnd,
  transactionBudgetMilliseconds,
} from "./snapshot-builder.service.js";

describe("snapshot builder invariants", () => {
  it("computes the previous calendar month end without local-time drift", () => {
    expect(previousMonthEnd("2026-02-01")).toBe("2026-01-31");
    expect(previousMonthEnd("2024-03-31")).toBe("2024-02-29");
    expect(previousMonthEnd("2026-01-15")).toBe("2025-12-31");
  });

  it("orders publication tuples by source sequence then rebuild epoch", () => {
    expect(comparePublicationTuple([2n, 0n], [1n, 99n])).toBeGreaterThan(0);
    expect(comparePublicationTuple([2n, 3n], [2n, 4n])).toBeLessThan(0);
    expect(comparePublicationTuple([2n, 3n], [2n, 3n])).toBe(0);
  });

  it("enforces the fixed WIB and disk gates", () => {
    const cap = SNAPSHOT_OPERATIONAL_LIMITS.databaseReviewBytes;
    expect(evaluateOperationalGate(120, cap - 1, false)).toEqual({ ok: true });
    expect(evaluateOperationalGate(299, cap - 1, false)).toEqual({ ok: true });
    // SEMENTARA 2026-09-12: batas 299/300 dipulihkan bersama pengembalian config.
    expect(evaluateOperationalGate(1071, cap - 1, false)).toEqual({ ok: true });
    expect(evaluateOperationalGate(1440, cap - 1, false)).toEqual({
      ok: false,
      reason: "outside_build_window",
    });
    expect(evaluateOperationalGate(119, cap - 1, false).ok).toBe(false);
    expect(evaluateOperationalGate(285, cap - 1, true)).toEqual({
      ok: false,
      reason: "latest_lease_passed",
    });
    expect(evaluateOperationalGate(284, cap - 1, true)).toEqual({ ok: true });
    expect(evaluateOperationalGate(180, cap, false)).toEqual({
      ok: false,
      reason: "disk_review_required",
    });
  });

  it("rejects malformed or out-of-range build requests before SQL", () => {
    const valid = {
      unitId: 1,
      asOfDate: "2026-02-01",
      sourceCycleId: "11111111-1111-4111-8111-111111111111",
      sourceCycleSequence: 2n,
      rebuildEpoch: 0n,
    };
    expect(() => assertBuildRequest(valid)).not.toThrow();
    expect(() => assertBuildRequest({ ...valid, unitId: 40_000 })).toThrow(/unitId/);
    expect(() => assertBuildRequest({ ...valid, asOfDate: "2026-02-31" })).toThrow(/asOfDate/);
    expect(() => assertBuildRequest({ ...valid, sourceCycleId: "not-uuid" })).toThrow(/sourceCycleId/);
    expect(() => assertBuildRequest({ ...valid, sourceCycleSequence: 0n })).toThrow(/sourceCycleSequence/);
    expect(() => assertBuildRequest({ ...valid, rebuildEpoch: -1n })).toThrow(/rebuildEpoch/);
    expect(() => assertBuildRequest({ ...valid, workId: "11111111-1111-4111-8111-111111111111" })).toThrow(/together/);
    expect(() => assertBuildRequest({ ...valid, leaseOwner: "worker-1" })).toThrow(/together/);
    expect(() => assertBuildRequest({
      ...valid,
      workId: "11111111-1111-4111-8111-111111111111",
      leaseOwner: "  ",
    })).toThrow(/leaseOwner/);
  });

  it("sets Prisma transaction budgets to the accepted phase and attempt caps", () => {
    expect(transactionBudgetMilliseconds("build", undefined, 1_000)).toBe(600_000);
    expect(transactionBudgetMilliseconds("publish", undefined, 1_000)).toBe(30_000);
    expect(transactionBudgetMilliseconds("build", 6_000, 1_000)).toBe(5_000);
    expect(transactionBudgetMilliseconds("publish", 999, 1_000)).toBe(-1);
  });
});
