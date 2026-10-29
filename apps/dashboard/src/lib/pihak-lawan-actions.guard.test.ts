import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS jalur tulis pihak lawan (rencana 2026-10-29 U3) — bentuk yang
 * sama dengan `kas-actions.guard.test.ts`: komentar JS & SQL dibuang, asersi
 * urutan lewat `urutan()` (yang menuntut KEDUA ujung ada).
 *
 * Yang dijaga:
 *   · `pecahMutasi` (jalur tulis BARU) memanggil `hariBukuTerkunci` di dalam
 *     transaksi, sesudah set_config, SEBELUM INSERT — dan memakai hasilnya;
 *   · saldo pembuka pasangan: `requireUnit` KEDUA unit + wewenang SEBELUM BEGIN;
 *   · setiap aksi menolak sebelum `pool.connect()`; tak ada DELETE;
 *   · "Tetapkan pihak lawan" hanya mengisi satu kolom, sekali, dari NULL;
 *   · inti tulis TANPA gerbang tidak berada di berkas "use server".
 *
 * ⚠️ Batas: ini membuktikan penjagaan ADA di kode, bukan bahwa ia bekerja di
 * DB. Perilakunya: `pihak-lawan-actions.test.ts`, `kas-actions.pihak-lawan
 * .test.ts`, dan uji DB-live ber-gerbang env.
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
const AKSI = tanpaKomentar(baca("pihak-lawan-actions.ts"));
const KAS = tanpaKomentar(baca("kas-actions.ts"));
const TULIS_MENTAH = baca("pihak-lawan-tulis.ts");
const TULIS = tanpaKomentar(TULIS_MENTAH);

const badan = (kode: string, nama: string): string => {
  const i = kode.indexOf(`export async function ${nama}`);
  if (i < 0) return "";
  const j = kode.indexOf("\nexport ", i + 1);
  return kode.slice(i, j < 0 ? undefined : j);
};

/** Pelanggaran gerbang dua unit pada badan `tetapkanSaldoAwalPihakLawan` — [] = patuh. */
function pelanggaranDuaUnit(fn: string): string[] {
  const salah: string[] = [];
  const BEGIN = 'client.query("BEGIN")';
  for (const g of [
    "scope.requireUnit(input.code)",
    "scope.requireUnit(kodeLawan)",
    "canTetapkanSaldoAwalPihakLawan(",
  ]) {
    const u = urutan(fn, g, BEGIN);
    if (u !== "ok") salah.push(`${g}: ${u}`);
  }
  // Ditolak UTUH bila unit lawan tak dipegang — dan penolakan itu terjadi sebelum koneksi.
  const tolak = urutan(fn, "if (kodeLawan === null) {", "pool.connect()");
  if (tolak !== "ok") salah.push(`tolak unit lawan: ${tolak}`);
  if (!/if \(kodeLawan === null\) \{\s*return \{\s*ok: false/.test(fn)) salah.push("kodeLawan null tak ditolak");
  // Scope transaksi memuat KEDUA unit.
  if (!/`\$\{unit\.unit_id\},\$\{lawan\.unit_id\}`/.test(fn)) salah.push("app.unit_ids tak memuat unit lawan");
  return salah;
}

describe("pecahMutasi — jalur tulis BARU memakai penjaga hari tertutup (U2)", () => {
  const fn = badan(KAS, "pecahMutasi");

  it("punya subjek", () => {
    expect(fn).not.toBe("");
    expect(fn).toMatch(/INSERT INTO app\.cash_ledger/);
  });

  it("🔴 hariBukuTerkunci DI DALAM transaksi: BEGIN → set_config → hariBukuTerkunci → INSERT", () => {
    expect(urutan(fn, 'client.query("BEGIN")', "set_config('app.unit_ids'")).toBe("ok");
    expect(urutan(fn, "set_config('app.unit_ids'", "hariBukuTerkunci(client")).toBe("ok");
    expect(urutan(fn, "hariBukuTerkunci(client", "INSERT INTO app.cash_ledger")).toBe("ok");
  });

  it("🔴 hasilnya DIPAKAI: pra-cut-over ditolak, hari buku & tanggal asal ditulis", () => {
    expect(fn).toMatch(/if \(hari\.status === "pra-cut-over"\) \{\s*await client\.query\("ROLLBACK"\);\s*return/);
    expect(fn).toMatch(/tanggal_asal, alasan_maju, alasan_maju_applies_to/);
    expect(fn).toMatch(/hari\.hariBuku,/);
    expect(fn).toMatch(/maju \? input\.date : null/);
    expect(fn).toMatch(/maju \? KODE_MAJU_PECAHAN : null/);
  });

  it("Σ pecahan diperiksa sebelum koneksi, dan penolakannya terjadi", () => {
    expect(urutan(fn, "periksaPecahan(", "pool.connect()")).toBe("ok");
    expect(fn).toMatch(/if \(salahPecahan !== null\) return \{ ok: false, error: salahPecahan \}/);
  });

  it("🔴 gerbang Keuangan (pengawas & HoF ditolak) — lewat buka() yang sama", () => {
    expect(urutan(fn, "const ctx = await buka(input.code)", "pool.connect()")).toBe("ok");
    expect(fn).toMatch(/if \(!ctx\.boleh\) return \{ ok: false, error: ctx\.error \}/);
  });
});

describe("simpanMutasiKas — pihak lawan dibaca ulang di server (R2)", () => {
  const fn = badan(KAS, "simpanMutasiKas");
  it("pemeriksaan ada-tidaknya sebelum koneksi; baca ulang + kunci di dalam transaksi", () => {
    expect(urutan(fn, "periksaPihakLawanMutasi(", "pool.connect()")).toBe("ok");
    expect(urutan(fn, 'client.query("BEGIN")', "bacaPihakLawanTerkunci(client")).toBe("ok");
    expect(urutan(fn, "bacaPihakLawanTerkunci(client", "INSERT INTO app.cash_ledger")).toBe("ok");
    expect(fn).toMatch(/pihak_lawan_id\)/);
  });
  it("⚠️ simpanMutasiKas TETAP tanpa hariBukuTerkunci — celah lama di luar cakupan (rencana)", () => {
    // Bila kelak diubah, penjaga ini merah supaya perubahan itu keputusan sadar.
    expect(fn).not.toMatch(/hariBukuTerkunci/);
  });
});

describe("saldo pembuka pasangan — GERBANG DUA UNIT sebelum BEGIN", () => {
  const fn = badan(AKSI, "tetapkanSaldoAwalPihakLawan");

  it("🔴 kedua requireUnit + wewenang HoF mendahului BEGIN; scope = kedua unit", () => {
    expect(fn).not.toBe("");
    expect(pelanggaranDuaUnit(fn)).toEqual([]);
  });

  it("DAYA-BEDA: memindah requireUnit unit lawan ke sesudah BEGIN memerahkan penjaga", () => {
    const mutan = fn
      .replace("lawan = scope.requireUnit(kodeLawan);", "")
      .replace(
        'await client.query("BEGIN");',
        'await client.query("BEGIN");\n    lawan = scope.requireUnit(kodeLawan);',
      );
    expect(mutan).not.toBe(fn);
    expect(pelanggaranDuaUnit(mutan).length).toBeGreaterThan(0);
    const tanpaScopeB = fn.replace("`${unit.unit_id},${lawan.unit_id}`", "String(unit.unit_id)");
    expect(pelanggaranDuaUnit(tanpaScopeB)).toContain("app.unit_ids tak memuat unit lawan");
  });

  it("🔴 penolakan wewenang DIPAKAI, bukan hanya dipanggil", () => {
    expect(fn).toMatch(
      /if \(!canTetapkanSaldoAwalPihakLawan\(\{ role: scope\.role, email: scope\.email \}\)\) \{\s*return \{ ok: false, error: "Hanya Head of Finance/,
    );
  });
});

describe("setiap aksi pihak lawan — gerbang, set_config, append-only", () => {
  const AKSI_BUKA = [
    ["tambahPihakLawan", "canTambahPihakLawan"],
    ["nonaktifkanPihakLawan", "canNonaktifkanPihakLawan"],
    ["tetapkanPihakLawanBaris", "canTetapkanPihakLawanBaris"],
  ] as const;

  for (const [aksi, predikat] of AKSI_BUKA) {
    it(`${aksi}: buka(…, ${predikat}) menolak sebelum koneksi`, () => {
      const fn = badan(AKSI, aksi);
      expect(fn, aksi).not.toBe("");
      expect(urutan(fn, `const ctx = await buka(input.code, ${predikat})`, "pool.connect()")).toBe("ok");
      expect(fn).toMatch(/if \(!ctx\.boleh\) return \{ ok: false, error: ctx\.error \}/);
      expect(urutan(fn, "set_config('app.unit_ids'", "await audit(client")).toBe("ok");
    });
  }

  it("buka() MENOLAK bila predikat gagal — hasilnya dipakai", () => {
    expect(AKSI).toMatch(/if \(!boleh\(ctx\)\) return \{ boleh: false, error: pesanTakBolehKetik\(ctx\) \}/);
    expect(urutan(AKSI, "const unit = scope.requireUnit(code)", "if (!boleh(ctx))")).toBe("ok");
  });

  it("set_config transaction-local di setiap transaksi tulis (4 aksi)", () => {
    expect([...AKSI.matchAll(/set_config\('app\.unit_ids', \$1, true\)/g)]).toHaveLength(4);
    expect([...AKSI.matchAll(/pool\.connect\(\)/g)]).toHaveLength(4);
  });

  it("🔴 VOID-only: tak ada DELETE di jalur tulis pihak lawan", () => {
    for (const k of [AKSI, TULIS, KAS]) expect(k).not.toMatch(/DELETE\s+FROM/i);
  });

  it("🔴 Tetapkan pihak lawan: SATU kolom, SEKALI, dari NULL — nominal/tanggal/kategori tak disentuh", () => {
    const fn = badan(AKSI, "tetapkanPihakLawanBaris");
    const i = fn.indexOf("UPDATE app.cash_ledger");
    const upd = fn.slice(i, fn.indexOf("`", i));
    expect(upd).toMatch(/SET pihak_lawan_id = \$1::uuid\s+WHERE/);
    expect(upd).toMatch(/AND pihak_lawan_id IS NULL AND NOT void/);
    expect(upd).not.toMatch(/amount|business_date|category_label|category_side/);
    expect(fn).toMatch(/"kas\.pihak_lawan\.tetapkan"/);
  });
});

describe("inti tulis (pihak-lawan-tulis.ts)", () => {
  it("🔴 BUKAN berkas \"use server\" — fungsinya tanpa gerbang, tak boleh jadi endpoint", () => {
    expect(TULIS_MENTAH).not.toMatch(/^\s*["']use server["']/m);
  });

  it("saldo pembuka: void yang lama → insert → audit tetapkan|ganti", () => {
    expect(urutan(TULIS, "UPDATE app.pihak_lawan_saldo_awal", "INSERT INTO app.pihak_lawan_saldo_awal")).toBe("ok");
    expect(TULIS).toMatch(/SET void = true, voided_by_user_id = \$2, voided_at = now\(\)/);
    expect(TULIS).toMatch(/"pihak_lawan\.saldo_awal\.tetapkan" : "pihak_lawan\.saldo_awal\.ganti"/);
    expect(TULIS).not.toMatch(/SET amount/);
  });

  it("sisi lawan pasangan = nominalSisiLawan(amount), dan unit lawan dibaca ulang di transaksi", () => {
    expect(TULIS).toMatch(/amount: nominalSisiLawan\(m\.amount\)/);
    expect(TULIS).toMatch(/pihak\.lawanUnitId !== m\.lawan\.unitId/);
  });
});
