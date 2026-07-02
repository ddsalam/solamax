import type { Content, ContentTable } from "pdfmake/interfaces";
import { describe, expect, it } from "vitest";
import { DEFAULT_EXPORT_CONFIG } from "./config";
import { buildLaporanDocDefinition, type LaporanDocMeta } from "./laporan-doc";
import { buildLaporanModel, type LaporanRaw } from "@/lib/laporan-model";

const raw = {
  prodDay: [{ ckdbbm: "P1", nama: "Pertalite", vol: 1000, omzet: 10_000_000, harga: 10000 }],
  glRows: [],
  prodMonth: [{ ckdbbm: "P1", nama: "Pertalite", vol: 30000, omzet: 300_000_000, harga: 10000 }],
  delivMonth: [],
  doDay: [],
  doAnomalies: [],
  doSuspects: [],
  shift: { shifts: 3, last_dtgljam: null },
  corrections: 2,
  cash: [],
  saldo: { piutangLokal: 5000, piutangOnline: 0, hutangLokal: 0 },
  recapPelanggan: [],
  recapEdc: [],
  recapDeposit: [],
  recapPendapatanLain: [],
  recapPengeluaran: [],
  recapSetoran: [],
} as unknown as LaporanRaw;

const model = buildLaporanModel(raw, {
  unitCode: "6478111",
  date: "2026-06-11",
  today: "2026-07-02",
  mi: { month: 6, year: 2026, dayOfMonth: 11, daysInMonth: 30 },
  detail: true,
});

const meta: LaporanDocMeta = {
  unitDotted: "64.781.11",
  unitName: "Imam Bonjol",
  dateLong: "Kamis, 11 Juni 2026",
  monthName: "Juni",
  dayOfMonth: 11,
  daysInMonth: 30,
  staleDays: 30,
  generatedLabel: "2 Jul 2026 · 19.19",
};

function collectTables(node: unknown, out: ContentTable[] = []): ContentTable[] {
  if (Array.isArray(node)) for (const n of node) collectTables(n, out);
  else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if ("table" in o) out.push(o as unknown as ContentTable);
    for (const k of Object.keys(o)) collectTables(o[k], out);
  }
  return out;
}

describe("buildLaporanDocDefinition", () => {
  it("A4 potret + footer 'Halaman X dari Y' natif", () => {
    const doc = buildLaporanDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    expect(doc.pageSize).toBe("A4");
    expect(doc.pageOrientation).toBe("portrait");
    const footer = (doc.footer as (p: number, c: number) => Content)(2, 3);
    expect(JSON.stringify(footer)).toContain("Halaman 2 dari 3");
  });

  it("semua tabel: header berulang + tak memecah baris; satuan di judul", () => {
    const doc = buildLaporanDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    const tables = collectTables(doc.content);
    expect(tables.length).toBeGreaterThan(1);
    for (const t of tables) {
      expect(t.table.headerRows).toBe(1);
      expect(t.table.dontBreakRows).toBe(true);
    }
    const json = JSON.stringify(doc.content);
    expect(json).toContain("Sales (L)");
    expect(json).toContain("Omzet (Rp)");
    expect(json).toContain("G/L bulan (L)");
  });

  it("ringkas menghilangkan section detail; lengkap menyertakannya", () => {
    const lengkap = buildLaporanDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    expect(JSON.stringify(lengkap.content)).toContain("Realisasi & Target Bulanan");
    expect(JSON.stringify(lengkap.content)).toContain("Laporan DO Harian");

    const ringkas = buildLaporanDocDefinition({
      model,
      meta,
      config: { ...DEFAULT_EXPORT_CONFIG, detail: false },
    });
    const json = JSON.stringify(ringkas.content);
    expect(json).not.toContain("Realisasi & Target Bulanan");
    expect(json).not.toContain("Laporan DO Harian");
    // Section inti tetap ada:
    expect(json).toContain("Omset Penjualan, Gain (Losses) & Tera Harian");
  });

  it("metadata dokumen tanpa PII", () => {
    const doc = buildLaporanDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    expect(doc.info?.title).toContain("64.781.11");
    expect(doc.info?.author).toBe("SolaMax");
  });
});
