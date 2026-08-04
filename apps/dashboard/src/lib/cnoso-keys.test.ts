/**
 * Penjaga regresi: CNOSO sebagai kunci join HARUS case-insensitive.
 *
 * EasyMax menautkan penerimaan↔penebusan lewat No. SO Pertamina (`CNOSO`) secara
 * case-insensitive; nomornya teks bebas yang diketik tangan. Postgres `=` tidak.
 * Satu SO yang pernah diketik dua casing karena itu PECAH jadi dua SO: sisi tebus
 * menyisakan outstanding palsu, sisi terima jatuh jadi "yatim" — dua angka yang
 * saling bertentangan di satu layar. Terukur di Bundaran Kotabaru: Sisa DO Solar
 * 40.000 L padahal EasyMax 8.000 L (hantu 32.000 L, dua SO, empat penerimaan).
 *
 * Aturannya, atas SETIAP `trim(<alias>.cnoso)` di sumber dashboard:
 *   - `lower(trim(x.cnoso))`            → KUNCI ternormalisasi (sah)
 *   - `min(trim(x.cnoso)) AS cnoso_disp`→ nilai TAMPILAN, sengaja bit-faithful ke
 *                                          sumber (sah; lihat getDoSuspectSO)
 *   - bentuk lain                       → PELANGGARAN
 *
 * Kenapa `min(...)` untuk tampilan: getDoSuspectSO merender nomor SO ke layar dan
 * PDF. `lower()` polos akan me-recase ribuan nomor SO yang sehat (1.029 nilai
 * ber-huruf-besar di KB saja). `min()` atas grup yang casing-nya seragam
 * mengembalikan persis string sumbernya.
 *
 * Berkas dibaca lewat `readFileSync` — BUKAN grep. `apps/agent/src/domains.ts`
 * membuktikan kenapa: satu byte NUL di dalamnya membuat grep menganggap seluruh
 * berkas biner dan MELEWATKANNYA tanpa error. Pemindai yang bisa diam-diam
 * melewatkan berkas bukan penjaga.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = join(__dirname, "..");

/** Sumber app saja — berkas test dikecualikan: string kontrol di test ini sendiri
 *  (`lower(trim(th.cnoso))`, `min(…) AS cnoso_disp`) akan mencemari hitungan. */
function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? tsFiles(join(dir, e.name))
      : /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
        ? [join(dir, e.name)]
        : [],
  );
}

export interface CnosoKeyUse {
  file: string;
  /** Nomor baris 1-based tempat `trim(<alias>.cnoso)` muncul. */
  line: number;
  /** Potongan baris untuk pesan gagal. */
  text: string;
  kind: "key" | "display" | "violation";
}

/** Setiap `trim(<alias>.cnoso)` di `src`, dengan klasifikasi pembungkusnya. */
export function findCnosoKeyUses(file: string, src: string): CnosoKeyUse[] {
  const out: CnosoKeyUse[] = [];
  const lines = src.split("\n");
  for (const [i, line] of lines.entries()) {
    for (const m of line.matchAll(/trim\(\s*\w+\.cnoso\s*\)/g)) {
      const before = line.slice(0, m.index);
      const after = line.slice(m.index + m[0].length);
      const kind: CnosoKeyUse["kind"] = /lower\(\s*$/.test(before)
        ? "key"
        : /min\(\s*$/.test(before) && /^\s*\)\s*AS\s+cnoso_disp\b/i.test(after)
          ? "display"
          : "violation";
      out.push({
        file: file.replace(/.*\/src\//, "src/"),
        line: i + 1,
        text: line.trim(),
        kind,
      });
    }
  }
  return out;
}

describe("CNOSO sebagai kunci join (case-insensitive)", () => {
  const files = tsFiles(SRC_DIR);
  const uses = files.flatMap((f) => findCnosoKeyUses(f, readFileSync(f, "utf8")));

  it("tidak ada `trim(x.cnoso)` telanjang di kunci join/grouping", () => {
    const bad = uses.filter((u) => u.kind === "violation");
    const report = bad.map((v) => `${v.file}:${v.line}  ${v.text}`).join("\n");
    expect(
      bad,
      bad.length
        ? "`trim(x.cnoso)` telanjang menautkan SO secara CASE-SENSITIVE, sedangkan " +
            "EasyMax case-insensitive: satu SO yang diketik dua casing pecah jadi dua, " +
            "Sisa DO menggelembung dan penerimaannya jadi yatim. Bungkus jadi " +
            "`lower(trim(x.cnoso))` — atau, khusus nilai yang DIRENDER, " +
            `\`min(trim(x.cnoso)) AS cnoso_disp\`.\n${report}`
        : undefined,
    ).toEqual([]);
  });

  it("aturan ini benar-benar mengunci call-site yang dipakai app (anti-vakum)", () => {
    // Tanpa ini "nol pelanggaran" bisa berarti pemindainya tak membaca apa pun:
    // berkas berpindah, regex meleset, atau direktori kosong → hijau-palsu.
    expect(files.length).toBeGreaterThan(50);
    const q = files.find((f) => f.endsWith("lib/queries.ts"));
    expect(q, "src/lib/queries.ts harus ikut terpindai").toBeTruthy();
    const src = readFileSync(q!, "utf8");
    for (const fn of ["getDoHarian", "getDoAnomalies", "getDoSuspectSO"]) {
      expect(src, `${fn} harus masih ada di queries.ts`).toContain(fn);
    }
    // 3 call-site × 2 CTE (tebus + terima) = 6 kunci, + 1 nilai tampilan.
    expect(uses.filter((u) => u.kind === "key").length).toBeGreaterThanOrEqual(6);
    expect(uses.filter((u) => u.kind === "display").length).toBe(1);
  });

  it("detektornya sendiri bisa MERAH (kontrol non-vakum)", () => {
    // Nol pelanggaran tak membuktikan apa pun kalau regexnya tak pernah berbunyi.
    const rotten = "FROM red FULL JOIN rec ON red.cnoso = rec.cnoso\n" +
      "  SELECT trim(th.cnoso) AS cnoso, trim(td.ckdbbm) AS bbm";
    const fixed = "  SELECT lower(trim(th.cnoso)) AS cnoso, trim(td.ckdbbm) AS bbm";
    const display = "  SELECT min(trim(th.cnoso)) AS cnoso_disp,";
    const displayButKey = "  SELECT min(trim(th.cnoso)) AS cnoso,"; // bukan _disp
    const kinds = (s: string) => findCnosoKeyUses("a.ts", s).map((u) => u.kind);
    expect(kinds(rotten)).toEqual(["violation"]);
    expect(kinds(fixed)).toEqual(["key"]);
    expect(kinds(display)).toEqual(["display"]);
    expect(kinds(displayButKey)).toEqual(["violation"]);
    // Referensi ke kolom CTE yang SUDAH ternormalisasi bukan pelanggaran.
    expect(kinds("FROM red FULL JOIN rec ON red.cnoso = rec.cnoso")).toEqual([]);
  });
});
