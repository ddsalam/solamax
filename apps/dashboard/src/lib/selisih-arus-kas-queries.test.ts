import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PETA_KATEGORI_ARUS_KAS } from "./keuangan-sisi-kas";
import { READ_SALDO_PELANGGAN_LEGACY_SQL } from "./queries";

vi.mock("./db", () => ({ qScoped: vi.fn(async () => []), q: vi.fn(async () => []) }));

const { SQL_PEMBAYARAN_PIUTANG_SEKITAR, namaAkunSamar } = await import("./selisih-arus-kas-queries");
const { KATEGORI_PIUTANG_PELANGGAN } = await import("./selisih-arus-kas-model");

/**
 * Bentuk SQL penjelasan selisih (U2; R2, R7). ⚠️ Batas: SQL tidak dijalankan
 * di sini — perilakunya di Postgres dibuktikan `selisih-arus-kas.integration.test.ts`
 * (gated, Postgres lokal sekali pakai).
 */
describe("SQL_PEMBAYARAN_PIUTANG_SEKITAR", () => {
  const s = SQL_PEMBAYARAN_PIUTANG_SEKITAR.replace(/\s+/g, " ");
  const [easymax, bank] = s.split("UNION ALL");

  it("kedua sisi di-scope unit_id = $1", () => {
    expect(easymax).toMatch(/b\.unit_id = \$1/);
    expect(bank).toMatch(/l\.unit_id = \$1/);
  });

  it("EasyMax: pembayaran (sjnsbp=2), non-batal, bucket Lokal/Online SAMA dengan saldo pelanggan", () => {
    expect(easymax).toContain("b.sjnsbp = 2");
    expect(easymax).toContain("COALESCE(b.sbatal,0) = 0");
    const legacy = READ_SALDO_PELANGGAN_LEGACY_SQL.replace(/\s+/g, " ");
    for (const potong of [
      "WHERE unit_id = $1 AND sjenis IN (1,5)) m",
      "ON m.unit_id = b.unit_id AND trim(m.ckdplg) = trim(b.ckdplg)",
      "COALESCE(position('.' in trim(b.ckdplg)) > 0, false)",
    ]) {
      expect(legacy).toContain(potong);
      expect(easymax).toContain(potong);
    }
    expect(easymax).toContain("m.ckdplg IS NOT NULL OR");
  });

  it("bank: non-void, bukan saldo awal, menurut business_date (bukan tanggal_asal), kategori = $3", () => {
    expect(bank).toContain("NOT l.void AND NOT l.saldo_awal");
    expect(bank).toContain("l.category_label = $3");
    expect(bank).toMatch(/l\.business_date BETWEEN \$2::date - 7 AND \$2::date \+ 7/);
    expect(bank).not.toMatch(/WHERE[^]*tanggal_asal/);
  });

  it("kategori = kunci PETA_KATEGORI_ARUS_KAS yang barisnya 'Transaksi piutang pelanggan EasyMax' & dariBukuKas false", () => {
    expect(PETA_KATEGORI_ARUS_KAS[KATEGORI_PIUTANG_PELANGGAN]).toEqual({
      baris: "Transaksi piutang pelanggan EasyMax",
      dariBukuKas: false,
    });
  });

  it("modul memakai qScoped, tidak pernah pool", () => {
    const src = readFileSync(new URL("./selisih-arus-kas-queries.ts", import.meta.url), "utf8");
    expect(src).toContain("qScoped<Baris>(unit,");
    expect(src).not.toMatch(/\bpool\b/);
  });
});

describe("namaAkunSamar — nomor rekening tak pernah penuh", () => {
  it("deret digit di nama → …4 digit terakhir", () => {
    expect(namaAkunSamar("Bank Contoh - 1234500000", null)).toBe("Bank Contoh …0000");
  });
  it("nama tanpa nomor + nomor_rekening → ditambah …4 digit terakhir", () => {
    expect(namaAkunSamar("Bank Contoh", "99-1234-0000")).toBe("Bank Contoh …0000");
  });
  it("tanpa nomor sama sekali → nama apa adanya", () => {
    expect(namaAkunSamar("Kas Besar", null)).toBe("Kas Besar");
  });
});
