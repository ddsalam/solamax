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
});
