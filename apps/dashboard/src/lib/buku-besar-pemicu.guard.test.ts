import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga KTD3 pemicu 1 (rencana 2026-11-02 K6; R6, R13): SETIAP COMMIT yang
 * menutup tulisan ke `cash_ledger`, `manual_entry`, `edc_settlement`, atau
 * `reclassification` — langsung atau lewat inti `*-tulis` — didahului panggilan
 * pembentuk jurnal (`bentukJurnalSesudahTulis` / `bentukJurnalSumberDitulis`).
 * Perilakunya dibuktikan `buku-besar-pemicu.integration.test.ts` (Postgres
 * nyata); berkas ini menjaga agar jalur tulis BARU tidak lupa memanggilnya.
 *
 * Komentar dibuang dulu — penjaga yang lulus karena kata kuncinya tinggal di
 * komentar tidak menjaga apa-apa (pola `kas-actions.guard.test.ts`).
 */

const tanpaKomentar = (s: string): string =>
  s
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n")
    .replace(/--.*$/gm, "");

/** SQL yang mengubah jurnal sumber. */
const SQL_SUMBER = String.raw`INSERT INTO app\.(cash_ledger|manual_entry|edc_settlement|reclassification|penebusan|noncash_expense)\b|UPDATE app\.(cash_ledger|manual_entry|edc_settlement|penebusan|noncash_expense)\b`;

const SEMUA = readdirSync(__dirname)
  .filter((f) => f.endsWith(".ts") && !f.includes(".test.") && f !== "buku-besar-tulis.ts")
  .map((f) => tanpaKomentar(readFileSync(resolve(__dirname, f), "utf8")));

/** Fungsi & konstanta tingkat-atas beserta badannya (sampai deklarasi tingkat-atas berikutnya). */
function deklarasi(teks: string): { nama: string; badan: string }[] {
  const re = /^(?:export )?(?:async function|function|const) (\w+)/gm;
  const m = [...teks.matchAll(re)];
  return m.map((x, i) => ({ nama: x[1]!, badan: teks.slice(x.index, m[i + 1]?.index) }));
}

/**
 * Penulis = deklarasi yang memuat SQL sumber, atau memanggil penulis lain —
 * diturunkan dari kode (titik tetap), bukan daftar yang bisa basi. Server action
 * (`-actions.ts` ber-COMMIT) tidak ikut: mereka yang diperiksa.
 */
function namaPenulis(): Set<string> {
  const dekl = SEMUA.flatMap(deklarasi).filter((d) => !/"COMMIT"/.test(d.badan));
  const penulis = new Set(dekl.filter((d) => new RegExp(SQL_SUMBER).test(d.badan)).map((d) => d.nama));
  for (let berubah = true; berubah; ) {
    berubah = false;
    const pola = new RegExp(String.raw`\b(${[...penulis].join("|")})\b`);
    for (const d of dekl) {
      if (penulis.has(d.nama) || !pola.test(d.badan.replace(new RegExp(`^.*?${d.nama}`), ""))) continue;
      penulis.add(d.nama);
      berubah = true;
    }
  }
  return penulis;
}

const PENULIS = namaPenulis();
const MENULIS = new RegExp(`${SQL_SUMBER}|\\b(${[...PENULIS].join("|")})\\b`);
const PEMICU = /\bbentukJurnal(SesudahTulis|SumberDitulis)\(/;
const COMMIT = /await \w+\.query\(["'`]COMMIT["'`]\)/g;
/** Transaksi yang menyetel DUA unit ke `app.unit_ids` menulis buku kedua unit. */
const DUA_UNIT = /set_config\('app\.unit_ids', \$1, true\)", \[(`\$\{\w+\.unit_id\},\$\{\w+\.unit_id\}`|unitIds)\]/;

const BERKAS = readdirSync(__dirname).filter((f) => f.endsWith("-actions.ts"));

/** Segmen kode di antara COMMIT berturut-turut (atau awal fungsi) sampai tiap COMMIT. */
function segmenCommit(teks: string): { segmen: string; baris: number }[] {
  const out: { segmen: string; baris: number }[] = [];
  let dari = 0;
  for (const m of teks.matchAll(COMMIT)) {
    const awalFungsi = teks.lastIndexOf("async function ", m.index);
    const mulai = Math.max(dari, awalFungsi);
    out.push({ segmen: teks.slice(mulai, m.index), baris: teks.slice(0, m.index).split("\n").length });
    dari = m.index + m[0].length;
  }
  return out;
}

describe("KTD3 pemicu 1 — setiap COMMIT tulisan sumber membentuk jurnalnya", () => {
  it("penulis yang diturunkan memuat inti tulis yang dikenal", () => {
    for (const n of ["tulisBebanMutasi", "tulisPasanganAntarUnit", "simpanSetoranTunai", "postingPenjualanEdc", "INSERT_KAS_KLASIFIKASI"]) {
      expect(PENULIS.has(n), n).toBe(true);
    }
  });

  it("ada jalur tulis yang diperiksa (penjaga tidak lulus kosong)", () => {
    const n = BERKAS.flatMap((f) => segmenCommit(tanpaKomentar(readFileSync(resolve(__dirname, f), "utf8")))).filter((s) => MENULIS.test(s.segmen));
    expect(n.length).toBeGreaterThanOrEqual(25);
  });

  for (const f of BERKAS) {
    const teks = tanpaKomentar(readFileSync(resolve(__dirname, f), "utf8"));
    for (const { segmen, baris } of segmenCommit(teks)) {
      if (!MENULIS.test(segmen)) continue;
      it(`🔴 ${f} (COMMIT ±baris ${baris}) memanggil pembentuk jurnal sebelum COMMIT`, () => {
        expect(PEMICU.test(segmen)).toBe(true);
        // Sesudah tulisan terakhir, bukan di tengah.
        const terakhirTulis = Math.max(...[...segmen.matchAll(new RegExp(MENULIS.source, "g"))].map((m) => m.index));
        expect(segmen.slice(terakhirTulis).search(PEMICU)).toBeGreaterThan(-1);
        // Dua unit ⇒ pemicu dijalankan untuk SETIAP unit (`u.unit_id` dalam perulangan).
        const fn = teks.slice(teks.lastIndexOf("async function ", teks.indexOf(segmen)));
        if (DUA_UNIT.test(fn.slice(0, fn.indexOf(segmen.slice(-60)) + 60))) {
          expect(segmen).toMatch(/for \(const u of [^)]*\) await bentukJurnalSesudahTulis\(client, u\.unit_id/);
        }
      });
    }
  }

  it("Rincian pengawas: tulisan lewat dalamTransaksi, yang memanggil pemicu sebelum COMMIT; tanpa INSERT qScoped", () => {
    const teks = tanpaKomentar(readFileSync(resolve(__dirname, "manual-entry-actions.ts"), "utf8"));
    const dt = deklarasi(teks).find((d) => d.nama === "dalamTransaksi")!.badan;
    expect(dt.indexOf("bentukJurnalSesudahTulis(")).toBeGreaterThan(-1);
    expect(dt.indexOf("bentukJurnalSesudahTulis(")).toBeLessThan(dt.indexOf('"COMMIT"'));
    expect(teks).not.toMatch(/qScoped\([\s\S]{0,200}?INSERT INTO app\.manual_entry/);
  });
});
