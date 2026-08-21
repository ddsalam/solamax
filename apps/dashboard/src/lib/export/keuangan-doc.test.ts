import { describe, expect, it } from "vitest";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import type { PanelBalance, PanelLaporan } from "@/lib/keuangan-laporan-model";
import type { BarisUnit } from "@/lib/keuangan-papan-model";
import { buildLaporanKeuanganDoc } from "./keuangan-harian-doc";
import { buildPapanKeuanganDoc } from "./keuangan-papan-doc";
import { catatanSebab, selNilai, tekstKaki, type KopKeuangan } from "./keuangan-kop";

/**
 * Kelas cacat yang dijaga berkas ini — masing-masing dinamai:
 *  A. `null` bernama jadi `0` di kertas
 *  B. keadaan kosong hilang dari PDF (unit belum dimodelkan lenyap dari baris)
 *  C. berkas beredar tanpa jejak KAPAN & SIAPA
 *  D. PDF menyalin logika ringkasan alih-alih memanggilnya (penyebut salah)
 *  E. batas (caveat Nilai DO) tak ikut ke kertas
 */

const KOP: KopKeuangan = {
  ptLabel: "PT Sola Petra Abadi",
  judul: "Laporan keuangan harian",
  subjudul: "Bakau — 2026-01-12",
  generatedLabel: "12 Jan 2026 · 14.05",
  dicetakOleh: "orang@contoh.co",
};

/**
 * Serialisasi seluruh teks dokumen — ISI **dan KAKI**.
 *
 * ⛔ `footer` pdfmake adalah FUNGSI; `JSON.stringify` membuangnya diam-diam.
 * Versi pertama helper ini melakukan itu, dan asersi "kedua dokumen memakai kaki
 * yang sama" lulus tanpa pernah melihat satu pun kaki. Alat ukur yang membuang
 * subjeknya adalah kelas yang sama dengan penjaga tanpa subjek.
 */
function teks(doc: TDocumentDefinitions): string {
  const kaki = typeof doc.footer === "function" ? doc.footer(1, 1, {} as never) : doc.footer;
  return JSON.stringify(doc) + JSON.stringify(kaki);
}

const panel = (baris: PanelLaporan["baris"]): PanelLaporan => ({
  baris,
  pemeriksa: { label: "Pemeriksa", nilai: 0 },
});

describe("A · null bernama tetap bernama di kertas", () => {
  it("baris nilai null jadi 'belum bisa dihitung', BUKAN 0", () => {
    const sel = selNilai({ label: "Opening retained earnings", nilai: null, sebab: "belum_ada_saldo_pembuka" });
    expect(sel).toMatchObject({ text: "belum bisa dihitung" });
    expect(JSON.stringify(sel)).not.toContain('"0"');
  });

  it("DAYA-BEDA: nilai 0 yang SUNGGUH nol tetap dicetak sebagai 0", () => {
    expect(selNilai({ label: "x", nilai: 0 })).toMatchObject({ text: "0" });
  });

  it("sebab kosong ikut sebagai catatan — dan dikumpulkan dari barisnya sendiri", () => {
    const c = catatanSebab([
      { label: "a", nilai: null, sebab: "belum_ada_saldo_pembuka" },
      { label: "b", nilai: null, sebab: "belum_ada_saldo_pembuka" },
      { label: "c", nilai: 5 },
    ]);
    expect(JSON.stringify(c)).toContain("Saldo pembuka ekuitas belum punya sumber");
    // Tanpa baris kosong: tak ada catatan yang dikarang.
    expect(catatanSebab([{ label: "c", nilai: 5 }])).toBeNull();
  });
});

describe("C · tiap berkas menyebut KAPAN dan SIAPA", () => {
  it("kaki memuat waktu cetak dan pencetaknya", () => {
    const t = tekstKaki(KOP);
    expect(t).toContain("12 Jan 2026 · 14.05");
    expect(t).toContain("orang@contoh.co");
  });

  it("identitas kosong TIDAK menghilangkan barisnya — ia mengaku tak tahu", () => {
    const t = tekstKaki({ ...KOP, dicetakOleh: "   " });
    expect(t).toContain("(identitas tak diketahui)");
    expect(t).toContain("Dicetak");
  });

  it("kedua dokumen memakai kaki yang SAMA", () => {
    const a = teks(buildLaporanKeuanganDoc({
      kop: KOP, cashFlow: panel([]), income: panel([]),
      balance: { ...panel([]), langkahHarian: 0 } as PanelBalance,
      incomplete: [], catatanNilaiDo: "batas",
    }));
    const b = teks(buildPapanKeuanganDoc({ kop: KOP, baris: [] }));
    for (const s of [a, b]) expect(s).toContain("orang@contoh.co");
  });
});

describe("B/E · yang diekspor adalah apa yang terlihat, termasuk kosongnya", () => {
  const bs: PanelBalance = {
    baris: [{ label: "Opening retained earnings", nilai: null, sebab: "belum_ada_saldo_pembuka" }],
    pemeriksa: { label: "BSCheck", nilai: null },
    langkahHarian: null,
  };

  it("Layar 2: banner produk tak lengkap, caveat, dan null bernama semuanya ikut", () => {
    const s = teks(buildLaporanKeuanganDoc({
      kop: KOP, cashFlow: panel([]), income: panel([]), balance: bs,
      incomplete: ["Pertalite", "Solar"],
      catatanNilaiDo: "Nilai DO masih memakai sumbu tanggal yang belum cocok",
    }));
    expect(s).toContain("Pertalite");
    expect(s).toContain("tidak diperlakukan sebagai nol");
    expect(s).toContain("Nilai DO masih memakai sumbu tanggal");
    expect(s).toContain("belum bisa dihitung");
    expect(s).toContain("Saldo pembuka ekuitas belum punya sumber");
  });

  it("Layar 1: unit BELUM DIMODELKAN tetap jadi baris, dan disebut eksplisit", () => {
    const s = teks(buildPapanKeuanganDoc({ kop: KOP, baris: [belum("6478111", "Imam Bonjol")] }));
    expect(s).toContain("Imam Bonjol");
    expect(s).toContain("Belum dimodelkan");
    // JSON meng-escape tanda kutipnya — dicocokkan tanpa kutip supaya asersinya
    // menguji kalimatnya, bukan cara serialisasinya.
    expect(s).toContain("berarti");
    expect(s).toContain("belum dihitung");
    expect(s).toContain("bukan");
  });
});

describe("D · angka ringkasan DIPANGGIL, bukan disalin", () => {
  it("penyebutnya unit yang sudah DIPERIKSA — unit belum-pernah-dibuka tak masuk", () => {
    const s = teks(buildPapanKeuanganDoc({
      kop: KOP,
      baris: [seimbang("A"), belumDibuka("B"), belum("C", "C")],
    }));
    // 1 seimbang dari 1 yang diperiksa — BUKAN dari 2 termodelkan, BUKAN dari 3 unit.
    expect(s).toContain("1 / 1 seimbang");
    expect(s).toContain("3 unit dalam cakupan");
    expect(s).toContain("2 termodelkan");
    expect(s).toContain("1 belum pernah dibuka");
  });

  it("DAYA-BEDA: unit yang TIDAK seimbang tidak ikut pembilang", () => {
    const s = teks(buildPapanKeuanganDoc({ kop: KOP, baris: [seimbang("A"), timpang("B")] }));
    expect(s).toContain("1 / 2 seimbang");
  });
});

function dasar(code: string, nama: string): BarisUnit {
  return {
    unitId: 1, code, nama,
    labaBersih: 0, kasAkhir: 0, langkahHarian: 0, bsCheckKumulatif: null,
    status: "ditutup_normal", tier: null, nada: "baik",
  };
}
const seimbang = (n: string): BarisUnit => dasar("1", n);
const timpang = (n: string): BarisUnit => ({ ...dasar("2", n), langkahHarian: 5_000, nada: "buruk" });
const belumDibuka = (n: string): BarisUnit => ({
  ...dasar("3", n), status: "belum_pernah_dibuka", langkahHarian: null, nada: "tak_terhitung",
});
const belum = (code: string, nama: string): BarisUnit => ({
  ...dasar(code, nama), status: "belum_dimodelkan",
  labaBersih: null, kasAkhir: null, langkahHarian: null, nada: "tak_terhitung",
});
