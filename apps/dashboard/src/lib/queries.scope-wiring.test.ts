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
  ["getDailySalesByProduct", () => Q.getDailySalesByProduct([U], D, D)],
  ["getUnitCoverage", () => Q.getUnitCoverage([U])],
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
  // Ditambahkan 2026-08-07 setelah guard di bawah diperbaiki: keduanya qScoped
  // multi-unit dan SELAMA INI TAK TERCAKUP di tes isolasi ini.
  ["getZeroClosingEvents", () => Q.getZeroClosingEvents([U], D, D)],
  ["getAdminDays", () => Q.getAdminDays([U], D, D)],
];

describe("scope-wiring: every converted query passes its authorized unit to qScoped", () => {
  /**
   * Cakupan DITURUNKAN dari ekspor modul, bukan dari angka hardcoded.
   *
   * ⚠️ RIWAYAT (2026-08-07): guard ini dulu berbunyi `expect(CASES.length)
   * .toBe(34)` — ia membandingkan daftar DENGAN DIRINYA SENDIRI. Itu menangkap
   * PENGHAPUSAN tapi BUTA terhadap KELALAIAN, dan kelalaian justru arah
   * bahayanya. Dua query qScoped multi-unit lolos karenanya:
   * `getZeroClosingEvents` dan `getAdminDays` — yang kedua HIDUP DI PRODUKSI
   * dan tak pernah diuji isolasi tenant sama sekali, pada platform enam tenant
   * tempat RLS adalah gerbang keras satu-satunya.
   *
   * Angka hardcoded yang menjaga kelengkapan adalah kontradiksi. Bandingkan
   * dengan SUMBER KEBENARAN di luar daftar ini: ekspor modulnya sendiri.
   */
  it("covers ALL exported query functions (derived from module exports)", () => {
    const exported = Object.keys(Q)
      .filter((k) => k.startsWith("get") && typeof (Q as Record<string, unknown>)[k] === "function")
      .sort();
    const covered = CASES.map(([n]) => n).sort();
    expect(exported.filter((n) => !covered.includes(n)), "query tanpa uji scope-wiring").toEqual([]);
    // Kontrol anti-hampa: daftar ekspor tak boleh kosong (mis. mock salah jalan).
    expect(exported.length).toBeGreaterThan(30);
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
