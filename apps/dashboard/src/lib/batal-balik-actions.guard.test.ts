import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS Batalkan/Balik (rencana 2026-11-07 U3/U5) — pola
 * `antar-unit-actions.guard.test.ts`: komentar dibuang, urutan lewat `urutan()`
 * (yang menuntut KEDUA ujung ada).
 *
 * Yang dijaga untuk setiap aksi:
 *   · `scope.requireUnit` + predikat wewenangnya SEBELUM koneksi & BEGIN;
 *   · `app.unit_ids` diset sesudah BEGIN;
 *   · inti tulis bukan berkas "use server" (ekspornya tanpa gerbang).
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
const AKSI = tanpaKomentar(baca("batal-balik-actions.ts"));
const TULIS = baca("batal-balik-tulis.ts");

const badan = (kode: string, nama: string): string => {
  const i = kode.indexOf(`export async function ${nama}`);
  if (i < 0) return "";
  const j = kode.indexOf("\nexport ", i + 1);
  return kode.slice(i, j < 0 ? undefined : j);
};

/** Pelanggaran gerbang satu aksi — [] = patuh. */
function pelanggaran(fn: string, wewenang: string): string[] {
  const salah: string[] = [];
  for (const g of ["scope.requireUnit(", wewenang]) {
    for (const akhir of ["pool.connect()", 'client.query("BEGIN")']) {
      const u = urutan(fn, g, akhir);
      if (u !== "ok") salah.push(`${g} vs ${akhir}: ${u}`);
    }
  }
  const cfg = urutan(fn, 'client.query("BEGIN")', "set_config('app.unit_ids'");
  if (cfg !== "ok") salah.push(`set_config: ${cfg}`);
  return salah;
}

const AKSI_BATAL = { nama: "batalkanBiayaFinance", wewenang: "canBatalkanBarisFinance(" };

describe("gerbang server Batalkan", () => {
  it("penjaga ini punya SUBJEK", () => {
    expect(badan(AKSI, AKSI_BATAL.nama)).not.toBe("");
  });

  it("🔴 requireUnit + canBatalkanBarisFinance mendahului koneksi & BEGIN; unit_ids sesudah BEGIN", () => {
    expect(pelanggaran(badan(AKSI, AKSI_BATAL.nama), AKSI_BATAL.wewenang)).toEqual([]);
  });

  it("daya-beda: mutan tanpa predikat wewenang MEMERAH", () => {
    const mutan = badan(AKSI, AKSI_BATAL.nama).replace(AKSI_BATAL.wewenang, "Boolean(");
    expect(pelanggaran(mutan, AKSI_BATAL.wewenang)).not.toEqual([]);
  });

  it("inti tulis bukan 'use server' dan menulis lewat UPDATE bersyarat, tak pernah DELETE", () => {
    expect(TULIS).not.toMatch(/^"use server"/m);
    expect(TULIS).toMatch(/WHERE id = \$1::uuid AND unit_id = \$2 AND NOT void AND source_door = 'finance'/);
    expect(TULIS).not.toMatch(/DELETE FROM/i);
  });
});

describe("gerbang server Balik — wewenang di aksi, sebelum koneksi", () => {
  const kasus = [
    { nama: "ajukanBalikBiaya", wewenang: "canAjukanBalikBaris(" },
    { nama: "tarikBalikBiaya", wewenang: "canAjukanBalikBaris(" },
    { nama: "tolakBalikBiaya", wewenang: "canSetujuiBalikBaris(" },
    { nama: "setujuiBalikBiaya", wewenang: "canSetujuiBalikBaris(" },
  ];
  for (const k of kasus) {
    it(`🔴 ${k.nama}: requireUnit + ${k.wewenang.slice(0, -1)} mendahului jalankanBalik (koneksi & BEGIN)`, () => {
      const fn = badan(AKSI, k.nama);
      expect(fn, "subjek").not.toBe("");
      for (const g of ["scope.requireUnit(", k.wewenang]) expect(urutan(fn, g, "jalankanBalik(")).toBe("ok");
    });
  }
  it("jalankanBalik: BEGIN lalu unit_ids, dan pemicu jurnal sebelum COMMIT", () => {
    const fn = AKSI.slice(AKSI.indexOf("async function jalankanBalik"));
    expect(urutan(fn, 'client.query("BEGIN")', "set_config('app.unit_ids'")).toBe("ok");
    expect(urutan(fn, "bentukJurnalSesudahTulis(", 'client.query("COMMIT")')).toBe("ok");
  });
  it("daya-beda: menyetujui memakai predikat PENYETUJU, bukan predikat pengaju", () => {
    expect(badan(AKSI, "setujuiBalikBiaya")).not.toMatch(/canAjukanBalikBaris\(/);
    expect(badan(AKSI, "tolakBalikBiaya")).not.toMatch(/canAjukanBalikBaris\(/);
  });
});
