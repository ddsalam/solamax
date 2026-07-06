import { beforeAll, describe, expect, it } from "vitest";
import type { ScopedUnitId } from "./scope-rule";

/**
 * FULL-APP-UNDER-RLS (functional). Drives the REAL dashboard query functions —
 * which now run through qScoped() (migration 0016) — as the NON-SUPERUSER role
 * `dashboard_app` against the synthetic instance, and asserts unit-scoped results
 * for a pengawas (single unit) and a direksi (spanning units). Proves the DB-layer
 * RLS backstop returns correct scoped rows through the actual app code path, not
 * just raw SQL.
 *
 * Gated: RLS_SURFACES_LIVE_DB=1 & DATABASE_URL = the dashboard_app connection.
 * ⚠️ `./queries` is imported LAZILY inside beforeAll (like grant/scope integration
 * suites): a static import pulls db.ts → makePool(), which throws with no DATABASE_URL
 * in CI. Lazy import keeps module load DB-free so the suite SKIPS cleanly when not LIVE.
 */
const LIVE = process.env.RLS_SURFACES_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

const U = (n: number) => n as unknown as ScopedUnitId;
const D = "2026-07-01";

d("full-app under RLS (dashboard_app, synthetic 2-unit PT)", () => {
  let Q: typeof import("./queries");
  beforeAll(async () => {
    Q = await import("./queries"); // deferred → no makePool() at module load
  });

  it("getSalesByProduct scopes by unit (name discrimination, no cross-unit leak)", async () => {
    const u1 = await Q.getSalesByProduct(U(1), D, D);
    const u2 = await Q.getSalesByProduct(U(2), D, D);
    const n1 = u1.map((r) => r.nama);
    const n2 = u2.map((r) => r.nama);
    expect(n1).toContain("PERTAMAX"); // unit 1 product
    expect(n1).not.toContain("PERTALITE"); // unit 2 product must NOT leak
    expect(n2).toContain("PERTALITE"); // unit 2 product
    expect(n2).not.toContain("PERTAMAX");
  });

  it("getSyncByUnit: direksi spans [1,2]; pengawas sees only its unit", async () => {
    const direksi = await Q.getSyncByUnit([U(1), U(2)]);
    expect(direksi.map((r) => r.unit_id).sort()).toEqual([1, 2]);
    const pengawasIB = await Q.getSyncByUnit([U(1)]);
    expect(pengawasIB.map((r) => r.unit_id)).toEqual([1]);
    const pengawasBakau = await Q.getSyncByUnit([U(2)]);
    expect(pengawasBakau.map((r) => r.unit_id)).toEqual([2]);
  });

  it("monitoring/denah: getRealTank + getNozzles scoped per unit", async () => {
    expect((await Q.getRealTank(U(1))).length).toBe(2);
    expect((await Q.getRealTank(U(2))).length).toBe(1);
    expect((await Q.getNozzles(U(1))).length).toBe(2);
    expect((await Q.getNozzles(U(2))).length).toBe(1);
  });

  it("rincian: getManualEntries scoped per unit", async () => {
    expect((await Q.getManualEntries(U(1), D, "pengeluaran")).length).toBe(2);
    expect((await Q.getManualEntries(U(2), D, "pengeluaran")).length).toBe(1);
  });

  it("usulan: getUsulanSoList scoped per unit", async () => {
    expect((await Q.getUsulanSoList(U(1), 100)).length).toBe(2);
    expect((await Q.getUsulanSoList(U(2), 100)).length).toBe(1);
  });
});
