import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import pdfMakeImport from "pdfmake/build/pdfmake";
import vfsImport from "pdfmake/build/vfs_fonts";
import { describe, expect, it } from "vitest";
import { GlBars } from "@/components/harian/HarianCharts";
import { HarianNotes, HarianSummaryCards, MatrixTable, MonthlyMatrix } from "@/components/harian/HarianSections";
import { harianGlEmptyWindowFixture, harianGlQualityFixture, harianGlStaleUnitFixture } from "../__fixtures__/harian-gl-quality";
import { GL_INCOMPLETE_WARNING, GL_MONTHLY_PROVISIONAL_WARNING } from "../harian-gl-display";
import { buildHarianDocDefinition } from "./harian-doc";
import { pdfText } from "./glyphs";
import { divergentGlCanvas } from "./pdf-charts";

// pdfmake's browser bundle exposes its font VFS outside the published typings.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfMake: any = (pdfMakeImport as any).default ?? pdfMakeImport;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vfs: any = (vfsImport as any).default ?? vfsImport;
pdfMake.vfs = vfs.pdfMake?.vfs ?? vfs.vfs ?? vfs;

function textIn(node: unknown): string[] {
  if (node == null) return [];
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(textIn);
  if (typeof node !== "object") return [];
  const obj = node as Record<string, unknown>;
  return ["text", "stack", "columns", "table", "body", "ul"].flatMap((key) => textIn(obj[key]));
}

const model = harianGlQualityFixture();
const doc = (report = model) => buildHarianDocDefinition({ model: report, meta: {
  ptLabel: "SYNTHETIC TEST DATA", dateLong: report.date, unitsCount: report.units.length,
  divisor: report.avgDivisor, generatedLabel: "synthetic fixture", freshnessLabel: "synthetic data; not live",
} });

function html(report = model) {
  return renderToStaticMarkup(<main className="page">
    <h1>SYNTHETIC TEST DATA · G/L quality cases · {report.units.length} units</h1>
    <HarianSummaryCards model={report} />
    <MatrixTable title="Gain / Losses — harian" hint="liter" units={report.units} {...report.glDaily} incomplete={report.freshness.incomplete} signTone provisional={report.glProvisional} glIncomplete={report.glDaily.grandTotal === null} />
    <GlBars units={report.units} totals={report.glMonthly.totalsByUnit} provisional={report.glMonthlyProvisional} incomplete={report.glIncomplete} />
    <MonthlyMatrix title="Gain / Losses — bulanan (MTD)" hint="liter · Kumulatif & Rata-Rata" units={report.units} {...report.glMonthly} divisor={report.avgDivisor} incomplete={report.freshness.incomplete} signTone provisional={report.glMonthlyProvisional} glIncomplete={report.glIncomplete} />
    <HarianNotes notes={report.notes} />
  </main>);
}

describe("G/L screen/PDF quality parity — synthetic seven units", () => {
  it("keeps earlier-day provisional status in MTD only", () => {
    expect(harianGlQualityFixture(true).glProvisional).toBe(false);
    expect(harianGlQualityFixture(true).glMonthlyProvisional).toBe(true);
    expect(model.glMonthlyProvisional).toBe(true);
    expect(model.glDaily.totalsByUnit[3]).toBe(0);
    expect(model.glMonthly.totalsByUnit[3]?.kum).toBe(0);
    expect(model.glDaily.grandTotal).toBeNull();
    expect(model.glMonthly.grand.kum).toBeNull();
    expect(model.glMonthly.totalsByUnit[4]?.kum).toBe(4950);
  });

  it("preserves incomplete cells/totals and provisional warning in PDF, identical to screen", () => {
    const content = doc().content as unknown as Array<Record<string, unknown>>;
    const cards = content.find((c) => Array.isArray(c.columns) && (c.columns as unknown[]).length === 4)!;
    const columns = cards.columns as unknown[];
    expect(textIn(columns[2])).toEqual(["G/L hari ini (L)", "—", "TIDAK LENGKAP"]);
    expect(textIn(columns[3])).toEqual(["G/L bulan berjalan (L)", "—", "TIDAK LENGKAP"]);
    const text = textIn(content).join(" ");
    expect(text).toContain(pdfText(GL_INCOMPLETE_WARNING));
    expect(text).toContain(pdfText(GL_MONTHLY_PROVISIONAL_WARNING));
    expect(text).toContain("— · TIDAK LENGKAP");
    expect(text).not.toContain("sel tanpa data tampil 0");
    expect(text).not.toMatch(/NaN|Infinity/);
    expect(html()).toContain(GL_MONTHLY_PROVISIONAL_WARNING);
    expect(html().match(/class="harian-gl-fill"/g)).toHaveLength(5);
    const dailyTitleIndex = content.findIndex((c) => String(c.text).startsWith("Gain / Losses — harian"));
    const dailyTable = content[dailyTitleIndex + 2]!.table as { body: unknown[][] };
    const solar = dailyTable.body.find((r) => textIn(r[0])[0] === "Solar")!;
    expect(solar.map((c) => textIn(c).join(""))).toEqual(["Solar", "—", "-25", "0", "-50", "300", "-700", "100", "—"]);
    const monthlyTitleIndex = content.findIndex((c) => String(c.text).startsWith("Gain / Losses — bulanan (MTD)"));
    const monthlyTable = content[monthlyTitleIndex + 1]!.table as { body: unknown[][] };
    const solarMtd = monthlyTable.body.find((r) => textIn(r[0])[0] === "Solar")!;
    expect(textIn(solarMtd[1])).toEqual(["—"]);
    expect(textIn(solarMtd[2])).toEqual(["—"]);
    expect(textIn(solarMtd[3])).toEqual(["—"]);
    expect(textIn(solarMtd[4])).toEqual(["—"]);
    expect(textIn(solarMtd.at(-2))).toEqual(["—"]);
    expect(textIn(solarMtd.at(-1))).toEqual(["—"]);
  });

  it("keeps valid provisional PDF KPI values and measured zero distinct from gain", () => {
    const known = harianGlQualityFixture(true);
    known.glDaily.grandTotal = 0;
    known.glProvisional = false;
    known.glMonthly.grand.kum = 4950;
    known.glMonthlyProvisional = true;
    const definition = buildHarianDocDefinition({ model: known, meta: {
      ptLabel: "SYNTHETIC TEST DATA", dateLong: "22 Juli 2026", unitsCount: 7,
      divisor: 22, generatedLabel: "synthetic fixture", freshnessLabel: "synthetic data; not live",
    } });
    const content = definition.content as unknown as Array<Record<string, unknown>>;
    const cards = content.find((c) => Array.isArray(c.columns) && (c.columns as unknown[]).length === 4)!;
    const columns = cards.columns as unknown[];
    expect(textIn(columns[2])).toEqual(["G/L hari ini (L)", "0", "tanpa selisih"]);
    expect(textIn(columns[3])).toEqual(["G/L bulan berjalan (L)", "4.950", "gain · SEMENTARA"]);
  });

  it("keeps stale-unit group headlines unavailable and the current unit's losses visible in PDF", () => {
    const stale = harianGlStaleUnitFixture();
    const definition = buildHarianDocDefinition({ model: stale, meta: {
      ptLabel: "SYNTHETIC TEST DATA", dateLong: "2 Oktober 2026", unitsCount: 2,
      divisor: 2, generatedLabel: "synthetic fixture", freshnessLabel: "synthetic data; not live",
    } });
    expect(stale.glDaily.grandTotal).toBeNull();
    expect(stale.glMonthly.grand.kum).toBeNull();
    const content = definition.content as unknown as Array<Record<string, unknown>>;
    const cards = content.find((c) => Array.isArray(c.columns) && (c.columns as unknown[]).length === 4)!;
    const columns = cards.columns as unknown[];
    expect(textIn(columns[2])).toEqual(["G/L hari ini (L)", "—", "TIDAK LENGKAP"]);
    expect(textIn(columns[3])).toEqual(["G/L bulan berjalan (L)", "—", "TIDAK LENGKAP"]);
    const dailyIndex = content.findIndex((c) => String(c.text).startsWith("Gain / Losses — harian"));
    const dailyTable = content[dailyIndex + 2]!.table as { body: unknown[][] };
    const dailySolar = dailyTable.body.find((r) => textIn(r[0])[0] === "Solar")!;
    expect(dailySolar.map((c) => textIn(c).join(""))).toEqual(["Solar", "-5", "—", "—"]);
    const monthlyIndex = content.findIndex((c) => String(c.text).startsWith("Gain / Losses — bulanan (MTD)"));
    const monthlyTable = content[monthlyIndex + 1]!.table as { body: unknown[][] };
    const monthlySolar = monthlyTable.body.find((r) => textIn(r[0])[0] === "Solar")!;
    expect(textIn(monthlySolar[1])).toEqual(["-5"]);
    expect(monthlySolar.slice(3).map((c) => textIn(c).join(""))).toEqual(["—", "—", "—", "—"]);
    const chartIndex = content.findIndex((c) => String(c.text).startsWith("Gain / Losses kumulatif bulan berjalan"));
    const chartText = textIn(content[chartIndex + 2]);
    expect(chartText).toContain("(5)");
    expect(chartText).toContain("— · TIDAK LENGKAP");
    expect(chartText).not.toContain("7");
  });

  it("omits null PDF bars without shifting valid unit rows, including true zero", () => {
    const canvas = divergentGlCanvas([
      { name: "missing", value: null }, { name: "loss", value: -5 },
      { name: "missing2", value: null }, { name: "zero", value: 0 },
    ], 10, 300, 12) as unknown as { canvas: Array<{ type: string; y?: number }> };
    expect(canvas.canvas.filter((c) => c.type === "rect").map((c) => c.y)).toEqual([14.4, 38.4]);
  });
});

describe("G/L screen/PDF all-empty scope", () => {
  it("does not invent measured zero for an empty three-unit scope", () => {
    const empty = harianGlEmptyWindowFixture();
    expect(empty.units.every((u) => u.notYet)).toBe(true);
    expect(empty.glDaily.grandTotal).toBeNull();
    expect(empty.glMonthly.grand).toEqual({ kum: null, avg: null });
    expect(empty.glDaily.rows.every((r) => r.total === null)).toBe(true);
    expect(empty.glMonthly.rows.every((r) => r.total.kum === null && r.total.avg === null)).toBe(true);
    const markup = html(empty);
    expect(markup).not.toContain("tanpa selisih");
    expect(markup).toContain("TIDAK LENGKAP");
    expect(markup).not.toContain('class="harian-gl-fill"');
    expect(markup.match(/class="text-h2 t-primary num mt2">([^<]+)/g)?.slice(-2))
      .toEqual(['class="text-h2 t-primary num mt2">—', 'class="text-h2 t-primary num mt2">—']);

    const content = doc(empty).content as unknown as Array<Record<string, unknown>>;
    const cards = content.find((c) => Array.isArray(c.columns) && (c.columns as unknown[]).length === 4)!;
    const columns = cards.columns as unknown[];
    expect(textIn(columns[2])).toEqual(["G/L hari ini (L)", "—", "TIDAK LENGKAP"]);
    expect(textIn(columns[3])).toEqual(["G/L bulan berjalan (L)", "—", "TIDAK LENGKAP"]);
    expect(textIn(content).join(" ")).not.toContain("tanpa selisih");
    const dailyIndex = content.findIndex((c) => String(c.text).startsWith("Gain / Losses — harian"));
    const dailyTable = content[dailyIndex + 2]!.table as { body: unknown[][] };
    const dailyValues = dailyTable.body.slice(1).flatMap((r) => r.slice(1).flatMap(textIn));
    expect(dailyValues).toHaveLength((empty.glDaily.rows.length + 1) * (empty.units.length + 1));
    expect(new Set(dailyValues)).toEqual(new Set(["—"]));
    const monthlyIndex = content.findIndex((c) => String(c.text).startsWith("Gain / Losses — bulanan (MTD)"));
    const monthlyTable = content[monthlyIndex + 1]!.table as { body: unknown[][] };
    const monthlyValues = monthlyTable.body.slice(2).flatMap((r) => r.slice(1).flatMap(textIn));
    expect(monthlyValues).toHaveLength((empty.glMonthly.rows.length + 1) * (empty.units.length + 1) * 2);
    expect(new Set(monthlyValues)).toEqual(new Set(["—"]));
  });

  it("withholds an earlier gain when the known current date has no computed G/L", () => {
    const earlier = harianGlEmptyWindowFixture({ day: "earlier", gl: 7 });
    expect(earlier.units[0]!.notYet).toBe(false);
    expect(earlier.units[0]!.stale).toBe(false);
    expect(earlier.glDaily.grandTotal).toBeNull();
    expect(earlier.glMonthly.grand).toEqual({ kum: null, avg: null });
    expect(earlier.glMonthly.totalsByUnit[1]).toEqual({ kum: null, avg: null });
    expect(earlier.glMonthly.rows.find((r) => r.label === "Solar")?.total)
      .toEqual({ kum: null, avg: null });
    expect(earlier.glIncomplete).toBe(true);
    expect(earlier.glMonthlyProvisional).toBe(true);
    const cards = renderToStaticMarkup(<HarianSummaryCards model={earlier} />);
    expect(cards).not.toContain("tanpa selisih");
    expect(cards.match(/class="text-h2 t-primary num mt2">([^<]+)/g)?.slice(-2))
      .toEqual(['class="text-h2 t-primary num mt2">—', 'class="text-h2 t-primary num mt2">—']);
    const markup = html(earlier);
    expect(markup).toContain(GL_INCOMPLETE_WARNING);
    expect(markup).not.toContain('class="harian-gl-fill"');
    const content = doc(earlier).content as unknown as Array<Record<string, unknown>>;
    const cardRow = content.find((c) => Array.isArray(c.columns) && (c.columns as unknown[]).length === 4)!;
    const columns = cardRow.columns as unknown[];
    expect(textIn(columns[2])).toEqual(["G/L hari ini (L)", "—", "TIDAK LENGKAP"]);
    expect(textIn(columns[3])).toEqual(["G/L bulan berjalan (L)", "—", "TIDAK LENGKAP"]);
    expect(textIn(content).join(" ")).toContain(pdfText(GL_INCOMPLETE_WARNING));
    const monthlyIndex = content.findIndex((c) => String(c.text).startsWith("Gain / Losses — bulanan (MTD)"));
    const monthlyTable = content[monthlyIndex + 1]!.table as { body: unknown[][] };
    const solar = monthlyTable.body.find((r) => textIn(r[0])[0] === "Solar")!;
    expect(solar.slice(1).flatMap(textIn).every((value) => value === "—")).toBe(true);
  });

  it("preserves measured current zero while an earlier missing date withholds MTD", () => {
    const current = harianGlEmptyWindowFixture({ day: "current", gl: 0 });
    expect(current.glDaily.grandTotal).toBe(0);
    expect(current.glDaily.totalsByUnit[1]).toBe(0);
    expect(current.glProvisional).toBe(false);
    expect(current.glMonthly.grand).toEqual({ kum: null, avg: null });
    expect(current.glMonthly.totalsByUnit[1]).toEqual({ kum: null, avg: null });
    expect(current.glIncomplete).toBe(true);
    expect(current.glMonthlyProvisional).toBe(true);
    const cards = renderToStaticMarkup(<HarianSummaryCards model={current} />);
    expect(cards.match(/class="text-h2 t-primary num mt2">([^<]+)/g)?.slice(-2))
      .toEqual(['class="text-h2 t-primary num mt2">0', 'class="text-h2 t-primary num mt2">—']);
    expect(cards.match(/tanpa selisih/g)).toHaveLength(1);
    const content = doc(current).content as unknown as Array<Record<string, unknown>>;
    const cardRow = content.find((c) => Array.isArray(c.columns) && (c.columns as unknown[]).length === 4)!;
    const columns = cardRow.columns as unknown[];
    expect(textIn(columns[2])).toEqual(["G/L hari ini (L)", "0", "tanpa selisih"]);
    expect(textIn(columns[3])).toEqual(["G/L bulan berjalan (L)", "—", "TIDAK LENGKAP"]);
  });
});

// Optional local visual output, never published and explicitly marked synthetic.
const output = process.env.HARIAN_QUALITY_RENDER_OUT;
(output ? it : it.skip)("writes synthetic HTML/PDF and verifies PDF text bytes", async () => {
  mkdirSync(output!, { recursive: true });
  const css = ["styles/ds/tokens/colors.css", "styles/ds/tokens/typography.css", "styles/ds/tokens/spacing.css", "styles/ds/tokens/elevation.css", "styles/ds/tokens/layout.css", "styles/ds/base.css", "styles/app.css"].map((f) => readFileSync(join(__dirname, "../..", f), "utf8")).join("\n");
  writeFileSync(join(output!, "quality.html"), `<!doctype html><meta charset="utf-8"><title>Synthetic G/L quality</title><style>${css}</style><body>${html()}</body>`);
  const bytes = await new Promise<Buffer>((resolve) => pdfMake.createPdf(doc()).getBuffer(resolve));
  const pdf = join(output!, "quality.pdf");
  writeFileSync(pdf, bytes);
  const text = execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" });
  expect(text).toContain("SYNTHETIC TEST DATA");
  expect(text).toContain("SEMENTARA");
  expect(text).toContain("TIDAK LENGKAP");
  expect(text).not.toMatch(/NaN|Infinity|sel tanpa data tampil 0/);
});


(output ? it : it.skip)("writes an actual synthetic empty-scope PDF with unavailable G/L headlines", async () => {
  mkdirSync(output!, { recursive: true });
  const empty = harianGlEmptyWindowFixture();
  writeFileSync(join(output!, "empty-scope.html"), `<!doctype html><meta charset="utf-8"><title>Synthetic empty G/L scope</title><body>${html(empty)}</body>`);
  const bytes = await new Promise<Buffer>((resolve) => pdfMake.createPdf(doc(empty)).getBuffer(resolve));
  const pdf = join(output!, "empty-scope.pdf");
  writeFileSync(pdf, bytes);
  const text = execFileSync("pdftotext", ["-raw", pdf, "-"], { encoding: "utf8" });
  expect(text).toContain("SYNTHETIC TEST DATA");
  expect(text).toMatch(/G\/L hari ini \(L\)\s+—\s+TIDAK LENGKAP/);
  expect(text).toMatch(/G\/L bulan berjalan \(L\)\s+—\s+TIDAK LENGKAP/);
  expect(text).not.toMatch(/tanpa selisih|NaN|Infinity/);
});

(output ? it : it.skip).each([
  { name: "missing-current-gl", day: "earlier" as const, gl: 7 },
  { name: "measured-current-zero", day: "current" as const, gl: 0 },
])("writes an actual synthetic $name PDF with incomplete MTD withheld", async ({ name, day, gl }) => {
  mkdirSync(output!, { recursive: true });
  const report = harianGlEmptyWindowFixture({ day, gl });
  writeFileSync(join(output!, `${name}.html`), `<!doctype html><meta charset="utf-8"><title>Synthetic ${name}</title><body>${html(report)}</body>`);
  const bytes = await new Promise<Buffer>((resolve) => pdfMake.createPdf(doc(report)).getBuffer(resolve));
  const pdf = join(output!, `${name}.pdf`);
  writeFileSync(pdf, bytes);
  const text = execFileSync("pdftotext", ["-raw", pdf, "-"], { encoding: "utf8" });
  expect(text).toContain("SYNTHETIC TEST DATA");
  expect(text).toMatch(/G\/L bulan berjalan \(L\)\s+—\s+TIDAK LENGKAP/);
  expect(text).not.toMatch(/NaN|Infinity/);
  if (day === "earlier") {
    expect(text).toMatch(/G\/L hari ini \(L\)\s+—\s+TIDAK LENGKAP/);
    expect(text).not.toContain("tanpa selisih");
  } else {
    expect(text).toMatch(/G\/L hari ini \(L\)\s+0\s+tanpa selisih/);
    expect(text.match(/tanpa selisih/g)).toHaveLength(1);
  }
});
