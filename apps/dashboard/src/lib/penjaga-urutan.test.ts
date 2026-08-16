import { describe, expect, it } from "vitest";
import { mendahului, urutan } from "./penjaga-urutan";

/**
 * Uji atas PENAWAR-nya sendiri. Tanpa berkas ini, penawar untuk "penjaga yang
 * hijau karena subjeknya lenyap" bisa saja punya cacat yang sama.
 */
describe("mendahului — urutan hanya berarti bila keduanya ADA", () => {
  const teks = "gerbang();\nlalu pool.connect();";

  it("urutan benar ⇒ ok", () => {
    expect(urutan(teks, "gerbang()", "pool.connect()")).toBe("ok");
  });

  it("🔴 AWAL HILANG ⇒ GAGAL — inilah cacat yang ditawar", () => {
    // `indexOf` mengembalikan -1, dan -1 < indeks apa pun. Bentuk lama
    // (`expect(a).toBeLessThan(b)`) LULUS di sini — penjaga yang jadi lebih
    // "benar" setelah yang dijaganya dihapus.
    const tanpaGerbang = "lalu pool.connect();";
    expect(-1).toBeLessThan(tanpaGerbang.indexOf("pool.connect()")); // bentuk LAMA: lulus
    const h = mendahului(tanpaGerbang, "gerbang()", "pool.connect()");
    expect(h.ok).toBe(false);
    expect(h.ok === false && h.sebab).toBe("awal_hilang");
  });

  it("akhir hilang ⇒ gagal, dengan sebab yang berbeda", () => {
    const h = mendahului("gerbang();", "gerbang()", "pool.connect()");
    expect(h.ok === false && h.sebab).toBe("akhir_hilang");
  });

  it("terbalik ⇒ gagal, dan sebabnya dibedakan dari 'hilang'", () => {
    // "Gerbangnya hilang" dan "gerbangnya kesorean" menuntut perbaikan berbeda.
    const h = mendahului("pool.connect();\nlalu gerbang();", "gerbang()", "pool.connect()");
    expect(h.ok === false && h.sebab).toBe("terbalik");
  });

  it("posisi sama (string identik) dihitung TIDAK mendahului", () => {
    expect(mendahului("x", "x", "x").ok).toBe(false);
  });
});
