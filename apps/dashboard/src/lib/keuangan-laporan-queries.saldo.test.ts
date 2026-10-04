import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "./scope-rule";
import type { DailyGlRow } from "./queries";

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
  getSalesByProduct: vi.fn(async () => []),
  getAkunKas: vi.fn(async () => []),
  getHargaBeliRows: vi.fn(async () => []),
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
});
