import type { Content, ContentTable } from "pdfmake/interfaces";
import { describe, expect, it } from "vitest";
import { DEFAULT_EXPORT_CONFIG } from "./config";
import { buildBoardDocDefinition, type BoardDocMeta } from "./board-doc";
import { buildBoardModel, type PerUnitAgg } from "@/lib/board-model";

const perUnit: PerUnitAgg[] = [
  {
    u: { code: "6478111", name: "Imam Bonjol" },
    products: [{ ckdbbm: "P1", nama: "Pertalite", vol: 1000 }],
    totals: { vol: 1000, omzet: 20_000_000 },
    prevTotals: { omzet: 18_000_000 },
    glPct: 0.001,
    glAbnormal: false,
    glProvisional: false,
    gas: { kind: "gasoline", actual: 0.3, target: 0.35, deltaPt: -5, below: true },
    oil: { kind: "gasoil", actual: 0.2, target: 0.2, deltaPt: 0, below: false },
    shift: { shifts: 3, last_dtgljam: null },
    daily: [{ d: "2026-07-02", omzet: 20_000_000 }],
  },
];

const model = buildBoardModel(
  { perUnit, anomalies: [] },
  { firstUnitCode: "6478111", month: 7, today: "2026-07-02" },
);

const meta: BoardDocMeta = {
  dateLong: "Rabu, 2 Juli 2026",
  periodLabel: "Hari ini",
  unitsCount: 1,
  generatedLabel: "2 Jul 2026 · 22.09",
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

describe("buildBoardDocDefinition", () => {
  it("A4 LANSKAP + footer 'Halaman X dari Y' natif", () => {
    const doc = buildBoardDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    expect(doc.pageSize).toBe("A4");
    expect(doc.pageOrientation).toBe("landscape");
    const footer = (doc.footer as (p: number, c: number) => Content)(2, 2);
    expect(JSON.stringify(footer)).toContain("Halaman 2 dari 2");
  });

  it("ranking = tabel dengan header berulang + tak memecah baris", () => {
    const doc = buildBoardDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    const tables = collectTables(doc.content);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect(t.table.headerRows).toBe(1);
      expect(t.table.dontBreakRows).toBe(true);
    }
    const json = JSON.stringify(doc.content);
    expect(json).toContain("RINGKASAN DIREKSI");
    expect(json).toContain("Imam Bonjol"); // hanya unit ber-scope
  });

  it("sparkline berada ANTARA heading 'Tren omset grup' dan section 'Bauran' (urutan konten)", () => {
    const doc = buildBoardDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    const content = doc.content as unknown[];
    const idxOf = (needle: string) =>
      content.findIndex((c) => JSON.stringify(c).includes(needle));
    const trenIdx = idxOf("Tren omset grup");
    const bauranIdx = idxOf("Bauran NPSO / PSO");
    // sparkline = item canvas berisi polyline
    const sparkIdx = content.findIndex(
      (c) => JSON.stringify(c).includes("polyline") && !JSON.stringify(c).includes("Halaman"),
    );
    expect(trenIdx).toBeGreaterThanOrEqual(0);
    expect(sparkIdx).toBeGreaterThan(trenIdx);
    expect(bauranIdx).toBeGreaterThan(sparkIdx);
  });

  it("memuat chart vektor (canvas), bukan image", () => {
    const doc = buildBoardDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    const json = JSON.stringify(doc.content);
    expect(json).toContain("polyline"); // sparkline vektor
    expect(json).toContain("ellipse"); // KPI dots vektor
    expect(doc.info?.title).toContain("PT Sola Petra Abadi");
  });
});
