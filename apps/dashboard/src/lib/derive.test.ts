import { describe, expect, it } from "vitest";
import {
  alarmScore,
  bauran,
  bauranVsTarget,
  enduranceDays,
  enduranceLevel,
  glPercent,
  stockNow,
  verdictHeadline,
} from "./derive";
import { canonicalProductKey, classifyProduct, targetBauran, unitLabel } from "./config";

const PRODUKSI = [
  { nama: "PERTALITE", vol: 10000 },
  { nama: "PERTAMAX", vol: 1000 },
  { nama: "PERTAMAX TURBO", vol: 217 },
  { nama: "BIO SOLAR", vol: 10000 },
  { nama: "DEXLITE", vol: 2000 },
  { nama: "PERTAMINA DEX", vol: 1609 },
];

describe("klasifikasi produk (№4 terkonfirmasi)", () => {
  it("PSO = Pertalite + Solar; NPSO = Pertamax/Turbo/Dexlite/Dex", () => {
    expect(classifyProduct("PERTALITE")).toMatchObject({ pso: true, kind: "gasoline" });
    expect(classifyProduct("BIO SOLAR")).toMatchObject({ pso: true, kind: "gasoil" });
    expect(classifyProduct("PERTAMAX")).toMatchObject({ pso: false, kind: "gasoline" });
    expect(classifyProduct("PERTAMAX TURBO")).toMatchObject({ pso: false, kind: "gasoline" });
    expect(classifyProduct("DEXLITE")).toMatchObject({ pso: false, kind: "gasoil" });
    expect(classifyProduct("PERTAMINA DEX")).toMatchObject({ pso: false, kind: "gasoil" });
    expect(canonicalProductKey("Bio Solar")).toBe("SOLAR");
  });
});

describe("bauran (definisi workbook: rasio NPSO/PSO atas liter)", () => {
  it("gasoline = (Pertamax+Turbo)/Pertalite", () => {
    expect(bauran(PRODUKSI, "gasoline")).toBeCloseTo(1217 / 10000, 6);
  });
  it("gasoil = (Dexlite+Dex)/Solar", () => {
    expect(bauran(PRODUKSI, "gasoil")).toBeCloseTo(3609 / 10000, 6);
  });
  it("null bila PSO 0", () => {
    expect(bauran([{ nama: "PERTAMAX", vol: 10 }], "gasoline")).toBeNull();
  });
  it("vs target IB Jun (workbook .1217/.3609): delta 0 pt", () => {
    const g = bauranVsTarget(PRODUKSI, "6478111", 6, "gasoline");
    expect(g.target).toBeCloseTo(0.1217);
    expect(g.deltaPt).toBeCloseTo(0, 4);
    expect(g.below).toBe(false);
  });
  it("target bulan dari workbook (Des gasoline .1437)", () => {
    expect(targetBauran("6478111", "gasoline", 12)).toBeCloseTo(0.1437);
  });
});

describe("stok & ketahanan", () => {
  it("stok kini = opname − terjual + diterima", () => {
    expect(stockNow(18400, 2400, 8000)).toBe(24000);
    expect(stockNow(null, 5, 5)).toBeNull();
  });
  it("ketahanan & level ambang spec (1,5 / 3 hari)", () => {
    expect(enduranceDays(18400, 10000)).toBeCloseTo(1.84);
    expect(enduranceLevel(1.1)).toBe("danger");
    expect(enduranceLevel(2.5)).toBe("warning");
    expect(enduranceLevel(10)).toBe("ok");
    expect(enduranceLevel(null)).toBe("unknown");
  });
});

describe("gl% / verdict / alarm", () => {
  it("gl% bertanda", () => {
    expect(glPercent(-52, 15353)).toBeCloseTo(-0.0034, 4);
    expect(glPercent(-52, 0)).toBeNull();
  });
  it("verdict headline by jumlah chip", () => {
    expect(verdictHeadline([])).toBe("Grup sehat.");
    expect(
      verdictHeadline([
        { tone: "danger", text: "x" },
        { tone: "warning", text: "y" },
      ]),
    ).toBe("Grup sehat. Dua hal perlu perhatian.");
  });
  it("skor alarm: hanya cek aktif (№6)", () => {
    const s = alarmScore([
      { label: "a", state: "ok", note: "" },
      { label: "b", state: "fail", note: "" },
      { label: "c", state: "na", note: "" },
      { label: "d", state: "ok", note: "" },
    ]);
    expect(s.text).toBe("2/3");
    expect(s.na).toBe(1);
  });
});

describe("unitLabel (№7: kanonik bertitik + nama)", () => {
  it("IB → 64.781.11 — Imam Bonjol", () => {
    expect(unitLabel("6478111")).toBe("64.781.11 — Imam Bonjol");
  });
  it("unit tak dikenal → fallback", () => {
    expect(unitLabel("9999999", "Contoh")).toBe("9999999 — Contoh");
  });
});
