import { describe, expect, it } from "vitest";
import { isNegative, rp, rpParen } from "./format";

describe("rp() — tanda mata uang", () => {
  it("positif: 'Rp …'", () => {
    expect(rp(5000)).toBe("Rp 5.000");
    expect(rp(1234567)).toBe("Rp 1.234.567");
  });

  it("NEGATIF: '−Rp …' (jangan jatuhkan tanda — Summary H bisa sah negatif)", () => {
    expect(rp(-5000)).toBe("−Rp 5.000");
    expect(rp(-169000)).toBe("−Rp 169.000");
  });

  it("nol: 'Rp 0' (tanpa minus)", () => {
    expect(rp(0)).toBe("Rp 0");
    expect(rp(-0)).toBe("Rp 0");
  });

  it("pembulatan: −0,4 → Rp 0; −0,6 → −Rp 1", () => {
    expect(rp(-0.4)).toBe("Rp 0");
    expect(rp(-0.6)).toBe("−Rp 1");
  });
});

/**
 * TANDA saldo Hutang — bug produksi 2026-08-06.
 *
 * Layar & PDF memakai `danger ? '(' + rp(abs(v)) + ')' : rp(v)` — `Math.abs()`
 * TANPA syarat — sehingga saldo Hutang 28 Oktober yang **positif**
 * (+123.526.169) tercetak `(Rp 123.526.169)`, tak terbedakan dari saldo Imam
 * Bonjol yang benar-benar **negatif** (−751.284.145). Dua posisi ekonomi
 * berlawanan, satu tampilan identik — dan salah satunya bertanda BERBEDA dari
 * EasyMax, tepat di baris yang direkonsiliasi pengawas.
 *
 * Nilai TERSIMPAN-nya sudah benar (diverifikasi di DB pilot); yang salah murni
 * lapis tampilan. Angka di bawah adalah nilai asli kedua unit, 2026-08-04.
 */
describe("rpParen — kurung ditentukan TANDA, bukan flag baris", () => {
  it("POSITIF tampil apa adanya, TANPA kurung (28 Oktober)", () => {
    expect(rpParen(123_526_169)).toBe("Rp 123.526.169");
    expect(rpParen(140_919_652)).toBe("Rp 140.919.652");
  });

  it("NEGATIF tampil dalam kurung (Imam Bonjol)", () => {
    expect(rpParen(-751_284_145)).toBe("(Rp 751.284.145)");
    expect(rpParen(-734_439_355)).toBe("(Rp 734.439.355)");
  });

  it("dua unit dgn tanda berlawanan HARUS terbedakan", () => {
    // Inilah assertion yang gagal pada bug lama: keduanya menghasilkan string sama.
    expect(rpParen(123_526_169)).not.toBe(rpParen(-123_526_169));
  });

  it("nol tanpa kurung, dan −0 dinormalkan", () => {
    expect(rpParen(0)).toBe("Rp 0");
    expect(rpParen(-0)).toBe("Rp 0");
    expect(rpParen(-0.4)).toBe("Rp 0"); // membulat ke 0 → bukan negatif
  });

  it("isNegative mengikuti nilai yang SUDAH dibulatkan", () => {
    expect(isNegative(-751_284_145)).toBe(true);
    expect(isNegative(123_526_169)).toBe(false);
    expect(isNegative(0)).toBe(false);
    expect(isNegative(-0.4)).toBe(false); // −0,4 → 0, bukan merah
    expect(isNegative(-0.6)).toBe(true);
  });
});
