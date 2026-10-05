import { describe, expect, it } from "vitest";
import { DO_PRODUCTS } from "@/lib/config";
import { buildUsulanModel } from "@/lib/usulan-model";
import { buildUsulanDocDefinition } from "@/lib/export/usulan-doc";
import { DEFAULT_EXPORT_CONFIG } from "@/lib/export/config";

describe("buildUsulanModel", () => {
  it.each([null, "", "   "])("unidentified stock %s cannot become final inventory through its label", (ckdbbm) => {
    const product = DO_PRODUCTS[0]!;
    const m = buildUsulanModel({ glPrev: [{
      d: "2026-06-01", ckdbbm, nama: product.label, fisik: 1_000, fisik_prev: 1_100,
      pen_do: 0, sales_gross: 100, tera: 0, gl: 0, movement_invalid: false, excluded_tanks: 0, provisional: false,
    }], doDay: [], avg7: [], existing: [] });
    const row = m.rows.find(r => r.key === product.key)!;
    expect(row.sisaStock).toBeNull();
    expect(row.sisaStockProvisional).toBe(true);
    expect(row.ketahanan).toBeNull();
  });

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

describe("unassignable closing stock cannot silently finalize a proposal", () => {
  const knownRows = () => DO_PRODUCTS.map((p, i) => ({
    d: "2026-10-03", ckdbbm: `TEST-${i}`, nama: p.label,
    fisik: 1000, fisik_prev: 1100, pen_do: 0, sales_gross: 100, tera: 0,
    gl: 0, movement_invalid: false, excluded_tanks: 0, provisional: false,
  }));
  const build = (glPrev: Parameters<typeof buildUsulanModel>[0]["glPrev"], avg7: Parameters<typeof buildUsulanModel>[0]["avg7"] = []) =>
    buildUsulanModel({ glPrev, doDay: [], avg7, existing: [] });
  const unknown = () => ({
    d: "2026-10-03", ckdbbm: null, nama: null, fisik: null, fisik_prev: null,
    pen_do: 0, sales_gross: 0, tera: 0, gl: null, movement_invalid: false, excluded_tanks: 1, provisional: true,
  });

  it("reproduces PR420: a null-code/null-name stock row is not lost before the identity guard", () => {
    const m = build([...knownRows(), unknown()]);
    expect(m.anyProvisional).toBe(true);
    expect(m.rows.every((r) => r.sisaStock === null && r.sisaStockProvisional)).toBe(true);
    expect(m.rows.every((r) => r.ketahanan === null && r.ketahananLevel === "unknown")).toBe(true);
    // Existing contract is a numeric subtotal, explicitly labelled partial by both renderers.
    expect(m.totals.sisaStock).toBe(0);
  });

  it.each([null, "", " \t\n"])("treats missing identity %j with an unresolvable name as uncertain even for numeric zero", (ckdbbm) => {
    const m = build([...knownRows(), {
      ...unknown(), ckdbbm, nama: "UNSUPPORTED", fisik: 0, fisik_prev: 0,
      gl: 0, excluded_tanks: 0, provisional: false,
    }]);
    expect(m.anyProvisional).toBe(true);
    expect(m.rows.every((r) => r.sisaStock === null)).toBe(true);
  });

  it("flags nonzero unsupported stock rather than dropping it from final totals", () => {
    const m = build([...knownRows(), {
      ...unknown(), ckdbbm: "UNMAPPED", nama: "UNSUPPORTED", fisik: 500,
      fisik_prev: 500, gl: 0, excluded_tanks: 0, provisional: false,
    }]);
    expect(m.anyProvisional).toBe(true);
    expect(m.rows.every((r) => r.sisaStock === null)).toBe(true);
  });

  it("preserves healthy controls and explicitly neutral dormant unsupported products", () => {
    const healthy = build(knownRows());
    const dormant = build([...knownRows(), {
      ...unknown(), ckdbbm: "DORMANT", nama: "PREMIUM", fisik: 0,
      fisik_prev: 0, gl: 0, excluded_tanks: 0, provisional: false,
    }]);
    expect(healthy.anyProvisional).toBe(false);
    expect(healthy.totals.sisaStock).toBe(6000);
    expect(dormant).toEqual(healthy);
  });

  it.each([
    { fisik: null }, { fisik_prev: null }, { pen_do: 10 }, { sales_gross: 10 },
    { tera: 1 }, { gl: null }, { excluded_tanks: 1 }, { provisional: true },
  ])("does not treat unavailable/active unsupported stock as a neutral dormant row: %j", (patch) => {
    const m = build([...knownRows(), {
      ...unknown(), ckdbbm: "DORMANT", nama: "PREMIUM", fisik: 0,
      fisik_prev: 0, gl: 0, excluded_tanks: 0, provisional: false, ...patch,
    }]);
    expect(m.anyProvisional).toBe(true);
  });

  it("normalizes padded average-sales identities before the canonical stock lookup", () => {
    const m = build(knownRows(), [{ ckdbbm: " \tTEST-0\n ", avg_vol: 250 }]);
    const row = m.rows.find((r) => r.key === DO_PRODUCTS[0]!.key)!;
    expect(row.sisaStock).toBe(1000);
    expect(row.ketahanan).toBe(4);
    expect(m.anyProvisional).toBe(false);
  });

  it("carries unknown-stock provisional status into the existing PDF partial-total contract", () => {
    const meta = {
      unitDotted: "00.000.00", unitName: "Synthetic Unit", dateLong: "4 Oktober 2026",
      prevDateLong: "3 Oktober 2026", statusLabel: "Draft", generatedLabel: "4 Oktober 2026",
    };
    const doc = buildUsulanDocDefinition({
      model: build([...knownRows(), unknown()]), meta, config: DEFAULT_EXPORT_CONFIG,
    });
    const text = JSON.stringify(doc.content);
    expect(text).toContain("(sebagian)");
    expect(text.match(/— sementara/g)).toHaveLength(DO_PRODUCTS.length);
    const healthy = buildUsulanDocDefinition({ model: build(knownRows()), meta, config: DEFAULT_EXPORT_CONFIG });
    expect(JSON.stringify(healthy.content)).not.toContain("(sebagian)");
  });

});
