import { describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "./scope-rule";

/**
 * SCOPE-WIRING (F6): proves EVERY converted per-unit query passes ITS AUTHORIZED unit as
 * the first arg to qScoped() — the arg that becomes the RLS `app.unit_ids` context. The
 * SQL-text mocks elsewhere delegate qScoped→q and DROP this arg, so scope-correctness would
 * otherwise be untested. Here qScoped is a SPY: if any function hardcoded, dropped, widened,
 * or mistyped its unit, its case FAILS. A wrong/over-broad unit set cannot pass silently.
 */
const { q, qScoped } = vi.hoisted(() => ({
  q: vi.fn((_t: string, _p?: unknown[]) => Promise.resolve([] as unknown[])),
  qScoped: vi.fn((_unit: unknown, _t: string, _p?: unknown[]) => Promise.resolve([] as unknown[])),
}));
vi.mock("./db", () => ({ q, qScoped, pool: {} }));

const Q = await import("./queries");
const U = 4242 as unknown as ScopedUnitId; // sentinel authorized unit
const D = "2026-07-01";

// [name, invocation]. Single-unit fns pass U; the one aggregate fn passes [U].
const CASES: Array<[string, () => Promise<unknown>]> = [
  ["getSyncByUnit", () => Q.getSyncByUnit([U])],
  ["getSalesByProduct", () => Q.getSalesByProduct(U, D, D)],
  ["getDailyOmzet", () => Q.getDailyOmzet(U, D, D)],
  ["getSalesTotals", () => Q.getSalesTotals(U, D, D)],
  ["getShiftInfo", () => Q.getShiftInfo(U, D)],
  ["getCorrections", () => Q.getCorrections(U, D)],
  ["getCorrectedNozzles", () => Q.getCorrectedNozzles(U, D)],
  ["getClosingOpname", () => Q.getClosingOpname(U, D, D)],
  ["getDailyGlByProduct", () => Q.getDailyGlByProduct(U, D, D)],
  ["getDeliveryShortfalls", () => Q.getDeliveryShortfalls(U, D, D, 10)],
  ["getDeliveryByProduct", () => Q.getDeliveryByProduct(U, D, D)],
  ["getDoHarian", () => Q.getDoHarian(U, D)],
  ["getDoAnomalies", () => Q.getDoAnomalies(U, D)],
  ["getDoSuspectSO", () => Q.getDoSuspectSO(U, D)],
  ["getTankStocks", () => Q.getTankStocks(U)],
  ["getRealTank", () => Q.getRealTank(U)],
  ["getLastFills", () => Q.getLastFills(U)],
  ["getNozzles", () => Q.getNozzles(U)],
  ["getAvgDailySales", () => Q.getAvgDailySales(U, D, D)],
  ["getComplianceMatrix", () => Q.getComplianceMatrix(U, 7)],
  ["getTankCount", () => Q.getTankCount(U)],
  ["getLastInputs", () => Q.getLastInputs(U)],
  ["getCashForDate", () => Q.getCashForDate(U, D)],
  ["getPelangganForDate", () => Q.getPelangganForDate(U, D)],
  ["getTerraResmiForDate", () => Q.getTerraResmiForDate(U, D)],
  ["getEdcForDate", () => Q.getEdcForDate(U, D)],
  ["getEdcBlankCard", () => Q.getEdcBlankCard(U, D)],
  ["getDepositForDate", () => Q.getDepositForDate(U, D)],
  ["getSaldoPelanggan", () => Q.getSaldoPelanggan(U, D)],
  ["getManualEntries", () => Q.getManualEntries(U, D, "pengeluaran")],
  ["getUsulanSo", () => Q.getUsulanSo(U, D)],
  ["getUsulanSoList", () => Q.getUsulanSoList(U, 10)],
];

describe("scope-wiring: every converted query passes its authorized unit to qScoped", () => {
  it("covers ALL converted per-unit functions (guards against silent drift)", () => {
    // If someone adds a converted query but forgets a case here, this count trips.
    expect(CASES.length).toBe(32);
  });

  for (const [name, call] of CASES) {
    it(`${name} → qScoped first arg = authorized unit`, async () => {
      qScoped.mockClear();
      q.mockClear();
      await call().catch(() => {}); // ignore downstream post-processing on empty rows
      expect(qScoped, `${name} did not call qScoped (bare q()? unconverted?)`).toHaveBeenCalled();
      const firstArg = qScoped.mock.calls[0]![0];
      if (Array.isArray(firstArg)) expect(firstArg).toEqual([U]);
      else expect(firstArg).toBe(U);
      // And it must NOT fall back to bare q() for the per-unit read.
      expect(q, `${name} also used bare q() for a per-unit read`).not.toHaveBeenCalled();
    });
  }
});
