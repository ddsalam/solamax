import { describe, expect, it, vi } from "vitest";

// gl-window → queries → db (pool eager) — test murni tak butuh DB.
vi.mock("./db", () => ({ q: vi.fn(), qScoped: vi.fn(), pool: {} }));

import {
  resolveHistoricPart,
  shouldBypassEmptyCache,
  splitGlWindow,
} from "@/lib/gl-window";
import type { DailyGlRow } from "@/lib/queries";

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

describe("D13 — jangan sajikan hasil KOSONG dari cache", () => {
  const row = (d: string, gl: number): DailyGlRow => ({
    d, ckdbbm: "BB-03", nama: "SOLAR", fisik: 1, fisik_prev: 1, pen_do: 0,
    sales_gross: 0, tera: 0, gl, excluded_tanks: 0, provisional: false,
  });

  it("NETRALITAS: cache non-kosong dipakai apa adanya, fresh TIDAK dipanggil", async () => {
    const cachedRows = [row("2026-07-01", 10), row("2026-07-02", -5)];
    let freshCalls = 0;
    const out = await resolveHistoricPart(
      async () => cachedRows,
      async () => {
        freshCalls += 1;
        return [row("2026-07-01", 999)];
      },
    );
    expect(out).toBe(cachedRows); // referensi SAMA — tak disalin, tak diubah
    expect(freshCalls).toBe(0); // inilah jaminan /board tak berubah perilaku
  });

  it("cache KOSONG → fresh dipanggil dan hasilnya dipakai", async () => {
    let freshCalls = 0;
    const out = await resolveHistoricPart(
      async () => [],
      async () => {
        freshCalls += 1;
        return [row("2026-07-01", 42)];
      },
    );
    expect(freshCalls).toBe(1);
    expect(out).toHaveLength(1);
    expect(out[0]!.gl).toBe(42);
  });

  it("NOL BARIS, bukan NOL NILAI: Σgl = 0 dgn baris ADA tetap dipakai dari cache", async () => {
    // Unit yang sah-sah saja tak punya selisih — TIDAK boleh memicu bypass.
    const zeroValued = [row("2026-07-01", 0), row("2026-07-02", 0)];
    let freshCalls = 0;
    const out = await resolveHistoricPart(
      async () => zeroValued,
      async () => {
        freshCalls += 1;
        return [];
      },
    );
    expect(freshCalls).toBe(0);
    expect(out).toBe(zeroValued);
    expect(shouldBypassEmptyCache(zeroValued)).toBe(false);
  });

  it("kosong-kosong → hasil kosong (tak melempar, tak ulang tak terbatas)", async () => {
    let freshCalls = 0;
    const out = await resolveHistoricPart(
      async () => [],
      async () => {
        freshCalls += 1;
        return [];
      },
    );
    expect(freshCalls).toBe(1);
    expect(out).toEqual([]);
  });

  it("predikat: HANYA panjang 0 yang memicu bypass", () => {
    expect(shouldBypassEmptyCache([])).toBe(true);
    expect(shouldBypassEmptyCache([row("2026-07-01", 0)])).toBe(false);
  });
});
