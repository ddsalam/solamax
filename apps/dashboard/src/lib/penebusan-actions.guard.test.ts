import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS penebusan (rencana 2026-10-29 U7; KTD5, KTD9, R26, R28) —
 * bentuk `pihak-lawan-actions.guard.test.ts`: komentar JS & SQL dibuang,
 * asersi urutan lewat `urutan()` (yang menuntut KEDUA ujung ada).
 *
 * Yang dijaga:
 *   · gerbang (`requireUnit` + predikat) & Σ komponen SEBELUM koneksi;
 *   · `hariBukuTerkunci(client` DI DALAM transaksi (BEGIN → set_config →
 *     hariBukuTerkunci) dan SEBELUM INSERT baris kas — dan hasilnya dipakai;
 *   · pembatalan memeriksa hari buku SEBELUM UPDATE; tanpa DELETE;
 *   · kelompok cocok aktif (U10) menolak void sebelum hari & UPDATE diperiksa.
 *
 * ⚠️ Batas: membuktikan penjagaan ADA di kode. Perilakunya:
 * `penebusan-actions.test.ts` (DB tiruan) dan uji DB-live ber-gerbang env.
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

const MENTAH = readFileSync(resolve(__dirname, "penebusan-actions.ts"), "utf8");
const KODE = tanpaKomentar(MENTAH);
/** Inti audit bersama (satu salinan SQL) — dipanggil lewat `auditKeuangan(`. */
const KODE_TX = tanpaKomentar(readFileSync(resolve(__dirname, "keuangan-tx.ts"), "utf8"));

const badan = (kode: string, nama: string): string => {
  const i = kode.indexOf(`export async function ${nama}`);
  if (i < 0) return "";
  const j = kode.indexOf("\nexport ", i + 1);
  return kode.slice(i, j < 0 ? undefined : j);
};

const BEGIN = 'client.query("BEGIN")';
const SETCFG = "set_config('app.unit_ids'";
const HARI = "hariBukuTerkunci(client";
const INS_KAS = "INSERT INTO app.cash_ledger";

/** Pelanggaran urutan pembukuan simpan — [] = patuh. */
function pelanggaranSimpan(fn: string): string[] {
  const salah: string[] = [];
  for (const [a, b] of [
    ["scope.requireUnit(input.code)", "pool.connect()"],
    ["canCatatPenebusan(ctx)", "pool.connect()"],
    ["periksaPenebusan(input)", "pool.connect()"],
    [BEGIN, SETCFG],
    [SETCFG, HARI],
    [HARI, INS_KAS],
    [INS_KAS, "INSERT INTO app.penebusan"],
    ["INSERT INTO app.penebusan", 'client.query("COMMIT")'],
  ] as const) {
    const u = urutan(fn, a, b);
    if (u !== "ok") salah.push(`${a} → ${b}: ${u}`);
  }
  return salah;
}

describe("simpanPenebusan — hari buku DI DALAM transaksi sebelum baris kas (KTD5, R28)", () => {
  const fn = badan(KODE, "simpanPenebusan");

  it("punya subjek", () => {
    expect(fn).not.toBe("");
    expect(fn).toMatch(/INSERT INTO app\.penebusan/);
  });

  it("🔴 gerbang → koneksi → BEGIN → set_config → hariBukuTerkunci → INSERT kas → INSERT penebusan → COMMIT", () => {
    expect(pelanggaranSimpan(fn)).toEqual([]);
  });

  it("🔴 hasilnya DIPAKAI: pra-cut-over ditolak; hari buku, tanggal asal & kode alasan ditulis", () => {
    expect(fn).toMatch(/if \(hari\.status === "pra-cut-over"\) \{\s*await batal\(client\);\s*return/);
    expect(fn).toMatch(/hari\.hariBuku,/);
    expect(fn).toMatch(/maju \? input\.tanggalBayar : null/);
    expect(fn).toMatch(/maju \? KODE_MAJU_PENEBUSAN : null/);
    expect(fn).toMatch(/tanggal_asal, alasan_maju, alasan_maju_applies_to/);
  });

  it("predikat wewenang DITOLAK (return), bukan sekadar dipanggil", () => {
    expect(fn).toMatch(/if \(!canCatatPenebusan\(ctx\)\) \{\s*return \{ ok: false/);
    expect(fn).toMatch(/if \(!cek\.ok\) return \{ ok: false/);
  });

  it("DAYA-BEDA: hariBukuTerkunci dipindah ke sesudah INSERT / dihapus / sebelum BEGIN ⇒ merah", () => {
    const panggil = fn.slice(fn.indexOf("const hari = await hariBukuTerkunci("), fn.indexOf("\n", fn.indexOf("const hari = await hariBukuTerkunci(")));
    expect(panggil).not.toBe("");
    const hapus = fn.replace(panggil, "const hari = { status: \"dibukukan\", hariBuku: input.tanggalBayar, perluKodeAlasan: false } as const;");
    expect(pelanggaranSimpan(hapus).length).toBeGreaterThan(0);

    const sesudah = fn.replace(panggil, "").replace(
      "const pnb = await client.query",
      `${panggil}\n    const pnb = await client.query`,
    );
    expect(sesudah).not.toBe(fn);
    expect(pelanggaranSimpan(sesudah).length).toBeGreaterThan(0);

    const sebelum = fn.replace(panggil, "").replace(`await ${BEGIN};`, `${panggil}\n    await ${BEGIN};`);
    expect(pelanggaranSimpan(sebelum).length).toBeGreaterThan(0);
  });
});

describe("batalkanPenebusan — hari terbuka, tanpa DELETE", () => {
  const fn = badan(KODE, "batalkanPenebusan");

  it("🔴 gerbang sebelum koneksi; hariBukuTerkunci sebelum UPDATE; hari tertutup ditolak", () => {
    expect(fn).not.toBe("");
    expect(urutan(fn, "canBatalkanPenebusan(ctx)", "pool.connect()")).toBe("ok");
    expect(urutan(fn, SETCFG, HARI)).toBe("ok");
    expect(urutan(fn, HARI, "UPDATE app.penebusan")).toBe("ok");
    expect(fn).toMatch(/hari\.hariBuku !== p\.businessDate/);
  });

  it("baris kas ikut di-void HANYA bila dibuat penebusan ini", () => {
    expect(fn).toMatch(/if \(p\.kasDibuat\) \{\s*await client\.query\(\s*`UPDATE app\.cash_ledger/);
  });

  it("🔴 U10: kelompok cocok AKTIF diperiksa sesudah kunci, SEBELUM pemeriksaan hari & UPDATE, dan menolak", () => {
    expect(urutan(fn, "FOR UPDATE OF p, l", "FROM app.cocok_bank_baris")).toBe("ok");
    expect(urutan(fn, "FROM app.cocok_bank_baris", "hariBukuTerkunci(client")).toBe("ok");
    expect(urutan(fn, "FROM app.cocok_bank_baris", "UPDATE app.penebusan")).toBe("ok");
    expect(fn).toMatch(/if \(\(cocok\.rows\[0\]\?\.n \?\? 0\) > 0\) \{\s*await batal\(client\);\s*return \{/);
  });
});

describe("berkas aksi", () => {
  it("tanpa DELETE; hanya cash_ledger, penebusan, audit_log yang ditulis (R14)", () => {
    expect(KODE).not.toMatch(/DELETE FROM/i);
    expect(KODE_TX).not.toMatch(/DELETE FROM/i);
    expect(KODE).toMatch(/auditKeuangan\(client, scope, "penebusan\.catat"/);
    expect(KODE).toMatch(/auditKeuangan\(client, scope, "penebusan\.batal"/);
    const tulis = [...(KODE + KODE_TX).matchAll(/(INSERT INTO|UPDATE) (app\.\w+)/g)].map((m) => m[2]);
    expect(new Set(tulis)).toEqual(new Set(["app.cash_ledger", "app.penebusan", "app.audit_log"]));
  });

  it("set_config transaction-local di kedua aksi", () => {
    expect([...KODE.matchAll(/set_config\('app\.unit_ids', \$1, true\)/g)]).toHaveLength(2);
  });
});
