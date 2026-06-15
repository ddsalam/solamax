import { describe, expect, it } from "vitest";
import {
  ageText,
  cashStatus,
  isSelisihAbnormal,
  opnameStatus,
  salesStatus,
  staleness,
} from "./compliance";

describe("status modul", () => {
  it("penjualan: 3 shift hijau, 1-2 kuning, 0 merah", () => {
    expect(salesStatus(3)).toBe("green");
    expect(salesStatus(2)).toBe("yellow");
    expect(salesStatus(1)).toBe("yellow");
    expect(salesStatus(0)).toBe("red");
  });

  it("opname: semua tangki hijau, sebagian kuning, nol merah", () => {
    expect(opnameStatus(7, 7)).toBe("green");
    expect(opnameStatus(3, 7)).toBe("yellow");
    expect(opnameStatus(0, 7)).toBe("red");
    expect(opnameStatus(2, 0)).toBe("green"); // total tak diketahui → ada = hijau
  });

  it("kas biner", () => {
    expect(cashStatus(5)).toBe("green");
    expect(cashStatus(0)).toBe("red");
  });
});

describe("staleness", () => {
  const now = new Date("2026-06-12T00:00:00Z");

  it("belum pernah input = stale", () => {
    const s = staleness(null, 26, now);
    expect(s.stale).toBe(true);
    expect(s.ageText).toBe("belum pernah");
  });

  it("input segar tidak stale", () => {
    expect(staleness("2026-06-11T20:00:00Z", 26, now).stale).toBe(false);
  });

  it("kas dorman 2019 = stale bertahun-tahun (kasus IB)", () => {
    const s = staleness("2019-04-17", 7 * 24, now);
    expect(s.stale).toBe(true);
    expect(s.ageText).toContain("TAHUN");
  });
});

describe("selisih abnormal", () => {
  it("ambang absolut 100 L", () => {
    expect(isSelisihAbnormal(-150, null)).toBe(true);
    expect(isSelisihAbnormal(50, null)).toBe(false);
  });
  it("ambang persen 0,5% dari basis", () => {
    expect(isSelisihAbnormal(-60, 10_000)).toBe(true); // 0,6%
    expect(isSelisihAbnormal(-40, 10_000)).toBe(false); // 0,4%
  });
});

describe("ageText", () => {
  it("skala jam/hari/tahun", () => {
    expect(ageText(0.5)).toBe("baru saja");
    expect(ageText(30)).toBe("30 jam lalu");
    expect(ageText(24 * 10)).toBe("10 hari lalu");
    expect(ageText(24 * 365 * 7)).toContain("TAHUN");
  });
});
