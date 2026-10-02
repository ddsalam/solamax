import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "./scope";
import { getUsulanSo, getUsulanSoList, type UsulanSoRow, type UsulanSoListItem } from "./queries";

const mocks = vi.hoisted(() => ({ qScoped: vi.fn() }));
vi.mock("./db", () => ({ qScoped: mocks.qScoped }));
vi.mock("./derive", () => ({ GARBAGE_SELISIH_L: 50000, GARBAGE_STOCK_L: 100000 }));
vi.mock("./saldo-snapshot", () => ({ getSaldoSnapshot: vi.fn(), saldoFromSnapshotTotals: vi.fn() }));

const UNIT = 7 as ScopedUnitId;
beforeEach(() => vi.resetAllMocks());

describe("Usulan SO · kontrak baca pg (tanpa koersi null/nol)", () => {
  it("membaca null, nol historis, dan liter pecahan apa adanya dari pg", async () => {
    const stored: UsulanSoRow[] = [
      { productKey: "A", penerimaanHari: null, permintaanBesok: 0, usulanPenebusan: 12345.67, status: "draft" },
      { productKey: "B", penerimaanHari: 0, permintaanBesok: null, usulanPenebusan: null, status: "draft" },
    ];
    mocks.qScoped.mockResolvedValue(stored);
    expect(await getUsulanSo(UNIT, "2026-10-02")).toEqual(stored);
    expect(mocks.qScoped).toHaveBeenCalledWith(UNIT, expect.any(String), [UNIT, "2026-10-02"]);
    const sql = mocks.qScoped.mock.calls[0]![1];
    for (const [column, alias] of [
      ["penerimaan_hari", "penerimaanHari"],
      ["permintaan_besok", "permintaanBesok"],
      ["usulan_penebusan", "usulanPenebusan"],
    ]) {
      expect(sql).toContain(`${column}::float8 AS "${alias}"`);
    }
    expect(sql).toMatch(/WHERE unit_id = \$1 AND business_date = \$2::date AND NOT void/);
    expect(sql).not.toMatch(/coalesce|case\s+when/i);
  });

  it("daftar mempertahankan SUM nullable: semua null → null; nol yang diisi → 0", async () => {
    const rows: UsulanSoListItem[] = [
      { date: "2026-10-02", totalPenerimaan: null, totalPermintaan: null, totalUsulan: null, status: "draft", lastSavedAt: null },
      { date: "2026-10-01", totalPenerimaan: 0, totalPermintaan: 12500.25, totalUsulan: 0, status: "diajukan", lastSavedAt: null },
    ];
    mocks.qScoped.mockResolvedValue(rows);
    expect(await getUsulanSoList(UNIT, 12)).toEqual(rows);
    expect(mocks.qScoped).toHaveBeenCalledWith(UNIT, expect.any(String), [UNIT, 12]);
    const sql = mocks.qScoped.mock.calls[0]![1];
    expect(sql).toContain('sum(penerimaan_hari)::float8 AS "totalPenerimaan"');
    expect(sql).toContain('sum(permintaan_besok)::float8 AS "totalPermintaan"');
    expect(sql).toContain('sum(usulan_penebusan)::float8 AS "totalUsulan"');
    expect(sql).toMatch(/WHERE unit_id = \$1 AND NOT void/);
    expect(sql).toContain("GROUP BY business_date");
    expect(sql).not.toMatch(/coalesce|case\s+when/i);
  });
});

describe("0047 · migrasi aditif tanpa penafsiran ulang data historis", () => {
  const prisma = readFileSync(new URL("../../../backend/prisma/schema.prisma", import.meta.url), "utf8");
  const migration = readFileSync(new URL(
    "../../../backend/prisma/migrations/0047_usulan_so_nullable_quantities/migration.sql", import.meta.url,
  ), "utf8");
  const fields = [
    ["penerimaanHari", "penerimaan_hari"],
    ["permintaanBesok", "permintaan_besok"],
    ["usulanPenebusan", "usulan_penebusan"],
  ];

  it("tiga Decimal nullable tanpa default; presisi native DECIMAL(14,2) tetap", () => {
    const model = prisma.match(/model UsulanSo \{([\s\S]*?)\n\}/)?.[1];
    expect(model).toBeDefined();
    for (const [field, column] of fields) {
      const line = model!.split("\n").find((l) => l.trimStart().startsWith(`${field} `));
      expect(line).toBeDefined();
      expect(line).toMatch(new RegExp(`${field}\\s+Decimal\\?\\s+`));
      expect(line).toContain(`@map("${column}")`);
      expect(line).toContain("@db.Decimal(14, 2)");
      expect(line).not.toContain("@default");
    }
  });

  it("DDL hanya DROP NOT NULL/DEFAULT: tidak mengubah nol lama, unit, presisi, policy atau audit", () => {
    const sql = migration.replace(/--[^\n]*/g, "").replace(/\s+/g, " ").trim();
    const clauses = fields.flatMap(([, column]) => [
      `ALTER COLUMN "${column}" DROP NOT NULL`,
      `ALTER COLUMN "${column}" DROP DEFAULT`,
    ]);
    expect(sql).toBe(`ALTER TABLE "app"."usulan_so" ${clauses.join(", ")};`);
  });
});
