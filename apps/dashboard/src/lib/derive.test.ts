import { describe, expect, it } from "vitest";
import {
  aggregateClosingGl,
  aggregateDailyGl,
  alarmScore,
  bauran,
  bauranVsTarget,
  bauranVsTargetRange,
  enduranceDays,
  enduranceLevel,
  glPercent,
  isOpnameGarbage,
  isStockImplausible,
  stockNow,
  verdictHeadline,
  type ClosingRow,
  type DailyGlInput,
} from "./derive";
import {
  canonicalProductKey,
  classifyProduct,
  targetBauran,
  targetBauranRange,
  unitLabel,
} from "./config";

describe("targetBauranRange (rata-rata tertimbang hari — keputusan FASE 0 №1)", () => {
  it("rentang dalam satu bulan = target bulan itu", () => {
    expect(targetBauranRange("6478111", "gasoline", { from: "2026-07-01", to: "2026-07-16" })).toBeCloseTo(
      0.1253,
      6,
    );
  });
  it("lintas bulan = tertimbang hari (16 hr Jun + 16 hr Jul)", () => {
    const t = targetBauranRange("6478111", "gasoline", { from: "2026-06-15", to: "2026-07-16" });
    expect(t).toBeCloseTo((16 * 0.1217 + 16 * 0.1253) / 32, 6);
  });
  it("YTD Jan–Jul: rata-rata tertimbang ≠ target bulan akhir (selisih >1 pt)", () => {
    const t = targetBauranRange("6478111", "gasoline", { from: "2026-01-01", to: "2026-07-16" })!;
    const expected =
      (31 * 0.1033 + 28 * 0.107 + 31 * 0.1107 + 30 * 0.1143 + 31 * 0.118 + 30 * 0.1217 + 16 * 0.1253) /
      (31 + 28 + 31 + 30 + 31 + 30 + 16);
    expect(t).toBeCloseTo(expected, 6);
    expect(0.1253 - t).toBeGreaterThan(0.01); // bulan-akhir menyesatkan >1 pt
  });
  it("lintas tahun (Des→Jan) menghitung dua bulan, tahun kabisat aman", () => {
    const t = targetBauranRange("6478111", "gasoil", { from: "2025-12-31", to: "2026-01-01" });
    expect(t).toBeCloseTo((1 * 0.3713 + 1 * 0.3522) / 2, 6);
    // Feb kabisat 29 hari tertimbang benar
    const feb = targetBauranRange("6478111", "gasoline", { from: "2024-02-01", to: "2024-03-01" });
    expect(feb).toBeCloseTo((29 * 0.107 + 1 * 0.1107) / 30, 6);
  });
  it("unit tanpa target / rentang terbalik → null", () => {
    expect(targetBauranRange("9999999", "gasoline", { from: "2026-07-01", to: "2026-07-16" })).toBeNull();
    expect(targetBauranRange("6478111", "gasoline", { from: "2026-07-16", to: "2026-07-01" })).toBeNull();
  });
});

describe("bauranVsTargetRange", () => {
  const prods = [
    { nama: "PERTALITE", vol: 10000 },
    { nama: "PERTAMAX", vol: 1000 },
    { nama: "PERTAMAX TURBO", vol: 200 },
  ];
  it("target tertimbang + deltaPt + below", () => {
    const st = bauranVsTargetRange(prods, "6478111", { from: "2026-07-01", to: "2026-07-16" }, "gasoline");
    expect(st.actual).toBeCloseTo(0.12, 6);
    expect(st.target).toBeCloseTo(0.1253, 6);
    expect(st.below).toBe(true);
  });
  it("withTarget=false (jendela pembanding thn lalu): target null, tanpa below", () => {
    const st = bauranVsTargetRange(
      prods,
      "6478111",
      { from: "2025-07-01", to: "2025-07-16" },
      "gasoline",
      false,
    );
    expect(st.actual).toBeCloseTo(0.12, 6);
    expect(st.target).toBeNull();
    expect(st.deltaPt).toBeNull();
    expect(st.below).toBe(false);
  });
});

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
  it("stok mustahil (negatif) ditandai tak wajar; null/positif tidak", () => {
    expect(isStockImplausible(-14_000_000)).toBe(true);
    expect(isStockImplausible(500)).toBe(false);
    expect(isStockImplausible(null)).toBe(false);
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

describe("aggregateDailyGl (G/L metode RESUME — Σ harian)", () => {
  const row = (over: Partial<DailyGlInput>): DailyGlInput => ({
    ckdbbm: "BB-02",
    nama: "Pertamax",
    gl: 0,
    tera: 0,
    excluded_tanks: 0,
    provisional: false,
    ...over,
  });

  it("menjumlahkan G/L bertanda per produk + total (Σ harian = kumulatif)", () => {
    // Pertamax 18+19 Jun (RESUME): +2,29 lalu +22,88 → kumulatif +25,17.
    const agg = aggregateDailyGl([
      row({ gl: 2.29 }),
      row({ gl: 22.88 }),
      row({ ckdbbm: "BB-03", nama: "Solar", gl: 82.3 }),
    ]);
    expect(agg.byProduct.get("BB-02")?.signed).toBeCloseTo(25.17, 2);
    expect(agg.byProduct.get("BB-03")?.signed).toBeCloseTo(82.3, 2);
    expect(agg.totalSigned).toBeCloseTo(107.47, 2); // 2,29 + 22,88 + 82,30
    expect(agg.hasGl).toBe(true);
    expect(agg.provisional).toBe(false);
  });

  it("menjumlah Tera per produk & total tanpa mengubah G/L (kolom info)", () => {
    // 25 Jun: Pertamax tera 60, Pertalite 101, Dexlite 40 → total 201.
    const agg = aggregateDailyGl([
      row({ ckdbbm: "BB-02", gl: 10.21, tera: 60 }),
      row({ ckdbbm: "BB-07", nama: "Pertalite", gl: -53.97, tera: 101 }),
      row({ ckdbbm: "BB-06", nama: "Dexlite", gl: 1252.28, tera: 40 }),
    ]);
    expect(agg.byProduct.get("BB-02")?.tera).toBe(60);
    expect(agg.totalTera).toBe(201);
    expect(agg.totalSigned).toBeCloseTo(1208.52, 2);
  });

  it("gl=null (anchor D−1 hilang) → dilewati dari total tapi menandai provisional", () => {
    const agg = aggregateDailyGl([
      row({ gl: null, tera: 5 }),
      row({ ckdbbm: "BB-03", nama: "Solar", gl: 50 }),
    ]);
    expect(agg.totalSigned).toBe(50); // null tak ikut
    expect(agg.totalTera).toBe(5); // tera tetap dijumlah
    expect(agg.provisional).toBe(true);
    expect(agg.byProduct.get("BB-02")?.signed).toBe(0); // tak ada gl terhitung
  });

  it("provisional & excludedTanks ter-propagasi", () => {
    const agg = aggregateDailyGl([
      row({ gl: 3, provisional: true, excluded_tanks: 1 }),
      row({ ckdbbm: "BB-03", gl: 4, excluded_tanks: 2 }),
    ]);
    expect(agg.provisional).toBe(true);
    expect(agg.excludedTanks).toBe(3);
    expect(agg.hasGl).toBe(true);
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
