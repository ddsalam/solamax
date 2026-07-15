import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonthsClamped,
  addYearsClamped,
  isValidIsoDate,
  monthStart,
  rangeDays,
  resolveBoardPeriod,
  resolvePeriod,
  todayWib,
} from "@/lib/periods";

// 2026-07-16 10:00 WIB (UTC+7 → 03:00Z). todayWib pakai Asia/Pontianak.
const NOW = new Date("2026-07-16T03:00:00Z");
const TODAY = "2026-07-16";

describe("todayWib / addDays (regresi perilaku lama)", () => {
  it("todayWib WIB benar, termasuk lewat tengah malam WIB", () => {
    expect(todayWib(NOW)).toBe(TODAY);
    // 2026-07-16 23:30 WIB = 16:30Z → masih 16 Jul; 00:30 WIB (17:30Z hari sblm) → 17 Jul.
    expect(todayWib(new Date("2026-07-16T16:30:00Z"))).toBe("2026-07-16");
    expect(todayWib(new Date("2026-07-16T17:30:00Z"))).toBe("2026-07-17");
  });
  it("resolvePeriod lama tetap berfungsi (dipakai halaman lain)", () => {
    const p = resolvePeriod("week", NOW);
    expect(p.from).toBe("2026-07-10");
    expect(p.to).toBe(TODAY);
  });
});

describe("addMonthsClamped — bulan kalender dgn day-clamp", () => {
  it("geser biasa", () => {
    expect(addMonthsClamped("2026-07-16", -1)).toBe("2026-06-16");
    expect(addMonthsClamped("2026-07-01", -1)).toBe("2026-06-01");
  });
  it("clamp akhir bulan pendek: 31 → 30/28/29", () => {
    expect(addMonthsClamped("2026-07-31", -1)).toBe("2026-06-30");
    expect(addMonthsClamped("2026-03-31", -1)).toBe("2026-02-28"); // non-kabisat
    expect(addMonthsClamped("2024-03-31", -1)).toBe("2024-02-29"); // kabisat
  });
  it("lintas tahun: Jan −1 → Des tahun lalu", () => {
    expect(addMonthsClamped("2026-01-15", -1)).toBe("2025-12-15");
    expect(addMonthsClamped("2026-01-31", -1)).toBe("2025-12-31");
  });
});

describe("addYearsClamped — YoY dgn clamp kabisat", () => {
  it("29 Feb → 28 Feb tahun non-kabisat", () => {
    expect(addYearsClamped("2024-02-29", -1)).toBe("2023-02-28");
    expect(addYearsClamped("2024-02-29", 1)).toBe("2025-02-28");
  });
  it("tanggal biasa tak berubah selain tahun", () => {
    expect(addYearsClamped("2026-07-16", -1)).toBe("2025-07-16");
  });
});

describe("isValidIsoDate", () => {
  it("menolak format salah & tanggal tak nyata", () => {
    expect(isValidIsoDate(undefined)).toBe(false);
    expect(isValidIsoDate("16-07-2026")).toBe(false);
    expect(isValidIsoDate("2026-2-3")).toBe(false);
    expect(isValidIsoDate("2026-02-30")).toBe(false); // roll-over Date ditolak
    expect(isValidIsoDate("2026-13-01")).toBe(false);
  });
  it("menerima tanggal nyata (termasuk 29 Feb kabisat)", () => {
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-28")).toBe(true);
  });
});

describe("resolveBoardPeriod — preset", () => {
  it("today", () => {
    const p = resolveBoardPeriod("today", {}, NOW);
    expect(p.range).toEqual({ from: TODAY, to: TODAY });
  });
  it("7d / 30d rolling", () => {
    expect(resolveBoardPeriod("7d", {}, NOW).range).toEqual({ from: "2026-07-10", to: TODAY });
    expect(resolveBoardPeriod("30d", {}, NOW).range).toEqual({ from: "2026-06-17", to: TODAY });
  });
  it("bulan = kalender berjalan (MTD)", () => {
    const p = resolveBoardPeriod("bulan", {}, NOW);
    expect(p.range).toEqual({ from: "2026-07-01", to: TODAY });
    expect(monthStart(TODAY)).toBe("2026-07-01");
  });
  it("key tak dikenal → fallback 30d", () => {
    const p = resolveBoardPeriod("minggu-depan", {}, NOW);
    expect(p.key).toBe("30d");
  });
});

describe("resolveBoardPeriod — custom + validasi", () => {
  it("custom valid dipakai apa adanya", () => {
    const p = resolveBoardPeriod("custom", { from: "2026-06-10", to: "2026-06-20" }, NOW);
    expect(p.key).toBe("custom");
    expect(p.range).toEqual({ from: "2026-06-10", to: "2026-06-20" });
    expect(rangeDays(p.range)).toBe(11);
  });
  it("to di masa depan di-clamp ke hari ini", () => {
    const p = resolveBoardPeriod("custom", { from: "2026-07-01", to: "2026-12-31" }, NOW);
    expect(p.range).toEqual({ from: "2026-07-01", to: TODAY });
  });
  it("invalid → fallback 30d (key mencerminkan fallback)", () => {
    for (const opts of [
      {},
      { from: "2026-06-20", to: "2026-06-10" }, // terbalik
      { from: "2026-02-30", to: "2026-03-01" }, // tanggal tak nyata
      { from: "2026-08-01", to: "2026-09-01" }, // seluruhnya masa depan (from>to stlh clamp)
      { from: "abc", to: "2026-06-10" },
    ]) {
      const p = resolveBoardPeriod("custom", opts, NOW);
      expect(p.key).toBe("30d");
      expect(p.range.to).toBe(TODAY);
    }
  });
});

describe("resolveBoardPeriod — jendela pembanding", () => {
  it("MoM: rentang digeser −1 bulan (MTD-vs-MTD utk preset bulan)", () => {
    const p = resolveBoardPeriod("bulan", {}, NOW);
    expect(p.mom.prev).toEqual({ from: "2026-06-01", to: "2026-06-16" });
  });
  it("MoM clamp: 31 Jul → 30 Jun; 31 Mar (kabisat) → 29 Feb", () => {
    const p = resolveBoardPeriod("custom", { from: "2026-07-01", to: "2026-07-15" }, NOW);
    expect(p.mom.prev).toEqual({ from: "2026-06-01", to: "2026-06-15" });
    const q = resolveBoardPeriod(
      "custom",
      { from: "2024-03-31", to: "2024-03-31" },
      new Date("2026-07-16T03:00:00Z"),
    );
    expect(q.mom.prev).toEqual({ from: "2024-02-29", to: "2024-02-29" });
  });
  it("YoY: rentang sama tahun lalu; 29 Feb → 28 Feb", () => {
    const p = resolveBoardPeriod("custom", { from: "2026-06-10", to: "2026-06-20" }, NOW);
    expect(p.yoy.prev).toEqual({ from: "2025-06-10", to: "2025-06-20" });
    const q = resolveBoardPeriod("custom", { from: "2024-02-29", to: "2024-02-29" }, NOW);
    expect(q.yoy.prev).toEqual({ from: "2023-02-28", to: "2023-02-28" });
  });
  it("YTD: 1 Jan..to vs tahun lalu rentang sama", () => {
    const p = resolveBoardPeriod("bulan", {}, NOW);
    expect(p.ytd.cur).toEqual({ from: "2026-01-01", to: TODAY });
    expect(p.ytd.prev).toEqual({ from: "2025-01-01", to: "2025-07-16" });
  });
  it("YTD utk rentang custom di tahun lalu ikut tahun range.to", () => {
    const p = resolveBoardPeriod("custom", { from: "2025-03-01", to: "2025-03-31" }, NOW);
    expect(p.ytd.cur).toEqual({ from: "2025-01-01", to: "2025-03-31" });
    expect(p.ytd.prev).toEqual({ from: "2024-01-01", to: "2024-03-31" });
  });
  it("addDays regresi: lintas bulan/tahun", () => {
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
  });
});
