import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga struktur alur EDC per shift (§10.25; rencana K6 U6 — R15, R16,
 * KTD6, KTD7). Perilakunya dibuktikan `edc-shift-tulis.test.ts` (DB tiruan);
 * berkas ini menjaga BENTUK yang tak boleh hilang diam-diam saat disunting.
 */

const AKSI = readFileSync(resolve(__dirname, "edc-shift-actions.ts"), "utf8");
const TULIS = readFileSync(resolve(__dirname, "edc-shift-tulis.ts"), "utf8");

const badan = (s: string, nama: string): string => {
  const i = s.indexOf(`export async function ${nama}`);
  if (i < 0) throw new Error(`fungsi ${nama} tak ditemukan`);
  const j = s.indexOf("\nexport ", i + 1);
  return s.slice(i, j < 0 ? undefined : j);
};

/** "ok" bila `a` muncul sebelum `b` di `s`; selain itu keterangan yang terbaca. */
const urutan = (s: string, a: string, b: string): string => {
  const ia = s.indexOf(a);
  const ib = s.indexOf(b);
  if (ia < 0) return `tak ada: ${a}`;
  if (ib < 0) return `tak ada: ${b}`;
  return ia < ib ? "ok" : `${a} sesudah ${b}`;
};

describe("inti tulis edc-shift-tulis.ts (KTD6)", () => {
  it("🔴 BUKAN berkas \"use server\" — fungsi tanpa gerbang tak boleh jadi endpoint peramban", () => {
    expect(TULIS).not.toMatch(/^\s*["']use server["']/m);
  });

  it("🔴 hariBukuTerkunci dipanggil sebelum INSERT ke cash_ledger", () => {
    const b = badan(TULIS, "postingPenjualanEdc");
    expect(urutan(b, "hariBukuTerkunci(", "INSERT INTO app.cash_ledger")).toBe("ok");
  });

  it("baris cek dikunci (FOR UPDATE) dan bruto dihitung ULANG sebelum ditulis", () => {
    const b = badan(TULIS, "postingPenjualanEdc");
    expect(urutan(b, "FOR UPDATE", "INSERT INTO app.cash_ledger")).toBe("ok");
    expect(urutan(b, "brutoSekarang(", "INSERT INTO app.cash_ledger")).toBe("ok");
  });

  it("nominal yang dibukukan = bruto EasyMax dari cek, bukan slip", () => {
    const b = badan(TULIS, "postingPenjualanEdc");
    expect(b).toMatch(/cek\.easymaxRp,\s*\n\s*m\.aktorId/);
    expect(b).not.toMatch(/slipRp,\s*\n\s*m\.aktorId/);
  });

  it("tanggal buku = hari dari penjaga, bukan tanggal masukan mentah", () => {
    const b = badan(TULIS, "postingPenjualanEdc");
    expect(b).toMatch(/hari\.hariBuku,/);
  });
});

describe("server action (edc-shift-actions.ts)", () => {
  it("gerbang wewenang mendahului koneksi DB di ketiga aksi", () => {
    for (const [nama, gerbang] of [
      ["simpanPetaKartu", "canPetakanKartuEdc("],
      ["cekSlipEdc", "canCekSlipEdc("],
      ["setujuiPenjualanEdc", "alasanTakBolehInput("],
    ] as const) {
      const b = badan(AKSI, nama);
      expect(b.indexOf(gerbang), nama).toBeGreaterThan(-1);
      expect(b.indexOf(gerbang), nama).toBeLessThan(b.indexOf("pool.connect()"));
    }
  });

  it("bruto dihitung ULANG di server saat mencocokkan", () => {
    expect(badan(AKSI, "cekSlipEdc")).toMatch(/brutoSekarang\(/);
  });

  it("baris dikunci (FOR UPDATE) sebelum divonis & ditulis", () => {
    expect(badan(AKSI, "setujuiPenjualanEdc")).toMatch(/FOR UPDATE/);
    expect(badan(AKSI, "cekSlipEdc")).toMatch(/FOR UPDATE/);
  });

  it("R15: cekSlipEdc memposting lewat inti tulis yang SAMA, sesudah cek tersimpan, dalam transaksi yang sama", () => {
    const b = badan(AKSI, "cekSlipEdc");
    expect(urutan(b, "INSERT INTO app.edc_shift_cek", "postingPenjualanEdc(client")).toBe("ok");
    expect(urutan(b, "postingPenjualanEdc(client", 'client.query("COMMIT")')).toBe("ok");
    expect(b).toMatch(/vonisCekSlip\(/);
  });

  it("🔴 KTD7: riwayat cek dibaca TERMASUK yang sudah batal", () => {
    const b = badan(AKSI, "cekSlipEdc");
    const i = b.indexOf("SQL_RIWAYAT_CEK");
    expect(i).toBeGreaterThan(-1);
    const m = AKSI.match(/const SQL_RIWAYAT_CEK = `([^`]*)`/);
    expect(m, "SQL_RIWAYAT_CEK").not.toBeNull();
    expect(m![1]).not.toMatch(/void/i);
  });

  it("jalur Finance memakai inti tulis yang sama", () => {
    expect(badan(AKSI, "setujuiPenjualanEdc")).toMatch(/postingPenjualanEdc\(client/);
  });

  it("🔴 pengecek ≠ penyetuju hanya di jalur Finance — bukan di posting otomatis", () => {
    expect(badan(AKSI, "setujuiPenjualanEdc")).toMatch(/k\.checkedByUserId === scope\.userId/);
    expect(badan(AKSI, "cekSlipEdc")).not.toMatch(/checkedByUserId === scope\.userId/);
    expect(TULIS).not.toMatch(/checkedByUserId === /);
  });

  it("tak ada INSERT cash_ledger langsung di berkas aksi — satu-satunya penulis adalah inti tulis", () => {
    expect(AKSI).not.toMatch(/INSERT INTO app\.cash_ledger/);
  });
});
