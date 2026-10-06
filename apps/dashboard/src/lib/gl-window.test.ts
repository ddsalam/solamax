import { describe, expect, it, vi } from "vitest";

// gl-window → queries → db (pool eager) — test murni tak butuh DB.
vi.mock("./db", () => ({ q: vi.fn(), qScoped: vi.fn(), pool: {} }));

import {
  resolveHistoricPart,
  shouldBypassEmptyCache,
  splitGlWindow,
} from "@/lib/gl-window";
import { createGlHistoryCache } from "@/lib/gl-history-cache";
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
    sales_gross: 0, tera: 0, gl, movement_invalid: false, excluded_tanks: 0, provisional: false,
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

  it.each([true, undefined, null, 0, "false"])("rejects stale or invalid movement quality metadata (%s)", async flag => {
    const legacy = { ...row("2026-07-01", 0), movement_invalid: flag } as unknown as DailyGlRow;
    expect(shouldBypassEmptyCache([legacy])).toBe(true);
    const fresh = [row("2026-07-01", 0)];
    expect(await resolveHistoricPart(async () => [legacy], async () => fresh)).toBe(fresh);
  });

  it.each([NaN, Infinity, -Infinity, undefined])("does not serialize invalid G/L (%s) into a cached zero/null", value => {
    const invalid = { ...row("2026-07-01", 0), gl: value } as unknown as DailyGlRow;
    expect(shouldBypassEmptyCache([invalid])).toBe(true);
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

  it.each(["penutup_nol", "jangkar_nol"] as const)(
    "never admits a window holding a source-artefact verdict (%s), even if flags look final", reason => {
      // Defensive: a verdict must bypass by itself, not only through gl/provisional.
      const suspect: DailyGlRow = { ...row("2026-07-01", 0), gl: -5_000, gl_raw: -5_000, gl_suspect: reason };
      expect(shouldBypassEmptyCache([row("2026-07-02", 0), suspect])).toBe(true);
    });

  it("bypasses a legacy numeric zero-closing artefact lacking the SQL verdict", () => {
    const legacy: DailyGlRow = { ...row("2026-07-01", -4_900), fisik: 0, fisik_prev: 5_000, sales_gross: 100 };
    expect(shouldBypassEmptyCache([legacy])).toBe(true);
  });

  it("keeps a final legitimately-empty-tank window cacheable", () => {
    const empty: DailyGlRow = { ...row("2026-07-01", 0), fisik: 0, fisik_prev: 900, sales_gross: 900, gl_raw: 0, gl_suspect: null };
    expect(shouldBypassEmptyCache([empty])).toBe(false);
  });

  it("history cache re-reads a suspect window each time but retains a clean one (bounded by revision)", async () => {
    const cache = createGlHistoryCache((rows) => !shouldBypassEmptyCache(rows));
    const suspect: DailyGlRow = { ...row("2026-07-01", 0), gl: null, gl_raw: -5_000, gl_suspect: "penutup_nol", provisional: true };
    let suspectLoads = 0; let cleanLoads = 0;
    const loaders = (rows: DailyGlRow[], count: () => void) => ({
      readRevision: async () => "rev-1", load: async () => { count(); return rows; },
    });
    for (let i = 0; i < 3; i++) {
      await cache.get("suspect", loaders([suspect], () => suspectLoads++));
      await cache.get("clean", loaders([row("2026-07-01", 0)], () => cleanLoads++));
    }
    expect(suspectLoads).toBe(3);
    expect(cleanLoads).toBe(1);
    expect(cache.stats().entries).toBe(1);
  });
});
