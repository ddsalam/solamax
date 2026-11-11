import { describe, expect, it } from "vitest";
import {
  CEK_26_OKT,
  CEK_29_OKT,
  CEK_30_OKT,
  HARI_BAKAU_OKT,
} from "./__fixtures__/bakau-26-okt-selisih-arus";
import {
  jelaskanSelisihArusKas,
  kalimatCocok,
  kalimatPiutangWaktu,
  kelompokkanPerHari,
  type HariPiutang,
} from "./selisih-arus-kas-model";

const sen = (rp: number): number => Math.round(rp * 100);
const jelaskan = (date: string, check: number | null, hari: readonly HariPiutang[] = HARI_BAKAU_OKT) =>
  jelaskanSelisihArusKas({ date, check, hari });

describe("jelaskanSelisihArusKas — Bakau 26 Okt (AE1)", () => {
  const p = jelaskan("2026-10-26", CEK_26_OKT)!;

  it("−123.196.354 = −123.196.000 (waktu pembayaran piutang) − 354 (sisa), persis dalam sen", () => {
    expect(p.baris).toEqual([
      { kode: "piutang_waktu", rp: -123_196_000 },
      { kode: "sisa", rp: -354 },
    ]);
    expect(sen(p.baris[0].rp) + sen(p.baris[1].rp)).toBe(sen(-123_196_354));
    expect(p.easymax).toEqual({ n: 0, rp: 0 });
    expect(p.bank).toEqual({ n: 1, rp: 123_196_000 });
    expect(p.sisaDiLuarToleransi).toBe(false);
    expect(p.aksi).toBe("piutang_waktu");
  });

  it("petunjuk menyebut 29 Okt: EasyMax 3 baris = 123.196.000 (Σ hari 173.112.484); 30 Okt tidak (tanda sama)", () => {
    expect(p.petunjuk.map((h) => h.tanggal)).toEqual(["2026-10-29"]);
    const h = p.petunjuk[0]!;
    expect(h.selisihRp).toBe(151_262_784);
    expect(h.easymax.reduce((a, b) => a + b.rp, 0)).toBe(173_112_484);
    expect(h.cocok).not.toBeNull();
    expect(h.cocok!.rp).toBe(123_196_000);
    expect(h.cocok!.baris.map((b) => [b.pelanggan, b.rp])).toEqual([
      ["PLG0607", 86_136_000],
      ["PLG0609", 26_849_200],
      ["PLG0607", 10_210_800],
    ]);
    expect(kalimatCocok(h.cocok!)).toBe(
      "EasyMax mencatat pembayaran piutang Rp 123.196.000 (3 baris) pada 29 Okt — PLG0607 86.136.000, PLG0609 26.849.200, PLG0607 10.210.800; bank menerimanya pada 26 Okt.",
    );
    expect(p.tanpaHariBerlawanan).toBe(false);
  });

  it("kalimat baris 1 (bank > EasyMax)", () => {
    expect(kalimatPiutangWaktu(p)).toBe(
      "Bank menerima Rp 123.196.000 pada 26 Okt, tetapi EasyMax belum/tidak mencatat pembayarannya pada 26 Okt.",
    );
  });
});

describe("jelaskanSelisihArusKas — Bakau 29 Okt (AE2)", () => {
  const p = jelaskan("2026-10-29", CEK_29_OKT)!;

  it("+151.261.816 = +151.262.784 − 968", () => {
    expect(p.baris.map((b) => b.rp)).toEqual([151_262_784, -968]);
    expect(p.easymax).toEqual({ n: 6, rp: 173_112_484 });
    expect(p.bank).toEqual({ n: 1, rp: 21_849_700 });
    expect(kalimatPiutangWaktu(p)).toBe(
      "EasyMax mencatat pembayaran Rp 151.262.784 pada 29 Okt, tetapi rekening tidak menerimanya pada 29 Okt.",
    );
  });

  it("petunjuk 30 Okt (terdekat) lalu 26 Okt; 26 Okt cocok persis memakai PLG0607 10.210.800 yang PERTAMA; 30 Okt tidak", () => {
    expect(p.petunjuk.map((h) => h.tanggal)).toEqual(["2026-10-30", "2026-10-26"]);
    const [h30, h26] = p.petunjuk;
    expect(h30!.cocok).toBeNull();
    expect(h30!.selisihRp).toBe(-17_864_200);
    expect(h30!.bank[0]!.rp).toBe(17_864_200);
    expect(h26!.cocok!.baris.map((b) => b.kode)).toEqual(["BT-SINTETIS-01", "BT-SINTETIS-02", "BT-SINTETIS-03"]);
    expect(h26!.cocok!.tanggalEasymax).toBe("2026-10-29");
    expect(h26!.cocok!.tanggalBank).toBe("2026-10-26");
  });
});

describe("jelaskanSelisihArusKas — Bakau 30 Okt", () => {
  it("−17.864.266,5 = −17.864.200 − 66,5 (setengah rupiah bertahan di sen); petunjuk 29 Okt tanpa cocok persis", () => {
    const p = jelaskan("2026-10-30", CEK_30_OKT)!;
    expect(p.baris.map((b) => b.rp)).toEqual([-17_864_200, -66.5]);
    expect(p.petunjuk.map((h) => [h.tanggal, h.cocok])).toEqual([["2026-10-29", null]]);
    expect(p.petunjuk[0]!.selisihRp).toBe(151_262_784);
  });
});

describe("jelaskanSelisihArusKas — hari lain", () => {
  it("AE5: cek 0 atau null ⇒ tidak ada penjelasan", () => {
    expect(jelaskan("2026-10-26", 0)).toBeNull();
    expect(jelaskan("2026-10-26", null)).toBeNull();
  });

  it("AE3: cek −217 tanpa aktivitas piutang ⇒ baris 1 = 0, sisa −217, tanpa petunjuk, aksi null", () => {
    const p = jelaskan("2026-10-27", -217, [])!;
    expect(p.baris.map((b) => b.rp)).toEqual([0, -217]);
    expect(p.petunjuk).toEqual([]);
    expect(p.tanpaHariBerlawanan).toBe(false);
    expect(p.sisaDiLuarToleransi).toBe(false);
    expect(p.aksi).toBeNull();
    expect(kalimatPiutangWaktu(p)).toBeNull();
  });

  it("AE4: cek −25.000 tanpa aktivitas piutang ⇒ sisa di luar toleransi", () => {
    const p = jelaskan("2026-10-27", -25_000, [])!;
    expect(p.sisaDiLuarToleransi).toBe(true);
    expect(p.aksi).toBe("sisa_di_luar_toleransi");
  });

  it("batas toleransi: |sisa| 10.000 tidak ditandai; 10.000,01 ditandai", () => {
    expect(jelaskan("2026-10-27", -10_000, [])!.sisaDiLuarToleransi).toBe(false);
    expect(jelaskan("2026-10-27", 10_000.01, [])!.sisaDiLuarToleransi).toBe(true);
  });

  it("tanpa hari berlawanan dalam ±7 ⇒ tanpaHariBerlawanan, aksi tetap piutang_waktu", () => {
    const hari: HariPiutang[] = [
      { tanggal: "2026-10-15", easymax: [], bank: [{ id: "x", rekening: "Kas", tanggalAsal: null, keterangan: null, rp: 5_000_000 }] },
    ];
    const p = jelaskan("2026-10-15", -5_000_000, hari)!;
    expect(p.petunjuk).toEqual([]);
    expect(p.tanpaHariBerlawanan).toBe(true);
    expect(p.aksi).toBe("piutang_waktu");
  });

  it("hari di luar ±7 tidak menjadi petunjuk", () => {
    const hari: HariPiutang[] = [
      { tanggal: "2026-10-15", easymax: [], bank: [{ id: "x", rekening: "Kas", tanggalAsal: null, keterangan: null, rp: 100 }] },
      { tanggal: "2026-10-23", easymax: [{ kode: "a", pelanggan: "P", ref: null, keterangan: null, rp: 100 }], bank: [] },
    ];
    expect(jelaskan("2026-10-15", -100, hari)!.petunjuk).toEqual([]);
  });

  it("batas pencarian: hari dengan 17 baris EasyMax ⇒ tanpa pencarian subset, selisih hari saja", () => {
    const easymax = Array.from({ length: 17 }, (_, i) => ({ kode: `k${i}`, pelanggan: "P", ref: null, keterangan: null, rp: 100 }));
    const hari: HariPiutang[] = [
      { tanggal: "2026-10-15", easymax: [], bank: [{ id: "x", rekening: "Kas", tanggalAsal: null, keterangan: null, rp: 300 }] },
      { tanggal: "2026-10-16", easymax, bank: [] },
    ];
    const p = jelaskan("2026-10-15", -300, hari)!;
    expect(p.petunjuk).toHaveLength(1);
    expect(p.petunjuk[0]!.cocok).toBeNull();
    expect(p.petunjuk[0]!.selisihRp).toBe(1_700);
  });

  it("invarian: Σ baris (sen) === cek (sen) untuk setiap hari & cek", () => {
    for (const [date, check] of [
      ["2026-10-26", CEK_26_OKT],
      ["2026-10-29", CEK_29_OKT],
      ["2026-10-30", CEK_30_OKT],
      ["2026-10-27", -217],
      ["2026-10-28", 0.01],
      ["2026-10-31", -178.5],
    ] as const) {
      const p = jelaskan(date, check)!;
      expect(sen(p.baris[0].rp) + sen(p.baris[1].rp)).toBe(sen(check));
    }
  });
});

describe("kelompokkanPerHari", () => {
  it("baris kueri → per tanggal, terurut, urutan baris dipertahankan", () => {
    const e = (kode: string) => ({ kode, pelanggan: "P", ref: null, keterangan: null, rp: 1 });
    const b = { id: "b", rekening: "Kas", tanggalAsal: null, keterangan: null, rp: 1 };
    const h = kelompokkanPerHari([
      { sisi: "easymax", tanggal: "2026-10-29", baris: e("2") },
      { sisi: "bank", tanggal: "2026-10-26", baris: b },
      { sisi: "easymax", tanggal: "2026-10-29", baris: e("1") },
    ]);
    expect(h.map((x) => x.tanggal)).toEqual(["2026-10-26", "2026-10-29"]);
    expect(h[1]!.easymax.map((x) => x.kode)).toEqual(["2", "1"]);
    expect(h[0]!.bank).toEqual([b]);
  });
});
