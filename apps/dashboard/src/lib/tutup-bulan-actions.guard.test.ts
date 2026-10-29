import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS atas tutup bulan (rencana 2026-10-29 U12; R25; KTD14) — urutan
 * kunci → baca ulang → vonis → tulis, satu pembuat vonis, gerbang baca/tulis.
 */
const tanpaKomentar = (src: string): string =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");

const MENTAH = readFileSync(resolve(__dirname, "tutup-bulan-actions.ts"), "utf8");
const KODE = tanpaKomentar(MENTAH);
/** Inti audit bersama (satu salinan SQL) — dipanggil lewat `auditKeuangan(`. */
const KODE_TX = tanpaKomentar(readFileSync(resolve(__dirname, "keuangan-tx.ts"), "utf8"));
const Q = tanpaKomentar(readFileSync(resolve(__dirname, "tutup-bulan-queries.ts"), "utf8"));
const HAL = tanpaKomentar(
  readFileSync(resolve(__dirname, "../app/(app)/keuangan/unit/[code]/tutup-bulan/[bulan]/page.tsx"), "utf8"),
);
const PERIKSA = tanpaKomentar(readFileSync(resolve(__dirname, "../components/keuangan/TutupBulanPeriksa.tsx"), "utf8"));
const TOMBOL = tanpaKomentar(readFileSync(resolve(__dirname, "../components/keuangan/TutupBulanTombol.tsx"), "utf8"));

describe("tutupBulan — penjagaan yang tak boleh hilang", () => {
  const fn = KODE.slice(KODE.indexOf("export async function tutupBulan"));

  it("penjaga ini punya SUBJEK; berkas aksi 'use server'", () => {
    expect(fn).toMatch(/export async function tutupBulan/);
    expect(MENTAH).toMatch(/^"use server";/);
  });

  it("🔴 wewenang HoF SEBELUM koneksi", () => {
    expect(urutan(fn, "canTutupBulan(", "pool.connect()")).toBe("ok");
  });

  it("🔴 URUTAN: RLS → kunci eksklusif bulan → kunci baris → BACA ULANG → vonis → tulis → audit → COMMIT", () => {
    expect(urutan(fn, "set_config('app.unit_ids'", "kunciBulanEksklusif(client")).toBe("ok");
    expect(urutan(fn, "kunciBulanEksklusif(client", "FOR UPDATE")).toBe("ok");
    expect(urutan(fn, "FOR UPDATE", "bacaBahanTutupBulan(client")).toBe("ok");
    expect(urutan(fn, "bacaBahanTutupBulan(client", "periksaTutupBulan(")).toBe("ok");
    expect(urutan(fn, "periksaTutupBulan(", "INSERT INTO app.tutup_bulan")).toBe("ok");
    expect(urutan(fn, "INSERT INTO app.tutup_bulan", "auditKeuangan(client")).toBe("ok");
    expect(urutan(fn, "auditKeuangan(client", 'client.query("COMMIT")')).toBe("ok");
    // Jejak audit tinggal di satu salinan bersama (keuangan-tx.ts).
    expect(KODE_TX).toMatch(/INSERT INTO app\.audit_log \(actor_user_id, actor_email, action, target, detail\)/);
  });

  it("🔴 vonis MENOLAK (bukan sekadar dipanggil); masukan dibaca lewat KLIEN TRANSAKSI, bukan qScoped", () => {
    expect(fn).toMatch(/if \(!vonis\.boleh\) \{\s*await batal\(client\);\s*return \{ ok: false/);
    expect(fn).toMatch(/const bahan = await bacaBahanTutupBulan\(client, unit\.unit_id, input\.bulan\)/);
    expect(fn).not.toMatch(/getBahanTutupBulan|qScoped/);
  });

  it("idempoten: baris yang sudah ada dijawab 'sudah ditutup' SEBELUM membaca syarat; ON CONFLICT DO NOTHING", () => {
    expect(urutan(fn, "sudah.rows.length > 0", "bacaBahanTutupBulan(client")).toBe("ok");
    expect(fn).toMatch(/ON CONFLICT \(unit_id, bulan\) DO NOTHING/);
    expect(fn).toMatch(/"tutup_bulan\.tutup"/);
  });

  it("🔴 aturan R25 tidak disalin di aksi, halaman, atau komponen — satu pembuat vonis", () => {
    for (const src of [KODE, HAL, PERIKSA, TOMBOL]) {
      expect(src).not.toMatch(/KATEGORI_PENAMPUNG|Mutasi Belum Teridentifikasi|ADJ-FWD-REVERSAL|saldoAwal\b/);
    }
    expect(HAL).toMatch(/const vonis = periksaTutupBulan\(bahan\)/);
  });

  it("tanpa UPDATE/DELETE atas tutup_bulan (bulan tertutup beku)", () => {
    expect(KODE).not.toMatch(/UPDATE app\.tutup_bulan|DELETE FROM/i);
  });
});

describe("kunci bulan — eksklusif bagi penutup, bersama bagi jalur tulis, KUNCI DULU baru BACA", () => {
  it("🔴 bulanTertutupTerkunci: kunci bersama (urut) SEBELUM membaca tutup_bulan", () => {
    const f = Q.slice(Q.indexOf("export async function bulanTertutupTerkunci"));
    expect(urutan(f, "pg_advisory_xact_lock_shared(", "FROM app.tutup_bulan")).toBe("ok");
    expect(f).toMatch(/\.sort\(\)/);
  });

  it("🔴 penutup & jalur tulis memakai kunci yang SAMA (satu ekspresi)", () => {
    const n = (Q.match(/KUNCI_BULAN_SQL/g) ?? []).length;
    expect(n).toBeGreaterThanOrEqual(3); // definisi + eksklusif + bersama
    expect(Q).toMatch(/pg_advisory_xact_lock\(\$\{KUNCI_BULAN_SQL\}\)/);
    expect(Q).toMatch(/pg_advisory_xact_lock_shared\(\$\{KUNCI_BULAN_SQL\}\)/);
  });

  it("rekening wajib = PREDIKAT_REKENING_BCA (rekening bank lain tak pernah dituntut)", () => {
    const rek = Q.slice(Q.indexOf("export const SQL_REKENING_WAJIB"), Q.indexOf("export const SQL_IMPOR_BULAN"));
    expect(rek).toMatch(/\$\{PREDIKAT_REKENING_BCA\}/);
    const buku = Q.slice(Q.indexOf("export const SQL_BUKU_BULAN"));
    expect(buku).toMatch(/\$\{PREDIKAT_REKENING_BCA\}/);
  });
});

describe("halaman tutup bulan — gerbang baca & tombol", () => {
  it("gerbang BACA §10.13 dipakai dan penolakannya terjadi", () => {
    expect(HAL).toMatch(/if \(!canViewLaporanKeuangan\([^)]*\)\) notFound\(\)/);
  });

  it("🔴 tombol HANYA bagi canTutupBulan (dihitung di server), aktif HANYA bila vonis lolos", () => {
    expect(HAL).toMatch(/const bolehTutup = canTutupBulan\(ctx\)/);
    expect(HAL).toMatch(/\{bolehTutup && tertutup === null && <TutupBulanTombol [^>]*siap=\{vonis\.boleh\}/);
    expect(TOMBOL).toMatch(/disabled=\{pending \|\| !siap\}/);
    expect(TOMBOL).not.toMatch(/canTutupBulan|isHeadOfFinance/);
  });
});
