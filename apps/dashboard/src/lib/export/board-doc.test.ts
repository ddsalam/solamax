import type { Content, ContentTable } from "pdfmake/interfaces";
import { describe, expect, it } from "vitest";
import { DEFAULT_EXPORT_CONFIG } from "./config";
import { buildBoardDocDefinition, type BoardDocMeta } from "./board-doc";
import { ledgerLayout } from "./pdf-layout";
import { PDF } from "./pdf-tokens";
import {
  buildBoardCore,
  buildBoardEval,
  type BoardModel,
  type BoardUnit,
  type DatedDailyGlInput,
  type SalesGrainRow,
} from "@/lib/board-model";
import type { AnomalyItem } from "@/lib/anomalies";
import { dateLong, dateShort } from "@/lib/format";
import { addDays, resolveBoardPeriod, todayWib } from "@/lib/periods";

const NOW = new Date("2026-07-16T03:00:00Z");
const TODAY = "2026-07-16";
const PERIOD = resolveBoardPeriod("bulan", {}, NOW);
const IB: BoardUnit = { unit_id: 1, code: "6478111", name: "Imam Bonjol" };

const SALES: SalesGrainRow[] = [
  { unit_id: 1, d: "2026-07-16", ckdbbm: "PL", nama: "PERTALITE", vol: 1000, omzet: 10_000_000 },
  { unit_id: 1, d: "2026-07-16", ckdbbm: "PX", nama: "PERTAMAX", vol: 120, omzet: 1_800_000 },
  { unit_id: 1, d: "2026-06-16", ckdbbm: "PL", nama: "PERTALITE", vol: 800, omzet: 8_000_000 },
  { unit_id: 1, d: "2025-07-16", ckdbbm: "PL", nama: "PERTALITE", vol: 500, omzet: 5_000_000 },
];

const glRow = (gl: number, d = "2026-07-16", ckdbbm = "PL"): DatedDailyGlInput => ({
  d,
  ckdbbm,
  nama: ckdbbm === "PX" ? "PERTAMAX" : "PERTALITE",
  gl,
  tera: 0,
  excluded_tanks: 0,
  provisional: false,
});

const core = buildBoardCore({
  units: [IB],
  period: PERIOD,
  mode: "kumulatif",
  today: TODAY,
  dailySales: SALES,
  glRange: new Map([[1, [glRow(-2), glRow(0, "2026-07-16", "PX")]]]),
  shift: new Map([[1, { shifts: 3, last_dtgljam: null }]]),
  anomalies: [],
});

const evalM = buildBoardEval({
  units: [IB],
  period: PERIOD,
  today: TODAY,
  dailySales: SALES,
  gl: {
    range: new Map([[1, [glRow(-2), glRow(0, "2026-07-16", "PX")]]]),
    momPrev: new Map([[1, [glRow(-1, "2026-06-16")]]]),
    yoyPrev: new Map([[1, [glRow(-1, "2025-07-16")]]]),
    ytdCur: new Map([[1, [glRow(-2), glRow(0, "2026-07-16", "PX"), glRow(-1, "2026-06-16")]]]),
    ytdPrev: new Map([[1, [glRow(-1, "2025-07-16")]]]),
  },
  coverage: new Map([[1, "2022-08-31"]]),
  incompleteToday: false,
});

const model: BoardModel = { mode: "kumulatif", core, eval: evalM };

const meta: BoardDocMeta = {
  dateLong: "Kamis, 16 Juli 2026",
  periodLabel: "1 Jul 2026 – 16 Jul 2026",
  unitsLabel: "Semua unit (1)",
  modeLabel: "Kumulatif",
  unitsCount: 1,
  generatedLabel: "16 Jul 2026 · 08.00",
  ptLabel: "PT Sola Petra Abadi",
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

describe("buildBoardDocDefinition (redesign filter+evaluasi)", () => {
  it.each([
    { gl: 4000, provisional: false, value: "+48,78%", label: "G/L Imam Bonjol 48,78%" },
    { gl: -4000, provisional: false, value: "−48,78%", label: "G/L Imam Bonjol -48,78%" },
    { gl: 4000, provisional: true, value: "+48,78%", label: "G/L Imam Bonjol · sementara (opname belum final)" },
    { gl: -4000, provisional: true, value: "−48,78%", label: "G/L Imam Bonjol · sementara (opname belum final)" },
    { gl: 0, provisional: false, value: "0%", label: null },
  ])("PDF preserves neutral G/L labels and signed $gl (provisional=$provisional)", ({ gl, provisional, value, label }) => {
    const input = {
      units: [IB], period: PERIOD, today: TODAY,
      dailySales: [{ ...SALES[0]!, vol: 8200 }],
    };
    const glRange = new Map([[1, [{ ...glRow(gl), provisional }]]]);
    const signedModel: BoardModel = { mode: "kumulatif",
      core: buildBoardCore({ ...input, mode: "kumulatif", glRange,
        shift: new Map([[1, { shifts: 3, last_dtgljam: null }]]), anomalies: [] }),
      eval: buildBoardEval({ ...input,
        gl: { range: glRange, ytdCur: glRange, momPrev: new Map(), yoyPrev: new Map(), ytdPrev: new Map() },
        coverage: new Map([[1, TODAY]]), incompleteToday: false }),
    };
    const json = JSON.stringify(buildBoardDocDefinition({ model: signedModel, meta, config: DEFAULT_EXPORT_CONFIG }).content);
    if (label !== null) expect(json).toContain(label);
    expect(json).toContain(value);
    expect(json).not.toContain("Losses Imam Bonjol");
  });

  it("PDF never prints a source-artefact G/L as a percentage or loss", () => {
    const input = { units: [IB], period: PERIOD, today: TODAY, dailySales: [{ ...SALES[0]!, vol: 8200 }] };
    // Synthetic: raw −6.000 L would print as −73,17% if it were summed.
    const glRange = new Map([[1, [{ ...glRow(-6000), gl: null, gl_suspect: "penutup_nol" as const, provisional: true }]]]);
    const suspectModel: BoardModel = { mode: "kumulatif",
      core: buildBoardCore({ ...input, mode: "kumulatif", glRange,
        shift: new Map([[1, { shifts: 3, last_dtgljam: null }]]), anomalies: [] }),
      eval: buildBoardEval({ ...input,
        gl: { range: glRange, ytdCur: glRange, momPrev: new Map(), yoyPrev: new Map(), ytdPrev: new Map() },
        coverage: new Map([[1, TODAY]]), incompleteToday: false }),
    };
    const json = JSON.stringify(buildBoardDocDefinition({ model: suspectModel, meta, config: DEFAULT_EXPORT_CONFIG }).content);
    expect(json).toContain("G/L Belum terverifikasi");
    expect(json).toContain("— · Belum terverifikasi"); // ranking G/L cell
    expect(json).not.toMatch(/bukan kerugian|artefak|PERLU PERIKSA/i);
    expect(json).not.toMatch(/73,17|6\.000 L/);
  });

  it("A4 LANSKAP + footer 'Halaman X dari Y' natif", () => {
    const doc = buildBoardDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    expect(doc.pageSize).toBe("A4");
    expect(doc.pageOrientation).toBe("landscape");
    const footer = (doc.footer as (p: number, c: number) => Content)(2, 2);
    expect(JSON.stringify(footer)).toContain("Halaman 2 dari 2");
  });

  it("semua tabel: header berulang + tak memecah baris; hanya unit ber-scope", () => {
    const doc = buildBoardDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    const tables = collectTables(doc.content);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect(t.table.headerRows).toBe(1);
      expect(t.table.dontBreakRows).toBe(true);
    }
    const json = JSON.stringify(doc.content);
    expect(json).toContain("RINGKASAN DIREKSI");
    expect(json).toContain("Imam Bonjol");
  });

  it("header tabel ber-fill navy tercetak putih (bukan teks default hitam)", () => {
    const doc = buildBoardDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    expect(doc.styles?.th).toMatchObject({ color: PDF.onNavy, bold: true });
    const tables = collectTables(doc.content);
    expect(tables).toHaveLength(3); // evaluasi, ranking, anomali
    for (const t of tables) {
      expect(t.layout).toBe(ledgerLayout);
      for (const cell of t.table.body[0]!) expect(cell).toMatchObject({ style: "th" });
    }
  });

  it("judul seksi berpasangan dengan tabelnya agar tak yatim di dasar halaman", () => {
    const doc = buildBoardDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    expect(doc.pageBreakBefore).toBeTypeOf("function");
    expect(doc.pageBreakBefore!.length).toBe(4); // pdfmake hanya mengisi daftar next/previous bila > 2
    const content = doc.content as unknown as Record<string, unknown>[];
    const headings = content.filter((c) => c.headlineLevel === 1);
    expect(headings.map((h) => h.text)).toEqual(["Evaluasi per cabang", "Ranking 1 unit", "Anomali & Exception"]);
    for (const h of headings) {
      const body = content.find((c) => c.id === `${h.id}-body`);
      expect(body && "table" in body, `${h.text} paired with its table`).toBe(true);
      // Baris badan pertama membawa penanda yang dicek pageBreakBefore.
      expect(JSON.stringify(body), String(h.text)).toContain(`"id":"${h.id}-row"`);
    }
  });

  it("PARITAS FILTER: unit terpilih, periode, dan mode aktif tercetak", () => {
    const doc = buildBoardDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    const json = JSON.stringify(doc.content);
    expect(json).toContain("Semua unit (1)");
    expect(json).toContain("1 Jul 2026");
    expect(json).toContain("Kumulatif");
  });

  it("PARITAS MODEL: evaluasi MoM/YoY/YTD & label jendela ikut tercetak", () => {
    const doc = buildBoardDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    const json = JSON.stringify(doc.content);
    expect(json).toContain("Evaluasi per cabang");
    expect(json).toContain("MoM");
    expect(json).toContain("YoY");
    expect(json).toContain("YTD");
    expect(json).toContain(evalM.labels.yoy.replace(/[▲▼]/g, "")); // label jendela
    // NPSO gasoil hadir di ranking (kolom baru)
    expect(json).toContain("NPSO gasoil");
  });

  it("tren = canvas polyline vektor, di antara KPI dan evaluasi", () => {
    const doc = buildBoardDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    const content = doc.content as unknown[];
    const idxOf = (needle: string) => content.findIndex((c) => JSON.stringify(c).includes(needle));
    const trenIdx = idxOf("Tren omset");
    const evalIdx = idxOf("Evaluasi per cabang");
    const sparkIdx = content.findIndex(
      (c) => JSON.stringify(c).includes("polyline") && !JSON.stringify(c).includes("Halaman"),
    );
    expect(trenIdx).toBeGreaterThanOrEqual(0);
    expect(sparkIdx).toBeGreaterThan(trenIdx);
    expect(evalIdx).toBeGreaterThan(sparkIdx);
  });

  it("label PT dari meta.ptLabel — string kop/info/header identik dgn legacy utk PT Sola Petra Abadi", () => {
    // Regresi multi-tenant: viewer PT Sola Petra Abadi harus mendapat output
    // byte-identik dgn hardcode lama; PT lain (AS) mendapat PT-nya sendiri.
    const doc = buildBoardDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    expect(JSON.stringify(doc.content)).toContain("PT Sola Petra Abadi — Ringkasan Direksi");
    expect(doc.info?.title).toBe("Ringkasan Direksi — PT Sola Petra Abadi — 1 Jul 2026 – 16 Jul 2026");
    expect(doc.info?.subject).toBe("Ringkasan Direksi (board) PT Sola Petra Abadi");
    const header = (doc.header as (p: number) => Content)(2);
    expect(JSON.stringify(header)).toContain("Ringkasan Direksi · PT Sola Petra Abadi");

    const docAs = buildBoardDocDefinition({
      model,
      meta: { ...meta, ptLabel: "PT Sola Adis Raya" },
      config: DEFAULT_EXPORT_CONFIG,
    });
    expect(JSON.stringify(docAs.content)).toContain("PT Sola Adis Raya — Ringkasan Direksi");
    expect(JSON.stringify(docAs.content)).not.toContain("PT Sola Petra Abadi");
    expect(docAs.info?.title).toContain("PT Sola Adis Raya");
  });

  it("prints incomplete G/L warnings without a partial liter subtotal or ratio", () => {
    const partialCore = buildBoardCore({
      units: [IB], period: PERIOD, mode: "banding", today: TODAY,
      dailySales: SALES,
      glRange: new Map([[1, [glRow(-2)]]]), // same day, missing Pertamax
      shift: new Map([[1, { shifts: 3, last_dtgljam: null }]]), anomalies: [],
    });
    const partialEval = buildBoardEval({
      units: [IB], period: PERIOD, today: TODAY, dailySales: SALES,
      gl: {
        range: new Map([[1, [glRow(-2)]]]),
        momPrev: new Map([[1, [glRow(-1, "2026-06-16")]]]),
        yoyPrev: new Map([[1, [glRow(-1, "2025-07-16")]]]),
        ytdCur: new Map([[1, [glRow(-3)]]]),
        ytdPrev: new Map([[1, [glRow(-1, "2025-07-16")]]]),
      },
      coverage: new Map([[1, "2022-08-31"]]), incompleteToday: false,
    });
    const doc = buildBoardDocDefinition({
      model: { mode: "banding", core: partialCore, eval: partialEval },
      meta, config: DEFAULT_EXPORT_CONFIG,
    });
    const json = JSON.stringify(doc.content);
    expect(json).toContain("G/L belum lengkap");
    expect(json).not.toContain("-2 L");
    expect(json).not.toContain("−2 L");
    expect(json).not.toContain("-0,18%");
    expect(json).not.toContain("−0,18%");
  });

  describe("PDF historis Feb 2024 dengan feed anomali hidup Okt 2026", () => {
    const FEED_NOW = new Date("2026-10-06T03:00:00Z");
    const FEED_TODAY = todayWib(FEED_NOW);
    const FEB = resolveBoardPeriod("custom", { from: "2024-02-01", to: "2024-02-29" }, FEED_NOW);
    const febSales = [{ ...SALES[0]!, d: "2024-02-10" }, { ...SALES[1]!, d: "2024-02-10" }];
    const febMeta: BoardDocMeta = {
      ...meta,
      dateLong: dateLong(FEB.range.to),
      periodLabel: `${dateShort(FEB.range.from)} – ${dateShort(FEB.range.to)}`,
    };
    const docFor = (anomalies: AnomalyItem[]) => {
      const input = { units: [IB], period: FEB, today: FEED_TODAY, dailySales: febSales };
      const m: BoardModel = { mode: "kumulatif",
        core: buildBoardCore({ ...input, mode: "kumulatif", glRange: new Map(),
          shift: new Map([[1, { shifts: 3, last_dtgljam: null }]]), anomalies }),
        eval: buildBoardEval({ ...input,
          gl: { range: new Map(), ytdCur: new Map(), momPrev: new Map(), yoyPrev: new Map(), ytdPrev: new Map() },
          coverage: new Map([[1, "2022-08-31"]]), incompleteToday: false }),
      };
      return buildBoardDocDefinition({ model: m, meta: febMeta, config: DEFAULT_EXPORT_CONFIG });
    };
    const feedText = `${dateShort(addDays(FEED_TODAY, -6))} – ${dateShort(FEED_TODAY)}`;

    it.each([
      { name: "kosong", anomalies: [] as AnomalyItem[] },
      { name: "jarang", anomalies: [{ tone: "warning", tier: "major", sev: 1, dateIso: addDays(FEED_TODAY, -2),
        title: "Uji jarang", unit: "64.781.11", desc: "", time: "" }] as AnomalyItem[] },
    ])("feed $name: rentang tujuh hari sebenarnya tercetak di antara judul Anomali dan tabelnya", ({ anomalies }) => {
      const doc = docFor(anomalies);
      const content = doc.content as unknown as Record<string, unknown>[];
      const h = content.findIndex((c) => c.text === "Anomali & Exception");
      const body = content.findIndex((c) => c.id === `${content[h]!.id}-body`);
      const between = JSON.stringify(content.slice(h + 1, body));
      expect(between).toContain(feedText);
      expect(between).toContain("tidak mengikuti filter periode");
      // Kop tetap menyebut periode laporan; feed tak menyamar sebagai periode itu.
      expect(JSON.stringify(content[0])).toContain("Periode 1 Feb 2024 – 29 Feb 2024");
      expect(between).not.toContain("2024");
    });

    it("target bauran historis disebut bersumber workbook 2026 (kartu KPI & seksi Bauran)", () => {
      const json = JSON.stringify(docFor([]).content);
      expect(json).toContain("target rata-rata periode 10,7% · workbook 2026");
      expect(json).toContain("target rata-rata periode (workbook 2026)");
    });
  });
});
