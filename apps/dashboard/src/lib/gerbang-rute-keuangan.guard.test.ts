import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

/**
 * Semua `page.tsx` **dan `route.ts`** di bawah /keuangan — ditemukan, bukan
 * didaftar tangan.
 *
 * ⛔ `route.ts` ikut sejak ekspor PDF dibangun. Ekspornya sendiri terjadi di
 * PERAMBAN pada halaman yang sudah bergerbang, jadi ia tak menambah rute — tapi
 * "tak ada rute baru hari ini" bukan jaminan. Handler server yang kelak
 * mengembalikan PDF adalah permukaan ketujuh yang bentuknya BEDA, dan penjaga
 * yang hanya melihat `page.tsx` akan melaporkan "semua aman" atasnya.
 */
export function ruteKeuangan(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return ruteKeuangan(p);
    return e.name === "page.tsx" || e.name === "route.ts" ? [p] : [];
  });
}

const RUTE = ruteKeuangan(KEUANGAN);

describe("setiap rute /keuangan punya gerbang BACA yang MENOLAK", () => {
  it("penjaga ini punya SUBJEK — rutenya ditemukan, dan jumlahnya masuk akal", () => {
    // Kalau penemuannya gagal, `RUTE` kosong dan uji di bawah lulus tanpa
    // subjek. ENAM rute berdiri hari ini (lima layar + kelola akun kas).
    expect(RUTE.length).toBeGreaterThanOrEqual(6);
  });

  it("🔴 EKSPOR PDF BUKAN RUTE — ia dibangun di peramban, di halaman bergerbang", () => {
    // Kalau kelak ekspor jadi handler server, berkasnya akan muncul di RUTE dan
    // uji per-rute di atas menuntut gerbangnya. Baris ini merekam keadaan yang
    // dijamin HARI INI, supaya perubahannya terlihat sebagai perubahan.
    expect(RUTE.filter((f) => f.endsWith("route.ts"))).toEqual([]);
    // ⛔ Baris di atas SENDIRIAN tak bisa merah: repo hari ini memang tak punya
    //    route.ts, jadi mencabut penemuannya pun tetap menghasilkan []. Subjek
    //    yang bisa menjatuhkannya dibuatkan di sini — kalau penemuan `route.ts`
    //    dilucuti, baris ini merah.
    const tmp = mkdtempSync(join(tmpdir(), "rute-"));
    try {
      mkdirSync(join(tmp, "ekspor"));
      writeFileSync(join(tmp, "page.tsx"), "x");
      writeFileSync(join(tmp, "ekspor", "route.ts"), "export async function GET() {}");
      const ketemu = ruteKeuangan(tmp).map((f) => f.slice(tmp.length + 1)).sort();
      expect(ketemu).toEqual([join("ekspor", "route.ts"), "page.tsx"].sort());
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    // Dan dudukan ekspornya memang dipasang dari halaman yang bergerbang.
    for (const [hal, komponen] of [
      ["page.tsx", "PapanExportMount"],
      [join("unit", "[code]", "[date]", "page.tsx"), "LaporanKeuanganExportMount"],
    ] as const) {
      const src = readFileSync(join(KEUANGAN, hal), "utf8");
      expect(src, `${hal} tak memasang ${komponen}`).toContain(`<${komponen}`);
      expect(src).toMatch(/if \(!canViewLaporanKeuangan\([^)]*\)\) notFound\(\)/);
    }
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
