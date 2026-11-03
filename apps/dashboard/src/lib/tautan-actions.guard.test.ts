import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS atas `tautan-actions.ts` (rencana K6 U3; R27 jenis (b)): wewenang
 * input SEBELUM koneksi; RLS → baca+kunci kedua baris → periksaTautanBeban →
 * UPDATE → audit → COMMIT; setiap penolakan lewat `tolak` (ROLLBACK).
 * Membuktikan penjagaan ADA, bukan perilakunya terhadap DB.
 */
const tanpaKomentar = (src: string): string =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");

const KODE = tanpaKomentar(readFileSync(resolve(__dirname, "tautan-actions.ts"), "utf8"));
const FN = KODE.slice(KODE.indexOf("export async function tautkanBebanKeMutasi"));

/** Tukar kemunculan pertama `a` dan `b` — memaksa urutan terbalik. */
const tukar = (teks: string, a: string, b: string): string => teks.replace(a, "\u0000").replace(b, a).replace("\u0000", b);

describe("tautkanBebanKeMutasi — penjagaan yang tak boleh hilang", () => {
  it("penjaga ini punya SUBJEK; satu-satunya aksi yang diekspor", () => {
    expect([...KODE.matchAll(/export async function (\w+)/g)].map((m) => m[1])).toEqual(["tautkanBebanKeMutasi"]);
    expect(FN.length).toBeGreaterThan(500);
  });

  it("🔴 scope → wewenang input SEBELUM koneksi; penolakan tanpa menyentuh DB", () => {
    expect(urutan(FN, "requireUnit(", "alasanTakBolehInput(")).toBe("ok");
    expect(urutan(FN, "alasanTakBolehInput(", "pool.connect()")).toBe("ok");
    expect(FN).toMatch(/if \(alasan !== null\) return \{ ok: false, error: PESAN_TAK_BOLEH_INPUT\[alasan\] \}/);
  });

  it("🔴 URUTAN: BEGIN → RLS → baca+kunci beban → baca+kunci kas → periksaTautanBeban → UPDATE → audit → COMMIT", () => {
    expect(urutan(FN, 'client.query("BEGIN")', "set_config('app.unit_ids'")).toBe("ok");
    expect(urutan(FN, "set_config('app.unit_ids'", "FOR UPDATE OF m")).toBe("ok");
    expect(urutan(FN, "FOR UPDATE OF m", "FOR UPDATE OF l")).toBe("ok");
    expect(urutan(FN, "FOR UPDATE OF l", "periksaTautanBeban(")).toBe("ok");
    expect(urutan(FN, "periksaTautanBeban(", "UPDATE app.manual_entry")).toBe("ok");
    expect(urutan(FN, "UPDATE app.manual_entry", "auditKeuangan(client")).toBe("ok");
    expect(urutan(FN, "auditKeuangan(client", 'client.query("COMMIT")')).toBe("ok");
  });

  it("🔴 SETIAP penolakan sesudah BEGIN lewat tolak() (ROLLBACK); tolak() sendiri ber-ROLLBACK", () => {
    expect(FN).toMatch(/const tolak = async \(error: string\): Promise<TautanResult> => \{\s*await client\.query\("ROLLBACK"\);\s*return \{ ok: false, error \};/);
    const sesudah = FN.slice(FN.indexOf('client.query("BEGIN")'));
    // Sesudah BEGIN satu-satunya `return { ok: false` langsung adalah jalur catch (sudah ROLLBACK); sisanya lewat tolak().
    expect((sesudah.match(/return \{ ok: false/g) ?? []).length).toBe(1);
    expect((sesudah.match(/return tolak\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
    // Galat tak terduga: ROLLBACK dulu, baru dilaporkan.
    expect(urutan(FN.slice(FN.indexOf("} catch (e)")), 'client.query("ROLLBACK")', "return { ok: false")).toBe("ok");
  });

  it("🔴 tautan hanya menulis cash_ledger_id; penjaga TOCTOU di WHERE & rowCount diperiksa sebelum audit", () => {
    const up = FN.slice(FN.indexOf("UPDATE app.manual_entry"), FN.indexOf("`", FN.indexOf("UPDATE app.manual_entry")));
    expect(up).toMatch(/SET cash_ledger_id = \$1::uuid, updated_at = now\(\)/);
    expect(up).not.toMatch(/amount|nominal|operational_category|accounting_account/);
    expect(up).toMatch(/AND NOT void\s+AND cash_ledger_id IS NULL AND source_door = 'finance'/);
    expect(urutan(FN, "res.rowCount !== 1", "auditKeuangan(client")).toBe("ok");
    expect(FN).not.toMatch(/DELETE FROM|INSERT INTO app\.manual_entry|UPDATE app\.cash_ledger/);
  });

  it("daya-beda: pemeriksa MEMERAHKAN urutan terbalik / subjek hilang", () => {
    expect(urutan(tukar(FN, "alasanTakBolehInput(", "pool.connect()"), "alasanTakBolehInput(", "pool.connect()")).not.toBe("ok");
    expect(urutan(tukar(FN, "periksaTautanBeban(", "UPDATE app.manual_entry"), "periksaTautanBeban(", "UPDATE app.manual_entry")).not.toBe("ok");
    expect(urutan(tukar(FN, "auditKeuangan(client", 'client.query("COMMIT")'), "auditKeuangan(client", 'client.query("COMMIT")')).not.toBe("ok");
    expect(urutan(FN.replaceAll("alasanTakBolehInput(", "x("), "alasanTakBolehInput(", "pool.connect()")).not.toBe("ok");
  });
});
