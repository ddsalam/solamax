import { describe, expect, it } from "vitest";
import { boardParamsToQuery, parseBoardParams } from "@/lib/board-params";
import type { ScopedUnit, ScopedUnitId } from "@/lib/scope-rule";

const NOW = new Date("2026-07-16T03:00:00Z"); // 2026-07-16 WIB
const u = (id: number, code: string, name: string): ScopedUnit => ({
  unit_id: id as unknown as ScopedUnitId,
  code,
  name,
});
const IB = u(1, "6478111", "Imam Bonjol");
const BK = u(2, "6378301", "Bakau");
const SCOPE_ALL = [IB, BK];

describe("parseBoardParams — RBAC intersect (KEAMANAN)", () => {
  it("unit URL di luar scope TIDAK pernah lolos: pengawas scope-1-unit minta 2 unit → hanya unitnya", () => {
    const p = parseBoardParams({ units: "6478111,6378301" }, [BK], NOW);
    expect(p.units).toEqual([BK]);
    expect(p.allUnits).toBe(true); // semua unit ber-scope-nya terpilih
  });
  it("URL berisi HANYA unit asing → fallback semua unit ber-scope (bukan bocor/404)", () => {
    const p = parseBoardParams({ units: "9999999" }, [BK], NOW);
    expect(p.units).toEqual([BK]);
  });
  it("subset valid dipertahankan; urutan mengikuti scope, bukan URL", () => {
    const p = parseBoardParams({ units: "6378301" }, SCOPE_ALL, NOW);
    expect(p.units).toEqual([BK]);
    expect(p.allUnits).toBe(false);
    const q = parseBoardParams({ units: "6378301,6478111" }, SCOPE_ALL, NOW);
    expect(q.units).toEqual([IB, BK]); // urutan scope
    expect(q.allUnits).toBe(true);
  });
  it("param absen / kosong / sampah → semua unit ber-scope", () => {
    expect(parseBoardParams({}, SCOPE_ALL, NOW).units).toEqual(SCOPE_ALL);
    expect(parseBoardParams({ units: "" }, SCOPE_ALL, NOW).units).toEqual(SCOPE_ALL);
    expect(parseBoardParams({ units: ",,  ," }, SCOPE_ALL, NOW).units).toEqual(SCOPE_ALL);
  });
  it("scope kosong → units kosong (halaman render empty state, bukan error)", () => {
    expect(parseBoardParams({ units: "6478111" }, [], NOW).units).toEqual([]);
  });
});

describe("parseBoardParams — periode & mode", () => {
  it("default: today + kumulatif", () => {
    const p = parseBoardParams({}, SCOPE_ALL, NOW);
    expect(p.period.key).toBe("today");
    expect(p.mode).toBe("kumulatif");
  });
  it("kompat mundur: p=week→7d, p=month→30d", () => {
    expect(parseBoardParams({ p: "week" }, SCOPE_ALL, NOW).period.key).toBe("7d");
    expect(parseBoardParams({ p: "month" }, SCOPE_ALL, NOW).period.key).toBe("30d");
  });
  it("custom valid diteruskan; custom invalid → fallback 30d", () => {
    const ok = parseBoardParams(
      { p: "custom", from: "2026-06-01", to: "2026-06-30" },
      SCOPE_ALL,
      NOW,
    );
    expect(ok.period.key).toBe("custom");
    expect(ok.period.range).toEqual({ from: "2026-06-01", to: "2026-06-30" });
    const bad = parseBoardParams({ p: "custom", from: "x", to: "y" }, SCOPE_ALL, NOW);
    expect(bad.period.key).toBe("30d");
  });
  it("mode hanya menerima 'banding'; lainnya kumulatif", () => {
    expect(parseBoardParams({ mode: "banding" }, SCOPE_ALL, NOW).mode).toBe("banding");
    expect(parseBoardParams({ mode: "BANDING" }, SCOPE_ALL, NOW).mode).toBe("kumulatif");
    expect(parseBoardParams({ mode: "xyz" }, SCOPE_ALL, NOW).mode).toBe("kumulatif");
  });
});

describe("boardParamsToQuery — URL kanonik", () => {
  it("default (semua unit, today, kumulatif) → tanpa query", () => {
    expect(
      boardParamsToQuery({ unitCodes: ["6478111", "6378301"], allUnits: true, p: "today", mode: "kumulatif" }),
    ).toBe("");
  });
  it("subset unit + custom + banding lengkap di URL (shareable)", () => {
    const s = boardParamsToQuery({
      unitCodes: ["6378301"],
      allUnits: false,
      p: "custom",
      from: "2026-06-01",
      to: "2026-06-30",
      mode: "banding",
    });
    expect(s).toContain("units=6378301");
    expect(s).toContain("p=custom");
    expect(s).toContain("from=2026-06-01");
    expect(s).toContain("to=2026-06-30");
    expect(s).toContain("mode=banding");
  });
  it("from/to hanya ikut saat p=custom", () => {
    const s = boardParamsToQuery({
      unitCodes: [],
      allUnits: true,
      p: "7d",
      from: "2026-06-01",
      to: "2026-06-30",
      mode: "kumulatif",
    });
    expect(s).toBe("?p=7d");
  });
});
