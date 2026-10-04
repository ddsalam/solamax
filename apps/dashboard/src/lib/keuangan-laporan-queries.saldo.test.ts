import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "./scope-rule";
import type { DailyGlRow, ProductAgg } from "./queries";
import type { PurchasePriceRow } from "./harga-beli";

const {
  qScoped,
  getDailyGlByProduct,
  getDoHarian,
  getSalesByProduct,
  getAkunKas,
  getHargaBeliRows,
  getMutasiKas,
} = vi.hoisted(() => ({
  qScoped: vi.fn(),
  getDailyGlByProduct: vi.fn(async (): Promise<DailyGlRow[]> => []),
  getDoHarian: vi.fn(async () => []),
  getSalesByProduct: vi.fn(async (): Promise<ProductAgg[]> => []),
  getAkunKas: vi.fn(async (): Promise<Array<{ id: string; nama: string }>> => []),
  getHargaBeliRows: vi.fn(async (): Promise<PurchasePriceRow[]> => []),
  getMutasiKas: vi.fn(async () => []),
}));

vi.mock("./db", () => ({ qScoped }));
vi.mock("./ukur-kueri", () => ({
  ukur: (_name: string, read: () => Promise<unknown>) => read(),
}));
vi.mock("./queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./queries")>()),
  getDailyGlByProduct,
  getDoHarian,
  getSalesByProduct,
}));
vi.mock("./keuangan-input-queries", () => ({
  getAkunKas,
  getHargaBeliRows,
  getMutasiKas,
}));

const { getBahanLaporan } = await import("./keuangan-laporan-queries");
const U = 7 as unknown as ScopedUnitId;

describe("saldo EasyMax pada laporan Keuangan selama transisi snapshot", () => {
  beforeEach(() => {
    getDailyGlByProduct.mockReset().mockResolvedValue([]);
    getSalesByProduct.mockReset().mockResolvedValue([]);
    getAkunKas.mockReset().mockResolvedValue([]);
    getHargaBeliRows.mockReset().mockResolvedValue([]);
    qScoped.mockReset().mockImplementation(
      (_unit: ScopedUnitId, sql: string) => Promise.resolve(
        sql.includes("FROM app.saldo_pelanggan_snapshot_pointer")
          ? []
          : sql.includes("WITH piut AS")
            ? [{
                awalPiutangLokal: 10,
                akhirPiutangLokal: 20,
                awalPiutangOnline: 3,
                akhirPiutangOnline: 4,
                awalHutangLokal: -2,
                akhirHutangLokal: -5,
              }]
            : [],
      ),
    );
  });

  it("baris RESUME yang ditolak mempertahankan status tak terhitung dalam bahan keuangan", async () => {
    getDailyGlByProduct.mockResolvedValue([{
      d: "2026-08-04", ckdbbm: "P", nama: "P", fisik: null, fisik_prev: 10_000,
      pen_do: 0, sales_gross: 1_000, tera: 0, gl: null, excluded_tanks: 1, provisional: true,
    }]);
    const bahan = await getBahanLaporan(U, "2026-08-04", "2026-08-03");
    expect(bahan.totals.inventoryValue).toBeNull();
    expect(bahan.totals.lossesGainValue).toBeNull();
    expect(bahan.incomplete).toContain("P");
  });

  it("tetap menghasilkan angka piutang dari agregat ledger ketika snapshot belum ada", async () => {
    const bahan = await getBahanLaporan(U, "2026-08-04", "2026-08-03");

    expect(bahan.piutangEasymax).toBe(24);
    expect(bahan.deltaPiutangEasymax).toBe(-11);
    expect(qScoped.mock.calls.filter(([, sql]) => String(sql).includes("WITH piut AS"))).toHaveLength(2);
  });

  it.each([null, "", "   "])("unidentified product %s cannot create final financial zero or match a price", async (ckdbbm) => {
    getDailyGlByProduct.mockResolvedValue([{
      d: "2026-08-04", ckdbbm, nama: null, fisik: 1_000, fisik_prev: 1_100,
      pen_do: 0, sales_gross: 100, tera: 0, gl: 0, excluded_tanks: 0, provisional: false,
    }]);
    getHargaBeliRows.mockResolvedValue([{ productKey: "", effectiveFrom: "2026-01-01", price: 9_000, void: false }]);
    getAkunKas.mockResolvedValue([{ id: "synthetic-account", nama: "Synthetic" }]);
    const bahan = await getBahanLaporan(U, "2026-08-04", "2026-08-03");
    expect(bahan.totals.inventoryValue).toBeNull();
    expect(bahan.totals.lossesGainValue).toBeNull();
    expect(bahan.totalAssetKemarin).toBeNull();
    expect(bahan.incomplete).toContain("Produk tidak diketahui");
    expect(bahan.incomplete.every(name => typeof name === "string" && name.length > 0)).toBe(true);
  });

  it("normalizes valid padded identities without rejecting an unmapped product", async () => {
    getDailyGlByProduct.mockResolvedValue([{
      d: "2026-08-04", ckdbbm: " P ", nama: null, fisik: 1_000, fisik_prev: 1_100,
      pen_do: 0, sales_gross: 100, tera: 0, gl: 0, excluded_tanks: 0, provisional: false,
    }]);
    getSalesByProduct.mockResolvedValue([{ ckdbbm: "P", nama: "Synthetic P", vol: 100, omzet: 1_000_000, harga: 10_000 }]);
    getHargaBeliRows.mockResolvedValue([{ productKey: "P", effectiveFrom: "2026-01-01", price: 9_000, void: false }]);
    const bahan = await getBahanLaporan(U, "2026-08-04", "2026-08-03");
    expect(bahan.totals.inventoryValue).toBe(9_000_000);
    expect(bahan.totals.lossesGainValue).toBe(0);
    expect(bahan.totals.revenue).toBe(1_000_000);
  });
});
