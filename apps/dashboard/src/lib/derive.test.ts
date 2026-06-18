import { describe, expect, it } from "vitest";
import {
  aggregateClosingGl,
  alarmScore,
  bauran,
  bauranVsTarget,
  enduranceDays,
  enduranceLevel,
  glPercent,
  isOpnameGarbage,
  stockNow,
  verdictHeadline,
  type ClosingRow,
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
  it("verdict headline by jumlah chip & tone", () => {
    expect(verdictHeadline([])).toBe("Grup sehat.");
    // warning saja → "perlu perhatian" (tak ada "tindakan")
    expect(verdictHeadline([{ tone: "warning", text: "y" }])).toBe(
      "Grup perlu perhatian. Satu hal perlu ditinjau.",
    );
    // ada danger → "perlu tindakan", JANGAN "sehat"
    expect(
      verdictHeadline([
        { tone: "danger", text: "x" },
        { tone: "warning", text: "y" },
      ]),
    ).toBe("Grup perlu tindakan. Dua hal perlu perhatian.");
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
    // provisional di luar penyebut, dilaporkan terpisah
    const p = alarmScore([
      { label: "x", state: "provisional", note: "" },
      { label: "y", state: "ok", note: "" },
    ]);
    expect(p.text).toBe("1/1");
    expect(p.provisional).toBe(1);
  });
});

describe("garbage guard opname (tambahan A)", () => {
  it("menandai stok/selisih non-fisik sebagai garbage", () => {
    expect(isOpnameGarbage(471436, 26606)).toBe(true); // selisih 444k (11 Jun T-04)
    expect(isOpnameGarbage(2_000_000, 1000)).toBe(true); // stok buku 2 juta (5 Jun)
    expect(isOpnameGarbage(-5, 10)).toBe(true); // negatif
    expect(isOpnameGarbage(18520, 18507)).toBe(false); // wajar (−13 L)
    expect(isOpnameGarbage(null, null)).toBe(false); // null ditangani terpisah
  });
});

describe("aggregateClosingGl (G/L signed dari opname penutup)", () => {
  const row = (over: Partial<ClosingRow>): ClosingRow => ({
    d: "2026-06-10",
    ckdtangki: "T-01",
    ckdbbm: "BB-01",
    nama: "Pertalite",
    bk: 1000,
    op: 1000,
    signed: 0,
    dtgljam: "2026-06-11T06:00:00Z",
    provisional: false,
    ...over,
  });

  it("menjumlahkan SIGNED (bisa negatif), bukan absolut", () => {
    const agg = aggregateClosingGl([
      row({ ckdbbm: "P1", bk: 1000, op: 980, signed: -20 }),
      row({ ckdbbm: "P1", ckdtangki: "T-02", bk: 1000, op: 1010, signed: 10 }),
    ]);
    expect(agg.totalSigned).toBe(-10); // −20 + 10, bukan 30
    expect(agg.byProduct.get("P1")?.signed).toBe(-10);
  });

  it("mengecualikan baris garbage dari total & memunculkannya terpisah", () => {
    const agg = aggregateClosingGl([
      row({ ckdbbm: "P1", bk: 10000, op: 9950, signed: -50 }),
      row({ ckdtangki: "T-04", bk: 471436, op: 26606, signed: -444830 }), // garbage
    ]);
    expect(agg.totalSigned).toBe(-50); // outlier 444k TIDAK ikut
    expect(agg.garbage).toHaveLength(1);
    expect(agg.byProduct.get("P1")?.signed).toBe(-50);
  });

  it("menandai abnormal (>100 L atau >0,5% buku) di antara yang lolos guard", () => {
    const agg = aggregateClosingGl([
      row({ ckdtangki: "T-01", bk: 10000, op: 9994, signed: -6 }), // normal
      row({ ckdtangki: "T-02", bk: 10000, op: 9850, signed: -150 }), // abnormal abs
      row({ ckdtangki: "T-03", bk: 5000, op: 4970, signed: -30 }), // abnormal 0,6%
    ]);
    expect(agg.abnormal).toHaveLength(2);
    expect(agg.totalSigned).toBe(-186);
  });

  it("provisional bila ada baris provisional yang lolos guard", () => {
    const agg = aggregateClosingGl([row({ provisional: true, signed: -5, op: 995 })]);
    expect(agg.provisional).toBe(true);
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
