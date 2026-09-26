import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bacaHargaLiter, bacaRupiah, teksTerbaca } from "./angka-input";

const nilai = (h: ReturnType<typeof bacaRupiah>) => (h.keadaan === "sah" ? h.nilai : h.keadaan);

describe("bacaRupiah — yang ambigu DITOLAK, tidak ditebak seratus kali lipat", () => {
  it.each([
    ["1500000", 1_500_000],
    ["1.500.000", 1_500_000],
    ["Rp 1.500.000", 1_500_000],
    ["  328.795.000 ", 328_795_000],
    ["15.000", 15_000],
    // Review #398: bentuk kuitansi Indonesia yang lazim — sen nol.
    ["1.500.000,-", 1_500_000],
    ["1.500.000,00", 1_500_000],
    ["1500000,0", 1_500_000],
    ["IDR 1.500.000", 1_500_000],
  ])("%s → %d", (t, n) => expect(nilai(bacaRupiah(t))).toBe(n));

  it.each(["1.500.000,50", "1500000.5", "1.50", "1,500,000", "1.50.000", "12a", "1.500.000,05"])(
    "🔴 %s DITOLAK (dulu tersimpan diam-diam dengan nilai lain)",
    (t) => expect(bacaRupiah(t).keadaan).toBe("tolak"),
  );

  it("kasus nyata: 1.500.000,50 dulu tersimpan 150.000.050 — kini ditolak DENGAN contoh", () => {
    const h = bacaRupiah("1.500.000,50");
    expect(h.keadaan).toBe("tolak");
    if (h.keadaan === "tolak") expect(h.pesan).toMatch(/tanpa sen.*1\.500\.000/);
  });

  it("minus hanya bila diizinkan (penyesuaian, saldo pembuka)", () => {
    expect(bacaRupiah("-250.000").keadaan).toBe("tolak");
    expect(nilai(bacaRupiah("-250.000", { bolehNegatif: true }))).toBe(-250_000);
    expect(nilai(bacaRupiah("-Rp 250.000", { bolehNegatif: true }))).toBe(-250_000);
  });

  it("kosong bukan nol", () => expect(bacaRupiah("  ").keadaan).toBe("kosong"));
});

describe("bacaHargaLiter — koma desimal, titik ribuan", () => {
  it.each([
    ["19582,51", 19_582.51],
    ["19.582,51", 19_582.51],
    ["19582", 19_582],
    ["19.582", 19_582],
    ["6557,6612", 6_557.6612],
  ])("%s → %d", (t, n) => expect(nilai(bacaHargaLiter(t))).toBeCloseTo(n, 6));

  it("🔴 19582.51 DITOLAK dengan saran '19582,51' (dulu tersimpan 1.958.251)", () => {
    const h = bacaHargaLiter("19582.51");
    expect(h.keadaan).toBe("tolak");
    if (h.keadaan === "tolak") expect(h.pesan).toContain("19582,51");
  });

  it.each(["19,582,51", "19582,123456", "abc"])("%s ditolak", (t) =>
    expect(bacaHargaLiter(t).keadaan).toBe("tolak"),
  );
});

describe("pratinjau menyebut angka YANG AKAN TERSIMPAN", () => {
  it("rupiah & per liter", () => {
    expect(teksTerbaca(bacaRupiah("1.500.000"), "rupiah")).toBe("Terbaca: Rp 1.500.000");
    expect(teksTerbaca(bacaHargaLiter("19.582,51"), "per_liter")).toBe("Terbaca: Rp 19.582,51 per liter");
  });
});

describe("penjaga — tak ada formulir keuangan yang membaca angka sendiri lagi", () => {
  // Penjaga menemukan himpunannya sendiri: SETIAP komponen keuangan.
  const dir = resolve(__dirname, "../components/keuangan");
  const berkas = readdirSync(dir).filter((f) => f.endsWith(".tsx"));

  it("subjeknya ada", () => expect(berkas.length).toBeGreaterThanOrEqual(10));

  for (const f of berkas) {
    it(`${f}: tidak membuang tanda baca dari angka ketikan`, () => {
      const s = readFileSync(join(dir, f), "utf8");
      expect(s).not.toMatch(/replace\(\/\[\^\\d/);
    });
  }
});
