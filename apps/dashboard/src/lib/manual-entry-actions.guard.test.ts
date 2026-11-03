import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga struktur setoran otomatis ke Kas Besar (rencana K6 U5 — R14, R17,
 * KTD6). Perilakunya dibuktikan `setoran-tulis.test.ts` (DB tiruan); berkas
 * ini menjaga BENTUK yang tak boleh hilang diam-diam saat disunting.
 *
 * Komentar JS dan SQL dibuang dulu — penjaga yang lulus karena kata kuncinya
 * tinggal di komentar tidak menjaga apa-apa (pola `kas-actions.guard.test.ts`).
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

const AKSI_MENTAH = readFileSync(resolve(__dirname, "manual-entry-actions.ts"), "utf8");
const TULIS_MENTAH = readFileSync(resolve(__dirname, "setoran-tulis.ts"), "utf8");
const AKSI = tanpaKomentar(AKSI_MENTAH);
const TULIS = tanpaKomentar(TULIS_MENTAH);

/** Badan satu fungsi (`export async function` atau `async function`) sampai fungsi tingkat-atas berikutnya. */
const badan = (s: string, nama: string): string => {
  const m = new RegExp(`^(export )?async function ${nama}\\b`, "m").exec(s);
  if (!m) throw new Error(`fungsi ${nama} tak ditemukan`);
  const sisa = s.slice(m.index + 1);
  const j = sisa.search(/^(export |async function |const |type |\/\*\*)/m);
  return s.slice(m.index, j < 0 ? undefined : m.index + 1 + j);
};

describe("inti tulis setoran-tulis.ts (KTD6)", () => {
  it("🔴 BUKAN berkas \"use server\" — fungsi tanpa gerbang tak boleh jadi endpoint peramban", () => {
    expect(TULIS_MENTAH).not.toMatch(/^\s*["']use server["']/m);
  });

  it("🔴 akun tujuan = akun aktif kind 'kas' bernama baku \"Kas Besar\"", () => {
    const b = badan(TULIS, "siapkan");
    expect(b).toMatch(/a\.kind = 'kas' AND a\.active AND a\.nama = \$2/);
    expect(b).toMatch(/NAMA_BAKU\.kas/);
    expect(urutan(b, "PESAN_TANPA_KAS_BESAR", "hariBukuTerkunci(")).toBe("ok");
  });

  it("🔴 hari buku dikunci SEBELUM setoran & baris kas ditulis", () => {
    const b = badan(TULIS, "simpanSetoranTunai");
    expect(urutan(b, "siapkan(", "INSERT INTO app.manual_entry")).toBe("ok");
    expect(urutan(b, "INSERT INTO app.manual_entry", "tulisBarisKas(")).toBe("ok");
    expect(badan(TULIS, "siapkan")).toMatch(/hariBukuTerkunci\(c, unitId, tanggal, \{ accountId: tujuan\.id \}\)/);
    expect(urutan(badan(TULIS, "postingSetoran"), "siapkan(", "tulisBarisKas(")).toBe("ok");
  });

  it("🔴 hari tertutup tidak didorong maju (perluKodeAlasan ⇒ tolak)", () => {
    expect(badan(TULIS, "siapkan")).toMatch(/if \(hari\.perluKodeAlasan\) \{\s*return \{\s*ok: false/);
  });

  it("🔴 nominal baris kas = nominal setoran yang TERSIMPAN, bukan angka dari client", () => {
    const tulis = badan(TULIS, "tulisBarisKas");
    // Parameter INSERT dipaku utuh: nominal ke-5 = `m.entri.amount`, tak ada sumber lain.
    expect(tulis).toContain(
      "[m.unitId, m.akunId, m.hariBuku, m.entri.keterangan, m.entri.amount, m.aktorId, m.entri.id]",
    );
    expect(tulis.match(/amount/g)?.length).toBe(3); // tipe `entri`, kolom INSERT, parameter
    // simpanSetoranTunai meneruskan baris hasil RETURNING, bukan `m.amount`.
    const simpan = badan(TULIS, "simpanSetoranTunai");
    expect(simpan).toMatch(/RETURNING id::text AS id, keterangan, amount::text AS amount/);
    expect(simpan).toMatch(/const entri = ins\.rows\[0\]/);
    expect(simpan).toMatch(/tulisBarisKas\(c, \{[^}]*entri,/);
  });

  it("idempoten: ON CONFLICT pada indeks unik parsial 0033", () => {
    expect(badan(TULIS, "tulisBarisKas")).toMatch(
      /ON CONFLICT \("source_manual_entry_id"\) WHERE "source_manual_entry_id" IS NOT NULL AND NOT "void"\s*DO NOTHING/,
    );
  });

  it("🔴 pembatalan menolak baris kas di kelompok cocok AKTIF sebelum UPDATE", () => {
    const b = badan(TULIS, "batalkanKasSetoran");
    expect(b).toMatch(/FROM app\.cocok_bank_baris b\s*WHERE b\.cash_ledger_id = l\.id AND b\.unit_id = l\.unit_id AND b\.aktif/);
    expect(b).toMatch(/FOR UPDATE OF l/);
    expect(urutan(b, "PESAN_SETORAN_DICOCOKKAN", "UPDATE app.cash_ledger")).toBe("ok");
  });
});

describe("server action (manual-entry-actions.ts)", () => {
  it("🔴 setoran_tunai lewat transaksi + inti tulis; gerbang requireUnit mendahuluinya", () => {
    const b = badan(AKSI, "addManualEntry");
    expect(urutan(b, "scope.requireUnit(", 'input.section === "setoran_tunai"')).toBe("ok");
    expect(b).toMatch(/dalamTransaksi\(unit, scope, \(c\) =>\s*simpanSetoranTunai\(c, \{/);
    expect(b).toMatch(/unitId: unit\.unit_id,/);
    expect(b).toMatch(/aktorId: scope\.userId,/);
  });

  it("🔴 transaksi: BEGIN → set_config app.unit_ids → kerja → COMMIT; galat/penolakan ⇒ ROLLBACK", () => {
    const b = badan(AKSI, "dalamTransaksi");
    expect(urutan(b, '"BEGIN"', "set_config('app.unit_ids'")).toBe("ok");
    expect(urutan(b, "set_config('app.unit_ids'", "kerja(client)")).toBe("ok");
    expect(urutan(b, "kerja(client)", '"COMMIT"')).toBe("ok");
    expect(b).toMatch(/if \(!r\.ok\) \{\s*await client\.query\("ROLLBACK"\)/);
    expect(b).toMatch(/catch \(e\) \{\s*try \{\s*await client\.query\("ROLLBACK"\)/);
    expect(b).toMatch(/client\.release\(\)/);
  });

  it("🔴 void setoran: baris kas dibatalkan DALAM transaksi yang sama, sebelum manual_entry", () => {
    const b = badan(AKSI, "voidManualEntry");
    expect(urutan(b, "dalamTransaksi(unit", "batalkanKasSetoran(")).toBe("ok");
    expect(urutan(b, "batalkanKasSetoran(", "UPDATE app.manual_entry")).toBe("ok");
    expect(b).toMatch(/if \(!kas\.ok\) return kas;/);
    // Baris pintu Finance tetap tak bisa dibatalkan dari Rincian (§2).
    expect(b.match(/source_door = 'pengawas'/g)?.length).toBe(2);
  });
});
