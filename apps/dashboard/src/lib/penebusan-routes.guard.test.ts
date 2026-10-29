import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga GERBANG rute penebusan (rencana 2026-10-29 U7) — pola
 * `piutang-routes.guard.test.ts`. Halaman ikut dijaga `gerbang-rute-keuangan
 * .guard.test.ts` (penemuan otomatis); ekspor CSV di `app/api/**` TIDAK, jadi
 * dijaga di sini.
 */
const root = resolve(__dirname, "..");
const HALAMAN = readFileSync(resolve(root, "app/(app)/keuangan/unit/[code]/penebusan/page.tsx"), "utf8");
const EKSPOR = readFileSync(resolve(root, "app/api/keuangan/unit/[code]/penebusan/[bulan]/csv/route.ts"), "utf8");

describe("rute penebusan — scope, unit, peran, LALU baca", () => {
  it.each([
    ["halaman", HALAMAN, "getPenebusanBulan("],
    ["ekspor CSV", EKSPOR, "getPenebusanBulan("],
  ])("%s: getDataScope → requireUnit(code) → canViewLaporanKeuangan menolak → kueri", (_n, src, baca) => {
    expect(src).toMatch(/getDataScope\(\)/);
    expect(src).toMatch(/if \(!canViewLaporanKeuangan\([^)]*\)\) notFound\(\)/);
    expect(urutan(src, "scope.requireUnit(code)", "canViewLaporanKeuangan(")).toBe("ok");
    expect(urutan(src, "canViewLaporanKeuangan(", baca)).toBe("ok");
  });

  it("ekspor: bulan & cakupan divalidasi; rekap PT hanya bila SEMUA unit tenant dipegang", () => {
    expect(EKSPOR).toMatch(/if \(!bulanSah\(bulan\)\) return new Response\([^)]*\{ status: 400 \}\)/);
    expect(EKSPOR).toMatch(/unitSatuPt\(unit\.code, scope\.tenantPerUnit, scope\.units\)/);
    expect(EKSPOR).toMatch(/if \(units === null\) notFound\(\)/);
    expect(EKSPOR).toMatch(/"Cache-Control": "private, no-store"/);
  });

  it("halaman: rekap PT memakai aturan yang sama", () => {
    expect(HALAMAN).toMatch(/unitSatuPt\(unit\.code, scope\.tenantPerUnit, scope\.units\)/);
  });
});
