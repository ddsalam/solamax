import { describe, expect, it } from "vitest";
import { DO_PRODUCTS } from "@/lib/config";
import { alurSelisihNote, buildLaporanModel, type LaporanRaw } from "@/lib/laporan-model";

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

  it("hari alur-bersih: recon 0 & alurSelisih 0 di semua baris — tanpa sub-baris rekonsiliasi", () => {
    const clean = {
      ...raw,
      doDay: [
        // Dexlite 06-13: 4+4−0−? → sisa 0; alur terserap penuh.
        { ckdbbm: "BB-06", nama: "DEXLITE", do_awal: 4000, penerimaan: 4000, penebusan: 0, sisa: 0, sisa_macet: 0, alur_selisih: 0 },
      ],
    } as unknown as LaporanRaw;
    const m = buildLaporanModel(clean, ctx);
    for (const r of m.doHarian.rows) {
      expect(r.recon).toBe(0);
      expect(r.alurSelisih).toBe(0);
      expect(alurSelisihNote(r.alurSelisih)).toBeNull();
    }
  });

  it("hari break (Bakau 2026-06-13): sub-baris rekonsiliasi = −recon, identitas balance", () => {
    const brokeDay = {
      ...raw,
      doDay: [
        // Solar: 48 + 0 − 16 = 32 alur; sisa 40 → 8.000 penerimaan tak terserap.
        { ckdbbm: "BB-03", nama: "SOLAR", do_awal: 48000, penerimaan: 16000, penebusan: 0, sisa: 40000, sisa_macet: 0, alur_selisih: 8000 },
        // Pertalite: 8 + 0 − 16 = −8 alur; sisa 8 → 16.000 tak terserap (clamp).
        { ckdbbm: "BB-07", nama: "PERTALITE", do_awal: 8000, penerimaan: 16000, penebusan: 0, sisa: 8000, sisa_macet: 0, alur_selisih: 16000 },
      ],
    } as unknown as LaporanRaw;
    const m = buildLaporanModel(brokeDay, ctx);
    const solar = m.doHarian.rows.find((r) => r.key === "solar")!;
    const perta = m.doHarian.rows.find((r) => r.key === "pertalite")!;
    // Kesetaraan dua jalur (query-CTE vs residual aritmetika) — WAJIB sama;
    // ketidaksetaraan = bug yang harus muncul, bukan disembunyikan.
    expect(solar.alurSelisih).toBe(-solar.recon);
    expect(perta.alurSelisih).toBe(-perta.recon);
    expect(solar.alurSelisih).toBe(8000);
    expect(perta.alurSelisih).toBe(16000);
    // Identitas tampilan balance: DO Awal + Penebusan − Penerimaan + selisih = Sisa.
    expect(solar.doAwal + solar.penebusan - solar.penerimaan + solar.alurSelisih).toBe(solar.sisa);
    expect(perta.doAwal + perta.penebusan - perta.penerimaan + perta.alurSelisih).toBe(perta.sisa);
    expect(alurSelisihNote(solar.alurSelisih)).toContain("8.000");
    expect(alurSelisihNote(solar.alurSelisih)).toContain("penerimaan tak terserap");
    // Arah sebaliknya (penebusan terserap kelebihan-terima lama).
    expect(alurSelisihNote(-24000)).toContain("penebusan terserap");
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
