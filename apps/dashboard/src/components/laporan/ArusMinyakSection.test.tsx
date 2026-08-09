/**
 * Keadaan-keadaan TAMPILAN yang tidak terwakili di data live 2026.
 *
 * Sapuan DB (2026, 7 unit) menunjukkan **nol** hari dengan baris opname di luar
 * batas wajar, jadi jalur `excludedTanks` tidak pernah tersentuh oleh pemeriksaan
 * mata mana pun. Sama halnya baris tanpa opname (`incomplete`). Kalau tidak
 * dikunci di sini, keduanya adalah kode yang tak pernah dilihat siapa pun sampai
 * hari ia benar-benar dibutuhkan.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArusMinyakSection } from "./ArusMinyakSection";
import { parseArusHtml } from "@/lib/arus-minyak.grade";
import type { ArusMinyak, ArusRow } from "@/lib/arus-minyak";

const baris = (o: Partial<ArusRow> = {}): ArusRow => ({
  ckdbbm: "BB-02",
  nama: "PERTAMAX",
  awal: 100,
  penerimaan: 50,
  penjualan: 30,
  teori: 120,
  fisik: 118,
  losses: -2,
  pct: -6.67,
  ...o,
});

const arus = (o: Partial<ArusMinyak> = {}): ArusMinyak => ({
  rows: [baris()],
  total: baris({ nama: "TOTAL", ckdbbm: "" }),
  provisional: false,
  excludedTanks: 0,
  incomplete: false,
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
    // Jalur ini TIDAK muncul di data 2026 mana pun (sapuan 7 unit) — hanya di sini ia terlihat.
    const h = html(arus({ excludedTanks: 3 }));
    expect(h).toContain("3 baris tangki di luar batas wajar");
    expect(html(arus({ excludedTanks: 0 }))).not.toContain("di luar batas wajar");
  });

  it("incomplete → catatan '—' tidak ikut TOTAL; lengkap → senyap", () => {
    expect(html(arus({ incomplete: true }))).toContain("tidak ikut TOTAL");
    expect(html(arus({ incomplete: false }))).not.toContain("tidak ikut TOTAL");
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
