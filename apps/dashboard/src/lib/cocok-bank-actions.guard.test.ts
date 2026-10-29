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
 *     baris LAHIRAN yang menulis buku, sesudah kelompok dinonaktifkan;
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
  it("cocokkanOtomatis, cocokkanManual, dan inti tulis tak menyentuh cash_ledger", () => {
    for (const fn of [badan(KODE, "cocokkanOtomatis"), badan(KODE, "cocokkanManual"), TULIS]) {
      expect(fn).not.toMatch(/(INSERT INTO|UPDATE) app\.cash_ledger/);
    }
    const tulis = [...TULIS.matchAll(/(INSERT INTO|UPDATE) (app\.\w+)/g)].map((m) => m[2]);
    expect(new Set(tulis)).toEqual(new Set(["app.cocok_bank", "app.cocok_bank_baris", "app.audit_log"]));
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
    const m = MENTAH.slice(MENTAH.indexOf("export async function batalkanCocok"));
    expect(urutan(m, "U12 MENAMBAHKAN DI SINI", "UPDATE app.cocok_bank")).toBe("ok");
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
