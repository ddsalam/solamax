import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  jumlahElemen,
  panggilanBerparameter,
  placeholderTertinggi,
  vonisAritas,
} from "./aritas-parameter";

/**
 * Penjaga ARITAS — lihat `aritas-parameter.ts` untuk kelas cacat dan **ketiga
 * batasnya yang diakui** (urutan kolom tak dijaga · array dinamis tak dinilai ·
 * SQL ber-interpolasi tak dinilai).
 */
const SRC = resolve(__dirname, "..");

function berkasTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return berkasTs(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

interface Sensus {
  cocok: number;
  timpang: number;
  sql_interpolasi: number;
  array_dinamis: number;
  tanpa_sql_literal: number;
  tanpa_placeholder: number;
  pelanggaran: string[];
}

function sensus(): Sensus {
  const s: Sensus = {
    cocok: 0, timpang: 0, sql_interpolasi: 0, array_dinamis: 0,
    tanpa_sql_literal: 0, tanpa_placeholder: 0,
    pelanggaran: [],
  };
  for (const f of berkasTs(SRC)) {
    for (const p of panggilanBerparameter(readFileSync(f, "utf8"))) {
      const v = vonisAritas(p.argumen);
      if (v.jenis === "tak_dinilai") s[v.sebab]++;
      else {
        s[v.jenis]++;
        if (v.jenis === "timpang") {
          s.pelanggaran.push(
            `${f.replace(SRC, "src")}:${p.baris} — butuh $1..$${v.butuh}, diberi ${v.diberi}`,
          );
        }
      }
    }
  }
  return s;
}

describe("aritas parameter kueri: jumlah placeholder == panjang array nilai", () => {
  const s = sensus();

  it("SENSUS — dicetak apa adanya, termasuk yang TAK DAPAT DINILAI", () => {
    const dinilai = s.cocok + s.timpang;
    console.log(
      `\n  dinilai            : ${dinilai} (cocok ${s.cocok}, timpang ${s.timpang})` +
        `\n  tak dapat dinilai  : SQL ber-interpolasi ${s.sql_interpolasi} · ` +
        `array dinamis ${s.array_dinamis}` +
        `\n  tanpa SQL literal  : ${s.tanpa_sql_literal}  ← TAK DAPAT DINILAI` +
        `\n  tanpa placeholder  : ${s.tanpa_placeholder}  ← tak perlu dinilai\n`,
    );
    // Penjaga tanpa subjek bukan penjaga: kalau tak ada yang bisa dinilai,
    // "nol pelanggaran" tak berarti apa-apa.
    expect(dinilai, "tak satu pun kueri berparameter bisa dinilai").toBeGreaterThan(20);
  });

  it("🔴 tak ada kueri yang jumlah nilainya timpang", () => {
    expect(s.pelanggaran, `aritas timpang:\n${s.pelanggaran.join("\n")}`).toEqual([]);
  });

  it("🔴 DAYA-BEDA: bentuk yang PERSIS menghalangi owner terdeteksi merah", () => {
    // 11 placeholder, 10 nilai — INSERT app.purchase_price sebelum #309.
    const buruk = [
      "`INSERT INTO app.purchase_price (a,b,c,d,e,f,g,h,i,j,k) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`",
      "[a, b, c, d, e, f, g, h, i, j]",
    ];
    expect(vonisAritas(buruk)).toEqual({ jenis: "timpang", butuh: 11, diberi: 10 });

    // KONTROL POSITIF: yang cocok tidak dilaporkan.
    const baik = ["`INSERT INTO t (a,b) VALUES ($1,$2)`", "[a, b]"];
    expect(vonisAritas(baik)).toEqual({ jenis: "cocok", butuh: 2, diberi: 2 });

    // Kelebihan nilai juga timpang — arahnya dua, bukan satu.
    expect(vonisAritas(["`SELECT $1`", "[a, b]"])).toEqual({ jenis: "timpang", butuh: 1, diberi: 2 });
  });

  it("🔴 yang TAK DAPAT DINILAI diakui, bukan dianggap lolos", () => {
    expect(vonisAritas(["`SELECT $1 FROM ${TABEL}`", "[a]"])).toEqual({
      jenis: "tak_dinilai",
      sebab: "sql_interpolasi",
    });
    expect(vonisAritas(["`SELECT $1, $2`", "[...nilai]"])).toEqual({
      jenis: "tak_dinilai",
      sebab: "array_dinamis",
    });
    expect(vonisAritas(["`SELECT $1`", "params"])).toEqual({
      jenis: "tak_dinilai",
      sebab: "array_dinamis",
    });
    expect(vonisAritas(["`SELECT 1`"])).toEqual({
      jenis: "tak_dinilai",
      sebab: "tanpa_placeholder",
    });
    // SQL-nya variabel ⇒ TAK DAPAT dinilai, berbeda dari "tak perlu".
    expect(vonisAritas(["teksKueri", "[a]"])).toEqual({
      jenis: "tak_dinilai",
      sebab: "tanpa_sql_literal",
    });
  });

  it("penghitung placeholder & elemen: koma di dalam nilai tak mengelabuinya", () => {
    expect(placeholderTertinggi("VALUES ($1,$2,$10)")).toBe(10);
    expect(placeholderTertinggi("SELECT 1")).toBe(0);
    // Koma di dalam pemanggilan fungsi, objek, dan string TIDAK dihitung.
    expect(jumlahElemen("[f(a, b), { x: 1, y: 2 }, 'p,q']")).toBe(3);
    expect(jumlahElemen("[]")).toBe(0);
    expect(jumlahElemen("[...x]")).toBeNull();
    expect(jumlahElemen("bukanArray")).toBeNull();
  });

  it("pemisah argumen tahan template literal ber-interpolasi bersarang", () => {
    const src = "q(`SELECT ${a(1, 2)} FROM t WHERE x = $1`, [y]);";
    const p = panggilanBerparameter(src);
    expect(p).toHaveLength(1);
    expect(p[0]!.argumen).toHaveLength(2);
    expect(p[0]!.argumen[1]).toBe("[y]");
  });
});

/**
 * 🔴 BUKTI TERKUAT: penjaga ini diadu dengan SEJARAH NYATA.
 *
 * `__fixture__/harga-beli-actions.pra309.txt` adalah salinan
 * `harga-beli-actions.ts` **sebelum commit `bf5bdb3`** — versi yang benar-benar
 * menghalangi owner di produksi. Bukan kode karangan, bukan potongan yang
 * disederhanakan: berkas yang sungguh dirilis.
 *
 * Berekstensi `.txt` dengan sengaja: kalau ia `.ts`, penjaga di atas akan
 * memindainya sebagai kode produksi dan memerah selamanya.
 */
describe("diadu dengan sejarah: kode PRA-#309 harus MERAH", () => {
  const PRA = resolve(__dirname, "__fixture__/harga-beli-actions.pra309.txt");

  it("menemukan cacat yang lolos ke produksi — dan menyebut angkanya", () => {
    const src = readFileSync(PRA, "utf8");
    const timpang = panggilanBerparameter(src)
      .map((p) => ({ baris: p.baris, v: vonisAritas(p.argumen) }))
      .filter((x) => x.v.jenis === "timpang");
    expect(timpang).toHaveLength(1);
    expect(timpang[0]!.v).toEqual({ jenis: "timpang", butuh: 11, diberi: 10 });
  });

  it("KONTROL: versi SESUDAH perbaikan tidak lagi merah", () => {
    const kini = readFileSync(resolve(__dirname, "harga-beli-actions.ts"), "utf8");
    const timpang = panggilanBerparameter(kini)
      .map((p) => vonisAritas(p.argumen))
      .filter((v) => v.jenis === "timpang");
    expect(timpang).toEqual([]);
  });
});
