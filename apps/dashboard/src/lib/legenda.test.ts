import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Legenda papan Ketaatan memberi label TINGKAT, bukan SEBAB.
 *
 * Dibaca dari sumber halamannya — halaman itu Server Component dan tak bisa
 * di-import, jadi tes yang "meniru" legendanya akan menguji salinan. Idiom yang
 * sama dengan penjaga sumber di laporan-model.test.ts & db-budget.test.ts.
 */
const HALAMAN = readFileSync(
  join(__dirname, "..", "app", "(app)", "monitoring", "ketaatan", "page.tsx"),
  "utf8",
);

/** Kode vonis yang SEMUANYA dirender merah — dari sumber compliance.ts. */
const KODE_MERAH = ["setoran_tersalin", "kurang_setor", "setoran_kosong", "belum_diisi", "config_hilang"];

describe("legenda papan Ketaatan — label TINGKAT, bukan SEBAB", () => {
  it("berkas halamannya terbaca (anti-vakum)", () => {
    expect(HALAMAN).toContain("LEGENDA_NADA");
    expect(HALAMAN.length).toBeGreaterThan(2000);
  });

  /** Potongan legenda saja — bukan seluruh halaman. */
  const blok = () => {
    const a = HALAMAN.indexOf("const LEGENDA_NADA");
    const b = HALAMAN.indexOf("const LEGENDA_NETRAL");
    expect(a, "blok LEGENDA_NADA tak ditemukan").toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    return HALAMAN.slice(a, b);
  };

  it("label 'kosong' TIDAK dipakai untuk nada merah", () => {
    // Kata itulah akar temuannya: ia menamai SATU dari lima sebab, dan pembaca
    // legenda membacanya sebagai satu-satunya.
    expect(blok().toLowerCase()).not.toContain("kosong");
  });

  it("tiap nada punya label, dan labelnya menyatakan tingkat", () => {
    const b = blok();
    for (const nada of ["success", "warning", "danger"]) {
      expect(b, `nada ${nada} tak punya entri legenda`).toContain(`${nada}:`);
    }
    expect(b).toContain("perlu tindakan");
  });

  it("halaman menyatakan eksplisit bahwa warna = tingkat, bukan sebab", () => {
    expect(HALAMAN).toContain("TINGKAT, bukan sebab");
  });

  it("KONTROL: kelima kode merah memang ada di pembuat vonis", () => {
    // Tanpa ini, klaim "lima sebab satu warna" cuma kalimat di komentar.
    const sumber = readFileSync(join(__dirname, "compliance.ts"), "utf8");
    for (const k of KODE_MERAH) expect(sumber, `kode ${k} hilang`).toContain(`"${k}"`);
  });
});
