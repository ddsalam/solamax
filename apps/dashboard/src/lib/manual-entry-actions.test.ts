import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Negative-access tulis manual_entry (penegasan A, jalur server action). Gerbang:
 * `unit_id` SELALU dari `scope.requireUnit(code)` (notFound utk kode di luar scope)
 * → tak pernah dari input mentah. Bila gerbang dilepas (pakai input mentah / skip
 * requireUnit), test "out-of-scope" jadi MERAH.
 */
const { q } = vi.hoisted(() => ({
  q: vi.fn((_t: string, _p?: unknown[]) => Promise.resolve([] as unknown[])),
}));
vi.mock("./db", () => ({ q, pool: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Fake scope: requireUnit MENIRU gerbang asli (notFound throw utk kode di luar scope).
const SCOPED = [{ unit_id: 6478, code: "6478111", name: "IB" }];
vi.mock("./scope", () => ({
  getDataScope: vi.fn(async () => ({
    userId: 7,
    requireUnit(code: string) {
      const u = SCOPED.find((x) => x.code === code);
      if (!u) throw new Error("NEXT_NOT_FOUND"); // = notFound()
      return u;
    },
  })),
}));

const { addManualEntry, voidManualEntry } = await import("./manual-entry-actions");

describe("manual_entry server action — tulis ter-scope", () => {
  beforeEach(() => q.mockClear());

  it("in-scope: INSERT unit_id = scoped (bukan input), created_by = user sesi", async () => {
    const res = await addManualEntry({
      code: "6478111", date: "2026-06-14", section: "pengeluaran",
      keterangan: "BELI LAKBAN", amount: 15000,
    });
    expect(res).toEqual({ ok: true });
    const [sql, params] = q.mock.calls[0]!;
    expect(sql).toContain("INSERT INTO app.manual_entry");
    expect(params![0]).toBe(6478); // unit_id TER-SCOPE
    expect(params![5]).toBe(7); // created_by_user_id = userId sesi
  });

  it("out-of-scope: requireUnit notFound → throw, TAK ADA tulis", async () => {
    await expect(
      addManualEntry({
        code: "9999999", date: "2026-06-14", section: "pengeluaran",
        keterangan: "x", amount: 1,
      }),
    ).rejects.toThrow(/NEXT_NOT_FOUND/);
    expect(q).not.toHaveBeenCalled();
  });

  it("void: UPDATE ter-scope (unit_id=$3) + voided_by/voided_at", async () => {
    const res = await voidManualEntry({ code: "6478111", date: "2026-06-14", id: "uuid-1" });
    expect(res).toEqual({ ok: true });
    const [sql, params] = q.mock.calls[0]!;
    expect(sql).toMatch(/UPDATE app\.manual_entry/);
    expect(sql).toContain("void=true");
    expect(sql).toMatch(/voided_by_user_id=\$1/);
    expect(sql).toMatch(/unit_id=\$3/);
    expect(params![2]).toBe(6478); // ter-scope
  });

  it("setoran_tunai: seksi diterima, INSERT unit_id ter-scope", async () => {
    const res = await addManualEntry({
      code: "6478111", date: "2026-06-14", section: "setoran_tunai",
      keterangan: "Setoran BCA 14:00", amount: 5_000_000,
    });
    expect(res).toEqual({ ok: true });
    const [sql, params] = q.mock.calls[0]!;
    expect(sql).toContain("INSERT INTO app.manual_entry");
    expect(params![0]).toBe(6478); // unit_id TER-SCOPE (bukan input mentah)
    expect(params![2]).toBe("setoran_tunai");
  });

  it("setoran_tunai: out-of-scope tetap ditolak (requireUnit notFound), TAK ADA tulis", async () => {
    await expect(
      addManualEntry({
        code: "9999999", date: "2026-06-14", section: "setoran_tunai",
        keterangan: "x", amount: 1,
      }),
    ).rejects.toThrow(/NEXT_NOT_FOUND/);
    expect(q).not.toHaveBeenCalled();
  });

  it("validasi: amount ≤ 0 ditolak tanpa tulis", async () => {
    const res = await addManualEntry({
      code: "6478111", date: "2026-06-14", section: "pengeluaran",
      keterangan: "x", amount: 0,
    });
    expect(res.ok).toBe(false);
    expect(q).not.toHaveBeenCalled();
  });
});
