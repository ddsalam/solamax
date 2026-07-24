import { describe, expect, it } from "vitest";
import { niceAxisMax } from "./HarianCharts";

describe("niceAxisMax — sumbu tak boleh menenggelamkan datanya", () => {
  it("puncak data selalu ≥ 60% tinggi bidang (regresi: 9.206 pernah dapat sumbu 20.000)", () => {
    for (const v of [9_206, 297, 1, 47, 6_446, 123_456, 0.4, 999, 1_000, 1_001]) {
      const max = niceAxisMax(v);
      expect(max, `max utk ${v}`).toBeGreaterThanOrEqual(v);
      expect(v / max, `rasio utk ${v}`).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("nilai konkret dari data nyata", () => {
    expect(niceAxisMax(9_206)).toBe(10_000); // tren kumulatif 13 bulan
    expect(niceAxisMax(297)).toBe(320); // tren rata-rata per hari
  });

  it("tick seperempatan selalu bilangan bulat rapi", () => {
    for (const v of [9_206, 297, 6_446]) {
      const max = niceAxisMax(v);
      expect(max % 4).toBe(0);
    }
  });

  it("nol / negatif aman (tak pernah membagi nol)", () => {
    expect(niceAxisMax(0)).toBe(1);
    expect(niceAxisMax(-5)).toBe(1);
  });
});
