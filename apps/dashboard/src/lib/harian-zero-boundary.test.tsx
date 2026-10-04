import { Suspense, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HarianModel } from "./harian-model";
import type { DailyGlRow, DailySalesRow, ZeroClosingRow } from "./queries";
import type { ScopedUnitId } from "./scope-rule";

const mocks = vi.hoisted(() => ({
  scope: vi.fn(), sales: vi.fn(), coverage: vi.fn(), sync: vi.fn(), zeros: vi.fn(), gl: vi.fn(),
}));
vi.mock("./scope", () => ({ getDataScope: mocks.scope }));
vi.mock("./queries", () => ({
  getDailySalesByProduct: mocks.sales, getUnitCoverage: mocks.coverage,
  getSyncByUnit: mocks.sync, getZeroClosingEvents: mocks.zeros,
}));
vi.mock("./gl-window", () => ({ getDailyGlWindow: mocks.gl }));
import LaporanHarianPage from "@/app/(app)/laporan-harian/page";
import { HarianSummaryCards, MatrixTable, MonthlyMatrix } from "@/components/harian/HarianSections";
import { buildHarianDocDefinition } from "./export/harian-doc";
import { GL_DAILY_PROVISIONAL_WARNING, GL_MONTHLY_PROVISIONAL_WARNING } from "./harian-gl-display";

const unit = { unit_id: 1 as ScopedUnitId, code: "SYNTHETIC", name: "Synthetic unit" };
const glRow: DailyGlRow = {
  d: "2026-10-01", ckdbbm: "P", nama: "SOLAR", fisik_prev: 0, fisik: 9_000,
  pen_do: 0, sales_gross: 1_000, tera: 0, gl: 10_000,
  movement_invalid: false, excluded_tanks: 0, provisional: false,
};
const sale: DailySalesRow = {
  unit_id: 1, d: glRow.d, ckdbbm: "P", nama: "SOLAR", vol: 1_000, omzet: 10_000,
};
const event: ZeroClosingRow = {
  unit_id: 1, d: "2026-09-30", ckdtangki: "A", ckdbbm: "P", nama: "SOLAR",
  bk: 10_000, prev: 10_000, next: 9_000, recv_next: 0,
};

// Evaluate the real async server body beneath the page's Suspense boundary.
// Queries are mocked here only; queries.gl-integrity.test.ts executes their SQL.
async function pageModel(date: string): Promise<HarianModel> {
  const shell = await LaporanHarianPage({ searchParams: { d: date } });
  const children = shell.props.children as ReactElement[];
  const suspense = children.find(child => child.type === Suspense)!;
  expect(suspense).toBeDefined();
  const body = suspense.props.children as ReactElement & {
    type: (props: unknown) => Promise<ReactElement<{ children: ReactNode[] }>>;
  };
  const rendered = await body.type(body.props);
  const head = rendered.props.children[0] as ReactElement<{ model: HarianModel }>;
  return head.props.model;
}

function pdfTextNodes(node: unknown): string[] {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(pdfTextNodes);
  if (!node || typeof node !== "object") return [];
  const obj = node as Record<string, unknown>;
  return ["text", "stack", "columns", "table", "body", "ul"].flatMap(key => pdfTextNodes(obj[key]));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
  mocks.scope.mockResolvedValue({ units: [unit] });
  mocks.sales.mockResolvedValue([sale]);
  mocks.coverage.mockResolvedValue([{ unit_id: 1, sales_min: "2026-09-29" }]);
  mocks.sync.mockResolvedValue([{ unit_id: 1, last_run: "2026-10-02T01:00:00Z" }]);
  mocks.zeros.mockResolvedValue([event]);
  mocks.gl.mockResolvedValue([glRow]);
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers(); });

describe("Harian zero-closing month boundary", () => {
  it.each([
    ["2026-10-01", "2026-09-29", "2026-10-02"],
    ["2026-10-04", "2026-09-29", "2026-10-04"],
    ["2026-01-01", "2025-12-30", "2026-01-02"],
    ["2024-03-01", "2024-02-28", "2024-03-02"],
  ])("fetches the zero candidate's predecessor for %s and caps the upper context at today", async (date, from, to) => {
    await pageModel(date);
    expect(mocks.zeros).toHaveBeenCalledTimes(1);
    expect(mocks.zeros).toHaveBeenCalledWith([unit.unit_id], from, to);
  });

  it("carries a prior-month zero anchor into daily and MTD screen/PDF warnings without correcting its value", async () => {
    const model = await pageModel("2026-10-01");
    expect(model).toMatchObject({ glProvisional: true, glMonthlyProvisional: true, glIncomplete: false });
    expect(model.glDaily.grandTotal).toBe(10_000);
    expect(model.glMonthly.grand.kum).toBe(10_000);
    expect(model.glSuspectUnits.map(u => u.unitId)).toEqual([1]);
    const cards = renderToStaticMarkup(<HarianSummaryCards model={model} />);
    expect(cards.match(/gain · SEMENTARA/g)).toHaveLength(2);
    const daily = renderToStaticMarkup(<MatrixTable title="Synthetic daily" hint="L" units={model.units}
      {...model.glDaily} incomplete={false} signTone provisional={model.glProvisional} />);
    const monthly = renderToStaticMarkup(<MonthlyMatrix title="Synthetic MTD" hint="L" units={model.units}
      {...model.glMonthly} divisor={1} incomplete={false} signTone provisional={model.glMonthlyProvisional} />);
    expect(daily).toContain(GL_DAILY_PROVISIONAL_WARNING);
    expect(monthly).toContain(GL_MONTHLY_PROVISIONAL_WARNING);
    const doc = buildHarianDocDefinition({ model, meta: {
      ptLabel: "SYNTHETIC TEST DATA", dateLong: model.date, unitsCount: 1, divisor: 1,
      generatedLabel: "synthetic fixture", freshnessLabel: "synthetic fixture",
    } });
    const text = pdfTextNodes(doc.content).join(" ");
    expect(text.match(/gain · SEMENTARA/g)).toHaveLength(2);
    expect(text).toContain(GL_DAILY_PROVISIONAL_WARNING);
    expect(text).toContain(GL_MONTHLY_PROVISIONAL_WARNING);
    expect(text).toContain("penutup opname bernilai 0");
  });

  it("discards earlier context events whose following day is outside MTD", async () => {
    mocks.zeros.mockResolvedValue([{ ...event, d: "2026-09-29" }]);
    const model = await pageModel("2026-10-01");
    expect(model).toMatchObject({ glProvisional: false, glMonthlyProvisional: false, glSuspectUnits: [] });
    expect(model.glDaily.grandTotal).toBe(10_000);
    expect(model.glMonthly.grand.kum).toBe(10_000);
    expect(model.notes.join(" ")).not.toContain("penutup opname bernilai 0");
  });
});
