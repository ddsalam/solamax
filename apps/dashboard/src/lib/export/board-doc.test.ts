import type { Content, ContentTable } from "pdfmake/interfaces";
import { describe, expect, it } from "vitest";
import { DEFAULT_EXPORT_CONFIG } from "./config";
import { buildBoardDocDefinition, type BoardDocMeta } from "./board-doc";
import {
  buildBoardCore,
  buildBoardEval,
  type BoardModel,
  type BoardUnit,
  type SalesGrainRow,
} from "@/lib/board-model";
import type { DailyGlInput } from "@/lib/derive";
import { resolveBoardPeriod } from "@/lib/periods";

const NOW = new Date("2026-07-16T03:00:00Z");
const TODAY = "2026-07-16";
const PERIOD = resolveBoardPeriod("bulan", {}, NOW);
const IB: BoardUnit = { unit_id: 1, code: "6478111", name: "Imam Bonjol" };

const SALES: SalesGrainRow[] = [
  { unit_id: 1, d: "2026-07-10", ckdbbm: "PL", nama: "PERTALITE", vol: 1000, omzet: 10_000_000 },
  { unit_id: 1, d: "2026-07-10", ckdbbm: "PX", nama: "PERTAMAX", vol: 120, omzet: 1_800_000 },
  { unit_id: 1, d: "2026-06-10", ckdbbm: "PL", nama: "PERTALITE", vol: 800, omzet: 8_000_000 },
  { unit_id: 1, d: "2025-07-10", ckdbbm: "PL", nama: "PERTALITE", vol: 500, omzet: 5_000_000 },
];

const glRow = (gl: number): DailyGlInput => ({
  ckdbbm: "PL",
  nama: "PERTALITE",
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
  glRange: new Map([[1, [glRow(-2)]]]),
  shift: new Map([[1, { shifts: 3, last_dtgljam: null }]]),
  anomalies: [],
});

const evalM = buildBoardEval({
  units: [IB],
  period: PERIOD,
  today: TODAY,
  dailySales: SALES,
  gl: {
    range: new Map([[1, [glRow(-2)]]]),
    momPrev: new Map([[1, [glRow(-1)]]]),
    yoyPrev: new Map([[1, [glRow(-1)]]]),
    ytdCur: new Map([[1, [glRow(-3)]]]),
    ytdPrev: new Map([[1, [glRow(-1)]]]),
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
});
