import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS "Gerbang dua unit" (rencana 2026-10-29 U4; R30, R31;
 * Implementation Constraints) — bentuk yang sama dengan
 * `pihak-lawan-actions.guard.test.ts`: komentar JS & SQL dibuang, asersi urutan
 * lewat `urutan()` (yang menuntut KEDUA ujung ada).
 *
 * Yang dijaga, untuk `catatAntarUnit` DAN `balikPasanganAntarUnit`:
 *   · `scope.requireUnit` untuk KEDUA unit + predikat wewenangnya SEBELUM BEGIN;
 *   · `app.unit_ids` transaksi = kedua unit;
 *   · inti tulis (`antar-unit-tulis.ts`) memanggil `hariBukuTerkunci` per kaki
 *     sebelum INSERT, dan bukan berkas "use server".
 *
 * DAYA-BEDA: setiap penjaga punya mutan — sumber yang sama dengan SATU
 * `requireUnit` dihapus/dipindah — yang wajib memerahkannya.
 */
const tanpaKomentar = (src: string): string =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n")
    .replace(/--.*$/gm, "");

const baca = (f: string): string => readFileSync(resolve(__dirname, f), "utf8");
const AKSI = tanpaKomentar(baca("antar-unit-actions.ts"));
const TULIS_MENTAH = baca("antar-unit-tulis.ts");
const TULIS = tanpaKomentar(TULIS_MENTAH);

const badan = (kode: string, nama: string): string => {
  const i = kode.indexOf(`export async function ${nama}`);
  if (i < 0) return "";
  const j = kode.indexOf("\nexport ", i + 1);
  return kode.slice(i, j < 0 ? undefined : j);
};

const BEGIN = 'client.query("BEGIN")';

/** Pelanggaran gerbang dua unit pada satu badan aksi — [] = patuh. */
function pelanggaran(fn: string, gerbang: { unitA: string; unitB: string; wewenang: string; scopeB: string }): string[] {
  const salah: string[] = [];
  for (const g of [gerbang.unitA, gerbang.unitB, gerbang.wewenang]) {
    const u = urutan(fn, g, BEGIN);
    if (u !== "ok") salah.push(`${g}: ${u}`);
    const k = urutan(fn, g, "pool.connect()");
    if (k !== "ok") salah.push(`${g} vs koneksi: ${k}`);
  }
  const cfg = urutan(fn, BEGIN, "set_config('app.unit_ids'");
  if (cfg !== "ok") salah.push(`set_config: ${cfg}`);
  if (!fn.includes(gerbang.scopeB)) salah.push("app.unit_ids tak memuat kedua unit");
  return salah;
}

const CATAT = {
  unitA: "scope.requireUnit(input.pemberiCode)",
  unitB: "scope.requireUnit(input.penerimaCode)",
  wewenang: "canCatatAntarUnit(",
  scopeB: "`${pemberi.unit_id},${penerima.unit_id}`",
};
const BALIK = {
  unitA: "scope.requireUnit(input.code)",
  unitB: "scope.requireUnit(kodeLawan)",
  wewenang: "canBalikPasanganAntarUnit(",
  scopeB: "`${unit.unit_id},${lawan.unit_id}`",
};

describe("catatAntarUnit — GERBANG DUA UNIT sebelum BEGIN (R30)", () => {
  const fn = badan(AKSI, "catatAntarUnit");

  it("punya subjek", () => {
    expect(fn).not.toBe("");
    expect(fn).toMatch(/tulisPasanganAntarUnit\(client/);
  });

  it("🔴 kedua requireUnit + canCatatAntarUnit mendahului BEGIN & koneksi; scope = kedua unit", () => {
    expect(pelanggaran(fn, CATAT)).toEqual([]);
  });

  it("🔴 unit di luar jangkauan DITOLAK (return), bukan hanya dicatat", () => {
    expect(fn).toMatch(/if \(!dipegang\(input\.pemberiCode\) \|\| !dipegang\(input\.penerimaCode\)\) \{\s*return \{ ok: false/);
    expect(urutan(fn, "if (!dipegang(input.pemberiCode)", "pool.connect()")).toBe("ok");
    expect(fn).toMatch(/if \(!canCatatAntarUnit\(ctx\)\) return \{ ok: false/);
  });

  it("DAYA-BEDA: menghapus requireUnit penerima / memindahnya ke sesudah BEGIN / scope satu unit ⇒ merah", () => {
    const hapus = fn.replace("scope.requireUnit(input.penerimaCode)", "scope.units.find((u) => u.code === input.penerimaCode)!");
    expect(hapus).not.toBe(fn);
    expect(pelanggaran(hapus, CATAT).length).toBeGreaterThan(0);

    const hapusA = fn.replace("scope.requireUnit(input.pemberiCode)", "scope.units.find((u) => u.code === input.pemberiCode)!");
    expect(pelanggaran(hapusA, CATAT).length).toBeGreaterThan(0);

    const pindah = fn
      .replace("const penerima = scope.requireUnit(input.penerimaCode);", "")
      .replace(`await ${BEGIN};`, `await ${BEGIN};\n    const penerima = scope.requireUnit(input.penerimaCode);`);
    expect(pindah).not.toBe(fn);
    expect(pelanggaran(pindah, CATAT).length).toBeGreaterThan(0);

    const satu = fn.replace(CATAT.scopeB, "String(pemberi.unit_id)");
    expect(pelanggaran(satu, CATAT)).toContain("app.unit_ids tak memuat kedua unit");
  });
});

describe("balikPasanganAntarUnit — GERBANG DUA UNIT + HoF sebelum BEGIN (R31)", () => {
  const fn = badan(AKSI, "balikPasanganAntarUnit");

  it("🔴 kedua requireUnit + canBalikPasanganAntarUnit mendahului BEGIN; scope = kedua unit", () => {
    expect(fn).not.toBe("");
    expect(pelanggaran(fn, BALIK)).toEqual([]);
    expect(fn).toMatch(/if \(kodeLawan === null\) \{\s*return \{\s*ok: false/);
  });

  it("DAYA-BEDA: menghapus requireUnit unit lawan ⇒ merah", () => {
    const mutan = fn.replace("scope.requireUnit(kodeLawan)", "scope.units.find((u) => u.code === kodeLawan)!");
    expect(mutan).not.toBe(fn);
    expect(pelanggaran(mutan, BALIK).length).toBeGreaterThan(0);
  });
});

describe("inti tulis (antar-unit-tulis.ts)", () => {
  it("🔴 BUKAN berkas \"use server\" — fungsinya tanpa gerbang", () => {
    expect(TULIS_MENTAH).not.toMatch(/^\s*["']use server["']/m);
  });

  it("🔴 hariBukuTerkunci per kaki, sebelum INSERT; hasil pra-cut-over ditolak", () => {
    expect(urutan(TULIS, "hariBukuTerkunci(c", "(INSERT_KAS, [")).toBe("ok");
    expect(TULIS).toMatch(/INSERT INTO app\.cash_ledger/);
    expect([...TULIS.matchAll(/if \(h\.status === "pra-cut-over"\) \{\s*return \{\s*ok: false/g)]).toHaveLength(2);
    expect(TULIS).toMatch(/tanggal_asal, alasan_maju, alasan_maju_applies_to/);
  });

  it("🔴 VOID-only: tak ada DELETE", () => {
    for (const k of [AKSI, TULIS]) expect(k).not.toMatch(/DELETE\s+FROM/i);
  });
});
