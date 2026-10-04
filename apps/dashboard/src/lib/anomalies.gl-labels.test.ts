import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DailyGlRow } from "./queries";
import type { ScopedUnit } from "./scope";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("./queries", () => ({
  getAdminDays: vi.fn(async () => []),
  getAvgDailySales: vi.fn(async () => []),
  getClosingOpname: vi.fn(async () => []),
  getCorrections: vi.fn(async () => 0),
  getDailyGlByProduct: vi.fn(async (): Promise<DailyGlRow[]> => []),
  getDeliveryShortfalls: vi.fn(async () => []),
  getHargaDeviasi: vi.fn(async () => []),
  getShiftInfo: vi.fn(async () => ({ shifts: 3, last_dtgljam: null })),
  getTankStocks: vi.fn(async () => []),
  getZeroClosingEvents: vi.fn(async () => []),
}));

import { buildAnomalies } from "./anomalies";
import { getDailyGlByProduct } from "./queries";

const units = [{ unit_id: 1, code: "6478111", name: "Synthetic unit" }] as ScopedUnit[];
const row = (gl: number | null, provisional = false): DailyGlRow => ({
  d: "2026-02-02", ckdbbm: "GQP01", nama: "PERTALITE",
  fisik_prev: 20000, pen_do: 0, sales_gross: 8200, tera: 0,
  fisik: gl === null ? null : 11800 + gl, gl, provisional,
  movement_invalid: false, excluded_tanks: 0,
});

describe("synthetic anomaly G/L sign labels", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    { gl: 4000, title: "G/L +4.000 L (48,78%)" },
    { gl: -4000, title: "G/L −4.000 L (48,78%)" },
  ])("preserves severity and signed $gl while using a neutral title", async ({ gl, title }) => {
    vi.mocked(getDailyGlByProduct).mockResolvedValue([row(gl)]);
    const items = await buildAnomalies(units);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title, tone: "danger", tier: "major", sev: 4000, dateIso: "2026-02-02" });
    expect(items[0]!.desc).toContain("di atas ambang 100 L / 0,5%");
  });

  it.each([row(4000, true), row(-4000, true), row(0), row(null, true)])(
    "preserves suppression for provisional, measured zero or unavailable G/L: %j", async (input) => {
      vi.mocked(getDailyGlByProduct).mockResolvedValue([input]);
      expect(await buildAnomalies(units)).toEqual([]);
    },
  );
});
