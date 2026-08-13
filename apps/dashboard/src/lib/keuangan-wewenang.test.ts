import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canCloseException,
  canOverrideAboveMax,
  isHeadOfFinance,
  type WewenangCtx,
} from "./keuangan-wewenang";

const HOF = ["ddsalam@solagroup.co"];
const ctx = (over: Partial<WewenangCtx> = {}): WewenangCtx => ({
  role: "pengawas",
  email: "orang@solagroup.co",
  ...over,
});

describe("isHeadOfFinance — fail-closed", () => {
  it("cocok apa adanya", () => {
    expect(isHeadOfFinance("ddsalam@solagroup.co", HOF)).toBe(true);
  });

  it("tidak peka huruf besar/kecil dan spasi pinggir", () => {
    expect(isHeadOfFinance("  DDSalam@SolaGroup.CO ", HOF)).toBe(true);
  });

  it("email lain bukan HoF", () => {
    expect(isHeadOfFinance("lain@solagroup.co", HOF)).toBe(false);
  });

  it("null / kosong / spasi ⇒ false", () => {
    for (const e of [null, undefined, "", "   "]) {
      expect(isHeadOfFinance(e, HOF), String(e)).toBe(false);
    }
  });

  it("daftar KOSONG ⇒ tak seorang pun HoF (env belum dipasang = fail-closed)", () => {
    // Kalau baris ini pernah merah, env yang lupa diisi berubah jadi wewenang
    // penutupan-di-luar-toleransi untuk siapa saja.
    expect(isHeadOfFinance("ddsalam@solagroup.co", [])).toBe(false);
  });
});

describe("canCloseException — kapabilitas, BUKAN peran", () => {
  it("direksi boleh", () => {
    expect(canCloseException(ctx({ role: "direksi" }), HOF)).toBe(true);
  });

  it("super_admin boleh", () => {
    expect(canCloseException(ctx({ role: "super_admin" }), HOF)).toBe(true);
  });

  it("pengawas tidak boleh", () => {
    expect(canCloseException(ctx({ role: "pengawas" }), HOF)).toBe(false);
  });

  it("admin_perusahaan SAJA tidak boleh — mengelola akses ≠ wewenang keuangan", () => {
    expect(canCloseException(ctx({ role: "admin_perusahaan", email: "lain@x.co" }), HOF)).toBe(
      false,
    );
  });

  it("HoF boleh MESKI perannya admin_perusahaan — inilah kasus nyatanya", () => {
    // ddsalam@solagroup.co = app.users id 15, peran admin_perusahaan.
    // Kalau baris ini merah, HoF telah diperlakukan sebagai peran lagi.
    expect(
      canCloseException({ role: "admin_perusahaan", email: "ddsalam@solagroup.co" }, HOF),
    ).toBe(true);
  });

  it("HoF boleh meski perannya pengawas — kapabilitas berdiri sendiri", () => {
    expect(canCloseException({ role: "pengawas", email: "ddsalam@solagroup.co" }, HOF)).toBe(true);
  });

  it("Direksi mewarisi wewenang HoF tanpa perlu ada di daftar", () => {
    expect(canCloseException({ role: "direksi", email: "bukan-hof@x.co" }, [])).toBe(true);
  });

  it("daftar HoF kosong ⇒ hanya direksi/super_admin yang lolos", () => {
    expect(canCloseException(ctx({ role: "admin_perusahaan" }), [])).toBe(false);
    expect(canCloseException(ctx({ role: "direksi" }), [])).toBe(true);
  });
});

describe("ROLE_RANK tidak boleh disentuh", () => {
  const scopeRule = readFileSync(resolve(__dirname, "scope-rule.ts"), "utf8");

  it("tangga peran tetap empat, tanpa head_of_finance", () => {
    // Penjaga struktural terhadap "perbaikan" yang paling mungkin diusulkan
    // orang berikutnya. Menaruh HoF di tangga ini merusak SALAH SATU dari dua
    // hal, tergantung posisinya: cakupan data Direksi, atau wewenang HoF.
    expect(scopeRule).not.toMatch(/head_of_finance/);
    const rank = scopeRule.match(/ROLE_RANK[\s\S]*?\{([\s\S]*?)\}/)?.[1] ?? "";
    const entri = [...rank.matchAll(/^\s*(\w+):\s*\d+,/gm)].map((m) => m[1]);
    expect(entri).toEqual(["pengawas", "direksi", "admin_perusahaan", "super_admin"]);
  });

  it("modul wewenang keuangan tidak MEMAKAI ROLE_RANK (menyebutnya boleh)", () => {
    // Bedakan menyebut dari memakai: modul ini memang MENJELASKAN kenapa
    // ROLE_RANK tak boleh disentuh, dan penjelasan itu justru harus ada.
    // Yang dilarang adalah kodenya bersandar padanya.
    const src = readFileSync(resolve(__dirname, "keuangan-wewenang.ts"), "utf8");
    const kode = src
      .split("\n")
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    expect(kode).not.toMatch(/ROLE_RANK/);
    expect(kode).not.toMatch(/from "\.\/scope-rule"/);
    // …dan penjelasannya memang ada (jangan hijau karena modulnya kosong).
    expect(src).toMatch(/ROLE_RANK/);
  });

  it("peringatan 'jangan pakai canCloseException utk tingkat 3' tetap ada", () => {
    const src = readFileSync(resolve(__dirname, "keuangan-wewenang.ts"), "utf8");
    expect(src).toMatch(/JANGAN memakai `?canCloseException`?/);
  });
});

describe("canOverrideAboveMax — tingkat ketiga, BERDIRI SENDIRI", () => {
  it("direksi & super_admin boleh (keputusan owner 13 Agu 2026)", () => {
    expect(canOverrideAboveMax({ role: "direksi", email: null })).toBe(true);
    expect(canOverrideAboveMax({ role: "super_admin", email: null })).toBe(true);
  });

  it("🔴 HoF TIDAK boleh — satu-satunya suku yang membedakan dua tingkat", () => {
    expect(canOverrideAboveMax({ role: "admin_perusahaan", email: "ddsalam@solagroup.co" })).toBe(
      false,
    );
    // …sementara pada tingkat kedua ia BOLEH. Pasangan pernyataan inilah yang
    // menjaga tangganya: menyatukan dua predikat memerahkan salah satunya.
    expect(canCloseException({ role: "admin_perusahaan", email: "ddsalam@solagroup.co" }, HOF)).toBe(
      true,
    );
  });

  it("pengawas & admin_perusahaan biasa tidak boleh", () => {
    expect(canOverrideAboveMax({ role: "pengawas", email: "x@y.co" })).toBe(false);
    expect(canOverrideAboveMax({ role: "admin_perusahaan", email: "x@y.co" })).toBe(false);
  });

  it("TIDAK bersandar pada canCloseException — dua predikat, bukan turunan", () => {
    // Kalau tingkat ketiga ditulis sebagai `canCloseException(...) && ...`,
    // perubahan pada tingkat kedua akan merembes ke tingkat ketiga diam-diam.
    const src = readFileSync(resolve(__dirname, "keuangan-wewenang.ts"), "utf8");
    const badan = src.slice(src.indexOf("export function canOverrideAboveMax"));
    expect(badan).not.toMatch(/canCloseException\s*\(/);
    expect(badan).not.toMatch(/isHeadOfFinance\s*\(/);
  });
});
