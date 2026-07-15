import { describe, expect, it } from "vitest";
import { boardWarmPlan, isWarmAuthorized } from "@/lib/board-warm";

// 2026-07-16 WIB
const TODAY = "2026-07-16";
const NOW = new Date("2026-07-16T03:00:00Z");

describe("boardWarmPlan — cakupan jendela pre-warm", () => {
  const plan = boardWarmPlan(TODAY, NOW);
  const has = (from: string, to: string) => plan.some((w) => w.from === from && w.to === to);

  it("memuat jendela preset inti: 7d, 30d, bulan-ini", () => {
    expect(has("2026-07-10", TODAY)).toBe(true); // 7d
    expect(has("2026-06-17", TODAY)).toBe(true); // 30d
    expect(has("2026-07-01", TODAY)).toBe(true); // bulan ini (MTD)
  });
  it("memuat pembanding MoM/YoY/YTD (yang berat: YTD cur & prev)", () => {
    expect(has("2026-01-01", TODAY)).toBe(true); // YTD cur
    expect(has("2025-01-01", "2025-07-16")).toBe(true); // YTD prev
    expect(has("2026-06-01", "2026-06-16")).toBe(true); // MoM prev preset bulan
    expect(has("2025-07-01", "2025-07-16")).toBe(true); // YoY prev preset bulan
  });
  it("dedup: tak ada jendela ganda; semua from ≤ to", () => {
    const keys = plan.map((w) => `${w.from}|${w.to}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(plan.every((w) => w.from <= w.to)).toBe(true);
  });
});

describe("isWarmAuthorized — gerbang fail-closed", () => {
  const SECRET = "a".repeat(64);
  it("cocok → true", () => {
    expect(isWarmAuthorized(SECRET, SECRET)).toBe(true);
  });
  it("env absen / pendek → SELALU false (route tanpa konfigurasi mati)", () => {
    expect(isWarmAuthorized(SECRET, undefined)).toBe(false);
    expect(isWarmAuthorized("x", "x")).toBe(false); // < 32 char
    expect(isWarmAuthorized("", SECRET)).toBe(false);
    expect(isWarmAuthorized(null, SECRET)).toBe(false);
  });
  it("nilai salah / beda panjang → false", () => {
    expect(isWarmAuthorized("b".repeat(64), SECRET)).toBe(false);
    expect(isWarmAuthorized("a".repeat(63), SECRET)).toBe(false);
  });
});
