import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { unitRouteHref, type UnitRouteSegment } from "./unit-route";

/**
 * Penjaga PEMILIH SPBU di rute keuangan.
 *
 * 🔴 KELAS YANG MELAHIRKANNYA (22 Agu 2026, keluhan owner pada hari pertama
 * pemakaian): **nol dari enam** rute keuangan punya pemilih unit, sementara
 * tujuh rute non-keuangan punya. Untuk berpindah SPBU, owner harus pergi ke
 * LAPORAN, menggantinya di sana, lalu kembali — sebab pilihan unit hidup di
 * cookie, dan cookie itu hanya ditulis oleh `UnitDateFilters`.
 *
 * ⚠️ BATAS: penjaga ini memastikan pemilihnya TERPASANG dan URL-nya BENAR. Ia
 * tak bisa membuktikan pemilihnya terlihat baik atau mudah dipakai — itu tetap
 * tinjauan tampilan oleh manusia.
 */
const KEU = resolve(__dirname, "../app/(app)/keuangan");

function halaman(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return halaman(p);
    return e.name === "page.tsx" ? [p] : [];
  });
}

const RUTE = halaman(KEU);

describe("keenam rute keuangan punya pemilih unit/tanggal", () => {
  it("penjaga ini punya SUBJEK — enam rute ditemukan", () => {
    expect(RUTE.length).toBe(6);
  });

  for (const f of RUTE) {
    const nama = f.slice(KEU.length + 1);
    it(`${nama}: memasang UnitDateFilters`, () => {
      // ⛔ Batas kata: tanpa `\s`, mengganti nama komponen jadi
      // `<UnitDateFiltersDilepas` tetap lolos — mutasi X1 membuktikannya hijau.
      expect(readFileSync(f, "utf8"), `${nama} tanpa pemilih`).toMatch(/<UnitDateFilters\s/);
    });
  }

  it("🔴 papan memakai dimensiUnit=tak_berlaku — kontrol yang tak mengubah apa pun TIDAK dipasang", () => {
    const papan = readFileSync(join(KEU, "page.tsx"), "utf8");
    expect(papan).toMatch(/dimensiUnit="tak_berlaku"/);
    // DAYA-BEDA: kelima rute lain TIDAK memakainya — kalau semuanya memakainya,
    // pemilih unit lenyap dari seluruh modul dan penjaga di atas tetap hijau.
    const lain = RUTE.filter((f) => f !== join(KEU, "page.tsx"));
    for (const f of lain) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/dimensiUnit="tak_berlaku"/);
    }
    expect(lain).toHaveLength(5);
  });
});

describe("🔴 URL keuangan dibangun SATU tempat, dan menavigasi ke tempat yang benar", () => {
  const kasus: Array<[UnitRouteSegment, string]> = [
    ["keuangan-laporan", "/keuangan/unit/6378301/2026-08-22"],
    ["keuangan-input", "/keuangan/unit/6378301/2026-08-22/input"],
    ["keuangan-tutup-hari", "/keuangan/unit/6378301/tutup-hari/2026-08-22"],
    ["keuangan-akun-kas", "/keuangan/unit/6378301/akun-kas"],
  ];

  for (const [segment, harap] of kasus) {
    it(`${segment} → ${harap}`, () => {
      expect(unitRouteHref({ segment, code: "6378301", date: "2026-08-22" })).toBe(harap);
    });
  }

  it("sumber-data membawa unit di QUERY, bukan di path", () => {
    const href = unitRouteHref({
      segment: "keuangan-sumber-data",
      code: "6378301",
      date: "2026-08-22",
    });
    expect(href).toBe("/keuangan/sumber-data?unit=6378301&tanggal=2026-08-22");
    // Bentuk path akan mendarat di 404 — daya-beda yang menutup salah-tebak.
    expect(href).not.toContain("/sumber-data/6378301");
  });

  it("papan TIDAK membawa unit sama sekali — hanya tanggal", () => {
    const href = unitRouteHref({ segment: "keuangan-papan", code: "6378301", date: "2026-08-22" });
    expect(href).toBe("/keuangan?tanggal=2026-08-22");
    expect(href).not.toContain("6378301");
  });

  it("🔴 MENAVIGASI, bukan menulis cookie: tiap unit adalah URL yang berbeda", () => {
    // Kelas "salah yang terlihat benar": cookie berganti, layar menampilkan
    // unit lama. Kalau kedua unit menghasilkan URL yang sama, itu yang terjadi.
    const a = unitRouteHref({ segment: "keuangan-laporan", code: "6378301", date: "2026-08-22" });
    const b = unitRouteHref({ segment: "keuangan-laporan", code: "6478111", date: "2026-08-22" });
    expect(a).not.toBe(b);
    expect(b).toContain("6478111");
  });

  it("query yang sudah ada dipertahankan, tidak ditimpa", () => {
    expect(
      unitRouteHref({
        segment: "keuangan-sumber-data",
        code: "6478111",
        date: "2026-08-22",
        query: "view=ringkas",
      }),
    ).toBe("/keuangan/sumber-data?view=ringkas&unit=6478111&tanggal=2026-08-22");
  });
});
