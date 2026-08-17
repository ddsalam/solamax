import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS atas `tutup-hari-actions.ts` (Layar 4) — permukaan tulis yang
 * paling mahal kalau salah: penutupan MENGUNCI `manual_entry` terhadap void.
 */
const baca = (f: string): string =>
  readFileSync(resolve(__dirname, f), "utf8")
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n")
    .replace(/--.*$/gm, "");

const KODE = baca("tutup-hari-actions.ts");
const PANEL = baca("../components/keuangan/TutupHariPanel.tsx");
const HAL = baca("../app/(app)/keuangan/unit/[code]/tutup-hari/[date]/page.tsx");

describe("tutup-hari-actions — penjagaan yang tak boleh hilang", () => {
  it("penjaga ini punya SUBJEK", () => {
    expect(KODE).toMatch(/export async function tutupHari/);
  });

  it("🔴 SELISIH dibaca ulang di server — tidak pernah dari client", () => {
    // Kalau selisih boleh dikirim browser, SELURUH tangga §3.2 bisa dilewati
    // dengan mengirim 0.
    const masukan = KODE.slice(
      KODE.indexOf("export interface TutupHariInput"),
      KODE.indexOf("}", KODE.indexOf("export interface TutupHariInput")) + 1,
    );
    expect(masukan).toMatch(/reasonCode/);
    expect(masukan).not.toMatch(/difference|selisih/i);
    expect(KODE).toMatch(/const differenceRp = Number\(row\.differenceRp\)/);
  });

  it("🔴 AMBANG tidak disalin — satu tempat yang memutuskan", () => {
    // Menyalin ambang berarti layar, aksi, dan laporan bisa menjawab berbeda
    // untuk pertanyaan yang sama.
    expect(KODE).toMatch(/periksaTutupHari\(/);
    // 🔴 Bukan hanya DIPANGGIL — hasilnya harus MENOLAK. Uji mutasi: menghapus
    // blok `if (!hasil.boleh)` meninggalkan `const hasil = …` yang tetap cocok
    // dengan asersi di atas, jadi penjaga hijau sementara tangga §3.2 mati
    // total. Kelas yang sama sudah muncul di keempat aksi Layar 3.
    expect(KODE).toMatch(/if \(!hasil\.boleh\) \{/);
    expect(KODE).toMatch(/return \{ ok: false, error: pesanKurang\(hasil\.kurang\)/);
    expect(KODE).toMatch(/tierFor\(differenceRp\)/);
    for (const src of [KODE, PANEL]) {
      expect(src).not.toMatch(/10_?000\b|100_?000\b/);
    }
    // Panel memakai konstanta bersama, bukan angka.
    expect(PANEL).toMatch(/TOLERANSI_RP/);
    expect(PANEL).toMatch(/BATAS_HOF_RP/);
  });

  it("🔴 requires_target_date dibaca dari MASTER, bukan dari nama kodenya", () => {
    expect(KODE).toMatch(/FROM app\.reason_code/);
    expect(KODE).not.toMatch(/CLS-INVESTIGATING/);
    expect(PANEL).not.toMatch(/CLS-INVESTIGATING/);
  });

  it("FOR UPDATE + status='open' — dua penutup tak menutup dua kali", () => {
    expect(KODE).toMatch(/FOR UPDATE/);
    expect(KODE).toMatch(/AND status='open'/);
  });

  it("hari tanpa baris penilaian TIDAK bisa ditutup", () => {
    // Menutup hari yang belum dinilai adalah menutup mata, bukan menutup buku.
    expect(KODE).toMatch(/belum punya baris penilaian/);
  });

  it("RLS di-set sebelum DML, dan tak ada DELETE", () => {
    expect(urutan(KODE, "set_config('app.unit_ids'", "UPDATE app.day_close")).toBe("ok");
    expect(KODE).not.toMatch(/DELETE FROM/i);
  });

  it("🔴 wewenang dihitung DI SERVER, layar hanya menerima hasilnya", () => {
    // Kesimpulan klien bisa dibuat benar dengan mengubah state di peramban.
    expect(HAL).toMatch(/bolehMenutup\(tierFor\(/);
    expect(PANEL).toMatch(/bolehMenutupTier: boolean/);
    // Panel TIDAK memanggil predikat wewenang sendiri.
    expect(PANEL).not.toMatch(/canCloseException|canOverrideAboveMax|bolehMenutup\(/);
  });

  it("gerbang BACA §10.13 dipakai dan penolakannya terjadi", () => {
    expect(HAL).toMatch(/if \(!canViewLaporanKeuangan\([^)]*\)\) notFound\(\)/);
  });

  it("kumulatif yang belum tersedia DISEBUT, bukan disembunyikan", () => {
    expect(PANEL).toMatch(/LANGKAH HARIAN/);
    expect(PANEL).toMatch(/kumulatif belum tersedia|kumulatif/);
  });
});
