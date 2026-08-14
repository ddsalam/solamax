import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canManageAccess } from "./admin-rules";
import type { Role } from "./auth-context";
import {
  canCloseException,
  canInputKeuangan,
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

  it("tangga peran persis lima, tanpa head_of_finance", () => {
    // Penjaga struktural terhadap "perbaikan" yang paling mungkin diusulkan
    // orang berikutnya. Menaruh HoF di tangga ini merusak SALAH SATU dari dua
    // hal, tergantung posisinya: cakupan data Direksi, atau wewenang HoF.
    //
    // 📌 Penjaga ini BERBUNYI saat peran `keuangan` ditambahkan (0032, 15 Agu
    // 2026) — memang itu tugasnya. Yang berubah adalah daftarnya, BUKAN
    // aturannya: `head_of_finance` tetap terlarang di sini, dan alasannya utuh
    // (pemegang HoF punya peran lain yang akan tercabut; pemegang `keuangan`
    // tidak). Memperbarui daftar tanpa memperbarui larangan = melumpuhkan
    // penjaga sambil merasa sudah memeliharanya.
    expect(scopeRule).not.toMatch(/head_of_finance/);
    const rank = scopeRule.match(/ROLE_RANK[\s\S]*?\{([\s\S]*?)\}/)?.[1] ?? "";
    const entri = [...rank.matchAll(/^\s*(\w+):\s*\d+,/gm)].map((m) => m[1]);
    expect(entri).toEqual(["pengawas", "keuangan", "direksi", "admin_perusahaan", "super_admin"]);
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

describe("canInputKeuangan — gerbang tulis Layar 3 (peran `keuangan`, 0032)", () => {
  const c = (role: Role, email: string | null = null) => ({ role, email });

  it("peran `keuangan` boleh; `super_admin` boleh", () => {
    expect(canInputKeuangan(c("keuangan"))).toBe(true);
    expect(canInputKeuangan(c("super_admin"))).toBe(true);
  });

  it("🔴 PENGAWAS TIDAK BOLEH — ini inti §2", () => {
    // Pengawas memiliki FAKTA transaksi; Finance memiliki klasifikasi &
    // penyajian akuntansi. Pengawas yang bisa mengetik harga beli meruntuhkan
    // pemisahan itu tanpa satu pun angka terlihat salah.
    expect(canInputKeuangan(c("pengawas"))).toBe(false);
  });

  it("direksi & admin_perusahaan TIDAK boleh mengetik — wewenang ≠ tangga cakupan data", () => {
    // Inilah yang ditolak saat memilih bentuk gerbang ini: kalau hak tulis
    // keuangan menempel pada tangga peran, setiap direksi di tenant mana pun
    // otomatis boleh mengetik mutasi bank.
    expect(canInputKeuangan(c("direksi"))).toBe(false);
    expect(canInputKeuangan(c("admin_perusahaan"))).toBe(false);
  });

  it("🔴 Head of Finance TIDAK mendapat hak tulis dari kapabilitasnya", () => {
    // Mengisi buku bukan mengesahkan selisih. HoF menyetujui penutupan (§3.2);
    // memberinya hak tulis membuat penyetuju memeriksa pekerjaannya sendiri.
    const hof = "hof@solagroup.co";
    expect(isHeadOfFinance(hof, [hof])).toBe(true);
    expect(canInputKeuangan(c("admin_perusahaan", hof))).toBe(false);
    expect(canInputKeuangan(c("direksi", hof))).toBe(false);
  });

  it("🔴 peran `keuangan` TIDAK mendapat wewenang penutupan §3.2", () => {
    // Arah sebaliknya, dan sama pentingnya: yang mengetik tidak menyetujui.
    expect(canCloseException(c("keuangan"), [])).toBe(false);
    expect(canOverrideAboveMax(c("keuangan"))).toBe(false);
  });

  it("`keuangan` tidak membuka /admin", () => {
    expect(canManageAccess({ userId: 1, role: "keuangan", tenantIds: ["t"] })).toBe(false);
  });

  it("dua predikat, bukan satu — daftar perannya memang berbeda", () => {
    // Kalau kelak seseorang menulis canInputKeuangan sebagai turunan
    // canCloseException, baris ini merah: keduanya HARUS berselisih.
    const semua: Role[] = ["pengawas", "keuangan", "direksi", "admin_perusahaan", "super_admin"];
    const tulis = semua.filter((r) => canInputKeuangan(c(r)));
    const tutup = semua.filter((r) => canCloseException(c(r), []));
    expect(tulis).not.toEqual(tutup);
    expect(tulis).toEqual(["keuangan", "super_admin"]);
    expect(tutup).toEqual(["direksi", "super_admin"]);
  });
});
