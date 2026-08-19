import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * §10.17 — grup menu Keuangan disembunyikan dari yang tak boleh membacanya.
 *
 * ⛔ **DAN INILAH TES YANG PALING PENTING DI BERKAS INI:** yang menjaga akses
 * BUKAN sidebar. Ada asersi di bawah yang memerah bila seseorang kelak mengira
 * menyembunyikan menu sudah cukup — yaitu bila gerbang per-rute hilang
 * sementara sidebar tetap menyembunyikannya.
 */
const SIDEBAR = readFileSync(resolve(__dirname, "Sidebar.tsx"), "utf8");
const APPSHELL = readFileSync(resolve(__dirname, "AppShell.tsx"), "utf8");
const LAYOUT = readFileSync(resolve(__dirname, "../app/(app)/layout.tsx"), "utf8");

describe("§10.17 — grup Keuangan disembunyikan, tanpa menjadi kontrol akses", () => {
  it("penjaga ini punya SUBJEK", () => {
    expect(SIDEBAR).toMatch(/id: "keuangan"/);
    expect(SIDEBAR).toMatch(/bolehLihatKeuangan/);
  });

  it("grup yang ditandai sembunyi benar-benar TIDAK dirender", () => {
    // Bukan `hidden`/CSS — disaring sebelum render, jadi tak ada di DOM.
    expect(SIDEBAR).toMatch(/\.filter\(\(g\) => !g\.sembunyi\)/);
    expect(SIDEBAR).toMatch(/sembunyi: !bolehLihatKeuangan/);
  });

  it("🔴 nilainya dihitung di SERVER dengan predikat yang SAMA", () => {
    // Kesimpulan klien bisa dibuat benar dengan mengubah state di peramban.
    expect(LAYOUT).toMatch(/canViewLaporanKeuangan\(\{ role: scope\.role, email: scope\.email \}\)/);
    expect(APPSHELL).toMatch(/bolehLihatKeuangan={bolehLihatKeuangan}/);
    // Sidebar TIDAK memanggil predikatnya sendiri — ia menerima hasilnya.
    expect(SIDEBAR).not.toMatch(/canViewLaporanKeuangan\s*\(/);
  });

  it("🔴 SIDEBAR BUKAN KONTROL AKSES — peringatannya tertulis di kodenya", () => {
    // Kalimat ini yang mencegah orang berikutnya membangun rute baru tanpa
    // gerbang karena "toh menunya disembunyikan".
    expect(SIDEBAR).toMatch(/MENYEMBUNYIKAN MENU BUKAN KONTROL AKSES/);
    expect(SIDEBAR).toMatch(/tetap bisa dibuka dengan mengetik URL/);
  });

  it("🔴 kalimat lama TIDAK dihapus — ia diberi batasnya", () => {
    // Kalimat yang hilang tanpa jejak akan ditulis ulang oleh orang berikutnya
    // lengkap dengan alasan yang sudah kedaluwarsa.
    expect(SIDEBAR).toMatch(/Menu IDENTIK untuk semua peran/);
    expect(SIDEBAR).toMatch(/BATAS kalimat di atas/);
  });

  it("🔴 gerbang per-rute TETAP ADA — sidebar tidak menggantikannya", () => {
    // Inilah asersi yang memerah bila seseorang mengira sidebar sudah cukup:
    // ia memeriksa RUTE, bukan menu, dan ia berdiri sendiri.
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const dir = resolve(__dirname, "../app/(app)/keuangan");
    const pages = (function cari(d: string): string[] {
      return readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? cari(join(d, e.name)) : e.name === "page.tsx" ? [join(d, e.name)] : [],
      );
    })(dir);
    expect(pages.length, "rute keuangan tak ditemukan — penjaga tanpa subjek").toBeGreaterThanOrEqual(5);
    for (const p of pages) {
      expect(
        readFileSync(p, "utf8"),
        `${p} kehilangan gerbang baca — menyembunyikan menu TIDAK menggantikannya`,
      ).toMatch(/if \(!canViewLaporanKeuangan\([^)]*\)\) notFound\(\)/);
    }
  });

  it("grup LAIN tidak ikut disembunyikan — kontrol POSITIF", () => {
    // Tanpa ini, penjaga di atas juga hijau bila filternya membuang segalanya.
    for (const id of ["monitoring", "laporan", "direksi"]) {
      const i = SIDEBAR.indexOf(`id: "${id}"`);
      const blok = SIDEBAR.slice(i, i + 400);
      expect(blok, `grup ${id} ikut punya sembunyi`).not.toMatch(/sembunyi:/);
    }
  });
});
