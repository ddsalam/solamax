import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KETAATAN_HARI } from "./config";

/**
 * Penjaga JENDELA papan Ketaatan — satu angka, tiga tempat yang dulu menyalinnya.
 *
 * Sebelum 2026-09-07 lebar jendela hidup di TIGA tempat sekaligus: `DAYS = 14`
 * di halamannya, `repeat(14, 30px)` di `.hm-grid`, dan kalimat "14 hari terakhir"
 * di kartu Hub. Menaikkan satu saja tidak menjatuhkan apa pun — kisi CSS akan
 * melebar 14 kolom untuk 30 sel data (16 sel jatuh ke kolom implisit selebar
 * auto, tak sejajar dengan label harinya) dan Hub akan terus menjanjikan 14 hari.
 * Kegagalan diam yang tak punya pemeriksa; test ini pemeriksanya.
 *
 * Idiom sama dengan legenda.test.ts & db-budget.test.ts: halaman ini Server
 * Component dan CSS-nya bukan modul, jadi keduanya DIBACA dari sumbernya —
 * test yang "meniru" isinya hanya akan menguji salinan keempat.
 */
const baca = (...bagian: string[]) => readFileSync(join(__dirname, "..", ...bagian), "utf8");

const HALAMAN = baca("app", "(app)", "monitoring", "ketaatan", "page.tsx");
const HUB = baca("app", "(app)", "page.tsx");
const CSS = baca("styles", "app.css");

/** Aturan `.hm-grid` saja — bukan seluruh stylesheet. */
function aturanHmGrid(): string {
  const i = CSS.indexOf(".hm-grid {");
  expect(i, "aturan .hm-grid tak ditemukan — namanya berubah?").toBeGreaterThan(-1);
  return CSS.slice(i, CSS.indexOf("}", i) + 1);
}

describe("jendela papan Ketaatan — satu sumber, bukan tiga salinan", () => {
  it("ketiga berkasnya terbaca (anti-vakum)", () => {
    // Tanpa ini, path yang salah membuat setiap `not.toMatch` di bawah lulus
    // atas string kosong — hijau tanpa subjek.
    expect(HALAMAN).toContain("KetaatanPage");
    expect(HUB).toContain("Ketaatan administrasi");
    expect(CSS).toContain(".hm-cell");
  });

  it("nilainya masuk akal sebagai jendela hari", () => {
    expect(Number.isInteger(KETAATAN_HARI)).toBe(true);
    // Batas atas 31: label sel hanya tanggal (`d.slice(8)`), jadi jendela ≥32
    // hari mengulang angka yang sama dua kali di satu baris.
    expect(KETAATAN_HARI).toBeGreaterThanOrEqual(7);
    expect(KETAATAN_HARI).toBeLessThanOrEqual(31);
  });

  it("halaman memakai konstanta, bukan angka sendiri", () => {
    expect(HALAMAN).toContain("KETAATAN_HARI");
    // Benih `iSebelumnya` untuk sel terkiri — hilang = aturan salin-setoran
    // mati diam-diam di kolom paling kiri.
    expect(HALAMAN).toContain("KETAATAN_HARI + 1");
    expect(HALAMAN, "jendela ditulis ulang sebagai angka di halaman").not.toMatch(
      /const\s+DAYS\s*=\s*\d/,
    );
  });

  it("kartu Hub menjanjikan jendela yang SAMA dengan yang dirender", () => {
    expect(HUB).toContain("KETAATAN_HARI");
    expect(HUB, "kartu Hub menyebut jumlah hari sebagai literal").not.toMatch(
      /\d+\s+hari terakhir/,
    );
  });

  it("kisi CSS tidak menghitung kolom hari sama sekali", () => {
    const aturan = aturanHmGrid();
    // Ini inti penjaganya: `repeat(<angka>, …)` = jumlah hari yang tertulis
    // ulang di CSS, tempat yang tak bisa meng-import KETAATAN_HARI.
    expect(aturan, "jumlah kolom hari tertulis ulang di CSS").not.toMatch(/repeat\(\s*\d+/);
    expect(aturan).toContain("grid-auto-flow: column");
    expect(aturan).toContain("grid-auto-columns");
  });

  it("kisi lebar tetap bisa digulir (jendela lebar > lebar layar)", () => {
    // 130px + 30 × (30px + 5px) ≈ 1.180px — melampaui banyak layar, dan
    // `.hm-scroll` satu-satunya yang mencegahnya terpotong senyap.
    expect(HALAMAN.includes("<Heatmap") || HALAMAN.includes("Heatmap ")).toBe(true);
    expect(baca("components", "mon", "Heatmap.tsx")).toContain("hm-scroll");
    expect(CSS).toMatch(/\.hm-scroll\s*\{[^}]*overflow-x:\s*auto/);
  });
});
