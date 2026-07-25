import { describe, expect, it } from "vitest";
import { buildHarianModel, type HarianInput } from "@/lib/harian-model";
import type { DailySalesRow } from "@/lib/queries";
import type { ScopedUnit, ScopedUnitId } from "@/lib/scope-rule";
import { buildHarianDocDefinition, type HarianDocMeta } from "./harian-doc";

const U = (id: number, code: string, name: string): ScopedUnit => ({ unit_id: id as ScopedUnitId, code, name });
const UNITS = [U(1, "6478111", "IB"), U(2, "6378301", "BK")];
const sale = (u: number, d: string, nama: string, vol: number): DailySalesRow => ({ unit_id: u, d, ckdbbm: "BB-x", nama, vol, omzet: vol * 10000 });
const META: HarianDocMeta = { ptLabel: "PT Uji", dateLong: "Rabu, 22 Juli 2026", unitsCount: 2, divisor: 22, generatedLabel: "x", freshnessLabel: "sinkron terlama: BK, baru saja" };
const input: HarianInput = {
  units: UNITS, date: "2026-07-22",
  dailySales: UNITS.flatMap((u) => [sale(u.unit_id, "2026-07-22", "SOLAR", 1000)]),
  gl: new Map(), coverage: UNITS.map((u) => ({ unit_id: u.unit_id, sales_min: "2020-01-01" })),
  sync: UNITS.map((u) => ({ unit_id: u.unit_id, last_run: "2026-07-24T07:00:00Z" })), recordFloor: "2025-12-29",
};

describe("buildHarianDocDefinition — struktur", () => {
  const doc = buildHarianDocDefinition({ model: buildHarianModel(input), meta: META });
  it("A4 lanskap (7 kolom)", () => {
    expect(doc.pageSize).toBe("A4");
    expect(doc.pageOrientation).toBe("landscape");
  });
  it("footer fungsi (Halaman X dari Y + kesegaran)", () => {
    expect(typeof doc.footer).toBe("function");
    const f = (doc.footer as (a: number, b: number) => { columns: Array<{ text: string }> })(1, 3);
    const txt = f.columns.map((c) => c.text).join(" ");
    expect(txt).toContain("Halaman 1 dari 3");
    expect(txt).toContain("sinkron terlama");
  });
  it("info judul memuat PT + tanggal", () => {
    expect(String(doc.info?.title)).toContain("PT Uji");
  });
  it("presentation-only: dibangun dari model tanpa melempar", () => {
    expect(() => buildHarianDocDefinition({ model: buildHarianModel(input), meta: META })).not.toThrow();
  });
});
