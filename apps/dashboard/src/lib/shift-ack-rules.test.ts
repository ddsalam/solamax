import { describe, expect, it } from "vitest";
import { bacaDaftarPeristiwa, MAKS_PERISTIWA_SEKALI_AKUI } from "./shift-ack-rules";

const G = "00000000-0000-4000-8000-00000000000a";
const daftar = (n: number) =>
  JSON.stringify(Array.from({ length: n }, (_, i) => ({ d: "2026-08-31", g: G })));

describe("aturan pengakuan per-koreksi", () => {
  it("membaca daftar yang sah apa adanya", () => {
    expect(bacaDaftarPeristiwa(daftar(3))).toHaveLength(3);
    expect(bacaDaftarPeristiwa(daftar(1))[0]).toEqual({ d: "2026-08-31", g: G });
  });

  // 🔴 INI LARANGANNYA. Tidak ada bentuk yang berarti "semua".
  it("MENOLAK daftar kosong — jalur setujui-semua tidak pernah dibuat", () => {
    for (const kosong of ["[]", "", "null", "{}", "undefined"]) {
      expect(() => bacaDaftarPeristiwa(kosong)).toThrow();
    }
  });

  it("menolak muatan yang tidak bisa diurai", () => {
    expect(() => bacaDaftarPeristiwa("bukan json")).toThrow("tidak valid");
  });

  it("berbatas — muatan yang dipalsukan tidak bisa jadi jejak ribuan baris", () => {
    expect(() => bacaDaftarPeristiwa(daftar(MAKS_PERISTIWA_SEKALI_AKUI + 1)))
      .toThrow(String(MAKS_PERISTIWA_SEKALI_AKUI));
    // Batasnya sendiri masih lolos — pemeriksa yang tak bisa HIJAU sama tak
    // bergunanya dengan yang tak bisa MERAH.
    expect(bacaDaftarPeristiwa(daftar(MAKS_PERISTIWA_SEKALI_AKUI)))
      .toHaveLength(MAKS_PERISTIWA_SEKALI_AKUI);
  });

  it("menolak tanggal dan generasi yang bentuknya salah", () => {
    expect(() => bacaDaftarPeristiwa(JSON.stringify([{ d: "31-08-2026", g: G }])))
      .toThrow("as_of_date");
    expect(() => bacaDaftarPeristiwa(JSON.stringify([{ d: "2026-08-31", g: "bukan-uuid" }])))
      .toThrow("generation_id");
    expect(() => bacaDaftarPeristiwa(JSON.stringify([{ d: "2026-08-31" }])))
      .toThrow("generation_id");
  });

  it("batasnya cukup untuk koreksi terbesar yang pernah terjadi", () => {
    // cut 424 menyentuh 8 tanggal; cut 206 menyentuh 7. Kalau batas ini pernah
    // diturunkan sampai di bawah itu, koreksi nyata jadi tak bisa diakui.
    expect(MAKS_PERISTIWA_SEKALI_AKUI).toBeGreaterThan(8);
  });
});
