import { describe, expect, it } from "vitest";
import { DO_PRODUCTS } from "@/lib/config";
import { buildUsulanModel } from "@/lib/usulan-model";

describe("buildUsulanModel", () => {
  it("raw kosong → semua slot DO provisional, total nol, status draft", () => {
    const m = buildUsulanModel({ glPrev: [], doDay: [], avg7: [], existing: [] });
    expect(m.rows).toHaveLength(DO_PRODUCTS.length);
    expect(m.rows.every((r) => r.sisaStock === null && r.sisaStockProvisional)).toBe(true);
    expect(m.anyProvisional).toBe(true);
    expect(m.status).toBe("draft");
    expect(m.totals.penerimaanHari).toBe(0);
    expect(m.totals.usulanPenebusan).toBe(0);
  });

  it("menggabung nilai tersimpan per productKey + status diajukan", () => {
    const key = DO_PRODUCTS[0]!.key;
    const m = buildUsulanModel({
      glPrev: [],
      doDay: [],
      avg7: [],
      existing: [
        {
          productKey: key,
          penerimaanHari: 5000,
          permintaanBesok: 3000,
          usulanPenebusan: 8000,
          status: "diajukan",
        },
      ] as never,
    });
    expect(m.status).toBe("diajukan");
    const row = m.rows.find((r) => r.key === key)!;
    expect(row.penerimaanHari).toBe(5000);
    expect(row.usulanPenebusan).toBe(8000);
    expect(m.totals.penerimaanHari).toBe(5000);
    expect(m.totals.permintaanBesok).toBe(3000);
    expect(m.totals.usulanPenebusan).toBe(8000);
  });
});
