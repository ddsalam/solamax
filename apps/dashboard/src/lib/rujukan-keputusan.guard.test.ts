import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga RUJUKAN `§10.x` — **kutipan ke dokumen adalah klaim**, dan tunduk pada
 * aturan yang sama dengan klaim lain: yang tidak diperiksa adalah tebakan.
 *
 * 🔴 KELAS YANG MELAHIRKANNYA (21 Agu 2026). `keuangan-integritas.ts` menyebut
 * **§10.9** sebagai sumber keputusan "tanpa foreign key"; keputusan itu ada di
 * **§10.10**. §10.9 sendiri bukan keputusan melainkan daftar "yang belum
 * terverifikasi", dan ia duduk **sesudah §10.20** sehingga penomorannya tak
 * urut. Siapa pun yang mengikuti kutipan itu tiba di tempat yang salah dan
 * menyimpulkan keputusannya tak pernah ditulis.
 *
 * ⚠️ **BATAS YANG DIAKUI, jangan dikira lebih.** Penjaga ini menjamin nomornya
 * **ADA**, **UNIK**, dan **URUT**. Ia **TIDAK** bisa menilai apakah sebuah
 * kutipan menunjuk bagian yang BENAR — §10.9 dulu ada, dan kutipannya tetap
 * salah. Itu tetap pemeriksaan manusia. Yang ditutup penjaga ini adalah kelas
 * yang membuat kesalahan itu sulit terlihat: nomor yang hilang, ganda, atau
 * tidak urut.
 */

const DOK = resolve(__dirname, "../../KEUANGAN-HARIAN.md");
const SRC = resolve(__dirname, "..");

/** Nomor bagian §10 di dokumen, berurut sesuai kemunculannya. */
export function nomorBagian(md: string): number[] {
  return [...md.matchAll(/^### 10\.(\d+)\b/gm)].map((m) => Number(m[1]));
}

/** Tiap rujukan `§10.x` di kode (bukan di dokumen), dengan berkasnya. */
export function rujukanDalam(sumber: string): number[] {
  return [...sumber.matchAll(/§ ?10\.(\d+)/g)].map((m) => Number(m[1]));
}

function berkasTs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return berkasTs(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

/**
 * ⛔ SATU berkas dikecualikan: berkas ini sendiri. Ia memuat contoh karangan
 * (`§10.99`, `§10.9`) yang justru bukti daya-bedanya, dan memindai dirinya
 * membuat penjaganya menuduh dirinya sendiri.
 *
 * Pengecualiannya **sesempit mungkin dan diakui**: tepat satu berkas, dan
 * jumlahnya diasersi — daftar-lewat yang bisa tumbuh adalah tempat kutipan buruk
 * bersembunyi.
 */
function berkasDipindai(): string[] {
  return berkasTs(SRC).filter((f) => f !== __filename);
}

/**
 * ⛔ TIGA PEMBUAT VONIS, dipakai uji atas dokumen NYATA maupun atas data
 * KARANGAN. Versi pertama menulis ketiganya inline di dalam asersinya, dan uji
 * daya-bedanya menyalin logikanya — sehingga melumpuhkan pemeriksanya tetap
 * HIJAU (mutasi U4/U5 lulus). Repo yang sehat tak menyediakan kasus gagal;
 * satu-satunya yang bisa memerahkan pemeriksa adalah data karangan yang lewat
 * PEMERIKSA YANG SAMA.
 */
export function rujukanHilang(nomor: readonly number[], ada: ReadonlySet<number>): number[] {
  return nomor.filter((n) => !ada.has(n));
}

export function nomorGanda(nomor: readonly number[]): number[] {
  return nomor.filter((n, i) => nomor.indexOf(n) !== i);
}

/** Nomor yang melanggar urutan menaik — kosong berarti urut. */
export function nomorTakUrut(nomor: readonly number[]): number[] {
  return nomor.filter((n, i) => i > 0 && n < nomor[i - 1]!);
}

const MD = readFileSync(DOK, "utf8");
const NOMOR = nomorBagian(MD);
const ADA = new Set(NOMOR);

describe("rujukan §10.x di kode menunjuk bagian yang benar-benar ada", () => {
  it("penjaga ini punya SUBJEK — dokumennya terbaca dan bagiannya banyak", () => {
    expect(NOMOR.length).toBeGreaterThanOrEqual(15);
    // Pengecualian tepat SATU berkas (berkas ini). Kalau daftar-lewatnya tumbuh,
    // baris ini merah — dan pertumbuhannya harus dibela, bukan diam-diam.
    expect(berkasTs(SRC).length - berkasDipindai().length).toBe(1);
  });

  it("🔴 setiap §10.x yang dikutip kode ADA di dokumen", () => {
    const hilang: string[] = [];
    let jumlahRujukan = 0;
    for (const f of berkasDipindai()) {
      const nomor = rujukanDalam(readFileSync(f, "utf8"));
      jumlahRujukan += nomor.length;
      for (const n of rujukanHilang(nomor, ADA)) hilang.push(`${f.replace(SRC, "src")}: §10.${n}`);
    }
    // Nol rujukan = penjaga tanpa subjek, bukan kabar baik.
    expect(jumlahRujukan, "tak satu pun rujukan §10.x ditemukan di kode").toBeGreaterThan(20);
    expect(hilang, `rujukan ke bagian yang tak ada:\n${hilang.join("\n")}`).toEqual([]);
  });

  it("🔴 nomor bagian UNIK — tak ada §10.x ganda", () => {
    const ganda = nomorGanda(NOMOR);
    expect(ganda, `nomor ganda: ${ganda.join(", ")}`).toEqual([]);
  });

  it("🔴 nomor bagian URUT — inilah yang memerah pada §10.9 yang salah tempat", () => {
    const salah = nomorTakUrut(NOMOR);
    expect(salah, `urutan sekarang: ${NOMOR.join(", ")}`).toEqual([]);
  });

  it("🔴 DAYA-BEDA: ketiga pemeriksa memang menolak bentuk yang salah", () => {
    // ⛔ Lewat PEMBUAT VONIS YANG SAMA dengan asersi atas dokumen nyata.
    // Nomor tak ada.
    expect(rujukanHilang(rujukanDalam("lihat §10.99 untuk itu"), ADA)).toEqual([99]);
    // Ganda — bentuk yang pernah nyaris terjadi saat §10.20 ditambahkan.
    expect(nomorGanda(nomorBagian("### 10.1 a\n### 10.1 b\n"))).toEqual([1]);
    // Tidak urut — bentuk PERSIS yang pernah ada (10.9 sesudah 10.20).
    expect(nomorTakUrut(nomorBagian("### 10.19 x\n### 10.20 y\n### 10.9 z\n"))).toEqual([9]);
    // Kontrol POSITIF: dokumen yang benar lolos ketiganya, tanpa kecuali.
    const benar = nomorBagian("### 10.1 a\n### 10.2 b\n");
    expect(benar).toEqual([1, 2]);
    expect(nomorGanda(benar)).toEqual([]);
    expect(nomorTakUrut(benar)).toEqual([]);
    expect(rujukanHilang([1, 2], new Set(benar))).toEqual([]);
  });

  it("§10.9 tak lagi ada sebagai bagian, dan tak ada yang mengutipnya", () => {
    // Ia kini catatan riwayat tanpa nomor — lihat kepala berkas.
    expect(ADA.has(9)).toBe(false);
    for (const f of berkasDipindai()) {
      expect(rujukanDalam(readFileSync(f, "utf8")), f).not.toContain(9);
    }
  });
});
