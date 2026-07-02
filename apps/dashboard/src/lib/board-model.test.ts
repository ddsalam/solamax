import { describe, expect, it } from "vitest";
import { buildBoardModel, type PerUnitAgg } from "@/lib/board-model";

function unit(code: string, name: string, omzet: number): PerUnitAgg {
  return {
    u: { code, name },
    products: [
      { ckdbbm: "P1", nama: "Pertalite", vol: 1000 },
      { ckdbbm: "P2", nama: "Pertamax", vol: 500 },
    ],
    totals: { vol: 1500, omzet },
    prevTotals: { omzet: omzet * 0.9 },
    glPct: 0.001,
    glAbnormal: false,
    glProvisional: false,
    gas: { kind: "gasoline", actual: 0.3, target: 0.35, deltaPt: -5, below: true },
    oil: { kind: "gasoil", actual: 0.2, target: 0.2, deltaPt: 0, below: false },
    shift: { shifts: 3, last_dtgljam: null },
    daily: [{ d: "2026-07-02", omzet }],
  };
}

const ctx = { firstUnitCode: "6478111", month: 7, today: "2026-07-02" };

describe("buildBoardModel", () => {
  it("agregasi KPI grup + sparkline 14 hari", () => {
    const m = buildBoardModel({ perUnit: [unit("6478111", "Imam Bonjol", 20_000_000)], anomalies: [] }, ctx);
    expect(m.kpi.omzet).toBe(20_000_000);
    expect(m.spark.vals).toHaveLength(14);
    expect(m.ratios.rg.length).toBe(1);
  });

  it("RBAC: model HANYA memuat unit dari perUnit ber-scope (tak menambah unit)", () => {
    const perUnit = [unit("6478111", "Imam Bonjol", 20_000_000)];
    const m = buildBoardModel({ perUnit, anomalies: [] }, ctx);
    expect(m.unitsCount).toBe(1);
    expect(m.ranking).toHaveLength(1);
    const codes = new Set(perUnit.map((p) => p.u.code));
    expect(m.ranking.every((r) => codes.has(r.code))).toBe(true);
    expect(m.ranking[0]?.name).toBe("Imam Bonjol");
  });

  it("ranking terurut desc by omzet; chip bauran di bawah target", () => {
    const m = buildBoardModel(
      {
        perUnit: [unit("A", "Alpha", 10_000_000), unit("B", "Beta", 30_000_000)],
        anomalies: [],
      },
      ctx,
    );
    expect(m.ranking.map((r) => r.name)).toEqual(["Beta", "Alpha"]);
    expect(m.verdict.chips.some((c) => c.text.includes("Bauran NPSO di bawah target"))).toBe(true);
  });
});
