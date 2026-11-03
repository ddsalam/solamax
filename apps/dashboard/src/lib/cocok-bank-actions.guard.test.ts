import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS aksi kelompok cocok (rencana 2026-10-29 U10; R31; KTD6;
 * Implementation Constraints "Gerbang dua unit") — bentuk
 * `impor-bank-actions.guard.test.ts`: komentar JS & SQL dibuang, asersi urutan
 * lewat `urutan()` (yang menuntut KEDUA ujung ada).
 *
 * Yang dijaga:
 *   · gerbang (`requireUnit` + predikat) SEBELUM koneksi di ketiga aksi;
 *   · mencocokkan TIDAK menulis `cash_ledger` (KTD6) — hanya pembatalan atas
 *     baris LAHIRAN yang menulis buku, sesudah kelompok dinonaktifkan; dan
 *     SATU pengecualian bernama: pasangan Setoran ke Bank jemputan (K6 U7),
 *     yang hanya menulis kaki LAHIRAN sesudah setoran dikunci & hari dikunci;
 *   · inti tulis bukan berkas "use server"; tanpa DELETE;
 *   · penanda U12 (bulan tertutup) sebelum UPDATE pembatalan.
 *
 * ⚠️ Batas: membuktikan penjagaan ADA di kode. Perilakunya:
 * `cocok-bank-actions.test.ts` (DB tiruan) dan uji DB-live ber-gerbang env.
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

const MENTAH = readFileSync(resolve(__dirname, "cocok-bank-actions.ts"), "utf8");
const KODE = tanpaKomentar(MENTAH);
const TULIS_MENTAH = readFileSync(resolve(__dirname, "cocok-bank-tulis.ts"), "utf8");
const TULIS = tanpaKomentar(TULIS_MENTAH);
/** Inti audit bersama (satu salinan SQL) — dipanggil lewat `auditKeuangan(`. */
const KODE_TX = tanpaKomentar(readFileSync(resolve(__dirname, "keuangan-tx.ts"), "utf8"));

/** K6 U7 — satu-satunya bagian inti tulis yang boleh menulis `cash_ledger`. */
const iPasangan = TULIS.indexOf("const INSERT_KAKI_SETORAN");
const jPasangan = TULIS.indexOf("export type HasilOtomatis");
const PASANGAN = iPasangan < 0 || jPasangan < iPasangan ? "" : TULIS.slice(iPasangan, jPasangan);
const TULIS_LAIN = PASANGAN === "" ? TULIS : TULIS.slice(0, iPasangan) + TULIS.slice(jPasangan);

const badan = (kode: string, nama: string): string => {
  const i = kode.indexOf(`export async function ${nama}`);
  if (i < 0) return "";
  const j = kode.indexOf("\nexport ", i + 1);
  return kode.slice(i, j < 0 ? undefined : j);
};

describe("gerbang SEBELUM koneksi", () => {
  for (const [nama, predikat] of [
    ["cocokkanOtomatis", "canCocokkanBank(ctx)"],
    ["cocokkanManual", "canCocokkanBank(ctx)"],
    ["terimaUsulanSetoran", "canCocokkanBank(ctx)"],
    ["batalkanCocok", "canBatalkanCocokBank("],
  ] as const) {
    it(`🔴 ${nama}: requireUnit → ${predikat} → pool.connect() → BEGIN → set_config`, () => {
      const fn = badan(KODE, nama);
      expect(fn).not.toBe("");
      expect(urutan(fn, "scope.requireUnit(", "pool.connect()")).toBe("ok");
      expect(urutan(fn, predikat, "pool.connect()")).toBe("ok");
      expect(urutan(fn, 'client.query("BEGIN")', "set_config('app.unit_ids', $1, true)")).toBe("ok");
    });
  }
});

describe("⛔ KTD6 — mencocokkan tak menulis buku", () => {
  it("cocokkanOtomatis, cocokkanManual, terimaUsulanSetoran, dan inti tulis (selain pasangan jemputan) tak menyentuh cash_ledger", () => {
    for (const fn of [badan(KODE, "cocokkanOtomatis"), badan(KODE, "cocokkanManual"), badan(KODE, "terimaUsulanSetoran"), TULIS_LAIN]) {
      expect(fn).not.toMatch(/(INSERT INTO|UPDATE) app\.cash_ledger/);
    }
    expect(KODE_TX).not.toMatch(/(INSERT INTO|UPDATE) app\.cash_ledger/);
    expect(TULIS).toMatch(/auditKeuangan\(c, m\.aktor, "cocok_bank\.otomatis"/);
    const tulis = [...(TULIS_LAIN + KODE_TX).matchAll(/(INSERT INTO|UPDATE) (app\.\w+)/g)].map((m) => m[2]);
    expect(new Set(tulis)).toEqual(new Set(["app.cocok_bank", "app.cocok_bank_baris", "app.audit_log"]));
  });

  it("🔴 K6 U7 pasangan jemputan: hanya INSERT kaki LAHIRAN; setoran dikunci & diperiksa, hari dikunci, kelompok dulu — semuanya SEBELUM INSERT", () => {
    expect(PASANGAN).not.toBe("");
    expect(PASANGAN).not.toMatch(/UPDATE app\.cash_ledger/);
    expect([...PASANGAN.matchAll(/INSERT INTO (app\.\w+)/g)].map((m) => m[1])).toEqual(["app.cash_ledger"]);
    expect(PASANGAN).toMatch(/lahir_dari_cocok_id\)/);
    expect(urutan(PASANGAN, "bacaKasId(c, m.unitId, ids, true)", "INSERT_KAKI_SETORAN, [")).toBe("ok");
    expect(urutan(PASANGAN, "if (!utuh) return", "hariBukuTerkunci(")).toBe("ok");
    expect(urutan(PASANGAN, "hariBukuTerkunci(c, m.unitId, m.mutasi.tanggalBank, { accountId: m.akunKasBesar })", "buatKelompok(")).toBe("ok");
    expect(urutan(PASANGAN, "buatKelompok(", "INSERT_KAKI_SETORAN, [")).toBe("ok");
    expect(urutan(PASANGAN, "INSERT_KAKI_SETORAN, [", "tambahAnggota(")).toBe("ok");
  });

  it("terimaUsulanSetoran: rekening koran dikunci, usulan dihitung ULANG di server SEBELUM pasangan ditulis", () => {
    const fn = badan(KODE, "terimaUsulanSetoran");
    expect(urutan(fn, "FOR NO KEY UPDATE", "usulkanSemua(")).toBe("ok");
    expect(urutan(fn, "usulkanSemua(", "tulisPasanganJemputan(")).toBe("ok");
    expect(fn).toMatch(/if \(!u \|\| !kandidat \|\| !ktx\.akunKasBesar\) \{\s*await batal\(client\);\s*return/);
  });

  it("manual: Σ diperiksa (periksaKelompokManual) SEBELUM kelompok ditulis; baris kas dikunci sebelum diperiksa", () => {
    const fn = badan(KODE, "cocokkanManual");
    expect(urutan(fn, "FOR NO KEY UPDATE", "periksaKelompokManual(")).toBe("ok");
    expect(urutan(fn, "bacaKasId(client, unit.unit_id, [...kasIds].sort(), true)", "periksaKelompokManual(")).toBe("ok");
    expect(urutan(fn, "periksaKelompokManual(", "tulisKelompok(")).toBe("ok");
    expect(fn).toMatch(/if \(!v\.ok\) \{\s*await batal\(client\);\s*return/);
  });
});

describe("batalkanCocok — HoF, kelompok dulu baru buku", () => {
  const fn = badan(KODE, "batalkanCocok");

  it("🔴 kelompok dikunci, gerbang dua unit & penanda U12 SEBELUM UPDATE; buku ditulis SESUDAH kelompok nonaktif", () => {
    expect(urutan(fn, "FROM app.cocok_bank", "UPDATE app.cocok_bank")).toBe("ok");
    expect(fn).toMatch(/FOR UPDATE`/);
    expect(urutan(fn, "k.pasanganUuid !== null", "UPDATE app.cocok_bank")).toBe("ok");
    expect(urutan(fn, "UPDATE app.cocok_bank", "UPDATE app.cash_ledger")).toBe("ok");
    expect(urutan(fn, "UPDATE app.cocok_bank", "INSERT INTO app.cash_ledger")).toBe("ok");
    expect(urutan(fn, "hariBukuTerkunci(client", "INSERT INTO app.cash_ledger")).toBe("ok");
    // U12 — bulan tertutup (kunci bersama → baca) sesudah kunci kelompok, sebelum UPDATE, dan menolak.
    expect(urutan(fn, "FOR UPDATE", "bulanTertutupTerkunci(client, unit.unit_id, bulanBank)")).toBe("ok");
    expect(urutan(fn, "bulanTertutupTerkunci(", "UPDATE app.cocok_bank")).toBe("ok");
    expect(fn).toMatch(/if \(tertutup\.length > 0\) \{\s*await batal\(client\);\s*return \{\s*ok: false/);
  });

  it("🔴 U11 gerbang dua unit: unit lawan kaki pasangan lahiran → requireUnit SEBELUM koneksi; transaksi memuat kedua unit; balik lewat tulisBalikPasangan sesudah kelompok nonaktif", () => {
    expect(urutan(fn, "l.pasangan_uuid IS NOT NULL", "pool.connect()")).toBe("ok");
    expect(urutan(fn, "lawan = scope.requireUnit(kode)", "pool.connect()")).toBe("ok");
    expect(fn).toMatch(/if \(kode === null\) \{\s*return \{\s*ok: false/);
    expect(fn).toMatch(/set_config\('app\.unit_ids', \$1, true\)", \[unitIds\]/);
    expect(urutan(fn, "UPDATE app.cocok_bank", "tulisBalikPasangan(client")).toBe("ok");
    // Void sepihak kaki pasangan tidak ada: baris ber-pasangan dilewati rencana biasa.
    expect(fn).toMatch(/if \(k\.pasanganUuid !== null\) continue;/);
  });

  it("🔴 U11 beban tertaut: hari terbuka ⇒ ikut di-void; hari tertutup ⇒ ditolak SEBELUM kelompok dinonaktifkan", () => {
    expect(urutan(fn, "!buka && k.bebanId !== null", "UPDATE app.cocok_bank")).toBe("ok");
    expect(urutan(fn, "!buka && !k.sisiLawanAda", "UPDATE app.cocok_bank")).toBe("ok");
    expect(urutan(fn, "UPDATE app.cocok_bank", "UPDATE app.manual_entry")).toBe("ok");
  });

  it("hanya baris LAHIRAN kelompok ini yang di-void / dibalik", () => {
    expect(fn).toMatch(/l\.lahir_dari_cocok_id = \$2::uuid AND NOT l\.void/);
    expect(fn).toMatch(/ADJ-FWD-REVERSAL|KODE_PEMBALIK/);
  });
});

describe("berkas", () => {
  it("🔴 inti tulis BUKAN berkas \"use server\"; aksi berkas \"use server\"", () => {
    expect(TULIS_MENTAH).not.toMatch(/^\s*["']use server["']/m);
    expect(MENTAH).toMatch(/^"use server";/);
  });

  it("tanpa DELETE; anggota kelompok tak pernah di-UPDATE aplikasi (cermin FK)", () => {
    for (const k of [KODE, TULIS]) {
      expect(k).not.toMatch(/DELETE\s+FROM/i);
      expect(k).not.toMatch(/UPDATE app\.cocok_bank_baris/);
    }
  });
});
