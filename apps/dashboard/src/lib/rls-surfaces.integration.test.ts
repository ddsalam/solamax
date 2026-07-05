import { describe, expect, it } from "vitest";
import type { ScopedUnitId } from "./scope";
import {
  getSalesByProduct,
  getSyncByUnit,
  getRealTank,
  getNozzles,
  getManualEntries,
  getUsulanSoList,
} from "./queries";

/**
 * FULL-APP-UNDER-RLS (functional). Drives the REAL dashboard query functions —
 * which now run through qScoped() (migration 0016) — as the NON-SUPERUSER role
 * `dashboard_app` against the synthetic instance, and asserts unit-scoped results
 * for a pengawas (single unit) and a direksi (spanning units). Proves the DB-layer
 * RLS backstop returns correct scoped rows through the actual app code path, not
 * just raw SQL.
 *
 * Gated: RLS_SURFACES_LIVE_DB=1 & DATABASE_URL = the dashboard_app connection.
 * (db.ts makePool() connects as whatever DATABASE_URL points to.)
 */
const LIVE = process.env.RLS_SURFACES_LIVE_DB === "1" && !!process.env.DATABASE_URL;
const d = LIVE ? describe : describe.skip;

const U = (n: number) => n as unknown as ScopedUnitId;
const D = "2026-07-01";

d("full-app under RLS (dashboard_app, synthetic 2-unit PT)", () => {
  it("getSalesByProduct scopes by unit (name discrimination, no cross-unit leak)", async () => {
    const u1 = await getSalesByProduct(U(1), D, D);
    const u2 = await getSalesByProduct(U(2), D, D);
    const n1 = u1.map((r) => r.nama);
    const n2 = u2.map((r) => r.nama);
    expect(n1).toContain("PERTAMAX"); // unit 1 product
    expect(n1).not.toContain("PERTALITE"); // unit 2 product must NOT leak
    expect(n2).toContain("PERTALITE"); // unit 2 product
    expect(n2).not.toContain("PERTAMAX");
  });

  it("getSyncByUnit: direksi spans [1,2]; pengawas sees only its unit", async () => {
    const direksi = await getSyncByUnit([U(1), U(2)]);
    expect(direksi.map((r) => r.unit_id).sort()).toEqual([1, 2]);
    const pengawasIB = await getSyncByUnit([U(1)]);
    expect(pengawasIB.map((r) => r.unit_id)).toEqual([1]);
    const pengawasBakau = await getSyncByUnit([U(2)]);
    expect(pengawasBakau.map((r) => r.unit_id)).toEqual([2]);
  });

  it("monitoring/denah: getRealTank + getNozzles scoped per unit", async () => {
    expect((await getRealTank(U(1))).length).toBe(2);
    expect((await getRealTank(U(2))).length).toBe(1);
    expect((await getNozzles(U(1))).length).toBe(2);
    expect((await getNozzles(U(2))).length).toBe(1);
  });

  it("rincian: getManualEntries scoped per unit", async () => {
    expect((await getManualEntries(U(1), D, "pengeluaran")).length).toBe(2);
    expect((await getManualEntries(U(2), D, "pengeluaran")).length).toBe(1);
  });

  it("usulan: getUsulanSoList scoped per unit", async () => {
    expect((await getUsulanSoList(U(1), 100)).length).toBe(2);
    expect((await getUsulanSoList(U(2), 100)).length).toBe(1);
  });
});
