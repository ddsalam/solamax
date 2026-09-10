import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "./scope-rule";
import type { SaldoSnapshot } from "./saldo-snapshot";

const mocks = vi.hoisted(() => ({
  getDataScope: vi.fn(),
  getSaldoSnapshot: vi.fn(),
  canView: vi.fn(),
  renderPdfBuffer: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/scope", () => ({ getDataScope: mocks.getDataScope }));
vi.mock("@/lib/saldo-snapshot", () => ({ getSaldoSnapshot: mocks.getSaldoSnapshot }));
vi.mock("@/lib/keuangan-wewenang", () => ({ canViewLaporanKeuangan: mocks.canView }));
vi.mock("@/lib/export/server-pdf", () => ({ renderPdfBuffer: mocks.renderPdfBuffer }));
vi.mock("@/lib/config", () => ({ ptLabelForUnits: () => "PT Sola Petra Abadi" }));

const { GET: getCsv } = await import(
  "../app/api/keuangan/unit/[code]/piutang/[date]/csv/route"
);
const { GET: getPdf } = await import(
  "../app/api/keuangan/unit/[code]/piutang/[date]/pdf/route"
);

const unit = { unit_id: 7 as ScopedUnitId, code: "6478111", name: "Imam Bonjol" };
const ready: SaldoSnapshot = {
  status: "ready",
  asOfDate: "2026-09-09",
  metadata: {
    generationId: "generation-1",
    rowCount: 1,
    formulaVersion: "saldo-pelanggan-v1",
    computedAt: "2026-09-09T03:01:00Z",
    sourceCycleId: "cycle-1",
    sourceCompletedAt: "2026-09-09T03:00:00Z",
    pendingReplacement: false,
    staleInvalidFrom: null,
    totals: {
      awal: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 },
      akhir: { piutangLokal: 10, piutangOnline: 0, hutangLokal: 0 },
    },
  },
  rows: [{
    customerCode: "P-1",
    customerName: "Pelanggan",
    awalPiutangLokal: 0,
    akhirPiutangLokal: 10,
    awalPiutangOnline: 0,
    akhirPiutangOnline: 0,
    awalHutangLokal: 0,
    akhirHutangLokal: 0,
  }],
  hasOnlineCustomer: false,
};

const endpoints = [
  { name: "CSV", get: getCsv, expectedType: "text/csv; charset=utf-8" },
  { name: "PDF", get: getPdf, expectedType: "application/pdf" },
] as const;

function context(date = "2026-09-09") {
  return { params: Promise.resolve({ code: unit.code, date }) };
}

describe("piutang export route behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canView.mockReturnValue(true);
    mocks.renderPdfBuffer.mockResolvedValue(Buffer.from("%PDF-test"));
    mocks.getDataScope.mockResolvedValue({
      role: "admin",
      email: "dion@example.com",
      requireUnit: vi.fn(() => unit),
    });
    mocks.getSaldoSnapshot.mockResolvedValue(ready);
  });

  it.each(endpoints)("$name rejects invalid date and filter before data access", async ({ get }) => {
    const badDate = await get(new Request("http://test/export?filter=semua"), context("09-09-2026"));
    expect(badDate.status).toBe(400);
    const badFilter = await get(new Request("http://test/export?filter=rahasia"), context());
    expect(badFilter.status).toBe(400);
    expect(mocks.getDataScope).not.toHaveBeenCalled();
    expect(mocks.getSaldoSnapshot).not.toHaveBeenCalled();
  });

  it.each(endpoints)("$name returns a numeric-free 409 when the strict snapshot is not ready", async ({ get }) => {
    mocks.getSaldoSnapshot.mockResolvedValue({
      status: "not_ready",
      asOfDate: "2026-09-09",
      reason: "no_published_snapshot",
    } satisfies SaldoSnapshot);
    const response = await get(new Request("http://test/export?filter=semua"), context());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      status: "belum siap",
      reason: "no_published_snapshot",
    });
  });

  it.each(endpoints)("$name returns a no-store attachment for a ready snapshot", async ({ get, expectedType }) => {
    const response = await get(new Request("http://test/export?q=P&filter=semua&sort=kode"), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(expectedType);
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename=".+"$/);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each(endpoints)("$name denies a role without financial-report authority before snapshot access", async ({ get }) => {
    mocks.canView.mockReturnValue(false);
    await expect(get(new Request("http://test/export"), context())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.getSaldoSnapshot).not.toHaveBeenCalled();
  });

  it.each(endpoints)("$name denies an out-of-scope unit before snapshot access", async ({ get }) => {
    mocks.getDataScope.mockResolvedValue({
      role: "admin",
      email: "dion@example.com",
      requireUnit: () => {
        throw new Error("NEXT_NOT_FOUND");
      },
    });
    await expect(get(new Request("http://test/export"), context())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.canView).not.toHaveBeenCalled();
    expect(mocks.getSaldoSnapshot).not.toHaveBeenCalled();
  });
});
