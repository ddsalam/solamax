import { describe, expect, it, vi } from "vitest";

// gl-window → queries → db (pool eager) — test murni tak butuh DB.
vi.mock("./db", () => ({ q: vi.fn(), qScoped: vi.fn(), pool: {} }));

import { splitGlWindow } from "@/lib/gl-window";

const TODAY = "2026-07-16";

describe("splitGlWindow — batas cache G/L (historis = today−2)", () => {
  it("jendela sepenuhnya historis → cache utuh, tanpa segar", () => {
    expect(splitGlWindow("2025-01-01", "2025-07-16", TODAY)).toEqual({
      cached: { from: "2025-01-01", to: "2025-07-16" },
      fresh: null,
    });
    // tepat di batas: to = today−2 masih cache
    expect(splitGlWindow("2026-07-01", "2026-07-14", TODAY)).toEqual({
      cached: { from: "2026-07-01", to: "2026-07-14" },
      fresh: null,
    });
  });
  it("jendela berujung KEMARIN tidak di-cache (baris bisa provisional s/d opname pagi)", () => {
    expect(splitGlWindow("2026-07-01", "2026-07-15", TODAY)).toEqual({
      cached: { from: "2026-07-01", to: "2026-07-14" },
      fresh: { from: "2026-07-15", to: "2026-07-15" },
    });
  });
  it("jendela menyentuh hari ini dipecah: prefix cache + suffix segar", () => {
    expect(splitGlWindow("2026-01-01", TODAY, TODAY)).toEqual({
      cached: { from: "2026-01-01", to: "2026-07-14" },
      fresh: { from: "2026-07-15", to: TODAY },
    });
  });
  it("jendela seluruhnya baru (hari ini / kemarin) → segar utuh", () => {
    expect(splitGlWindow(TODAY, TODAY, TODAY)).toEqual({
      cached: null,
      fresh: { from: TODAY, to: TODAY },
    });
    expect(splitGlWindow("2026-07-15", TODAY, TODAY)).toEqual({
      cached: null,
      fresh: { from: "2026-07-15", to: TODAY },
    });
  });
  it("rentang terbalik → kosong (fail-safe)", () => {
    expect(splitGlWindow(TODAY, "2026-07-01", TODAY)).toEqual({ cached: null, fresh: null });
  });
  it("pecahan menyatu kembali tanpa celah/tumpang-tindih", () => {
    const s = splitGlWindow("2026-06-01", TODAY, TODAY);
    expect(s.cached!.to < s.fresh!.from).toBe(true);
    // hari setelah cached.to = fresh.from (kontinu)
    expect(s.fresh!.from).toBe("2026-07-15");
    expect(s.cached!.to).toBe("2026-07-14");
  });
});
