import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(process.cwd(), "src");
const files = [
  "app/(app)/keuangan/unit/[code]/piutang/[date]/page.tsx",
  "app/(app)/keuangan/unit/[code]/piutang/[date]/pelanggan/[...customerCode]/page.tsx",
  "app/api/keuangan/unit/[code]/piutang/[date]/csv/route.ts",
  "app/api/keuangan/unit/[code]/piutang/[date]/pdf/route.ts",
].map((path) => readFileSync(resolve(root, path), "utf8"));

describe("B6 route guards", () => {
  it.each(files)("resolves scope, unit, role, then reads the strict snapshot", (source) => {
    expect(source).toMatch(/getDataScope\(\)/);
    expect(source).toMatch(/scope\.requireUnit\(code\)/);
    expect(source).toMatch(/if \(!canViewLaporanKeuangan\([^)]*\)\) notFound\(\)/);
    expect(source).toMatch(/getSaldoSnapshot\(unit\.unit_id, date\)/);
    expect(source).not.toMatch(/readSaldoPelangganLegacy|public\.(bppiut|bphut)/);
    expect(source.indexOf("scope.requireUnit(code)")).toBeLessThan(source.indexOf("getSaldoSnapshot(unit.unit_id, date)"));
  });

  it("keeps the customer detail on the already-loaded immutable rowset", () => {
    expect(files[1]).toMatch(/snapshot\.rows\.find/);
    expect(files[1]).not.toMatch(/getSaldoSnapshotRow|getCustomerSaldo/);
  });

  it.each(files.slice(2))("validates export enums independently", (source) => {
    expect(source).toMatch(/validPiutangExportInput/);
    expect(source).toMatch(/status: "belum siap"/);
    expect(source).toMatch(/"Cache-Control": "private, no-store"/);
  });
});
