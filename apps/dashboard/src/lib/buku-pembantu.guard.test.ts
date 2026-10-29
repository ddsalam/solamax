import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canViewLaporanKeuangan } from "./keuangan-wewenang";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS halaman buku pembantu pihak lawan (rencana 2026-10-29 U6).
 * Perilaku saldonya diuji di `buku-pembantu-model.test.ts`; di sini yang
 * dijaga adalah gerbang baca dan SUMBER angkanya.
 */
const HAL = readFileSync(resolve(__dirname, "../app/(app)/keuangan/unit/[code]/pihak-lawan/page.tsx"), "utf8");

describe("buku pembantu pihak lawan — gerbang & sumber", () => {
  it("🔴 pengawas DITOLAK: gerbang §10.13 menolak sebelum satu pun data dibaca", () => {
    expect(canViewLaporanKeuangan({ role: "pengawas", email: "pengawas@example.test" })).toBe(false);
    expect(HAL).toMatch(/if \(!canViewLaporanKeuangan\(ctx\)\) notFound\(\)/);
    expect(urutan(HAL, "canViewLaporanKeuangan(ctx)", "getBahanBukuPembantu(")).toBe("ok");
    expect(urutan(HAL, "canViewLaporanKeuangan(ctx)", "getBahanParitas(")).toBe("ok");
  });

  it("saldo lahir dari jalur baca NERACA, bukan hitungan kedua", () => {
    expect(HAL).toMatch(/getBahanBukuPembantu\(unit\.unit_id, per\)/);
    expect(HAL).toMatch(/bukuPembantu\(\{/);
    expect(HAL).not.toMatch(/getMutasiPihakLawan/);
  });

  it("tanggal bawaan HARI INI; tidak ada ekspor CSV (Scope Boundaries)", () => {
    expect(HAL).toMatch(/const hariIni = todayWib\(\)/);
    expect(HAL).not.toMatch(/ExportMount|text\/csv|toCsv|\.csv/);
  });
});
