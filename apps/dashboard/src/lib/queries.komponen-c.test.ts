import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScopedUnitId } from "./scope-rule";

/**
 * KOMPONEN C — SATU ATURAN, TIGA PEMAKAI (penjaga tanpa DB).
 *
 * Kenapa berkas ini ada. Aturan C hidup di tiga query: `getPelangganForDate`
 * (Rincian + Laporan), `getComplianceMatrix` (panel Ketaatan Administrasi), dan
 * `getAdminDays` (anomali/board). Pada 2026-09-11 perbaikan sumber rupiah
 * voucher (detail → posting `bppiut` ∪ `bphut`) hanya menyentuh yang pertama,
 * sehingga **Rincian dan Ketaatan Administrasi menampilkan H berbeda untuk hari
 * yang sama** — KB 31-08 selisih Rp 48.900, cukup untuk memunculkan alarm kas
 * palsu di satu panel sementara panel lain sudah benar.
 *
 * Invarian "dua jalur, satu H" sebenarnya SUDAH diuji di
 * `laporan-setoran.integration.test.ts` — tetapi uji itu butuh DB live
 * (`SCOPE_LIVE_DB=1`) dan **CI tidak pernah menyetelnya**, jadi ia tidak pernah
 * berbunyi. Berkas ini menutup celah itu dari sisi yang bisa jalan tiap commit:
 * ia membaca TEKS SQL-nya, tanpa DB.
 *
 * Uji ini MERAH pada implementasi sebelum 2026-09-11.
 */
const { q, qScoped } = vi.hoisted(() => {
  const q = vi.fn((_text: string, _params?: unknown[]) => Promise.resolve([] as unknown[]));
  const qScoped = vi.fn((_unit: unknown, text: string, params?: unknown[]) => q(text, params));
  return { q, qScoped };
});
vi.mock("./db", () => ({ q, qScoped, pool: {} }));

const Q = await import("./queries");
const U = 6478 as unknown as ScopedUnitId;
const D = "2026-08-31";

/** Ketiga produsen komponen C, dengan cara memanggilnya masing-masing. */
const PRODUSEN: Array<[string, () => Promise<unknown>]> = [
  ["getPelangganForDate", () => Q.getPelangganForDate(U, D)],
  ["getComplianceMatrix", () => Q.getComplianceMatrix(U, 7)],
  ["getAdminDays", () => Q.getAdminDays([U], D, D)],
];

describe("komponen C — satu aturan di tiga query", () => {
  beforeEach(() => q.mockClear());

  for (const [nama, panggil] of PRODUSEN) {
    it(`${nama}: rupiah voucher dari POSTING dua buku`, async () => {
      await panggil();
      const [sql] = q.mock.calls[0]!;
      expect(sql).toContain("public.bppiut");
      expect(sql).toContain("public.bphut");
      expect(sql).toMatch(/vcref LIKE 'UV%'/);
      expect(sql).toMatch(/sjnsbp = 1/);
      expect(sql).toContain("public.pelanggan_sale");
    });
  }

  // `voucher_sale` KEMBALI dipakai sejak 2026-09-12 — tetapi hanya sebagai
  // CADANGAN per ref, bukan sumber utama. Sebuah ref yang kehilangan baris
  // posting hidup (akibat siklus posting+pembalik saat laporan dicetak ulang)
  // tetap dihitung EasyMax dari detailnya; memakai posting saja membuat SolaMax
  // kurang catat Rp 1.987.978 pada KB 2026-08-31.
  for (const nama of ["getComplianceMatrix", "getAdminDays"] as const) {
    it(`${nama}: voucher memakai CADANGAN per-ref, bukan detail mentah`, async () => {
      const panggil = PRODUSEN.find(([n]) => n === nama)![1];
      await panggil();
      const [sql] = q.mock.calls[0]!;
      expect(sql).toContain("public.voucher_sale");
      expect(sql).toMatch(/COALESCE\(p\.rp, dt\.rp, 0\)/);
      expect(sql).toContain("FULL JOIN");
      // Cadangan detail TANPA filter sbatal — lihat komentar komponenCSql.
      expect(sql).not.toMatch(/voucher_sale[\s\S]{0,200}COALESCE\(sbatal,0\)=0/);
    });
  }

  it("ketiganya memakai predikat posting yang IDENTIK", async () => {
    const teks: string[] = [];
    for (const [, panggil] of PRODUSEN) {
      q.mockClear();
      await panggil();
      teks.push(q.mock.calls[0]![0]);
    }
    // Normalisasi spasi; alias tabel boleh berbeda (`b.sjnsbp` vs `sjnsbp`),
    // yang tidak boleh berbeda adalah predikatnya.
    const predikat = teks.map((s) => {
      const m = s
        .replace(/\s+/g, " ")
        .match(/(?:\w+\.)?sjnsbp = 1 AND (?:\w+\.)?vcref LIKE 'UV%'/g);
      return m?.length ?? 0;
    });
    // pelanggan: 2 kemunculan (bppiut + bphut) di tiap query.
    expect(predikat).toEqual([2, 2, 2]);
  });
});
