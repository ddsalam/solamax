import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga GERBANG BACA per-rute keuangan.
 *
 * 🔴 **KELAS YANG DITUTUPNYA.** Tinjauan pra-promosi menemukan **4 dari 5** rute
 * keuangan punya gerbang baca, dan yang kelima — Layar 3, Input keuangan —
 * TIDAK. Pengawas yang membukanya melihat harga beli, SALDO tujuh rekening,
 * settlement EDC, dan klasifikasi akuntansi; `bolehTulis` hanya menyembunyikan
 * FORMULIRNYA, bukan tabelnya.
 *
 * ⚠️ Yang membuat ini lolos: memeriksa **keberadaan** `canViewLaporanKeuangan`
 * di satu berkas lulus, sementara pertanyaan yang benar adalah **apakah SETIAP
 * rute punya**. Penjaga yang menghitung satu contoh tidak menjaga himpunan —
 * dan relay-lah yang menyuruh memeriksa per-rute, bukan per-berkas.
 *
 * Karena itu penjaga ini bekerja dengan **MENEMUKAN sendiri** daftar rutenya
 * dari sistem berkas: rute keuangan baru otomatis ikut dijaga tanpa ada yang
 * perlu ingat menambahkannya ke daftar.
 */
const KEUANGAN = resolve(__dirname, "../app/(app)/keuangan");

/** Semua `page.tsx` di bawah /keuangan — ditemukan, bukan didaftar tangan. */
function rutePage(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return rutePage(p);
    return e.name === "page.tsx" ? [p] : [];
  });
}

const RUTE = rutePage(KEUANGAN);

describe("setiap rute /keuangan punya gerbang BACA yang MENOLAK", () => {
  it("penjaga ini punya SUBJEK — rutenya ditemukan, dan jumlahnya masuk akal", () => {
    // Kalau penemuannya gagal, `RUTE` kosong dan uji di bawah lulus tanpa
    // subjek. Lima layar berdiri hari ini.
    expect(RUTE.length).toBeGreaterThanOrEqual(5);
  });

  for (const f of RUTE) {
    const nama = f.slice(KEUANGAN.length + 1) || "page.tsx";
    it(`${nama}: memanggil gerbang DAN memakai hasilnya`, () => {
      const src = readFileSync(f, "utf8");
      // Bukan hanya "gerbangnya disebut" — penolakannya harus terjadi.
      expect(
        src,
        `${nama} tidak menolak pembaca tak berhak — periksa canViewLaporanKeuangan + notFound()`,
      ).toMatch(/if \(!canViewLaporanKeuangan\([^)]*\)\) notFound\(\)/);
    });
  }

  it("🔴 DAYA-BEDA: pola asersinya memang menolak bentuk yang salah", () => {
    // Tanpa ini, penjaga di atas bisa hijau karena polanya terlalu longgar.
    const pola = /if \(!canViewLaporanKeuangan\([^)]*\)\) notFound\(\)/;
    expect("canViewLaporanKeuangan({ role, email });").not.toMatch(pola); // dipanggil, hasil dibuang
    expect("const b = canViewLaporanKeuangan(ctx);").not.toMatch(pola); // disimpan, tak menolak
    expect("if (!canViewLaporanKeuangan(ctx)) notFound();").toMatch(pola); // benar
  });
});
