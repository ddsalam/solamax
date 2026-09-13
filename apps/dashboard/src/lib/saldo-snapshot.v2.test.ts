import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "./scope-rule";
import type { SaldoSnapshotPointer, SaldoSnapshotRow } from "./saldo-snapshot";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./db", () => ({ qScoped: read }));
import { assembleReadySaldoSnapshot, getSaldoSnapshot } from "./saldo-snapshot";

// Recorded source cut: session-notes/evidence/2026-09-13-piutang-fase2-gerbang-a/01-audit.txt:68-70.
// No calculation from a net balance supplies these gross amounts.
const actual = {
  awalPiutangLokal: 13_052_684_187.5, akhirPiutangLokal: 13_052_684_187.5,
  awalPiutangOnline: 900_000, akhirPiutangOnline: 900_000,
  awalHutangLokal: -673_010_538, akhirHutangLokal: -673_010_538,
  awalPiutangLokalDebet: 122_345_938_294, awalPiutangLokalKredit: 109_293_254_106.5,
  akhirPiutangLokalDebet: 122_345_938_294, akhirPiutangLokalKredit: 109_293_254_106.5,
  awalPiutangOnlineDebet: 10_505_841, awalPiutangOnlineKredit: 9_605_841,
  akhirPiutangOnlineDebet: 10_505_841, akhirPiutangOnlineKredit: 9_605_841,
  awalHutangLokalDebet: 53_549_062_678.5, awalHutangLokalKredit: 54_222_073_216.5,
  akhirHutangLokalDebet: 53_549_062_678.5, akhirHutangLokalKredit: 54_222_073_216.5,
};
const pointer: SaldoSnapshotPointer = {
  ...actual, generationId: "v2-generation", rowCount: 1, formulaVersion: "saldo-pelanggan-v2",
  computedAt: "2026-09-13T02:00:00Z", sourceCycleId: "source-cut", sourceCompletedAt: "2026-09-13T01:00:00Z",
  pendingReplacement: false, staleInvalidFrom: null,
};
// A single synthetic row carries real manifest amounts to exercise the transport;
// this is not presented as an actual IB customer.
const row: SaldoSnapshotRow = { ...actual, customerCode: "TRANSPORT.1", customerName: "Transport fixture" };
const unit = 1 as ScopedUnitId;

beforeEach(() => read.mockReset());

describe("v2 snapshot transport and public composition", () => {
  it("retains every real gross amount and half rupiah through JSON", () => {
    const snapshot = assembleReadySaldoSnapshot("2026-09-13", pointer, { status: "ready", rows: [row], hasOnlineCustomer: true });
    const decoded = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
    expect(decoded.rows[0]).toEqual(row);
    expect(decoded.metadata.debetTotals.awal.piutangLokal).toBe(122_345_938_294);
    expect(decoded.metadata.kreditTotals.awal.piutangLokal).toBe(109_293_254_106.5);
    expect(decoded.metadata.totals.awal.piutangLokal).toBe(13_052_684_187.5);
    expect(decoded.metadata.debetTotals.akhir.hutangLokal - decoded.metadata.kreditTotals.akhir.hutangLokal).toBe(-673_010_538);
    // Measure exactness in integer half-rupiah units instead of an epsilon assertion.
    expect(BigInt(decoded.metadata.kreditTotals.awal.piutangLokal * 2)).toBe(218586508213n);
    expect(BigInt(decoded.metadata.debetTotals.awal.piutangLokal * 2)).toBe(244691876588n);
    expect(decoded.metadata).not.toHaveProperty("awalPiutangLokalDebet");
  });

  it("direct reader and shared cache assembler produce the same 18-number contract", async () => {
    read.mockResolvedValueOnce([pointer]).mockResolvedValueOnce([
      { integrityVerified: true }, { integrityVerified: false, ...row },
    ]);
    const got = await getSaldoSnapshot(unit, "2026-09-13");
    expect(got).toEqual(assembleReadySaldoSnapshot("2026-09-13", pointer, { status: "ready", rows: [row], hasOnlineCustomer: true }));
    expect(read.mock.calls.every((call) => call[0] === unit)).toBe(true);
  });

  it("does not expose amounts without a successful integrity sentinel", async () => {
    read.mockResolvedValueOnce([pointer]).mockResolvedValueOnce([{ integrityVerified: false, ...row }]).mockResolvedValueOnce([pointer]);
    expect(await getSaldoSnapshot(unit, "2026-09-13")).toEqual({ status: "not_ready", asOfDate: "2026-09-13", reason: "incomplete_snapshot" });
  });
});
