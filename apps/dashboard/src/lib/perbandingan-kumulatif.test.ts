import { describe, expect, it } from "vitest";
import { buildPerbandingan, perbandinganRanges, type PkTable } from "./perbandingan-kumulatif";
import type { DailySalesRow } from "./queries";

const KB = { unitId: 4, code: "6478106", name: "Bundaran Kotabaru" };
const IB = { unitId: 1, code: "6478111", name: "Imam Bonjol" };

const sale = (unit_id: number, d: string, nama: string | null, vol: number, ckdbbm: string | null = null): DailySalesRow => ({
  unit_id,
  d,
  nama,
  ckdbbm,
  vol,
  omzet: 0,
});

const rowOf = (t: PkTable, key: string) =>
  key === "JML_ALL" ? t.total : t.groups.flatMap((g) => g.rows).find((r) => r.key === key)!;

describe("perbandinganRanges", () => {
  it("bulan ini 1..D, bulan lalu 1..D", () => {
    expect(perbandinganRanges("2026-10-25")).toEqual({
      cur: { from: "2026-10-01", to: "2026-10-25", lastDay: 25 },
      prev: { from: "2026-09-01", to: "2026-09-25", lastDay: 25 },
    });
  });

  it("tanggal tak ada di bulan lalu → tanggal terakhir bulan lalu (31 Okt vs 30 Sep)", () => {
    expect(perbandinganRanges("2026-10-31").prev).toEqual({ from: "2026-09-01", to: "2026-09-30", lastDay: 30 });
  });

  it("Maret vs Februari, kabisat dan bukan", () => {
    expect(perbandinganRanges("2027-03-30").prev.to).toBe("2027-02-28");
    expect(perbandinganRanges("2028-03-30").prev.to).toBe("2028-02-29");
  });

  it("Januari vs Desember tahun lalu", () => {
    expect(perbandinganRanges("2027-01-15").prev).toEqual({ from: "2026-12-01", to: "2026-12-15", lastDay: 15 });
  });
});

describe("buildPerbandingan", () => {
  const rows: DailySalesRow[] = [
    // bulan ini (Okt 1–3)
    sale(4, "2026-10-01", "BIO SOLAR", 1000),
    sale(4, "2026-10-02", "BIO SOLAR", 1000),
    sale(4, "2026-10-01", "DEXLITE", 300),
    sale(4, "2026-10-01", "PERTAMINA DEX", 200),
    sale(4, "2026-10-03", "PERTALITE", 4000),
    sale(4, "2026-10-03", "PERTAMAX", 400),
    sale(4, "2026-10-03", "PERTAMAX TURBO", 100),
    sale(1, "2026-10-02", "SOLAR", 500),
    // bulan lalu (Sep 1–3)
    sale(4, "2026-09-02", "BIO SOLAR", 2500),
    sale(4, "2026-09-02", "DEXLITE", 500),
    sale(4, "2026-09-03", "PERTALITE", 4000),
    // di luar rentang → diabaikan
    sale(4, "2026-10-04", "BIO SOLAR", 99999),
    sale(4, "2026-09-04", "BIO SOLAR", 99999),
    sale(4, "2026-08-02", "BIO SOLAR", 99999),
    // unit di luar filter → diabaikan
    sale(9, "2026-10-01", "BIO SOLAR", 99999),
    // produk lain (PLK) → tidak masuk JML, dilaporkan terpisah
    sale(4, "2026-10-02", "PLK", 70),
  ];
  const { ranges, tables } = buildPerbandingan(rows, [IB, KB], "2026-10-03");
  const [all, ib, kb] = tables;

  it("ALL dulu lalu unit sesuai urutan masukan", () => {
    expect(tables.map((t) => t.code)).toEqual(["ALL", "6478111", "6478106"]);
    expect(all!.unitId).toBeNull();
    expect(ranges.prev.to).toBe("2026-09-03");
  });

  it("volume, D+D, JML, porsi thd BioSolar/Pertalite", () => {
    expect(rowOf(kb!, "BS").cur).toBe(2000);
    expect(rowOf(kb!, "DD").cur).toBe(500);
    expect(rowOf(kb!, "JML_SOLAR").cur).toBe(2500);
    expect(rowOf(kb!, "PTX_TURBO").cur).toBe(500);
    expect(rowOf(kb!, "JML_BENSIN").cur).toBe(4500);
    expect(rowOf(kb!, "JML_ALL").cur).toBe(7000);
    expect(rowOf(kb!, "BS").curShare).toBe(1);
    expect(rowOf(kb!, "DL").curShare).toBeCloseTo(0.15);
    expect(rowOf(kb!, "DD").curShare).toBeCloseTo(0.25);
    expect(rowOf(kb!, "PTX").curShare).toBeCloseTo(0.1);
    expect(rowOf(kb!, "JML_SOLAR").curShare).toBeNull();
  });

  it("delta dan delta %", () => {
    expect(rowOf(kb!, "BS").delta).toBe(-500);
    expect(rowOf(kb!, "BS").deltaPct).toBeCloseTo(-0.2);
    expect(rowOf(kb!, "DL").deltaPct).toBeCloseTo(-0.4);
    expect(rowOf(kb!, "JML_ALL").prev).toBe(7000);
    expect(rowOf(kb!, "JML_ALL").deltaPct).toBe(0);
  });

  it("penyebut 0 → porsi null; bulan lalu 0 → delta % null", () => {
    expect(rowOf(kb!, "DEX").deltaPct).toBeNull();
    expect(rowOf(ib!, "PL").curShare).toBeNull();
    expect(rowOf(ib!, "PTX").curShare).toBeNull();
    expect(rowOf(ib!, "BS").prevShare).toBeNull();
  });

  it("jumlah unit = ALL untuk setiap baris dan periode", () => {
    const keys = ["BS", "DL", "DEX", "DD", "JML_SOLAR", "PL", "PTX", "TURBO", "PTX_TURBO", "JML_BENSIN", "JML_ALL"];
    for (const k of keys) {
      expect(rowOf(all!, k).cur).toBe(rowOf(ib!, k).cur + rowOf(kb!, k).cur);
      expect(rowOf(all!, k).prev).toBe(rowOf(ib!, k).prev + rowOf(kb!, k).prev);
    }
  });

  it("produk lain tidak masuk JML ALL tetapi dilaporkan", () => {
    expect(kb!.otherCur).toBe(70);
    expect(all!.otherCur).toBe(70);
    expect(ib!.otherCur).toBe(0);
  });

  it("nama kosong memakai kode produk (ckdbbm) lewat normalisasi", () => {
    const t = buildPerbandingan([sale(4, "2026-10-01", null, 10, "SOLAR")], [KB], "2026-10-01").tables[1]!;
    expect(rowOf(t, "BS").cur + t.otherCur).toBe(10);
  });

  it("unit tanpa penjualan → semua 0, tidak error", () => {
    const t = buildPerbandingan([], [KB], "2026-10-31").tables[1]!;
    expect(rowOf(t, "JML_ALL")).toMatchObject({ cur: 0, prev: 0, delta: 0, deltaPct: null, curShare: null });
  });
});

// Synthetic rendering regressions: never connect to a live database.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PerbandinganKumulatif } from "@/components/harian/HarianSections";
import { buildHarianModel, type HarianInput } from "./harian-model";
import { buildHarianDocDefinition } from "./export/harian-doc";
import type { ScopedUnitId } from "./scope-rule";

const incompleteInput: HarianInput = {
  units: [{ unit_id: 101 as ScopedUnitId, code: "TEST101", name: "DATA PALSU A" }],
  date: "2026-10-31", dailySales: [], gl: new Map(), coverage: [], sync: [],
};
const flatText = (node: unknown): string => {
  if (Array.isArray(node)) return node.map(flatText).join(" ");
  if (node && typeof node === "object") return Object.entries(node).filter(([key]) => ["text", "content", "stack", "columns", "table", "body"].includes(key)).map(([,v]) => flatText(v)).join(" ");
  return typeof node === "string" ? node : "";
};
const pdfOf = (input: HarianInput) => buildHarianDocDefinition({ model: buildHarianModel(input), meta: {ptLabel:"DATA PALSU",dateLong:"31 Oktober 2026",unitsCount:input.units.length,divisor:31,generatedLabel:"DATA PALSU",freshnessLabel:"DATA PALSU"} });

it("marks ALL incomplete when a selected unit has never synced, on screen and PDF", () => {
  const model=buildHarianModel(incompleteInput);
  const html=renderToStaticMarkup(createElement(PerbandinganKumulatif,{units:model.units,model}));
  expect(html).toMatch(/ALL[^<]*SEMUA SPBU[\s\S]*?ada unit belum lengkap/);
  expect(flatText(pdfOf(incompleteInput))).toMatch(/ALL · SEMUA SPBU\s+[!⚠] ada unit belum lengkap/);
});
it("shows em dash for zero-denominator product shares but leaves subtotal shares empty", () => {
  const model=buildHarianModel(incompleteInput);
  const html=renderToStaticMarkup(createElement(PerbandinganKumulatif,{units:model.units,model}));
  const firstRow=html.slice(html.indexOf("BS · BioSolar"),html.indexOf("DL · Dexlite"));
  expect(firstRow.match(/>—<\/span>/g)).toHaveLength(3); // two shares + delta percentage
  const text=flatText(pdfOf(incompleteInput));
  expect(text).toMatch(/BS · BioSolar\s+0\s+—\s+0\s+—/);
});
it("keeps at most two unit tables on each PDF comparison page", () => {
  const units=Array.from({length:5},(_,i)=>({unit_id:(101+i) as ScopedUnitId,code:`TEST${i}`,name:`DATA PALSU ${i}`}));
  const content=pdfOf({...incompleteInput,units}).content as unknown as Array<{pageBreak?:string;stack?:unknown[]}>;
  expect(content.find(n=>flatText(n) === "Perbandingan Penjualan Kumulatif")?.pageBreak).toBe("before");
  const pages=content.filter(n=>n.pageBreak === "before" && n.stack);
  expect(pages).toHaveLength(3);
  expect(pages.map(p=>p.stack!.filter(n=>flatText(n).includes("Produk")).length)).toEqual([2,2,1]);
});
