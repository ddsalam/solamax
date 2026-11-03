import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS atas `pos-actions.ts` (rencana 2026-11-02 K6 U1; R4, R5):
 * wewenang HoF (`buka` → requireUnit → canKelolaPos) SEBELUM koneksi; RLS →
 * baca ulang → validasi murni → DML → audit → COMMIT; setiap penolakan sesudah
 * BEGIN ber-ROLLBACK. Membuktikan penjagaan ADA, bukan perilakunya terhadap DB.
 */
const tanpaKomentar = (src: string): string =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");

const KODE = tanpaKomentar(readFileSync(resolve(__dirname, "pos-actions.ts"), "utf8"));

const badan = (nama: string): string => {
  const i = KODE.indexOf(`export async function ${nama}`);
  if (i < 0) return "";
  const j = KODE.indexOf("\nexport ", i + 1);
  return KODE.slice(i, j < 0 ? undefined : j);
};

/** Tukar kemunculan pertama `a` dan `b` — memaksa urutan terbalik. */
const tukar = (teks: string, a: string, b: string): string => teks.replace(a, "\u0000").replace(b, a).replace("\u0000", b);

const AKSI = ["tambahSubPos", "hapusSubPos", "ubahPetaKategori"];

describe("pos-actions — penjagaan yang tak boleh hilang", () => {
  it("penjaga ini punya SUBJEK: semua aksi yang diekspor tercakup", () => {
    const diekspor = [...KODE.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    expect(diekspor.sort()).toEqual([...AKSI].sort());
    for (const f of AKSI) expect(badan(f).length, f).toBeGreaterThan(200);
  });

  it("🔴 buka(): scope → requireUnit → canKelolaPos, tanpa koneksi di dalamnya", () => {
    const b = KODE.slice(KODE.indexOf("async function buka("), KODE.indexOf("async function daftarDiTransaksi"));
    expect(urutan(b, "getDataScope()", "requireUnit(")).toBe("ok");
    expect(urutan(b, "requireUnit(", "canKelolaPos(")).toBe("ok");
    expect(b).not.toMatch(/pool\.connect/);
  });

  it("🔴 setiap aksi memanggil buka() SEBELUM pool.connect(); input bentuk (UUID) juga sebelum koneksi", () => {
    for (const f of AKSI) {
      expect(urutan(badan(f), "await buka(input.code)", "pool.connect()"), f).toBe("ok");
      expect(badan(f), f).toMatch(/if \(!ctx\.boleh\) return \{ ok: false/);
    }
    expect(urutan(badan("hapusSubPos"), "UUID_RE.test(", "pool.connect()")).toBe("ok");
  });

  it("🔴 SETIAP penolakan sesudah BEGIN didahului ROLLBACK", () => {
    for (const f of AKSI) {
      const b = badan(f);
      const sesudah = b.slice(b.indexOf('client.query("BEGIN")'));
      const semua = (sesudah.match(/return \{ ok: false/g) ?? []).length;
      const berbatal = (sesudah.match(/(?:await batal\(client\)|await client\.query\("ROLLBACK"\));\s*return \{ ok: false/g) ?? []).length;
      expect(semua, `${f}: tanpa subjek`).toBeGreaterThan(0);
      expect(berbatal, `${f}: return ok:false tanpa ROLLBACK`).toBe(semua);
    }
  });

  it("tambahSubPos: RLS → baca daftar → periksaSubPosBaru → INSERT → audit → COMMIT", () => {
    const b = badan("tambahSubPos");
    expect(urutan(b, "set_config('app.unit_ids'", "daftarDiTransaksi(client")).toBe("ok");
    expect(urutan(b, "daftarDiTransaksi(client", "periksaSubPosBaru(")).toBe("ok");
    expect(urutan(b, "periksaSubPosBaru(", "INSERT INTO app.pos_unit")).toBe("ok");
    expect(urutan(b, "INSERT INTO app.pos_unit", "auditKeuangan(client")).toBe("ok");
    expect(urutan(b, "auditKeuangan(client", 'client.query("COMMIT")')).toBe("ok");
    expect(b).toMatch(/\[unit\.unit_id, kode, nama, input\.kodeInduk, scope\.userId\]/);
  });

  it("hapusSubPos: RLS → kunci baris → daftar → rujukan → periksaHapusPos → DELETE → audit → COMMIT", () => {
    const b = badan("hapusSubPos");
    expect(urutan(b, "set_config('app.unit_ids'", "FOR UPDATE")).toBe("ok");
    expect(urutan(b, "FOR UPDATE", "daftarDiTransaksi(client")).toBe("ok");
    expect(urutan(b, "daftarDiTransaksi(client", "SQL_RUJUKAN_POS")).toBe("ok");
    expect(urutan(b, "SQL_RUJUKAN_POS", "periksaHapusPos(")).toBe("ok");
    expect(urutan(b, "periksaHapusPos(", "DELETE FROM app.pos_unit")).toBe("ok");
    expect(urutan(b, "DELETE FROM app.pos_unit", "auditKeuangan(client")).toBe("ok");
    expect(urutan(b, "auditKeuangan(client", 'client.query("COMMIT")')).toBe("ok");
    // Penjaga di WHERE: pos bank (cash_account_id) tak pernah terhapus; jumlah baris diperiksa.
    expect(b).toMatch(/AND cash_account_id IS NULL/);
    expect(urutan(b, "d.rowCount !== 1", "auditKeuangan(client")).toBe("ok");
  });

  it("ubahPetaKategori: RLS → daftar → periksaPetaBaru → baca peta kini → INSERT append-only → audit → COMMIT", () => {
    const b = badan("ubahPetaKategori");
    expect(urutan(b, "set_config('app.unit_ids'", "daftarDiTransaksi(client")).toBe("ok");
    expect(urutan(b, "daftarDiTransaksi(client", "periksaPetaBaru(")).toBe("ok");
    expect(urutan(b, "periksaPetaBaru(", "INSERT INTO app.category_account_map")).toBe("ok");
    expect(urutan(b, "sebelum === input.kodePos", "INSERT INTO app.category_account_map")).toBe("ok");
    expect(urutan(b, "INSERT INTO app.category_account_map", "auditKeuangan(client")).toBe("ok");
    expect(urutan(b, "auditKeuangan(client", 'client.query("COMMIT")')).toBe("ok");
    // Peta global (unit_id NULL), append-only: tanpa DELETE.
    expect(b).toMatch(/VALUES \(NULL, \$1, \$2, \$3::date, \$4\)/);
    expect(b).not.toMatch(/DELETE FROM/);
  });

  it("daya-beda: pemeriksa MEMERAHKAN urutan terbalik / subjek hilang", () => {
    const b = badan("tambahSubPos");
    expect(urutan(tukar(b, "await buka(input.code)", "pool.connect()"), "await buka(input.code)", "pool.connect()")).not.toBe("ok");
    expect(urutan(tukar(b, "periksaSubPosBaru(", "INSERT INTO app.pos_unit"), "periksaSubPosBaru(", "INSERT INTO app.pos_unit")).not.toBe("ok");
    expect(urutan(b.replaceAll("periksaSubPosBaru(", "x("), "periksaSubPosBaru(", "INSERT INTO app.pos_unit")).not.toBe("ok");
    const gen = badan("hapusSubPos").replace(/client\.query\("ROLLBACK"\);(\s*return \{ ok: false)/g, "$1");
    expect((gen.match(/ROLLBACK"\);\s*return \{ ok: false/g) ?? []).length).toBe(0);
  });
});
