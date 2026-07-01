import type { Content, ContentTable } from "pdfmake/interfaces";
import { describe, expect, it } from "vitest";
import { DEFAULT_EXPORT_CONFIG } from "./config";
import { buildRincianDocDefinition, type RincianDocMeta } from "./rincian-doc";
import type { RincianModel } from "@/lib/rincian-model";

const meta: RincianDocMeta = {
  unitDotted: "64.781.11",
  unitName: "Imam Bonjol",
  address: "Jl. Imam Bonjol",
  pt: "PT Sola Petra Abadi",
  dateLong: "Kamis, 11 Juni 2026",
  generatedLabel: "1 Jul 2026 · 09.14",
};

const model: RincianModel = {
  sections: [
    {
      num: "1",
      title: "OMSET PENJUALAN",
      meta: "per produk",
      rows: [{ no: "1", ket: "Pertalite", vol: "1.000,00", rpv: "Rp 10.000.000" }],
      totalLabel: "TOTAL OMSET PENJUALAN",
      totalVol: "1.000,00",
      totalRp: "Rp 10.000.000",
    },
    {
      num: "5",
      title: "PENDAPATAN LAIN",
      meta: "input pengawas",
      rows: [],
      totalLabel: "TOTAL PENDAPATAN LAIN",
      totalVol: "",
      totalRp: "Rp 0",
    },
  ],
  summary: [
    { l: "A", label: "Omset Penjualan", val: "Rp 10.000.000" },
    { l: "E", label: "Penjualan Tunai", formula: "E = A − (B + C + D)", val: "Rp 9.000.000", em: true },
  ],
};

/** Kumpulkan semua node tabel (punya properti `table`) secara rekursif. */
function collectTables(node: unknown, out: ContentTable[] = []): ContentTable[] {
  if (Array.isArray(node)) {
    for (const n of node) collectTables(n, out);
  } else if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if ("table" in obj) out.push(obj as unknown as ContentTable);
    for (const k of Object.keys(obj)) collectTables(obj[k], out);
  }
  return out;
}

describe("buildRincianDocDefinition", () => {
  it("mengunci A4 potret (Prinsip 4)", () => {
    const doc = buildRincianDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    expect(doc.pageSize).toBe("A4");
    expect(doc.pageOrientation).toBe("portrait");
  });

  it("footer memberi 'Halaman X dari Y' natif (Prinsip 6)", () => {
    const doc = buildRincianDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    expect(typeof doc.footer).toBe("function");
    const rendered = (doc.footer as (p: number, c: number) => Content)(2, 5);
    expect(JSON.stringify(rendered)).toContain("Halaman 2 dari 5");
  });

  it("running header hanya pada halaman ke-2+ (Prinsip 6)", () => {
    const doc = buildRincianDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    const header = doc.header as (p: number, c: number, s: unknown) => Content | undefined;
    expect(header(1, 3, {})).toBeUndefined();
    expect(header(2, 3, {})).toBeDefined();
  });

  it("setiap tabel ledger mengulang header + tak memecah baris (Prinsip 7)", () => {
    const doc = buildRincianDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    const tables = collectTables(doc.content);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect(t.table.headerRows).toBe(1);
      expect(t.table.dontBreakRows).toBe(true);
    }
  });

  it("judul kolom memuat satuan (Prinsip 7)", () => {
    const doc = buildRincianDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    const json = JSON.stringify(doc.content);
    expect(json).toContain("Volume (L)");
    expect(json).toContain("Nilai (Rp)");
  });

  it("default hideEmpty menyembunyikan section kosong; false menampilkannya", () => {
    const on = buildRincianDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    expect(JSON.stringify(on.content)).not.toContain("PENDAPATAN LAIN");
    const off = buildRincianDocDefinition({
      model,
      meta,
      config: { ...DEFAULT_EXPORT_CONFIG, hideEmpty: false },
    });
    expect(JSON.stringify(off.content)).toContain("PENDAPATAN LAIN");
  });

  it("toggle section & tanda tangan dihormati", () => {
    const noSig = buildRincianDocDefinition({
      model,
      meta,
      config: { ...DEFAULT_EXPORT_CONFIG, includeSignature: false },
    });
    expect(JSON.stringify(noSig.content)).not.toContain("Pengawas SPBU");

    const noSec1 = buildRincianDocDefinition({
      model,
      meta,
      config: { ...DEFAULT_EXPORT_CONFIG, sections: { "1": false } },
    });
    expect(JSON.stringify(noSec1.content)).not.toContain("OMSET PENJUALAN");
  });

  it("mensanitasi glyph tak didukung Roboto di jalur PDF; pertahankan · dan −", () => {
    const glyphModel: RincianModel = {
      sections: [
        {
          num: "3",
          title: "PELANGGAN",
          meta: "penjualan tempo (RFID/deposit ⊎ voucher)",
          rows: [{ no: "1", ket: "MDU-RFID IB", vol: "", rpv: "Rp 1" }],
          totalLabel: "TOTAL PELANGGAN",
          totalVol: "",
          totalRp: "Rp 1",
        },
        {
          num: "4",
          title: "EDC",
          meta: "channel non-tunai · ⚠ blank-card Rp 10 (2 txn, di luar total)",
          rows: [{ no: "1", ket: "BRI", vol: "", rpv: "Rp 2" }],
          totalLabel: "TOTAL EDC",
          totalVol: "",
          totalRp: "Rp 2",
        },
      ],
      summary: [
        {
          l: "H",
          label: "Uang Tunai",
          formula: "H = E + F − G",
          val: "Rp 3",
          em: true,
        },
        {
          l: "I",
          label: "Setoran Tunai",
          val: "Rp 3",
          em: true,
          note: { tone: "ok", text: "Setoran menutup uang tunai (I ≥ H)" },
        },
      ],
    };
    const doc = buildRincianDocDefinition({
      model: glyphModel,
      meta,
      config: { ...DEFAULT_EXPORT_CONFIG, hideEmpty: false },
    });
    const json = JSON.stringify(doc.content);
    for (const g of ["⊎", "⚠", "✓", "✗", "→"]) expect(json).not.toContain(g);
    expect(json).toContain("RFID/deposit + voucher");
    expect(json).toContain("! blank-card");
    // Glyph terbukti ADA di Roboto → TIDAK diganti (setia ke layar):
    expect(json).toContain("(I ≥ H)"); // ≥ dipertahankan
    expect(json).toContain("·"); // middot
    expect(json).toContain("−"); // minus rp()/formula
  });

  it("metadata dokumen tak membocorkan PII (hanya unit + tanggal)", () => {
    const doc = buildRincianDocDefinition({ model, meta, config: DEFAULT_EXPORT_CONFIG });
    expect(doc.info?.title).toContain("64.781.11");
    expect(doc.info?.author).toBe("SolaMax");
  });
});
