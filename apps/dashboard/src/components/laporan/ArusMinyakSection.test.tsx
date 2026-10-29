/**
 * Synthetic display states for invalid/incomplete source stock. These cases
 * must remain covered without depending on mutable live business records.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArusMinyakSection } from "./ArusMinyakSection";
import { parseArusHtml } from "@/lib/arus-minyak.grade";
import { buildArusMinyak, type ArusMinyak, type ArusRow } from "@/lib/arus-minyak";
import type { DailyGlRow } from "@/lib/queries";

const baris = (o: Partial<ArusRow> = {}): ArusRow => ({
  ckdbbm: "BB-02",
  nama: "PERTAMAX",
  awal: 100,
  penerimaan: 50,
  penjualan: 30,
  tera: 0,
  teori: 120,
  fisik: 118,
  losses: -2,
  pct: -6.67,
  zeroClosing: null,
  artefak: null,
  glMentah: null,
  ...o,
});

const arus = (o: Partial<ArusMinyak> = {}): ArusMinyak => ({
  rows: [baris()],
  total: baris({ nama: "TOTAL", ckdbbm: "" }),
  provisional: false,
  excludedTanks: 0,
  incomplete: false,
  teraTotal: 0,
  zeroClosingCount: 0,
  artefakCount: 0,
  ...o,
});

const html = (a: ArusMinyak) => renderToStaticMarkup(<ArusMinyakSection arus={a} />);

describe("ArusMinyakSection", () => {
  it("8 kolom, TANPA Persediaan (keputusan owner)", () => {
    const h = html(arus());
    for (const k of [
      "Produk", "Stock Awal (L)", "Penerimaan (L)", "Penjualan (L)",
      "Stock Teori (L)", "Stock Fisik (L)", "Losses (L)",
    ])
      expect(h).toContain(k);
    expect(h).not.toContain("Persediaan");
    expect(parseArusHtml(h).get("PERTAMAX")).toHaveLength(7);
  });

  it("provisional → penanda 'belum final'; final → TIDAK ada", () => {
    expect(html(arus({ provisional: true }))).toContain("belum final");
    expect(html(arus({ provisional: false }))).not.toContain("belum final");
  });

  it("excludedTanks > 0 → catatan kaki menyebut jumlahnya; 0 → senyap", () => {
    // Exercise the source-quality warning with an explicit synthetic count.
    const h = html(arus({ excludedTanks: 3 }));
    expect(h).toContain("3 baris dengan stok atau identitas produk/tangki tidak valid");
    expect(html(arus({ excludedTanks: 0 }))).not.toContain("identitas produk/tangki tidak valid");
  });

  it("incomplete → dependent G/L totals unavailable; complete → no incomplete note", () => {
    expect(html(arus({ incomplete: true }))).toContain("total G/L yang bergantung padanya belum tersedia");
    expect(html(arus({ incomplete: false }))).not.toContain("total G/L yang bergantung padanya belum tersedia");
  });

  it("tanpa baris → empty state bermakna, TANPA baris TOTAL palsu", () => {
    const h = html(arus({ rows: [] }));
    expect(h).toContain("Belum ada opname penutup");
    expect(parseArusHtml(h).has("TOTAL")).toBe(false);
  });

  it("sel null tercetak '—', bukan 0 atau NaN", () => {
    const h = html(
      arus({ rows: [baris({ awal: null, teori: null, fisik: null, losses: null, pct: null })] }),
    );
    const sel = parseArusHtml(h).get("PERTAMAX")!;
    expect(sel[0]).toBeNull();
    expect(sel[6]).toBeNull();
    expect(h).not.toContain("NaN");
  });

  it("Losses −0,000001 tercetak 0,00 — bukan '-0,00' yang terbaca sebagai rugi", () => {
    const h = html(arus({ rows: [baris({ losses: -1e-6, pct: -1e-9 })] }));
    expect(h).not.toContain("-0,00");
    expect(parseArusHtml(h).get("PERTAMAX")![5]).toBe(0);
  });

  it("warna: Losses negatif t-danger, positif t-success", () => {
    expect(html(arus({ rows: [baris({ losses: -2 })] }))).toContain("t-danger");
    expect(html(arus({ rows: [baris({ losses: 2 })] }))).toContain("t-success");
  });
});

describe("ArusMinyakSection source-quality propagation", () => {
  const source = (overrides: Partial<DailyGlRow> = {}): DailyGlRow => ({
    d: "2026-06-11", ckdbbm: "P", nama: "SINTETIS P", fisik_prev: 100,
    pen_do: 50, sales_gross: 30, tera: 0, fisik: 120, gl: 0,
    movement_invalid: false, excluded_tanks: 0, provisional: false, ...overrides,
  });
  const healthy = source({ ckdbbm: "Q", nama: "SINTETIS Q", fisik_prev: 200, fisik: 220 });

  it("keeps invalid-movement subtotals diagnostic and withholds theory without inventing an opname-zero warning", () => {
    const a = buildArusMinyak([source({ fisik_prev: 2_000, fisik: 0, gl: null,
      movement_invalid: true, provisional: true }), healthy]);
    const h = html(a), cells = parseArusHtml(h);
    expect(cells.get("SINTETIS P")).toEqual([2_000, 50, 30, null, 0, null, null]);
    expect(cells.get("SINTETIS Q")).toEqual([200, 50, 30, 220, 220, 0, 0]);
    expect(cells.get("TOTAL")).toEqual([2_200, 100, 60, null, 220, null, null]);
    expect(h).toContain("belum final");
    expect(h).not.toContain("zc-note");
    expect(h).not.toMatch(/NaN|undefined/);
  });

  it("retains complete theory when only current physical stock is unavailable and withholds partial physical TOTAL", () => {
    const cells = parseArusHtml(html(buildArusMinyak([
      source({ fisik: null, gl: null, excluded_tanks: 1, provisional: true }), healthy,
    ])));
    expect(cells.get("SINTETIS P")).toEqual([100, 50, 30, 120, null, null, null]);
    expect(cells.get("TOTAL")).toEqual([300, 100, 60, 340, null, null, null]);
  });

  it("withholds partial beginning/theory totals while preserving independently measured physical stock", () => {
    const cells = parseArusHtml(html(buildArusMinyak([
      source({ fisik_prev: null, gl: null, provisional: true }), healthy,
    ])));
    expect(cells.get("TOTAL")).toEqual([null, 100, 60, null, 340, null, null]);
  });

  it("keeps a measured zero visible beside an unknown product while withholding stock totals", () => {
    const zero = source({ fisik_prev: 0, fisik: 0, pen_do: 0, sales_gross: 0 });
    const cells = parseArusHtml(html(buildArusMinyak([zero, source({ ckdbbm: null,
      nama: null, fisik_prev: null, fisik: null, gl: null, movement_invalid: true, provisional: true })])));
    expect(cells.get("SINTETIS P")).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(cells.get("Produk tidak diketahui")?.slice(3)).toEqual([null, null, null, null]);
    expect(cells.get("TOTAL")).toEqual([null, 50, 30, null, null, null, null]);
  });

  it.each([
    { reason: "jangkar_nol" as const, row: { fisik_prev: 0, fisik: 3_000, gl_raw: 3_030 } },
    { reason: "penutup_nol" as const, row: { fisik_prev: 6_000, sales_gross: 30, fisik: 0, gl_raw: -5_970 } },
  ])("renders a $reason artefact with raw stock, '—' Losses/% and an audit note", ({ reason, row }) => {
    const a = buildArusMinyak([source({ pen_do: 0, ...row, gl: null, gl_suspect: reason, provisional: true }), healthy]);
    const h = html(a), cells = parseArusHtml(h);
    const p = cells.get("SINTETIS P")!;
    expect(p[4]).toBe(row.fisik);       // raw physical stays visible
    expect(p.slice(5)).toEqual([null, null]);
    expect(cells.get("TOTAL")!.slice(5)).toEqual([null, null]);
    expect(h).toContain("perlu periksa");
    expect(h).toContain("BUKAN kerugian");
    expect(h).toContain("mentah");
    expect(h).not.toMatch(/NaN|undefined|sengaja tidak dikoreksi/);
  });

  it("empty source data has an explicit empty state and no invented TOTAL", () => {
    const a = buildArusMinyak([]), h = html(a);
    expect(a.total).toMatchObject({ awal: null, teori: null, fisik: null, losses: null, pct: null });
    expect(h).toContain("Belum ada opname penutup");
    expect(parseArusHtml(h).size).toBe(0);
  });
});
