/**
 * Penjaga regresi lebar kolom tabel grid (`.cols-*`).
 *
 * Setiap `.grid-head` / `.grid-row` / `.grid-total` adalah grid TERPISAH — tidak
 * ada tabel induk yang menyatukan kolomnya. Karena `Nfr` ≡ `minmax(auto, Nfr)`,
 * min-content sebuah sel melebarkan track HANYA di barisnya sendiri, sehingga
 * header ≠ baris ≠ TOTAL dan geometri tabel berubah mengikuti data. Luapannya
 * lalu DIPOTONG DIAM-DIAM oleh `.tbl-card { overflow: hidden }` — angka hilang.
 *
 * Aturannya: lebar track tidak boleh bergantung isi sel. Dua bentuk yang sah:
 *   - `minmax(0, Nfr)`    → lantai nol, lebar murni rasio
 *   - `minmax(<px>, Nfr)` → lantai px konstan, dipakai saat kolom wajib terbaca
 *                           (kolom sticky Produk & kolom unit di cols-harian*)
 * Track px mati (56px, 32px) tetap boleh — konstan juga.
 *
 * Yang dilarang hanya `Nfr` TELANJANG, satu-satunya bentuk yang membawa
 * minimum-auto. Sengaja dibatasi pada aturan `.cols-*`: grid tata letak halaman
 * (`.shell`, `.kpi-grid`, `.lap-two`, …) memang wajar memakai `1fr` karena tidak
 * ada baris kedua yang harus sejajar dengannya.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const STYLE_DIR = __dirname;

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? cssFiles(join(dir, e.name)) : e.name.endsWith(".css") ? [join(dir, e.name)] : [],
  );
}

export interface Violation {
  file: string;
  selector: string;
  value: string;
  bareTracks: string[];
}

/** Blok `selector { … }` yang selector-nya menyentuh `.cols-…`. */
export function findBareFrTracks(file: string, css: string): Violation[] {
  const out: Violation[] = [];
  const blocks = css.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  for (const b of blocks) {
    const selector = (b[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "").trim().replace(/\s+/g, " ");
    if (!/\.cols-/.test(selector)) continue;
    const decl = (b[2] ?? "").match(/grid-template-columns\s*:\s*([^;}]+)/);
    if (!decl?.[1]) continue;
    const value = decl[1].trim();
    // Buang minmax(...) — bentuk yang disahkan. Tidak ada minmax bersarang.
    const stripped = value.replace(/minmax\([^)]*\)/g, "");
    const bare = stripped.match(/(?<![\w.-])\d*\.?\d+fr/g);
    if (!bare) continue;
    out.push({ file: file.replace(/.*\/src\//, "src/"), selector, value, bareTracks: bare });
  }
  return out;
}

describe("lebar track tabel grid (.cols-*)", () => {
  it("tidak ada .cols-* yang memakai track `Nfr` telanjang", () => {
    const files = cssFiles(STYLE_DIR);
    expect(files.length).toBeGreaterThan(0); // direktori style harus terbaca
    const violations = files.flatMap((f) => findBareFrTracks(f, readFileSync(f, "utf8")));
    const report = violations.map((v) => `${v.file}  ${v.selector}  [${v.bareTracks.join(" ")}]  →  ${v.value}`).join("\n");
    expect(
      violations,
      violations.length
        ? "Track `Nfr` telanjang membawa minimum-auto: lebar kolom jadi bergantung isi sel, baris " +
            "saling geser, dan luapannya dipotong diam-diam oleh .tbl-card{overflow:hidden}. Bungkus " +
            `jadi minmax(0, Nfr) — atau minmax(<px>, Nfr) bila kolom itu wajib tetap terbaca.\n${report}`
        : undefined,
    ).toEqual([]);
  });

  it("aturan ini benar-benar mengunci berkas gaya yang dipakai app", () => {
    // Kalau app.css hilang/berpindah, test di atas jadi hijau-palsu (nol berkas
    // → nol pelanggaran). Pastikan ia memang ikut terpindai dan berisi .cols-*.
    const files = cssFiles(STYLE_DIR);
    const app = files.find((f) => f.endsWith("app.css"));
    expect(app, "app.css harus ikut terpindai").toBeTruthy();
    const css = readFileSync(app!, "utf8");
    const colsRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(
      (b) => /\.cols-/.test(b[1] ?? "") && /grid-template-columns/.test(b[2] ?? ""),
    );
    expect(colsRules.length).toBeGreaterThanOrEqual(12); // 15 varian − yg tanpa deklarasi
  });

  it("detektornya sendiri bisa MERAH (kontrol non-vakum)", () => {
    // Tanpa kontrol ini "nol pelanggaran" tak membuktikan apa pun — regex salah
    // juga menghasilkan nol.
    const sane = ".cols-x { grid-template-columns: minmax(0, 1.3fr) minmax(84px, 1fr) 56px; }";
    const rotten = ".cols-x { grid-template-columns: 1.3fr 1fr 56px; }";
    const mixed = ".cols-y { grid-template-columns: minmax(0, 1fr) 0.9fr; }";
    const nested = ".cols-z { grid-template-columns: 1.5fr repeat(var(--ncols, 7), minmax(74px, 1fr)); }";
    const layout = ".kpi-grid { grid-template-columns: 1fr 1fr; }"; // di luar cakupan
    const tracksOf = (css: string): string[] | undefined => findBareFrTracks("a.css", css)[0]?.bareTracks;
    expect(findBareFrTracks("a.css", sane)).toEqual([]);
    expect(tracksOf(rotten)).toEqual(["1.3fr", "1fr"]);
    expect(tracksOf(mixed)).toEqual(["0.9fr"]);
    // repeat(… minmax(…)) sah; `1.5fr` di depannya TIDAK.
    expect(tracksOf(nested)).toEqual(["1.5fr"]);
    expect(findBareFrTracks("a.css", layout)).toEqual([]);
  });
});
