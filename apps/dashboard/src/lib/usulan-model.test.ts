import { describe, expect, it } from "vitest";
import { DO_PRODUCTS } from "@/lib/config";
import { buildUsulanModel } from "@/lib/usulan-model";

describe("buildUsulanModel", () => {
  it("raw kosong → semua slot DO provisional, total manual kosong, saldo DO terhitung nol, status draft", () => {
    const m = buildUsulanModel({ glPrev: [], doDay: [], avg7: [], existing: [] });
    expect(m.rows).toHaveLength(DO_PRODUCTS.length);
    expect(m.rows.every((r) => r.sisaStock === null && r.sisaStockProvisional)).toBe(true);
    expect(m.anyProvisional).toBe(true);
    expect(m.status).toBe("draft");
    expect(m.totals.sisaDo).toBe(0);
    expect(m.totals.permintaanBesok).toBeNull();
    expect(m.totals.sisaStock).toBe(0);
    expect(m.rows.every((r) => r.sisaDo === 0 && r.penerimaanHari === null
      && r.permintaanBesok === null && r.usulanPenebusan === null)).toBe(true);
    expect(m.totals.penerimaanHari).toBeNull();
    expect(m.totals.usulanPenebusan).toBeNull();
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

  it("nol tersimpan dan nol sumber DO tidak diklasifikasi ulang sebagai kosong", () => {
    const key = DO_PRODUCTS[0]!.key;
    const m = buildUsulanModel({
      glPrev: [], avg7: [],
      doDay: [{ nama: DO_PRODUCTS[0]!.label, do_awal: 0 }] as never,
      existing: [{ productKey: key, penerimaanHari: 0, permintaanBesok: null,
        usulanPenebusan: null, status: "draft" }],
    });
    const row = m.rows.find((r) => r.key === key)!;
    expect(row.sisaDo).toBe(0);
    expect(row.penerimaanHari).toBe(0);
    expect(m.totals.sisaDo).toBe(0);
    expect(m.totals.penerimaanHari).toBe(0);
    expect(m.totals.permintaanBesok).toBeNull();
  });

  it("total campuran hanya menjumlahkan nilai yang tersedia, tetap numerik", () => {
    const m = buildUsulanModel({ glPrev: [], doDay: [], avg7: [], existing: [
      { productKey: DO_PRODUCTS[0]!.key, penerimaanHari: 8000,
        permintaanBesok: null, usulanPenebusan: 0, status: "draft" },
      { productKey: DO_PRODUCTS[1]!.key, penerimaanHari: 8125,
        permintaanBesok: null, usulanPenebusan: null, status: "draft" },
    ] });
    expect(m.totals.penerimaanHari).toBe(16125);
    expect(typeof m.totals.penerimaanHari).toBe("number");
    expect(m.totals.permintaanBesok).toBeNull();
    expect(m.totals.usulanPenebusan).toBe(0);
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });
});
