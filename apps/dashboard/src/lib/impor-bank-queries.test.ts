import { describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({ qScoped: vi.fn(async () => []), q: vi.fn(async () => []) }));

const { keSaldoBukuAwal, POLA_NAMA_BCA, PREDIKAT_REKENING_BCA, SQL_CUT_OVER, SQL_SALDO_BUKU_AWAL } = await import("./impor-bank-queries");

/**
 * Bentuk SQL bersama impor (U9; R18, R22). ⚠️ Batas: SQL tidak dijalankan di
 * sini — yang dijaga adalah RUMUSNYA (tanggal asal, cut-over rekening ⇒ unit).
 */
describe("SQL_SALDO_BUKU_AWAL (R18) — menurut TANGGAL ASAL, dari saldo pembuka rekening", () => {
  it("🔴 baris dibukukan maju dihitung pada tanggal asalnya; batas [cut-over, hari pertama periode)", () => {
    const s = SQL_SALDO_BUKU_AWAL.replace(/\s+/g, " ");
    expect(s).toMatch(/COALESCE\(l\.tanggal_asal, l\.business_date\) >= sa\.business_date/);
    expect(s).toMatch(/COALESCE\(l\.tanggal_asal, l\.business_date\) < \$3::date/);
    expect(s).toMatch(/NOT l\.void AND NOT l\.saldo_awal/);
    expect(s).toMatch(/account_id = \$2::uuid AND saldo_awal AND NOT void/);
  });

  it("baris → sen bulat; tanpa baris ⇒ null (rekening tanpa saldo pembuka)", () => {
    expect(keSaldoBukuAwal({ cutOver: "2026-10-01", saldo: "-1234.56", sementara: true })).toEqual({
      cutOver: "2026-10-01",
      saldoSen: -123_456,
      sementara: true,
    });
    expect(keSaldoBukuAwal(undefined)).toBeNull();
  });
});

describe("cut-over & rekening BCA", () => {
  it("cut-over: rekening dulu, unit sebagai cadangan — sumber sama dengan hariBukuTerkunci", () => {
    const s = SQL_CUT_OVER.replace(/\s+/g, " ");
    expect(s).toMatch(/FILTER \(WHERE account_id = \$2::uuid\)/);
    expect(s).toMatch(/WHERE unit_id = \$1 AND saldo_awal AND NOT void/);
  });

  it("rekening BCA: bank aktif bernomor dengan nama 'Bank BCA - …' — BRI/Mandiri tidak (Scope Boundaries)", () => {
    expect(PREDIKAT_REKENING_BCA).toContain("kind = 'bank' AND active AND nomor_rekening IS NOT NULL");
    const re = new RegExp(POLA_NAMA_BCA.replace("\\M", "\\b"), "i");
    expect(re.test("Bank BCA - 5125036811")).toBe(true);
    expect(re.test("Bank BRI - 9")).toBe(false);
    expect(re.test("Bank BCAX - 1")).toBe(false);
  });
});
