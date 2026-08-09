import type { Content, ContentTable } from "pdfmake/interfaces";
import { describe, expect, it } from "vitest";
import { DEFAULT_EXPORT_CONFIG } from "./config";
import { buildLaporanDocDefinition, type LaporanDocMeta } from "./laporan-doc";
import { buildLaporanModel, type LaporanRaw } from "@/lib/laporan-model";

const raw = {
  prodDay: [{ ckdbbm: "P1", nama: "Pertalite", vol: 1000, omzet: 10_000_000, harga: 10000 }],
  glRows: [],
  zeroClosing: [],
  prodMonth: [{ ckdbbm: "P1", nama: "Pertalite", vol: 30000, omzet: 300_000_000, harga: 10000 }],
  delivMonth: [],
  doDay: [],
  doAnomalies: [],
  doSuspects: [],
  shift: { shifts: 3, last_dtgljam: null },
  corrections: 2,
  cash: [],
  saldo: {
    awal: { piutangLokal: 5000, piutangOnline: 0, hutangLokal: 0 },
    akhir: { piutangLokal: 6000, piutangOnline: 0, hutangLokal: 0 },
  },
  recapPelanggan: [],
  recapEdc: [],
  recapDeposit: [],
  recapPendapatanLain: [],
  recapPengeluaran: [],
  recapSetoran: [],
  terra: [],
  tetanggaSebelum: { f: [], g: [], i: [] },
  tetanggaSesudah: { f: [], g: [], i: [] },
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

/**
 * TANDA Hutang di PDF — jalur ekspor harus sepakat dgn layar (keduanya `rpParen`).
 * Skenario memakai angka asli 2026-08-04: 28 Oktober hutang POSITIF
 * (+123.526.169), Imam Bonjol NEGATIF (−751.284.145). Bug 2026-08-06 mencetak
 * keduanya dalam kurung — tak terbedakan, dan salah satunya bertanda beda dari
 * EasyMax.
 */
describe("PDF: tanda Hutang mengikuti nilai, bukan flag baris", () => {
  const withHutang = (v: number) =>
    buildLaporanModel(
      {
        ...raw,
        saldo: {
          awal: { piutangLokal: 0, piutangOnline: 0, hutangLokal: v },
          akhir: { piutangLokal: 0, piutangOnline: 0, hutangLokal: v },
        },
      } as unknown as LaporanRaw,
      {
        unitCode: "63781002",
        date: "2026-08-04",
        today: "2026-08-06",
        mi: { month: 8, year: 2026, dayOfMonth: 4, daysInMonth: 31 },
        detail: true,
      },
    );

  /** Sel-sel baris "Saldo Hutang Pelanggan Lokal" dari docDefinition. */
  const hutangCells = (v: number) => {
    const doc = buildLaporanDocDefinition({
      model: withHutang(v),
      meta,
      config: DEFAULT_EXPORT_CONFIG,
    });
    const cells: { text: string; color?: string; bold?: boolean }[] = [];
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!n || typeof n !== "object") return;
      const t = n as ContentTable & { text?: unknown };
      if (t.table?.body) {
        for (const row of t.table.body) {
          const first = row[0] as { text?: string } | undefined;
          if (typeof first?.text === "string" && first.text.includes("Hutang Pelanggan Lokal")) {
            for (const c of row.slice(1)) cells.push(c as { text: string; color?: string; bold?: boolean });
          }
        }
      }
      Object.values(n as Record<string, unknown>).forEach(walk);
    };
    walk(doc.content);
    return cells;
  };

  it("hutang NEGATIF (Imam Bonjol) → kurung, merah, tebal", () => {
    const cells = hutangCells(-751_284_145);
    expect(cells.length).toBeGreaterThan(0); // kontrol: barisnya memang ketemu
    for (const c of cells) {
      expect(c.text).toBe("(Rp 751.284.145)");
      expect(c.bold).toBe(true);
    }
  });

  it("hutang POSITIF (28 Oktober) → TANPA kurung, tidak merah/tebal", () => {
    const cells = hutangCells(123_526_169);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) {
      expect(c.text).toBe("Rp 123.526.169");
      expect(c.text).not.toContain("(");
      expect(c.bold).toBeFalsy();
    }
  });

  it("kedua tanda menghasilkan teks BERBEDA (inti bug lama)", () => {
    expect(hutangCells(123_526_169)[0]!.text).not.toBe(hutangCells(-123_526_169)[0]!.text);
  });
});

/**
 * PDF: section Arus Minyak Harian. Angka & urutannya berasal dari model yang
 * SAMA dengan layar, jadi yang diuji di sini adalah bahwa jalur ekspor benar-benar
 * MENCETAKNYA — bukan menghitung ulang. Data = IB 6 Agustus 2026 (oracle EasyMax).
 */
describe("PDF: Arus Minyak Harian", () => {
  const glRow = (
    ckdbbm: string,
    nama: string,
    fisik_prev: number,
    pen_do: number,
    sales_gross: number,
    fisik: number,
  ) => ({
    d: "2026-08-06",
    ckdbbm,
    nama,
    fisik,
    fisik_prev,
    pen_do,
    sales_gross,
    tera: 0,
    gl: fisik - (fisik_prev + pen_do - sales_gross),
    excluded_tanks: 0,
    provisional: false,
  });

  const modelArus = buildLaporanModel(
    {
      ...raw,
      glRows: [
        glRow("BB-02", "PERTAMAX", 18685.01, 8000, 2859.71, 23635.74),
        glRow("BB-08", "PERTAMINA DEX", 2766.43, 8000, 3003.39, 13310),
      ],
    } as unknown as LaporanRaw,
    {
      unitCode: "6478111",
      date: "2026-08-06",
      today: "2026-08-09",
      mi: { month: 8, year: 2026, dayOfMonth: 6, daysInMonth: 31 },
      detail: true,
    },
  );

  it("tercetak dengan 8 kolom, TANPA kolom Persediaan", () => {
    const doc = buildLaporanDocDefinition({ model: modelArus, meta, config: DEFAULT_EXPORT_CONFIG });
    const json = JSON.stringify(doc.content);
    expect(json).toContain("Arus Minyak Harian");
    expect(json).toContain("Stock Teori (L)");
    // Keputusan owner: kolom Persediaan EasyMax TIDAK ikut.
    expect(json).not.toContain("Persediaan");
    const t = collectTables(doc.content).find((x) =>
      JSON.stringify(x).includes("Stock Teori (L)"),
    );
    expect(t).toBeDefined();
    expect(t!.table.widths).toHaveLength(8);
    expect(t!.table.body).toHaveLength(4); // header + 2 produk + TOTAL
  });

  it("angka identik oracle & TOTAL = jumlah kolom", () => {
    const doc = buildLaporanDocDefinition({ model: modelArus, meta, config: DEFAULT_EXPORT_CONFIG });
    const t = collectTables(doc.content).find((x) =>
      JSON.stringify(x).includes("Stock Teori (L)"),
    )!;
    const cell = (r: number, c: number) =>
      (t.table.body[r]![c] as { text: string }).text;
    // Pertamina Dex 6 Agu: Losses +5.546,96 → 184,69 % (sel paling ekstrem oracle).
    const dex = t.table.body.findIndex((r) => JSON.stringify(r[0]).includes("PERTAMINA DEX"));
    expect(cell(dex, 4)).toBe("7.763,04"); // Stock Teori
    expect(cell(dex, 6)).toBe("5.546,96"); // Losses
    expect(cell(dex, 7)).toBe("184,69"); // %
    const tot = t.table.body.length - 1;
    expect(cell(tot, 1)).toBe("21.451,44"); // Σ Stock Awal
    expect(cell(tot, 6)).toBe("5.357,40"); // Σ Losses (−189,56 + 5.546,96)
  });

  it("urutannya SESUDAH Alokasi/DO dan SEBELUM Harga — sama dengan layar", () => {
    const doc = buildLaporanDocDefinition({ model: modelArus, meta, config: DEFAULT_EXPORT_CONFIG });
    const json = JSON.stringify(doc.content);
    expect(json.indexOf("Laporan DO Harian")).toBeLessThan(json.indexOf("Arus Minyak Harian"));
    expect(json.indexOf("Arus Minyak Harian")).toBeLessThan(json.indexOf("Harga Jual"));
  });

  it("mode ringkas: tidak ikut tercetak (sama dengan section detail lain)", () => {
    const ringkas = buildLaporanDocDefinition({
      model: modelArus,
      meta,
      config: { ...DEFAULT_EXPORT_CONFIG, detail: false },
    });
    expect(JSON.stringify(ringkas.content)).not.toContain("Arus Minyak Harian");
  });
});
