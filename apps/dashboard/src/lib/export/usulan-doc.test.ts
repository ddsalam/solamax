import type { Content, ContentTable } from "pdfmake/interfaces";
import { describe, expect, it } from "vitest";
import { DEFAULT_EXPORT_CONFIG } from "./config";
import { buildUsulanDocDefinition, type UsulanDocMeta } from "./usulan-doc";
import type { UsulanModel } from "@/lib/usulan-model";

const meta: UsulanDocMeta = {
  unitDotted: "64.781.11",
  unitName: "Imam Bonjol",
  dateLong: "Kamis, 11 Juni 2026",
  prevDateLong: "Rabu, 10 Juni 2026",
  statusLabel: "Diajukan ke Keuangan",
  generatedLabel: "1 Jul 2026 · 09.14",
};

const model: UsulanModel = {
  rows: [
    {
      key: "pertalite",
      label: "Pertalite",
      sisaStock: 12000,
      sisaStockProvisional: false,
      ketahanan: 1.2,
      ketahananLevel: "danger",
      sisaDo: 8000,
      penerimaanHari: 5000,
      permintaanBesok: 16000,
      usulanPenebusan: 16000,
    },
    {
      key: "solar",
      label: "Solar",
      sisaStock: null,
      sisaStockProvisional: true,
      ketahanan: null,
      ketahananLevel: "unknown",
      sisaDo: 0,
      penerimaanHari: 0,
      permintaanBesok: 0,
      usulanPenebusan: 0,
    },
  ],
  totals: {
    sisaStock: 12000,
    sisaDo: 8000,
    penerimaanHari: 5000,
    permintaanBesok: 16000,
    usulanPenebusan: 16000,
  },
  status: "diajukan",
  anyProvisional: true,
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

describe("buildUsulanDocDefinition", () => {
  it("A4 potret + footer 'Halaman X dari Y' natif", () => {
    const doc = buildUsulanDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    expect(doc.pageSize).toBe("A4");
    expect(doc.pageOrientation).toBe("portrait");
    const footer = (doc.footer as (p: number, c: number) => Content)(2, 3);
    expect(JSON.stringify(footer)).toContain("Halaman 2 dari 3");
  });

  it("tabel: header berulang + tak memecah baris; satuan KL di judul kolom", () => {
    const doc = buildUsulanDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    const tables = collectTables(doc.content);
    expect(tables.length).toBe(1);
    expect(tables[0]!.table.headerRows).toBe(1);
    expect(tables[0]!.table.dontBreakRows).toBe(true);
    const json = JSON.stringify(doc.content);
    expect(json).toContain("Sisa Stock awal (KL)");
    expect(json).toContain("Usulan Penebusan (KL)");
    expect(json).toContain("Penerimaan Hari (KL)");
  });

  it("nilai KL 3-desimal id-ID + TOTAL provisional 'sebagian'", () => {
    const doc = buildUsulanDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    const json = JSON.stringify(doc.content);
    expect(json).toContain("16,000 KL"); // usulan Pertalite (16000 L → 16 KL, 3dp)
    expect(json).toContain("— sementara"); // Solar provisional
    expect(json).toContain("(sebagian)"); // TOTAL provisional marker
  });

  it("toggle tanda tangan; metadata tanpa PII", () => {
    const withSig = buildUsulanDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    expect(JSON.stringify(withSig.content)).toContain("Pengawas SPBU");
    const noSig = buildUsulanDocDefinition({
      model,
      meta,
      config: { ...DEFAULT_EXPORT_CONFIG, includeSignature: false },
    });
    expect(JSON.stringify(noSig.content)).not.toContain("Pengawas SPBU");
    expect(withSig.info?.title).toContain("64.781.11");
    expect(withSig.info?.author).toBe("SolaMax");
  });
});
