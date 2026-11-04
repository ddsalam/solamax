/**
 * Approved uncertainty policy (owner, 2026-10-06 17:13 UTC): uncertain G/L is labelled
 * exactly "Belum terverifikasi", withheld from totals/percentages/alarms, shown
 * with a labelled raw audit and evidence-based verification steps. Synthetic
 * rows only — no live business data.
 */
import { describe, expect, it } from "vitest";
import {
  collectGlMissing,
  GL_UNVERIFIED,
  GL_UNVERIFIED_LIMIT,
  GL_VERIFY_CAVEATS,
  GL_VERIFY_STEPS,
  glAuditText,
  glReasonText,
  glTankText,
  glUnverifiedItem,
  glUnverifiedPanel,
  glUnverifiedReason,
  type GlVerifyInput,
} from "./gl-verification";

const row = (o: Partial<GlVerifyInput> = {}): GlVerifyInput => ({
  d: "2026-10-02", ckdbbm: "P", nama: "SOLAR", fisik_prev: 10_000, fisik: 9_000,
  pen_do: 0, sales_gross: 1_000, tera: 0, gl: 0, gl_raw: 0, gl_suspect: null,
  movement_invalid: false, excluded_tanks: 0, provisional: false, ...o,
});
// Whole-product zero closing with Teori 6.000 − 1.000 = 5.000 L (SQL verdict).
const zero = row({ fisik_prev: 6_000, fisik: 0, gl: null, gl_raw: -5_000, gl_suspect: "penutup_nol",
  provisional: true, tanks: ["A", "B"], tanks_prev: ["A", "B"], prev_date: "2026-10-01" });

describe("label", () => {
  it("is exactly the approved wording", () => {
    expect(GL_UNVERIFIED).toBe("Belum terverifikasi");
  });
});

describe("glUnverifiedReason — only rows the canonical rule already withholds", () => {
  it.each([
    ["measured zero G/L", row()],
    ["genuine physical zero with small theory (legit empty)", row({ fisik_prev: 900, fisik: 0, sales_gross: 900, gl: 0 })],
    ["partial-tank zero inside a nonzero product (pending policy, stays measured)", row({ fisik: 3_800, gl: -5_200, gl_raw: -5_200 })],
    ["negative theory (stays measured)", row({ fisik_prev: 100, fisik: 50, sales_gross: 2_000, gl: 1_950, gl_raw: 1_950 })],
    ["provisional but computed", row({ gl: -12, provisional: true })],
  ])("%s → computed, never labelled (and never called verified)", (_n, r) => {
    expect(glUnverifiedReason(r)).toBeNull();
    expect(glUnverifiedItem(r)).toBeNull();
  });

  it.each([
    ["penutup_nol", zero],
    ["jangkar_nol", row({ fisik_prev: 0, gl: null, gl_raw: 8_000, gl_suspect: "jangkar_nol", prior_teori: 9_000 })],
    ["produk_tak_dikenal", row({ ckdbbm: " ", gl: null })],
    ["tangki_tak_valid", row({ fisik: null, gl: null, excluded_tanks: 1, tanks_invalid: ["B", null] })],
    ["mutasi_tak_valid", row({ gl: null, movement_invalid: true })],
    ["stok_awal_tak_ada", row({ fisik_prev: null, gl: null })],
    ["tangki_berubah", row({ gl: null, tanks: ["A", "B"], tanks_prev: ["A"] })],
    ["tak_terhitung", row({ gl: Number.NaN })],
  ] as const)("%s", (reason, r) => {
    expect(glUnverifiedReason(r)).toBe(reason);
  });

  it("legacy row without SQL verdict uses the existing fallback; absent Stock Awal field is not 'missing'", () => {
    expect(glUnverifiedReason(row({ fisik_prev: 6_000, fisik: 0, gl: -5_000, gl_raw: undefined, gl_suspect: undefined })))
      .toBe("penutup_nol");
    const { fisik_prev: _omit, ...noAnchorField } = row({ gl: null });
    expect(glUnverifiedReason(noAnchorField as GlVerifyInput)).toBe("tak_terhitung");
  });
});

describe("glUnverifiedItem — grounded in the row's own source values", () => {
  it("penutup_nol: tanks from the closing, specific reason, and raw audit = same formula as SQL", () => {
    const it = glUnverifiedItem(zero, { code: "6478111", name: "Imam Bonjol" })!;
    expect(it).toMatchObject({ unit: { code: "6478111", name: "Imam Bonjol" }, d: "2026-10-02",
      produk: "SOLAR", reason: "penutup_nol", tangki: ["A", "B"], prevDate: "2026-10-01" });
    // T = prev physical + nominal DO − (gross sales − official tera); raw = F − T from SQL.
    expect(it.audit).toEqual({ awal: 6_000, penerimaan: 0, penjualanKotor: 1_000, tera: 0,
      teori: 5_000, fisik: 0, mentah: -5_000 });
    expect(glReasonText(it)).toContain("5.000,00 L");
    expect(glAuditText(it.audit)).toBe(
      "Fisik 0,00 − Teori 5.000,00 = -5.000,00 L (Teori = Awal 6.000,00 + DO nominal 0,00 − (jual kotor 1.000,00 − tera resmi 0,00))");
  });

  it("official tera reduces net sales in the audit formula", () => {
    const it = glUnverifiedItem({ ...zero, sales_gross: 1_200, tera: 200 })!;
    expect(it.audit).toMatchObject({ penjualanKotor: 1_200, tera: 200, teori: 5_000 });
  });

  it("jangkar_nol names the prior zero closing and its own Stock Teori", () => {
    const it = glUnverifiedItem(row({ fisik_prev: 0, fisik: 8_000, sales_gross: 0, gl: null, gl_raw: 8_000,
      gl_suspect: "jangkar_nol", prev_date: "2026-10-01", prior_teori: 9_000, tanks: ["A"] }))!;
    expect(glReasonText(it)).toBe("Stock Awal 0 L berasal dari penutup 1 Okt 2026 yang tercatat 0 L, padahal Stock Teori penutup itu 9.000,00 L.");
    expect(it.audit).toMatchObject({ awal: 0, teori: 0, fisik: 8_000, mentah: 8_000 });
  });

  it("never invents a tank: missing metadata says so explicitly", () => {
    const it = glUnverifiedItem({ ...zero, tanks: undefined })!;
    expect(it.tangki).toBeNull();
    expect(glTankText(it)).toBe("tidak tersedia di sumber");
  });

  it("guard-rejected tanks are the ones named; a blank code is called out, not guessed", () => {
    const it = glUnverifiedItem(row({ fisik: null, gl: null, excluded_tanks: 2, tanks: ["A", "B", ""], tanks_invalid: ["B", ""] }))!;
    expect(it.tangki).toEqual(["B", "tanpa kode tangki"]);
  });

  it("structural reasons carry no raw audit (no number is fabricated)", () => {
    for (const r of [row({ gl: null, movement_invalid: true }), row({ fisik_prev: null, gl: null }),
      row({ fisik: null, gl: null, excluded_tanks: 1 }), row({ ckdbbm: null, gl: null })]) {
      expect(glUnverifiedItem(r)!.audit).toBeNull();
    }
  });

  it("unknown product keeps an explicit label", () => {
    expect(glUnverifiedItem(row({ ckdbbm: null, nama: "SOLAR", gl: null }))!.produk).toBe("Produk tidak diketahui");
  });
});

describe("collectGlMissing — R1: known product sold on a date with NO G/L row", () => {
  const unit = { code: "6478111", name: "Imam Bonjol" };
  const sale = (ckdbbm: string | null, vol: number, d = "2026-10-02", nama: string | null = "PERTAMAX") =>
    ({ d, ckdbbm, nama, vol });

  it("names date/product/sold volume from sales only; tank, stock and raw audit stay unavailable", () => {
    const items = collectGlMissing([row({ d: "2026-10-01", ckdbbm: "Q" })],
      [sale("Q", 300), sale("Q", 200), sale("Q", 100, "2026-10-01")], unit);
    expect(items).toEqual([{ unit, d: "2026-10-02", ckdbbm: "Q", produk: "PERTAMAX", reason: "penutup_tak_ada",
      tangki: null, prevDate: null, priorTeori: null, audit: null, terjual: 500 }]);
    const it = items[0]!;
    expect(glReasonText(it)).toBe(
      "Terjual 500,00 L, tetapi belum ada penutup opname produk ini untuk tanggal itu di data sumber — G/L hari itu tidak dapat dihitung.");
    expect(glTankText(it)).toBe("tidak tersedia di sumber");
    expect(glAuditText(it.audit)).toBeNull();
  });

  it("side by side: a valid known 0 and an already-withheld row are not duplicated as missing", () => {
    const rows = [row({ ckdbbm: " P ", gl: 0, gl_raw: 0 }), row({ ckdbbm: "Q", gl: null, movement_invalid: true })];
    expect(collectGlMissing(rows, [sale("P", 1_000), sale("Q", 4_100)])).toEqual([]);
    expect(glUnverifiedReason(rows[0]!)).toBeNull(); // the measured 0 stays known
  });

  it("does not broaden coverage: zero-volume sales and unknown-product sales are not relabelled", () => {
    expect(collectGlMissing([], [sale("P", 0), sale(null, 700), sale("  ", 700)])).toEqual([]);
  });

  it("falls back to the product code when the sales name is blank", () => {
    expect(collectGlMissing([], [sale("P", 10, "2026-10-02", " ")])[0]!.produk).toBe("P");
  });
});

describe("panel model", () => {
  it("newest first, capped, with every present reason's steps", () => {
    const items = Array.from({ length: GL_UNVERIFIED_LIMIT + 3 }, (_, i) =>
      glUnverifiedItem({ ...zero, d: `2026-10-${String(i + 1).padStart(2, "0")}` })!);
    items.push(glUnverifiedItem(row({ d: "2026-09-01", gl: null, movement_invalid: true }))!);
    const p = glUnverifiedPanel(items);
    expect(p.total).toBe(GL_UNVERIFIED_LIMIT + 4);
    expect(p.shown).toHaveLength(GL_UNVERIFIED_LIMIT);
    expect(p.hidden).toBe(4);
    expect(p.shown[0]!.d).toBe(`2026-10-${String(GL_UNVERIFIED_LIMIT + 3).padStart(2, "0")}`);
    expect(p.reasons).toEqual(["penutup_nol", "mutasi_tak_valid"]);
  });
});

describe("guidance wording — evidence-based, no categorical claims", () => {
  const all = [GL_VERIFY_CAVEATS, ...Object.values(GL_VERIFY_STEPS).flatMap((s) => [s.judul, ...s.langkah])].join(" ");

  it("never claims artefact / not-a-loss / not-real-stock, nor a certified outcome", () => {
    expect(all).not.toMatch(/artefak|bukan kerugian|bukan stok nyata|sudah terverifikasi|tersertifikasi sah/i);
  });

  it("states the approved limits: REAL alone, source correction alone, genuine physical zero", () => {
    expect(GL_VERIFY_CAVEATS).toContain("Volume REAL penerimaan saja tidak cukup sebagai verifikasi");
    expect(GL_VERIFY_CAVEATS).toContain("ralat sumber atau hilangnya penanda saja tidak membuat angka tersertifikasi");
    expect(GL_VERIFY_CAVEATS).toContain("Stok fisik 0 yang memang benar (tangki kosong) bukan otomatis salah input");
    expect(GL_VERIFY_CAVEATS).toContain("belum menunjukkan rugi maupun untung");
  });

  it("zero-pattern steps check physical closing, prior opening, nominal DO + documents, gross sales + official tera, then correct & recheck", () => {
    const s = GL_VERIFY_STEPS.penutup_nol.langkah.join(" ");
    for (const k of ["catatan fisik", "penutup sebelumnya", "DO nominal", "dokumen pengiriman",
      "penjualan kotor", "tera resmi", "hari bisnis yang sama", "ralat data di EasyMax", "sinkron ulang", "periksa kembali"])
      expect(s).toContain(k);
    const j = GL_VERIFY_STEPS.jangkar_nol.langkah.join(" ");
    for (const k of ["penutup opname 0 L", "DO nominal", "dokumen pengiriman", "tera resmi", "sinkron ulang"])
      expect(j).toContain(k);
  });

  it("missing-closing steps cover a still-running business day and a closed one, then recheck", () => {
    const s = GL_VERIFY_STEPS.penutup_tak_ada.langkah.join(" ");
    for (const k of ["masih berjalan", "sudah ditutup", "kode produk dan kode tangki", "catatan fisik", "periksa kembali"])
      expect(s).toContain(k);
  });
});
