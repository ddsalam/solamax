import { describe, expect, it } from "vitest";
import { cutOverTerawal, saldoAkun, saldoSemuaAkun, type MutasiKas } from "./keuangan-kas";
import { sebabKasDari } from "./keuangan-laporan-model";

/**
 * §10.26 — satu cut-over, satu aturan, di semua pembaca kas.
 * Kasus produksi 26-09-2026: IB Bank BCA punya mutasi biasa 1 Sep
 * (300.566.000) dan saldo pembuka sementara Rp 0 per 1 Okt.
 */
const m = (o: Partial<MutasiKas>): MutasiKas => ({
  accountId: "BCA",
  businessDate: "2026-09-01",
  jenis: "debet",
  categorySide: "debet",
  categoryLabel: "Pendapatan Lain-Lain",
  amount: 300_566_000,
  saldoAwal: false,
  void: false,
  ...o,
});
const IB = [
  m({}),
  m({ businessDate: "2026-10-01", jenis: "adjustment", categorySide: null, categoryLabel: null, amount: 0, saldoAwal: true }),
  m({ businessDate: "2026-10-02", amount: 1_000_000 }),
];

describe("saldoSemuaAkun = saldoAkun per akun (papan/laporan = layar input)", () => {
  it("🔴 mutasi sebelum cut-over TIDAK ikut — dulu papan menjumlahnya", () => {
    expect(saldoSemuaAkun(IB, "2026-10-02").get("BCA")).toBe(1_000_000);
    expect(saldoSemuaAkun(IB, "2026-10-02").get("BCA")).toBe(saldoAkun(IB, "BCA", "2026-10-02"));
  });
  it("akun tanpa saldo pembuka tetap dijumlah apa adanya", () => {
    const x = [m({ accountId: "KAS", amount: 5 }), m({ accountId: "KAS", businessDate: "2026-09-02", amount: 7 })];
    expect(saldoSemuaAkun(x, "2026-09-30").get("KAS")).toBe(12);
  });
});

describe("tanggal sebelum cut-over: 'belum dibukukan', bukan angka", () => {
  it("cut-over terawal ditemukan walau bertanggal sesudah hari laporan", () => {
    expect(cutOverTerawal(IB)).toBe("2026-10-01");
  });
  it("24 Sep ⇒ sebelum_cut_over; 1 Okt ⇒ bisa dihitung", () => {
    expect(sebabKasDari(1, 1, { tanggal: "2026-09-24", terawal: "2026-10-01" })).toBe("sebelum_cut_over");
    expect(sebabKasDari(1, 2, { tanggal: "2026-10-01", terawal: "2026-10-01" })).toBeNull();
  });
  it("tanpa saldo pembuka, perilaku lama tak berubah", () => {
    expect(sebabKasDari(1, 0, { tanggal: "2026-09-24", terawal: null })).toBe("belum_ada_mutasi_kas");
    expect(sebabKasDari(0, 0)).toBe("belum_ada_akun_kas");
  });
});
