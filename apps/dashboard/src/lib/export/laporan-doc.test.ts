import type { Content, ContentTable } from "pdfmake/interfaces";
import { describe, expect, it } from "vitest";
import { DEFAULT_EXPORT_CONFIG } from "./config";
import { buildLaporanDocDefinition, type LaporanDocMeta } from "./laporan-doc";
import { num2 } from "@/lib/format";
import { buildLaporanModel, type LaporanRaw } from "@/lib/laporan-model";
import type { DailyGlRow } from "@/lib/queries";

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
  hargaDeviasi: [],
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
  it("every section heading travels with its table (incl. Alokasi) instead of ending a page alone", () => {
    const withAlokasi = buildLaporanModel({ ...raw, doSuspects: [{ cnoso: "4060546316", ckdbbm: "BB-04",
      nama: "PERTAMAX TURBO", ditebus: 16000, diterima: 0, outstanding: 16000, sejak: "2026-03-15",
      umur_hari: 119, aktif: true }] } as unknown as LaporanRaw, { unitCode: "6478111", date: "2026-06-11",
      today: "2026-07-02", mi: { month: 6, year: 2026, dayOfMonth: 11, daysInMonth: 30 }, detail: true });
    const doc = buildLaporanDocDefinition({ model: withAlokasi, meta, config: DEFAULT_EXPORT_CONFIG });
    expect(doc.pageBreakBefore).toBeTypeOf("function");
    const content = doc.content as unknown as Record<string, unknown>[];
    const headings = content.filter((c) => c.headlineLevel === 1);
    expect(JSON.stringify(headings)).toContain("Alokasi Penerimaan Tidak Sesuai");
    for (const h of headings) {
      const i = content.indexOf(h);
      const body = content.findIndex((c) => c.id === `${h.id}-body`);
      expect(body, JSON.stringify(h)).toBeGreaterThan(i);
      expect("table" in content[body]!).toBe(true);
      expect(JSON.stringify(content[body]), JSON.stringify(h)).toContain(`"id":"${h.id}-row"`);
      // Nothing but notes between a heading and its table; never another heading.
      expect(content.slice(i + 1, body).every((c) => c.headlineLevel === undefined && !("table" in c))).toBe(true);
    }
  });

  it.each([
    { gl: 4000, provisional: false, signed: "+4.000" },
    { gl: -4000, provisional: false, signed: "−4.000" },
    { gl: 4000, provisional: true, signed: "+4.000" },
    { gl: -4000, provisional: true, signed: "−4.000" },
    { gl: 0, provisional: false, signed: "0" },
  ])("PDF alarm and explanation keep G/L $gl sign-neutral (provisional=$provisional)", ({ gl, provisional, signed }) => {
    const products = [{ ...raw.prodDay[0]!, vol: 8200 }];
    const signedModel = buildLaporanModel({ ...raw, prodDay: products, prodMonth: products,
      glRows: [{ d: "2026-06-11", ckdbbm: "P1", nama: "Pertalite", fisik_prev: 20000, fisik: 11800 + gl,
        pen_do: 0, sales_gross: 8200, tera: 0, gl, provisional, movement_invalid: false, excluded_tanks: 0 }],
    }, { unitCode: "6478111", date: "2026-06-11", today: "2026-07-02",
      mi: { month: 6, year: 2026, dayOfMonth: 11, daysInMonth: 30 }, detail: true });
    const json = JSON.stringify(buildLaporanDocDefinition({ model: signedModel, meta, config: DEFAULT_EXPORT_CONFIG }).content);
    for (const check of signedModel.checks.filter((c) => /^G\/L (harian|bulanan)/.test(c.label))) {
      expect(json).toContain(check.label);
      expect(json).toContain(check.note);
    }
    expect(json).toContain(`G/L harian (RESUME) ${signed} L${provisional ? " berjalan — belum final" : " = "}`);
    expect(json).not.toMatch(/Losses (harian|bulanan)/);
  });

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
    movement_invalid: false,
    gl: fisik - (fisik_prev + pen_do - sales_gross),
    excluded_tanks: 0,
    provisional: false,
  });

  const modelArus = buildLaporanModel(
    {
      ...raw,
      // This fixture covers these two products; the generic P1 sale above is
      // unrelated and would correctly make a complete G/L total unavailable.
      prodDay: [
        { ckdbbm: "BB-02", nama: "PERTAMAX", vol: 2859.71, omzet: 0, harga: null },
        { ckdbbm: "BB-08", nama: "PERTAMINA DEX", vol: 3003.39, omzet: 0, harga: null },
      ],
      prodMonth: [],
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

describe("PDF operational G/L source-integrity nulls", () => {
  it("renders one canonical sales row with G/L and tera once and the full monthly denominator", () => {
    // Same synthetic aggregate as the actual-SQL identity regression: raw
    // P / NBSP+P / BOM+P sales contribute 100 + 200 + 300 L before grouping.
    const products = [{ ckdbbm: "P", nama: "SOLAR", vol: 600, omzet: 6000000, harga: 10000 }];
    const m = buildLaporanModel({ ...raw, prodDay: products, prodMonth: products,
      glRows: [{ d: "2026-10-02", ckdbbm: "P", nama: "SOLAR", fisik_prev: 10000,
        fisik: 9600, pen_do: 0, sales_gross: 600, tera: 50, gl: 150, movement_invalid: false,
        excluded_tanks: 0, provisional: false }],
    }, { unitCode: "SYNTHETIC", date: "2026-10-02", today: "2026-10-04",
      mi: { month: 10, year: 2026, dayOfMonth: 2, daysInMonth: 31 }, detail: true });
    expect(m.sales.rows).toEqual([{ ckdbbm: "P", nama: "SOLAR", vol: 600,
      omzet: 6000000, gl: 150, tera: 50 }]);
    expect(m.sales.glTotal).toBe(150);
    expect(m.sales.totTera).toBe(50);
    expect(m.glMonthly.rows).toEqual([{ ckdbbm: "P", nama: "SOLAR", selisih: 150, vol: 600 }]);
    expect(m.glMonthly.glPctMonth).toBe(0.25);
    expect(m.harga.rows).toEqual([{ ckdbbm: "P", nama: "SOLAR", harga: 10000 }]);

    const doc = buildLaporanDocDefinition({ model: m, config: DEFAULT_EXPORT_CONFIG,
      meta: { ...meta, unitDotted: "SYNTHETIC", unitName: "SYNTHETIC PRODUCT SUMMARY",
        dateLong: "2 Oktober 2026", monthName: "Oktober", dayOfMonth: 2, daysInMonth: 31 } });
    const tables = collectTables(doc.content);
    const daily = tables.find((t) => JSON.stringify(t.table.body[0]).includes("Sales (L)"))!;
    const monthly = tables.find((t) => JSON.stringify(t.table.body[0]).includes("G/L bulan (L)"))!;
    const cells = (row: unknown[]) => row.map((cell) => (cell as { text: string }).text);
    expect(daily.table.body).toHaveLength(3); // header, one product, total
    expect(cells(daily.table.body[1]!)).toEqual(["SOLAR", "600", "+150", "50", "Rp 6.000.000"]);
    expect(cells(daily.table.body[2]!)).toEqual(["TOTAL", "600", "+150", "50", "Rp 6.000.000"]);
    expect(monthly.table.body).toHaveLength(2);
    expect(cells(monthly.table.body[1]!)).toEqual(["SOLAR", "+150 L", "25,00%"]);
  });

  it("unknown rows and totals render as unavailable in daily, cumulative, and Arus sections", () => {
    const m = buildLaporanModel({ ...raw, glRows: [{
      d: "2026-06-11", ckdbbm: "P1", nama: "Pertalite", fisik: 900, fisik_prev: 1_000,
      pen_do: 0, sales_gross: 100, tera: 0, gl: null, movement_invalid: true, excluded_tanks: 0, provisional: true,
    }] }, { unitCode: "6478111", date: "2026-06-11", today: "2026-07-02",
      mi: { month: 6, year: 2026, dayOfMonth: 11, daysInMonth: 30 }, detail: true });
    const doc = buildLaporanDocDefinition({ model: m, meta, config: DEFAULT_EXPORT_CONFIG });
    const tables = collectTables(doc.content);
    const daily = tables.find(t => JSON.stringify(t.table.body[0]).includes("Sales (L)"))!;
    const monthly = tables.find(t => JSON.stringify(t.table.body[0]).includes("G/L bulan (L)"))!;
    const text = (r: unknown[], i: number) => (r[i] as { text: string }).text;
    expect(text(daily.table.body[1]!, 2)).toBe("—");
    expect(text(daily.table.body.at(-1)!, 2)).toBe("—");
    expect(text(monthly.table.body[1]!, 1)).toBe("—");
    expect(text(monthly.table.body[1]!, 2)).toBe("—");
    expect(JSON.stringify(doc.content)).toContain("G/L belum bisa dihitung lengkap");
  });
});

/** Synthetic identities only; NULL source labels must never reach pdfText. */
describe("PDF operational G/L unidentified products", () => {
  it.each([null, "", "   "])("renders unknown identity %j safely without merging its zero into a known product", (code) => {
    const prod = (ckdbbm: string | null, nama: string | null) => ({
      ckdbbm: ckdbbm as string, nama: nama as string, vol: 10, omzet: 100000, harga: 10000,
    });
    const gl = (ckdbbm: string | null, nama: string | null) => ({
      d: "2026-06-11", ckdbbm, nama, fisik: 90, fisik_prev: 100, pen_do: 0,
      sales_gross: 10, tera: 0, gl: 0, movement_invalid: false, excluded_tanks: 0, provisional: false,
    });
    const products = [prod("KNOWN", "SOLAR"), prod(code, null)];
    const m = buildLaporanModel({ ...raw, prodDay: products, prodMonth: products,
      glRows: [gl("KNOWN", "SOLAR"), gl(code, null)],
      zeroClosing: [{ unit_id: 1, d: "2026-06-11", ckdtangki: "SYNTHETIC-TANK", ckdbbm: code,
        nama: null, bk: 2000, prev: 2000, next: 2000, recv_next: 0 }],
    }, { unitCode: "SYNTHETIC", date: "2026-06-11", today: "2026-07-02",
      mi: { month: 6, year: 2026, dayOfMonth: 11, daysInMonth: 30 }, detail: true });
    const doc = buildLaporanDocDefinition({ model: m, meta, config: DEFAULT_EXPORT_CONFIG });
    const tables = collectTables(doc.content);
    const text = (r: unknown[], i: number) => (r[i] as { text: string }).text;
    for (const [header, glColumn] of [["Sales (L)", 2], ["G/L bulan (L)", 1], ["Stock Awal (L)", 6]] as const) {
      const t = tables.find((t) => JSON.stringify(t.table.body[0]).includes(header))!;
      expect(t, `missing ${header} table`).toBeDefined();
      const unknown = t.table.body.find((r) => text(r, 0) === "Produk tidak diketahui")!;
      const known = t.table.body.find((r) => text(r, 0) === "SOLAR")!;
      expect(text(unknown, glColumn)).toBe("—");
      expect(text(known, glColumn)).toMatch(/^0(?:,00)?(?: L)?$/);
      if (header !== "G/L bulan (L)") expect(text(t.table.body.at(-1)!, glColumn)).toBe("—");
    }
    // The monthly aggregate is in its heading rather than a total table row.
    expect(m.glMonthly.glMonthTotal).toBeNull();
    expect(JSON.stringify(doc.content)).toContain("G/L belum bisa dihitung lengkap");
    expect(JSON.stringify(doc.content)).not.toMatch(/NaN|undefined/);
  });
});

describe("PDF Arus stock and movement completeness", () => {
  const source = (overrides: Partial<DailyGlRow> = {}): DailyGlRow => ({
    d: "2026-06-11", ckdbbm: "P", nama: "SINTETIS P", fisik_prev: 100,
    pen_do: 50, sales_gross: 30, tera: 0, fisik: 120, gl: 0,
    movement_invalid: false, excluded_tanks: 0, provisional: false, ...overrides,
  });
  const healthy = source({ ckdbbm: "Q", nama: "SINTETIS Q", fisik_prev: 200, fisik: 220 });
  const render = (glRows: DailyGlRow[]) => {
    const products = glRows.map((r) => ({ ckdbbm: r.ckdbbm, nama: r.nama,
      vol: r.sales_gross, omzet: r.sales_gross * 10_000, harga: 10_000 }));
    const m = buildLaporanModel({ ...raw, glRows, prodDay: products, prodMonth: products },
      { unitCode: "SYNTHETIC", date: "2026-06-11", today: "2026-07-02",
        mi: { month: 6, year: 2026, dayOfMonth: 11, daysInMonth: 30 }, detail: true });
    const doc = buildLaporanDocDefinition({ model: m, config: DEFAULT_EXPORT_CONFIG,
      meta: { ...meta, unitDotted: "SYNTHETIC", unitName: "SYNTHETIC ARUS" } });
    const table = collectTables(doc.content).find((t) => JSON.stringify(t.table.body[0]).includes("Stock Awal (L)"));
    const cells = (label: string) => table?.table.body
      .find((row) => (row[0] as { text?: string }).text === label)
      ?.map((cell) => (cell as { text: string }).text);
    return { m, doc, table, cells };
  };

  it("prints invalid-movement diagnostics but leaves theory and its TOTAL unavailable", () => {
    const { doc, cells } = render([source({ fisik_prev: 2_000, fisik: 0, gl: null,
      movement_invalid: true, provisional: true }), healthy]);
    expect(cells("SINTETIS P")).toEqual(["SINTETIS P", "2.000,00", "50,00", "30,00", "—", "0,00", "—", "—"]);
    expect(cells("TOTAL")).toEqual(["TOTAL", "2.200,00", "100,00", "60,00", "—", "220,00", "—", "—"]);
    expect(JSON.stringify(doc.content)).toContain("belum final");
    expect(JSON.stringify(doc.content)).not.toContain("[opname 0]");
    expect(JSON.stringify(doc.content)).not.toMatch(/NaN|undefined/);
  });

  it("prints valid theory when only current physical is missing, with unavailable physical TOTAL", () => {
    const { cells } = render([source({ fisik: null, gl: null, excluded_tanks: 1, provisional: true }), healthy]);
    expect(cells("SINTETIS P")).toEqual(["SINTETIS P", "100,00", "50,00", "30,00", "120,00", "—", "—", "—"]);
    expect(cells("TOTAL")).toEqual(["TOTAL", "300,00", "100,00", "60,00", "340,00", "—", "—", "—"]);
  });

  it("does not print a known-product subtotal as complete beginning or theoretical stock", () => {
    const { cells } = render([source({ fisik_prev: null, gl: null, provisional: true }), healthy]);
    expect(cells("TOTAL")).toEqual(["TOTAL", "—", "100,00", "60,00", "—", "340,00", "—", "—"]);
  });

  it("preserves measured zero while unknown-product stock makes dependent totals unavailable", () => {
    const zero = source({ fisik_prev: 0, fisik: 0, pen_do: 0, sales_gross: 0 });
    const { cells } = render([zero, source({ ckdbbm: null, nama: null,
      fisik_prev: null, fisik: null, gl: null, movement_invalid: true, provisional: true })]);
    expect(cells("SINTETIS P")).toEqual(["SINTETIS P", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00", "0,00"]);
    expect(cells("TOTAL")).toEqual(["TOTAL", "—", "50,00", "30,00", "—", "—", "—", "—"]);
  });

  it.each([
    { reason: "penutup_nol" as const, tag: "SINTETIS P  [opname 0]", awal: 6_000, fisik: 0, sales: 30, raw: -5_970 },
    { reason: "jangkar_nol" as const, tag: "SINTETIS P  [perlu periksa]", awal: 0, fisik: 3_000, sales: 0, raw: 3_000 },
  ])("prints a $reason artefact with raw stock but never as Losses, % or TOTAL", ({ reason, tag, awal, fisik, sales, raw }) => {
    const { doc, cells, m } = render([source({ fisik_prev: awal, fisik, pen_do: 0, sales_gross: sales,
      gl: null, gl_raw: raw, gl_suspect: reason, provisional: true }), healthy]);
    const row = cells(tag);
    expect(row).toBeDefined();
    expect(row!.slice(1)).toEqual([num2(awal), "0,00", num2(sales), num2(awal - sales), num2(fisik), "—", "—"]);
    expect(cells("TOTAL")!.slice(-2)).toEqual(["—", "—"]);
    expect(m.sales.glTotal).toBeNull();
    const text = JSON.stringify(doc.content);
    expect(text).toContain("BUKAN kerugian");
    expect(text).toContain("mentah");
    expect(text).not.toContain("sengaja tidak dikoreksi");
    expect(text).not.toMatch(/NaN|undefined/);
  });

  it("omits the empty Arus table instead of exporting an invented zero stock TOTAL", () => {
    const { m, doc, table } = render([]);
    expect(m.arusMinyak.total).toMatchObject({ awal: null, teori: null, fisik: null, losses: null, pct: null });
    expect(table).toBeUndefined();
    expect(JSON.stringify(doc.content)).not.toContain("Arus Minyak Harian");
  });
});

describe("PDF historis: sumber target tetap disebut", () => {
  it("laporan Feb 2024 dinilai terhadap target workbook 2026 dan mengatakannya (label lama tak berubah)", () => {
    const m = buildLaporanModel(raw, { unitCode: "6478111", date: "2024-02-10", today: "2026-10-06",
      mi: { month: 2, year: 2024, dayOfMonth: 10, daysInMonth: 29 }, detail: true });
    const doc = buildLaporanDocDefinition({ model: m, config: DEFAULT_EXPORT_CONFIG,
      meta: { ...meta, dateLong: "Sabtu, 10 Februari 2024", monthName: "Februari", dayOfMonth: 10, daysInMonth: 29 } });
    expect(m.target.rows[0]!.alok).not.toBeNull(); // target 2026 tetap dipakai (semantik dipertahankan)
    expect(JSON.stringify(doc.content)).toContain("vs prorata 10/29 hari · workbook 2026");
  });
});
