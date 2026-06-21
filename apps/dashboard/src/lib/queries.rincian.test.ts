import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "./scope-rule";

// Mock db.q (hindari makePool() yang butuh DATABASE_URL). Verifikasi konstruksi
// SQL + scoping tanpa DB nyata.
const { q } = vi.hoisted(() => ({
  q: vi.fn((_text: string, _params?: unknown[]) => Promise.resolve([] as unknown[])),
}));
vi.mock("./db", () => ({ q, pool: {} }));

const {
  getPelangganForDate,
  getEdcForDate,
  getEdcBlankCard,
  getDepositForDate,
  getManualEntries,
} = await import("./queries");

const U = 6478 as unknown as ScopedUnitId;

describe("F1c queries: scoped ($1=unit) + schema-qualified", () => {
  beforeEach(() => q.mockClear());

  it("getPelangganForDate: UNION sale∪voucher, non-batal, scoped", async () => {
    await getPelangganForDate(U, "2026-06-14");
    const [sql, params] = q.mock.calls[0]!;
    expect(sql).toContain("public.pelanggan_sale");
    expect(sql).toContain("public.voucher_sale");
    expect(sql).toContain("UNION ALL");
    expect(sql).toMatch(/COALESCE\(ps\.sbatal,0\) = 0/);
    expect(sql).toMatch(/COALESCE\(vs\.sbatal,0\) = 0/);
    expect(sql).toContain("unit_id = $1");
    expect(params).toEqual([U, "2026-06-14"]);
  });

  it("getEdcForDate: public.edc, blank-card DIKECUALIKAN, join master card", async () => {
    await getEdcForDate(U, "2026-06-14");
    const [sql, params] = q.mock.calls[0]!;
    expect(sql).toContain("public.edc");
    expect(sql).toContain("public.card");
    expect(sql).toMatch(/e\.ckdkartu IS NOT NULL/);
    expect(sql).toMatch(/trim\(e\.ckdkartu\) <> ''/);
    expect(sql).toContain("e.unit_id = $1");
    expect(params).toEqual([U, "2026-06-14"]);
  });

  it("getEdcBlankCard: HANYA blank-card (ckdkartu null/''), scoped", async () => {
    await getEdcBlankCard(U, "2026-06-14");
    const [sql, params] = q.mock.calls[0]!;
    expect(sql).toContain("public.edc");
    expect(sql).toMatch(/e\.ckdkartu IS NULL OR trim\(e\.ckdkartu\) = ''/);
    expect(sql).toContain("e.unit_id = $1");
    expect(params).toEqual([U, "2026-06-14"]);
  });

  it("getDepositForDate: public.deposit by dtgl, non-batal, scoped", async () => {
    await getDepositForDate(U, "2026-06-17");
    const [sql, params] = q.mock.calls[0]!;
    expect(sql).toContain("public.deposit");
    expect(sql).toMatch(/d\.dtgl = \$2::date/);
    expect(sql).toMatch(/COALESCE\(d\.sbatal,0\) = 0/);
    expect(sql).toContain("d.unit_id = $1");
    expect(params).toEqual([U, "2026-06-17"]);
  });

  it("getManualEntries: app.manual_entry, NOT void, section param, scoped", async () => {
    await getManualEntries(U, "2026-06-14", "pengeluaran");
    const [sql, params] = q.mock.calls[0]!;
    expect(sql).toContain("app.manual_entry");
    expect(sql).toContain("NOT void");
    expect(sql).toContain("unit_id = $1");
    expect(sql).toMatch(/section = \$3::app\.manual_entry_section/);
    expect(params).toEqual([U, "2026-06-14", "pengeluaran"]);
  });
});
