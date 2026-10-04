/** Synthetic quality cases only. No live operational data. */
import { buildHarianModel } from "../harian-model";
import type { DailyGlRow } from "../queries";
import type { ScopedUnitId } from "../scope-rule";

export function harianGlQualityFixture(completeDaily = false) {
  const units = ["Data hilang", "Data tidak valid", "Nol terukur", "Sementara MTD", "Gain final", "Losses final", "Unit final"].map((name, i) => ({
    unit_id: (i + 1) as ScopedUnitId, code: `SYNTHETIC-${i + 1}`, name,
  }));
  const row = (d: string, gl: number | null, provisional = false): DailyGlRow => ({
    d, ckdbbm: "BB-03", nama: "SOLAR", fisik: 20000, fisik_prev: 20000,
    pen_do: 0, sales_gross: 1000, tera: 0, gl, excluded_tanks: gl === null ? 1 : 0, provisional,
  });
  const before = "2026-07-21";
  const date = "2026-07-22";
  return buildHarianModel({
    units, date,
    dailySales: units.flatMap((u) => [before, date].map((d) => ({ unit_id: u.unit_id, d, ckdbbm: "BB-03", nama: "SOLAR", vol: 1000, omzet: 10000000 }))),
    coverage: units.map((u) => ({ unit_id: u.unit_id, sales_min: before })),
    sync: units.map((u) => ({ unit_id: u.unit_id, last_run: "2026-07-23T07:00:00Z" })),
    gl: new Map([
      [1, [row(before, 100), ...(completeDaily ? [row(date, 20)] : [])]],
      [2, [row(before, null), row(date, -25)]],
      [3, [row(before, 0), row(date, 0)]],
      [4, [row(before, 5000, true), row(date, -50)]],
      [5, [row(before, 600), row(date, 300)]],
      [6, [row(before, -6000), row(date, -700)]],
      [7, [row(before, 1000), row(date, 100)]],
    ]),
  });
}

/** Current losses must never be offset by a stale unit's prior-day gain. */
export function harianGlStaleUnitFixture() {
  const current = { unit_id: 1 as ScopedUnitId, code: "SYNTHETIC-CURRENT", name: "Current unit" };
  const stale = { unit_id: 2 as ScopedUnitId, code: "SYNTHETIC-STALE", name: "Stale unit" };
  const before = "2026-10-01";
  const date = "2026-10-02";
  const row = (d: string, gl: number): DailyGlRow => ({
    d, ckdbbm: "BB-03", nama: "SOLAR", fisik: 10000, fisik_prev: 10000,
    pen_do: 0, sales_gross: 1000, tera: 0, gl, excluded_tanks: 0, provisional: false,
  });
  return buildHarianModel({
    units: [current, stale], date,
    dailySales: ([[current, date], [stale, before]] as const).map(([u, d]) => ({
      unit_id: u.unit_id, d, ckdbbm: "BB-03", nama: "SOLAR", vol: 1000, omzet: 10000000,
    })),
    coverage: [current, stale].map((u) => ({ unit_id: u.unit_id, sales_min: before })),
    sync: [current, stale].map((u) => ({ unit_id: u.unit_id, last_run: "2026-10-03T07:00:00Z" })),
    gl: new Map([[1, [row(date, -5)]], [2, [row(before, 7)]]]),
  });
}
