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
    pen_do: 0, sales_gross: 1000, tera: 0, gl, movement_invalid: false, excluded_tanks: gl === null ? 1 : 0, provisional,
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
    pen_do: 0, sales_gross: 1000, tera: 0, gl, movement_invalid: false, excluded_tanks: 0, provisional: false,
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

/** Empty scope, or one measured date plus a known date without computed G/L. */
export function harianGlEmptyWindowFixture(observation?: { day: "earlier" | "current"; gl: number }) {
  const units = [1, 2, 3].map((id) => ({
    unit_id: id as ScopedUnitId, code: `SYNTHETIC-EMPTY-${id}`, name: `Empty unit ${id}`,
  }));
  const date = "2026-10-02";
  const before = "2026-10-01";
  const hasObservation = observation !== undefined;
  return buildHarianModel({
    units, date,
    // Recorded zero-sales dates establish freshness, but a date without a G/L
    // measurement makes dependent MTD totals unavailable. An observed current
    // zero remains valid independently of the missing earlier measurement.
    dailySales: hasObservation ? [before, date].map((d) => ({
      unit_id: 1, d, ckdbbm: "BB-03", nama: "SOLAR", vol: 0, omzet: 0,
    })) : [],
    coverage: units.map((u) => ({ unit_id: u.unit_id,
      sales_min: hasObservation && u.unit_id === 1 ? before : null })),
    sync: [],
    gl: observation ? new Map([[1, [{
      d: observation.day === "earlier" ? before : date,
      ckdbbm: "BB-03", nama: "SOLAR", fisik: 1000 + observation.gl,
      fisik_prev: 1000, pen_do: 0, sales_gross: 0, tera: 0, gl: observation.gl,
      movement_invalid: false, excluded_tanks: 0, provisional: false,
    }]]]) : new Map(),
  });
}
