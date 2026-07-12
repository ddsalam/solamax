import { describe, expect, it } from "vitest";
import { DO_PRODUCTS } from "@/lib/config";
import { buildLaporanModel, type LaporanRaw } from "@/lib/laporan-model";

const raw = {
  prodDay: [
    { ckdbbm: "P1", nama: "Pertalite", vol: 1000, omzet: 10_000_000, harga: 10000 },
    { ckdbbm: "P2", nama: "Pertamax", vol: 500, omzet: 6_000_000, harga: 12000 },
  ],
  glRows: [],
  prodMonth: [{ ckdbbm: "P1", nama: "Pertalite", vol: 30000, omzet: 300_000_000, harga: 10000 }],
  delivMonth: [],
  doDay: [],
  doAnomalies: [],
  doSuspects: [],
  shift: { shifts: 3, last_dtgljam: null },
  corrections: 0,
  cash: [],
  saldo: { piutangLokal: 0, piutangOnline: 0, hutangLokal: 0 },
  recapPelanggan: [],
  recapEdc: [],
  recapDeposit: [],
  recapPendapatanLain: [],
  recapPengeluaran: [],
  recapSetoran: [],
} as unknown as LaporanRaw;

const ctx = {
  unitCode: "6478111",
  date: "2026-06-11",
  today: "2026-07-02",
  mi: { month: 6, year: 2026, dayOfMonth: 11, daysInMonth: 30 },
  detail: true,
};

describe("buildLaporanModel", () => {
  it("agregasi omset & sales rows", () => {
    const m = buildLaporanModel(raw, ctx);
    expect(m.sales.rows).toHaveLength(2);
    expect(m.sales.totOmzet).toBe(16_000_000);
    expect(m.header.omzetTotal).toBe(16_000_000);
  });

  it("DO Harian selalu 6 slot; alarm 11 cek", () => {
    const m = buildLaporanModel(raw, ctx);
    expect(m.doHarian.rows).toHaveLength(DO_PRODUCTS.length);
    expect(m.checks).toHaveLength(11);
  });

  it("Rekonsiliasi A = omset; G null saat kas kosong; glMonthly kosong tanpa opname", () => {
    const m = buildLaporanModel(raw, ctx);
    expect(m.rekon.rows.find((r) => r.l === "A")?.val).toBe(16_000_000);
    expect(m.rekon.rows.find((r) => r.l === "G")?.val).toBeNull();
    expect(m.glMonthly.rows).toHaveLength(0);
  });

  it("Sisa DO tersegmentasi: sisaBerjalan + sisaMacet = sisa; totals ikut", () => {
    const withDo = {
      ...raw,
      doDay: [
        // Bakau-like: Solar 128k dengan 72k macet.
        { ckdbbm: "BB-03", nama: "SOLAR", do_awal: 136000, penerimaan: 8000, penebusan: 0, sisa: 128000, sisa_macet: 72000 },
        // Dexlite murni berjalan.
        { ckdbbm: "BB-06", nama: "DEXLITE", do_awal: 4000, penerimaan: 0, penebusan: 0, sisa: 4000, sisa_macet: 0 },
      ],
    } as unknown as LaporanRaw;
    const m = buildLaporanModel(withDo, ctx);
    const solar = m.doHarian.rows.find((r) => r.key === "solar")!;
    expect(solar.sisa).toBe(128000);
    expect(solar.sisaMacet).toBe(72000);
    expect(solar.sisaBerjalan).toBe(56000);
    const dexlite = m.doHarian.rows.find((r) => r.key === "dexlite")!;
    expect(dexlite.sisaMacet).toBe(0);
    expect(dexlite.sisaBerjalan).toBe(4000);
    expect(m.doHarian.totals.sisa).toBe(132000);
    expect(m.doHarian.totals.sisaMacet).toBe(72000);
  });

  it("IB-like (tanpa SO macet): segmen macet 0 di semua baris — tampilan tak berubah", () => {
    const m = buildLaporanModel(raw, ctx); // doDay kosong = tak ada macet
    for (const r of m.doHarian.rows) {
      expect(r.sisaMacet).toBe(0);
      expect(r.sisaBerjalan).toBe(r.sisa);
    }
    expect(m.doHarian.totals.sisaMacet).toBe(0);
    expect(m.doHarian.suspects).toHaveLength(0);
    expect(m.doHarian.suspectsNonaktif).toEqual({ count: 0, liters: 0 });
  });

  it("suspects terbelah aktif vs nonaktif (aturan tangki, tanpa hardcode nama)", () => {
    const withSuspects = {
      ...raw,
      doSuspects: [
        { cnoso: "4060546316", ckdbbm: "BB-04", nama: "PERTAMAX TURBO", ditebus: 16000, diterima: 0, outstanding: 16000, sejak: "2026-03-15", umur_hari: 119, aktif: true },
        { cnoso: "4023165148", ckdbbm: "BB-01", nama: "PREMIUM", ditebus: 64000, diterima: 0, outstanding: 64000, sejak: "2022-12-30", umur_hari: 1290, aktif: false },
        { cnoso: "4060297050", ckdbbm: "BB-01", nama: "PREMIUM", ditebus: 56000, diterima: 0, outstanding: 56000, sejak: "2026-02-28", umur_hari: 134, aktif: false },
      ],
    } as unknown as LaporanRaw;
    const m = buildLaporanModel(withSuspects, ctx);
    expect(m.doHarian.suspects).toHaveLength(1);
    expect(m.doHarian.suspects[0]!.cnoso).toBe("4060546316");
    expect(m.doHarian.suspectsNonaktif).toEqual({ count: 2, liters: 120000 });
  });
});
