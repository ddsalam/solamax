import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GlBars } from "@/components/harian/HarianCharts";
import { HarianSummaryCards, MatrixTable, MonthlyMatrix } from "@/components/harian/HarianSections";
import { harianGlStaleUnitFixture } from "./__fixtures__/harian-gl-quality";
import { buildHarianModel, type HarianModel } from "./harian-model";
import { GL_DAILY_PROVISIONAL_WARNING, GL_INCOMPLETE_WARNING, GL_MONTHLY_PROVISIONAL_WARNING, glStatusText, glValueText } from "./harian-gl-display";
import type { ScopedUnitId } from "./scope-rule";

function fixture(): HarianModel {
  const units = [1, 2, 3].map((unit_id) => ({ unit_id: unit_id as ScopedUnitId, code: `U${unit_id}`, name: `Unit ${unit_id}` }));
  const model = buildHarianModel({
    units, date: "2026-07-22", gl: new Map(),
    dailySales: units.map((u) => ({ unit_id: u.unit_id, d: "2026-07-22", ckdbbm: "BB-03", nama: "SOLAR", vol: 1000, omzet: 10000000 })),
    coverage: units.map((u) => ({ unit_id: u.unit_id, sales_min: "2020-01-01" })),
    sync: units.map((u) => ({ unit_id: u.unit_id, last_run: "2026-07-23T07:00:00Z" })),
  });
  model.glDaily = {
    rows: [{ key: "SOLAR", label: "Solar", byUnit: { 1: null, 2: -12, 3: 0 }, total: null }],
    totalsByUnit: { 1: null, 2: -12, 3: 0 }, grandTotal: null,
  };
  model.glMonthly = {
    rows: [{ key: "SOLAR", label: "Solar", byUnit: { 1: { kum: null, avg: null }, 2: { kum: -220, avg: -10 }, 3: { kum: 0, avg: 0 } }, total: { kum: null, avg: null } }],
    totalsByUnit: { 1: { kum: null, avg: null }, 2: { kum: -220, avg: -10 }, 3: { kum: 0, avg: 0 } },
    grand: { kum: null, avg: null },
  };
  model.glIncomplete = true;
  return model;
}

const daily = (m: HarianModel) => renderToStaticMarkup(<MatrixTable title="GL daily" hint="liter" units={m.units} {...m.glDaily} incomplete={m.freshness.incomplete} signTone provisional={m.glProvisional} glIncomplete={m.glDaily.grandTotal === null} />);
const monthly = (m: HarianModel) => renderToStaticMarkup(<MonthlyMatrix title="GL monthly" hint="liter" units={m.units} {...m.glMonthly} divisor={22} incomplete={m.freshness.incomplete} signTone provisional={m.glMonthlyProvisional} glIncomplete={m.glIncomplete} />);

describe("G/L presentation: unknown is not zero or gain", () => {
  it("formats null separately from measured zero and provisional values", () => {
    expect(glValueText(null)).toBe("—");
    expect(glValueText(0)).toBe("0");
    expect(glStatusText(null, false)).toBe("TIDAK LENGKAP");
    expect(glStatusText(null, true)).toBe("TIDAK LENGKAP");
    expect(glStatusText(0, false)).toBe("tanpa selisih");
    expect(glStatusText(-12, true)).toBe("losses · SEMENTARA");
    expect(glStatusText(12, true)).toBe("gain · SEMENTARA");
  });

  it("shows unknown daily/MTD KPIs as em dash with incomplete status", () => {
    const html = renderToStaticMarkup(<HarianSummaryCards model={fixture()} />);
    expect(html.match(/>—</g)).toHaveLength(2);
    expect(html.match(/TIDAK LENGKAP/g)).toHaveLength(2);
    expect(html).not.toMatch(/>(gain|losses)</);
  });

  it("keeps valid daily/MTD KPI values and independent provisional labels", () => {
    const m = fixture();
    m.glDaily.grandTotal = -12;
    m.glMonthly.grand.kum = 220;
    m.glProvisional = false;
    m.glMonthlyProvisional = true;
    const html = renderToStaticMarkup(<HarianSummaryCards model={m} />);
    expect(html).toContain(">-12<");
    expect(html).toContain(">220<");
    expect(html).toContain(">losses<");
    expect(html).toContain(">gain · SEMENTARA<");
  });

  it("renders null daily cells and all dependent totals as em dash, retaining valid zero", () => {
    const html = daily(fixture());
    expect(html.match(/>—</g)).toHaveLength(4);
    expect(html.match(/>0</g)).toHaveLength(2);
    expect(html.match(/>-12</g)).toHaveLength(2);
    expect(html).toContain(GL_INCOMPLETE_WARNING);
    expect(html).not.toContain("sel tanpa data tampil 0");
  });

  it("renders null MTD cumulative/average cells and totals as em dash", () => {
    const html = monthly(fixture());
    expect(html.match(/>—</g)).toHaveLength(8);
    expect(html.match(/>0</g)).toHaveLength(4);
    expect(html).toContain(GL_INCOMPLETE_WARNING);
  });

  it("shows daily and MTD provisional warnings beside their tables", () => {
    const m = fixture();
    m.glProvisional = true;
    m.glMonthlyProvisional = true;
    expect(daily(m)).toContain(GL_DAILY_PROVISIONAL_WARNING);
    expect(monthly(m)).toContain(GL_MONTHLY_PROVISIONAL_WARNING);
  });

  it("omits unknown chart bars while retaining unit labels, missing status, and valid values", () => {
    const m = fixture();
    const html = renderToStaticMarkup(<GlBars units={m.units} totals={m.glMonthly.totalsByUnit} provisional />);
    expect(html.match(/class="harian-gl-fill"/g)).toHaveLength(2);
    for (const u of m.units) expect(html).toContain(u.name);
    expect(html).toContain(">—<");
    expect(html).toContain(">(220)<");
    expect(html).toContain(">0<");
    expect(html).toContain(GL_MONTHLY_PROVISIONAL_WARNING);
    expect(html).toContain("TIDAK LENGKAP");
    expect(html).not.toMatch(/NaN|Infinity/);
  });

  it("keeps current losses visible without presenting stale prior-day gain as a group total", () => {
    const m = harianGlStaleUnitFixture();
    expect(m.units.find((u) => u.unitId === 2)?.stale).toBe(true);
    expect(m.glDaily.grandTotal).toBeNull();
    expect(m.glMonthly.grand.kum).toBeNull();
    expect(m.glDaily.totalsByUnit[1]).toBe(-5);
    expect(m.glMonthly.totalsByUnit[1]?.kum).toBe(-5);
    const cards = renderToStaticMarkup(<HarianSummaryCards model={m} />);
    expect(cards.match(/>—</g)).toHaveLength(2);
    expect(cards.match(/TIDAK LENGKAP/g)).toHaveLength(2);
    expect(cards).not.toMatch(/>(gain|losses)( · SEMENTARA)?</);
    for (const table of [daily(m), monthly(m)]) {
      expect(table.match(/>-5</g)).toHaveLength(2); // Product and current-unit total.
      expect(table).toContain("TIDAK LENGKAP");
      expect(table).not.toContain(">7<");
      expect(table).not.toContain(">2<"); // Never turn -5 + stale 7 into group gain.
    }
    const chart = renderToStaticMarkup(<GlBars units={m.units} totals={m.glMonthly.totalsByUnit} provisional={m.glMonthlyProvisional} incomplete={m.glIncomplete} />);
    expect(chart.match(/class="harian-gl-fill"/g)).toHaveLength(1);
    expect(chart).toContain(">(5)<");
    expect(chart).toContain("Stale unit");
    expect(chart).toContain(">—<");
  });

  it("retains sales fallback zero for absent product cells", () => {
    const m = fixture();
    const html = renderToStaticMarkup(<MatrixTable title="Sales" hint="liter" units={m.units} rows={[{ key: "SOLAR", label: "Solar", byUnit: {}, total: 0 }]} totalsByUnit={{}} grandTotal={0} incomplete={false} />);
    expect(html.match(/>0</g)).toHaveLength(8);
    expect(html).not.toContain(">—<");
  });
});
