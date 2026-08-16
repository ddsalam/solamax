import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { urutan } from "./penjaga-urutan";

/**
 * Penjaga TEKS atas Layar 2 — laporan keuangan harian.
 *
 * Yang dijaga di sini berbeda dari blok-blok Layar 3: bukan "tulisannya benar",
 * melainkan **tidak ada tulisan sama sekali**. Layar 2 read-only, dan read-only
 * yang hanya konvensi akan berhenti read-only pada perubahan pertama yang
 * terburu-buru.
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

const HAL = baca("../app/(app)/keuangan/unit/[code]/[date]/page.tsx");
const KUERI = baca("keuangan-laporan-queries.ts");
const PANEL = baca("../components/keuangan/PanelLaporanKeuangan.tsx");
const MODEL = baca("keuangan-laporan-model.ts");
/** Sumber MENTAH — untuk asersi atas KOMENTAR, yang justru dibuang `baca()`. */
const MODEL_MENTAH = readFileSync(resolve(__dirname, "keuangan-laporan-model.ts"), "utf8");

describe("Layar 2 — read-only, dan itu ditegakkan", () => {
  it("penjaga ini punya SUBJEK", () => {
    expect(HAL).toMatch(/export default async function LaporanKeuanganPage/);
    expect(KUERI).toMatch(/export async function getBahanLaporan/);
  });

  it("🔴 TIDAK ADA jalur tulis: tak ada server action, tak ada DML", () => {
    for (const [nama, src] of [["halaman", HAL], ["kueri", KUERI], ["panel", PANEL]] as const) {
      expect(src, `${nama} memuat "use server"`).not.toMatch(/"use server"/);
      expect(src, `${nama} memuat DML`).not.toMatch(/INSERT INTO|UPDATE app\.|DELETE FROM/i);
      expect(src, `${nama} memakai pool langsung`).not.toMatch(/pool\.connect\(\)/);
    }
  });

  it("gerbang BACA §10.13 dipanggil, dan penolakannya TERJADI", () => {
    expect(HAL).toMatch(/canViewLaporanKeuangan\(/);
    // Bukan hanya dipanggil — hasilnya dipakai untuk notFound().
    expect(HAL).toMatch(/if \(!canViewLaporanKeuangan\([^)]*\)\) notFound\(\)/);
    // …dan itu terjadi SEBELUM satu pun data dibaca.
    expect(urutan(HAL, "canViewLaporanKeuangan(", "getBahanLaporan(")).toBe("ok");
  });

  it("unit dari requireUnit, dan kueri menerima unit ter-scope", () => {
    expect(HAL).toMatch(/scope\.requireUnit\(code\)/);
    expect(HAL).toMatch(/getBahanLaporan\(unit\.unit_id/);
    expect(KUERI).toMatch(/unit: ScopedUnitId/);
  });

  it("🔴 beban digabung lewat SATU jalur — bukan jalur kedua yang ditulis ulang", () => {
    // Bukan "tak ada reduce" — mutasi membuktikan larangan berbasis SINTAKS
    // bisa dilewati dengan `map`. Yang diikat adalah SUMBER nilainya: `beban`
    // HARUS lahir dari `kumpulkanBeban`, titik.
    expect(KUERI).toMatch(/const beban = kumpulkanBeban\(/);
    expect([...KUERI.matchAll(/const beban\b/g)]).toHaveLength(1);
  });

  it("🔴 tak ada `?? 0` yang menyulap nilai tak diketahui jadi nol di MODEL", () => {
    // Model boleh memakai `?? 0` HANYA setelah memastikan nilainya ada (pola
    // `adaSemua`/`some(k => k === null)`), dan itu diuji perilakunya di
    // keuangan-laporan-model.test.ts. Yang dijaga di sini: nol tak pernah jadi
    // NILAI BARIS — hanya `null` yang boleh mewakili "tak diketahui".
    expect(MODEL).toMatch(/nilai: number \| null/);
    // Aturannya tertulis di modulnya — dibaca dari sumber MENTAH, sebab
    // `baca()` membuang komentar dan asersi atas komentar akan selalu merah.
    expect(MODEL_MENTAH).toMatch(/JANGAN diganti nol di pemanggil/);
  });

  it("🔴 neraca memakai SALDO, cash flow memakai ARUS — tak boleh tertukar", () => {
    // Dua angka sah dari kategori yang sama; yang salah hanya tempatnya, dan
    // itu tak memunculkan galat apa pun. Diikat per-variabel ke fungsinya.
    expect(KUERI).toMatch(/const saldoNonEasymax = adaAkun \? deltaKategoriSampai\(/);
    expect(KUERI).toMatch(/const arusNonEasymax = adaAkun \? deltaKategori\(/);
    // …dan masing-masing dipakai di tempat yang benar.
    expect(KUERI).toMatch(/hutangPiutangNonEasymax: saldoNonEasymax/);
    expect(KUERI).toMatch(/arusHutangPiutangNonEasymax: arusNonEasymax/);
    expect(HAL).toMatch(/hutangPiutangNonEasymax: b\.arusHutangPiutangNonEasymax/);
  });

  it("batas SOValue (B7) disebut DI LAYAR, bukan hanya di dokumen", () => {
    // Menyajikan angka yang kita tahu belum cocok tanpa menandainya adalah
    // bentuk paling halus dari melaporkan hasil yang menguntungkan.
    expect(HAL).toMatch(/Nilai DO/);
    expect(HAL).toMatch(/B7/);
    expect(HAL).toMatch(/4 dari 10/);
  });

  it("langkah harian disebut sebagai yang BERARTI, kumulatif ditandai bukan kesalahan hari ini", () => {
    expect(HAL).toMatch(/Langkah harian/);
    expect(HAL).toMatch(/bukan<\/strong> kesalahan hari ini|bukan\*\*? ?kesalahan hari ini/);
  });

  it("angka pemeriksa berada di KAKI panel dengan warna keadaan", () => {
    expect(PANEL).toMatch(/lap-chk/);
    expect(PANEL).toMatch(/nadaPemeriksa\(/);
    // …dan nilai null tidak dicetak sebagai 0.
    expect(PANEL).toMatch(/belum bisa dihitung/);
  });
});
