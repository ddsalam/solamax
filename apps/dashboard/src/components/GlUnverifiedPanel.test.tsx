import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GlUnverifiedPanel } from "./GlUnverifiedPanel";
import { collectGlMissing, glUnverifiedItem, type GlVerifyInput } from "@/lib/gl-verification";

const zero: GlVerifyInput = {
  d: "2026-10-02", ckdbbm: "P", nama: "SOLAR", fisik_prev: 6_000, fisik: 0, pen_do: 0,
  sales_gross: 1_000, tera: 0, gl: null, gl_raw: -5_000, gl_suspect: "penutup_nol",
  movement_invalid: false, excluded_tanks: 0, provisional: true, tanks: ["T-01"], prev_date: "2026-10-01",
};

describe("GlUnverifiedPanel", () => {
  it("renders nothing without withheld G/L", () => {
    expect(renderToStaticMarkup(<GlUnverifiedPanel items={[]} hint="x" />)).toBe("");
  });

  it("shows label, unit/date/product/tank, specific reason, labelled raw audit and steps", () => {
    const item = glUnverifiedItem(zero, { code: "6478111", name: "Imam Bonjol" })!;
    const h = renderToStaticMarkup(<GlUnverifiedPanel items={[item]} hint="periode uji" withUnit />);
    for (const k of ["G/L Belum terverifikasi", "Belum terverifikasi", "Imam Bonjol", "2 Okt 2026", "SOLAR", "T-01",
      "Penutup opname seluruh tangki produk tercatat 0 L", "Hitungan mentah — Belum terverifikasi",
      "= -5.000,00 L", "Cara memverifikasi", "dokumen pengiriman", "Volume REAL penerimaan saja tidak cukup"])
      expect(h).toContain(k);
    expect(h).not.toMatch(/bukan kerugian|artefak/i);
    expect(h).not.toMatch(/NaN|undefined/);
  });

  it("R1 missing closing: sold volume from sales, tank and raw audit explicitly unavailable, steps for running/closed day", () => {
    const [item] = collectGlMissing([], [{ d: "2026-10-02", ckdbbm: "Q", nama: "PERTAMAX", vol: 4_100 }],
      { code: "6478111", name: "Imam Bonjol" });
    const h = renderToStaticMarkup(<GlUnverifiedPanel items={[item!]} hint="periode uji" withUnit />);
    for (const k of ["G/L Belum terverifikasi", "Imam Bonjol", "2 Okt 2026", "PERTAMAX", "tidak tersedia di sumber",
      "Terjual 4.100,00 L, tetapi belum ada penutup opname", "tidak tersedia (komponen tidak lengkap)",
      "Penutup opname belum ada", "masih berjalan", "sudah ditutup", "Volume REAL penerimaan saja tidak cukup"])
      expect(h).toContain(k);
    expect(h).not.toMatch(/Fisik .* − Teori|terverifikasi sah|tersertifikasi sah|bukan kerugian|artefak/i);
    expect(h).not.toMatch(/NaN|undefined/);
  });
});
