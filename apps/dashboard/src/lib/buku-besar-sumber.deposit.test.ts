import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "./scope-rule";
import type { SaldoPelanggan } from "./saldo-snapshot";
import type { BarisJurnal } from "./buku-besar-model";

/**
 * Tanda deposit pelanggan EasyMax dari pembaca sumber sampai jurnal P28.
 * `getSaldoPelanggan` menyajikan Hutang Lokal sebagai liabilitas NEGATIF;
 * `SaldoPelangganHari` meminta positif = kewajiban. Pemakaian deposit
 * (kewajiban turun) harus Dr 2101 / Kr 1103; top-up sebaliknya. Angka yang
 * diharapkan dihitung tangan, bukan dari fungsi yang diuji.
 */

const { qScoped, getDailyGlByProduct, getDoHarian, getSalesByProduct, getSaldoPelanggan, getHargaBeliRows } =
  vi.hoisted(() => ({
    qScoped: vi.fn(async () => []),
    getDailyGlByProduct: vi.fn(async () => []),
    getDoHarian: vi.fn(async () => []),
    getSalesByProduct: vi.fn(async () => []),
    getSaldoPelanggan: vi.fn(),
    getHargaBeliRows: vi.fn(async () => []),
  }));

vi.mock("./db", () => ({ qScoped }));
vi.mock("./queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./queries")>()),
  getDailyGlByProduct,
  getDoHarian,
  getSalesByProduct,
  getSaldoPelanggan,
}));
vi.mock("./keuangan-input-queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./keuangan-input-queries")>()),
  getHargaBeliRows,
}));

const { bacaEasymaxHari } = await import("./buku-besar-sumber");
const { p28Pelanggan } = await import("./buku-besar-model");

const U = 2 as unknown as ScopedUnitId;
const T = "2026-10-22";
const rp = (n: number) => Math.round(n * 100); // rupiah → sen

/** Saldo per pos (debet − kredit) — penilai hasil, bukan kode yang diuji. */
function saldo(baris: readonly BarisJurnal[]): Record<string, number> {
  const s: Record<string, number> = {};
  for (const b of baris) s[b.posKode] = (s[b.posKode] ?? 0) + b.debetSen - b.kreditSen;
  for (const k of Object.keys(s)) if (s[k] === 0) delete s[k];
  return s;
}

function saldoEasymax(piutangAwal: number, piutangAkhir: number, hutangAwal: number, hutangAkhir: number): SaldoPelanggan {
  return {
    awal: { piutangLokal: piutangAwal, piutangOnline: 0, hutangLokal: hutangAwal },
    akhir: { piutangLokal: piutangAkhir, piutangOnline: 0, hutangLokal: hutangAkhir },
  };
}

async function jurnalP28(s: SaldoPelanggan) {
  getSaldoPelanggan.mockResolvedValue(s);
  const bahan = await bacaEasymaxHari(U, T);
  return { pelanggan: bahan.pelanggan!, jurnal: p28Pelanggan(T, bahan.pelanggan, 0) };
}

describe("P28 — tanda deposit pelanggan EasyMax (Hutang Lokal) dari sumber ke jurnal", () => {
  beforeEach(() => {
    getSaldoPelanggan.mockReset();
  });

  it("Hutang Lokal negatif dipetakan menjadi deposit positif (positif = kewajiban)", async () => {
    const { pelanggan } = await jurnalP28(saldoEasymax(0, 0, -3_429_860.5, -3_129_860.5));
    expect(pelanggan.depositAwalSen).toBe(rp(3_429_860.5));
    expect(pelanggan.depositAkhirSen).toBe(rp(3_129_860.5));
  });

  it("Bakau 22 Okt: pemakaian deposit Rp 300.000 → Dr 2101 / Kr 1103, bagian piutang tak berubah", async () => {
    // Piutang naik Rp 15.741.610 (angka 22 Okt); Hutang Lokal −3.429.860,5 → −3.129.860,5.
    const { jurnal } = await jurnalP28(saldoEasymax(100_000_000, 115_741_610, -3_429_860.5, -3_129_860.5));
    expect(jurnal!.aturan).toBe("P28");
    const dr = (pos: string) => jurnal!.baris.filter((b) => b.posKode === pos).reduce((s, b) => s + b.debetSen, 0);
    const kr = (pos: string) => jurnal!.baris.filter((b) => b.posKode === pos).reduce((s, b) => s + b.kreditSen, 0);
    expect(dr("2101")).toBe(rp(300_000));
    expect(kr("2101")).toBe(0);
    expect(dr("1121")).toBe(rp(15_741_610));
    // 1103: −15.741.610 (piutang) − 300.000 (deposit terpakai, tanpa uang masuk).
    expect(saldo(jurnal!.baris)).toEqual({ "1121": rp(15_741_610), "2101": rp(300_000), "1103": -rp(16_041_610) });
  });

  it("pemakaian deposit saja: Dr 2101 300.000 / Kr 1103 300.000", async () => {
    const { jurnal } = await jurnalP28(saldoEasymax(0, 0, -3_429_860.5, -3_129_860.5));
    expect(jurnal!.baris).toHaveLength(2);
    expect(jurnal!.baris).toEqual(
      expect.arrayContaining([
        { posKode: "2101", debetSen: rp(300_000), kreditSen: 0 },
        { posKode: "1103", debetSen: 0, kreditSen: rp(300_000) },
      ]),
    );
    expect(saldo(jurnal!.baris)).toEqual({ "2101": rp(300_000), "1103": -rp(300_000) });
  });

  it("top-up deposit Rp 500.000 (Hutang Lokal −1.000.000 → −1.500.000): Dr 1103 / Kr 2101", async () => {
    const { jurnal } = await jurnalP28(saldoEasymax(0, 0, -1_000_000, -1_500_000));
    expect(saldo(jurnal!.baris)).toEqual({ "1103": rp(500_000), "2101": -rp(500_000) });
  });

  it("tanpa gerak piutang maupun deposit: tidak ada baris jurnal; saldo nol tetap +0", async () => {
    const { pelanggan, jurnal } = await jurnalP28(saldoEasymax(0, 0, 0, 0));
    expect(Object.is(pelanggan.depositAwalSen, 0)).toBe(true);
    expect(Object.is(pelanggan.depositAkhirSen, 0)).toBe(true);
    expect(jurnal).toBeNull();
  });

  it("deposit tetap (−3.129.860,5 di kedua batas): 2101 tidak tersentuh, hanya piutang", async () => {
    const { jurnal } = await jurnalP28(saldoEasymax(1_000_000, 1_250_000, -3_129_860.5, -3_129_860.5));
    expect(saldo(jurnal!.baris)).toEqual({ "1121": rp(250_000), "1103": -rp(250_000) });
  });
});
