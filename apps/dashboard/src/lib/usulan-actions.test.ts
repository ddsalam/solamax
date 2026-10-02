import { beforeEach, describe, expect, it, vi } from "vitest";
import { DO_PRODUCTS } from "./config";
import { saveUsulanSo, type UsulanInputRow } from "./usulan-actions";
import { getUsulanSo, type UsulanSoRow } from "./queries";
import type { ScopedUnitId } from "./scope";

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  query: vi.fn(),
  qScoped: vi.fn(),
  release: vi.fn(),
  getDataScope: vi.fn(),
  requireUnit: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("./db", () => ({ pool: { connect: mocks.connect }, qScoped: mocks.qScoped }));
vi.mock("./scope", () => ({ getDataScope: mocks.getDataScope }));
vi.mock("./derive", () => ({ GARBAGE_SELISIH_L: 50000, GARBAGE_STOCK_L: 100000 }));
vi.mock("./saldo-snapshot", () => ({ getSaldoSnapshot: vi.fn(), saldoFromSnapshotTotals: vi.fn() }));

const UNIT = { unit_id: 7, code: "6478111" };
const USER_ID = 23;
const DATE = "2026-10-02";
const FIELDS = ["penerimaanHari", "permintaanBesok", "usulanPenebusan"] as const;
const row = (overrides: Partial<UsulanInputRow> = {}): UsulanInputRow => ({
  productKey: DO_PRODUCTS[0]!.key,
  penerimaanHari: null,
  permintaanBesok: null,
  usulanPenebusan: null,
  ...overrides,
});
const save = (rows: UsulanInputRow[]) => saveUsulanSo({
  code: UNIT.code, date: DATE, status: "draft", rows,
});
const inserts = () => mocks.query.mock.calls.filter(([sql]) => /INSERT INTO app\.usulan_so/.test(sql));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.query.mockResolvedValue({ rows: [] });
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
  mocks.requireUnit.mockReturnValue(UNIT);
  mocks.getDataScope.mockResolvedValue({ userId: USER_ID, requireUnit: mocks.requireUnit });
});

describe("saveUsulanSo · batas driver pg, null berbeda dari nol", () => {
  it("meneruskan tiga kolom kosong sebagai SQL null dalam transaksi ter-scope + audit", async () => {
    expect(await save([row()])).toEqual({ ok: true });
    expect(mocks.requireUnit).toHaveBeenCalledWith(UNIT.code);
    expect(mocks.query.mock.calls.map(([sql]) => sql.trim().split(/\s+/).slice(0, 2).join(" ")))
      .toEqual(["BEGIN", "SELECT set_config('app.unit_ids',", "UPDATE app.usulan_so", "INSERT INTO", "COMMIT"]);
    expect(mocks.query).toHaveBeenNthCalledWith(2,
      "SELECT set_config('app.unit_ids', $1, true)", [String(UNIT.unit_id)]);
    expect(mocks.query).toHaveBeenNthCalledWith(3,
      expect.stringMatching(/SET void=true, voided_by_user_id=\$1/),
      [USER_ID, UNIT.unit_id, DATE]);
    expect(mocks.query.mock.calls[2]![0]).toMatch(/WHERE unit_id=\$2 AND business_date=\$3::date AND NOT void/);
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0]![1]).toEqual([
      UNIT.unit_id, DATE, DO_PRODUCTS[0]!.key, null, null, null, "draft", USER_ID,
    ]);
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath.mock.calls).toEqual([
      [`/unit/${UNIT.code}/usulan/${DATE}`],
      [`/unit/${UNIT.code}/usulan/${DATE}/edit`],
    ]);
  });

  it("nol eksplisit tetap 0; kuantitas liter pecahan tidak diskalakan ke KL atau dibulatkan oleh action", async () => {
    expect(await save([row({ penerimaanHari: 0, permintaanBesok: 12345.67, usulanPenebusan: 0.25 })]))
      .toEqual({ ok: true });
    expect(inserts()[0]![1].slice(3, 6)).toEqual([0, 12345.67, 0.25]);
  });

  it("edit yang mengosongkan angka mempertahankan nol lain dan mem-void generasi lama", async () => {
    expect(await save([row({ penerimaanHari: 6000, permintaanBesok: 0 })])).toEqual({ ok: true });
    expect(await save([row({ penerimaanHari: null, permintaanBesok: 0 })])).toEqual({ ok: true });
    expect(inserts().map(([, params]) => params.slice(3, 6))).toEqual([
      [6000, 0, null], [null, 0, null],
    ]);
    expect(mocks.query.mock.calls.filter(([sql]) => /UPDATE app\.usulan_so/.test(sql))).toHaveLength(2);
  });

  it("save → read pada batas pg mempertahankan blank/nol/liter yang sama", async () => {
    // Driver stub: hasil baca dibentuk dari parameter INSERT yang benar-benar
    // dikirim action, bukan fixture terpisah yang bisa menyembunyikan koersi.
    // Ini uji kontrak action/query, bukan klaim integrasi Postgres hidup.
    let stored: UsulanSoRow[] = [];
    mocks.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (/UPDATE app\.usulan_so/.test(sql)) stored = [];
      if (/INSERT INTO app\.usulan_so/.test(sql)) {
        stored.push({
          productKey: params![2] as string,
          penerimaanHari: params![3] as number | null,
          permintaanBesok: params![4] as number | null,
          usulanPenebusan: params![5] as number | null,
          status: params![6] as "draft",
        });
      }
      return { rows: [] };
    });
    mocks.qScoped.mockImplementation(async () => stored);
    const entered = [row({ penerimaanHari: null, permintaanBesok: 0, usulanPenebusan: 12000.25 })];
    expect(await save(entered)).toEqual({ ok: true });
    expect(await getUsulanSo(UNIT.unit_id as ScopedUnitId, DATE))
      .toEqual(entered.map((r) => ({ ...r, status: "draft" })));

    // Clear the prior amount and deliberately fill the prior blank with zero.
    const edited = [row({ penerimaanHari: 0, permintaanBesok: 0, usulanPenebusan: null })];
    expect(await save(edited)).toEqual({ ok: true });
    expect(await getUsulanSo(UNIT.unit_id as ScopedUnitId, DATE))
      .toEqual(edited.map((r) => ({ ...r, status: "draft" })));
  });

  for (const field of FIELDS) {
    for (const invalid of [undefined, "", "0", "12.5", NaN, Infinity, -Infinity, -0.01, false, {}]) {
      it(`${field}: menolak ${String(invalid)} sebelum koneksi DB, tidak mengubahnya jadi null`, async () => {
        // Model pemanggil tak tepercaya: payload action tidak dijamin mengikuti TS.
        const invalidRow = { ...row(), [field]: invalid } as UsulanInputRow;
        expect(await save([row(), invalidRow])).toEqual({ ok: false, error: "Angka harus ≥ 0." });
        expect(mocks.connect).not.toHaveBeenCalled();
        expect(mocks.revalidatePath).not.toHaveBeenCalled();
      });
    }
  }

  it("tetap menolak produk tak dikenal walaupun seluruh kuantitasnya null", async () => {
    expect(await save([row({ productKey: "produk-tak-dikenal" })]))
      .toEqual({ ok: false, error: "Produk tak dikenal: produk-tak-dikenal" });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("scope yang menolak unit tidak membuka koneksi atau menulis", async () => {
    mocks.requireUnit.mockImplementation(() => { throw new Error("NOT_FOUND"); });
    await expect(save([row()])).rejects.toThrow("NOT_FOUND");
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("kegagalan INSERT membatalkan void generasi lama, melepas koneksi, tanpa revalidasi", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (/INSERT INTO app\.usulan_so/.test(sql)) throw new Error("insert failed");
      return { rows: [] };
    });
    expect(await save([row()])).toEqual({ ok: false, error: "insert failed" });
    expect(mocks.query).toHaveBeenLastCalledWith("ROLLBACK");
    expect(mocks.query).not.toHaveBeenCalledWith("COMMIT");
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
