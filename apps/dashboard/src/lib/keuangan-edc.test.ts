import { describe, expect, it } from "vitest";
import {
  jurnalSeimbang,
  mdrRp,
  pergeseranMdr,
  ringkasMdr,
  selisihSettlement,
  usulanJurnalPencairan,
  type Settlement,
} from "./keuangan-edc";

const s = (o: Partial<Settlement> = {}): Settlement => ({
  id: "st-1",
  acquirer: "BCA",
  settlementDate: "2026-01-11",
  businessDate: "2026-01-10",
  toAccountId: "bca-5125978301",
  grossRp: 10_000_000,
  netRp: 9_825_000, // MDR 1,75 %
  txnTotalRp: 10_000_000,
  void: false,
  ...o,
});

describe("MDR — tidak pernah diketik", () => {
  it("MDR = bruto − neto", () => {
    expect(mdrRp(s())).toBe(175_000);
  });

  it("tanpa potongan ⇒ MDR nol", () => {
    expect(mdrRp(s({ netRp: 10_000_000 }))).toBe(0);
  });
});

describe("selisih transaksi vs settlement — berdiri, tidak hilang", () => {
  it("cocok ⇒ nol", () => {
    expect(selisihSettlement(s())).toBe(0);
  });

  it("transaksi lebih besar dari batch ⇒ selisih positif", () => {
    expect(selisihSettlement(s({ txnTotalRp: 10_500_000 }))).toBe(500_000);
  });

  it("🔴 BELUM direkonsiliasi ⇒ null, BUKAN nol", () => {
    // "Belum diperiksa" dan "sudah diperiksa, cocok" adalah dua keadaan berbeda.
    // Menyamakannya membuat batch yang tak pernah disentuh terlihat bersih.
    expect(selisihSettlement(s({ txnTotalRp: null }))).toBeNull();
    expect(selisihSettlement(s({ txnTotalRp: null }))).not.toBe(0);
  });
});

describe("usulan jurnal pencairan — tiga kaki, DITAWARKAN", () => {
  it("tiga kaki: Kas Bank neto D · Beban MDR D · EDC Penampungan bruto K", () => {
    const j = usulanJurnalPencairan(s(), "edc-penampungan");
    expect(j).toHaveLength(3);
    expect(j[0]).toMatchObject({ akun: "bca-5125978301", amount: 9_825_000 });
    expect(j[1]).toMatchObject({ akun: "7-1200", amount: 175_000, bukanAkunKas: true });
    expect(j[2]).toMatchObject({ akun: "edc-penampungan", amount: -10_000_000 });
  });

  it("🔴 jurnalnya SEIMBANG — neto + MDR = bruto", () => {
    expect(jurnalSeimbang(usulanJurnalPencairan(s(), "edc-penampungan"))).toBe(true);
  });

  it("seimbang untuk berbagai tarif MDR", () => {
    for (const net of [9_999_999, 9_900_000, 9_500_000, 1]) {
      const j = usulanJurnalPencairan(s({ netRp: net }), "edc-penampungan");
      expect(jurnalSeimbang(j), String(net)).toBe(true);
    }
  });

  it("MDR nol ⇒ hanya DUA kaki; baris beban nol bukan baris", () => {
    const j = usulanJurnalPencairan(s({ netRp: 10_000_000 }), "edc-penampungan");
    expect(j).toHaveLength(2);
    expect(jurnalSeimbang(j)).toBe(true);
    expect(j.some((b) => b.bukanAkunKas)).toBe(false);
  });

  it("🔴 kaki Beban MDR DITANDAI bukan akun kas", () => {
    // Penjaga terhadap pemanggil yang menyalin ketiganya ke cash_ledger:
    // beban bukan akun kas, dan menaruhnya di sana akan menggandakan biaya
    // sekaligus merusak Cash on Hand.
    const j = usulanJurnalPencairan(s(), "edc-penampungan");
    const kas = j.filter((b) => !b.bukanAkunKas);
    expect(kas).toHaveLength(2);
    // Dua kaki kas saja TIDAK seimbang — selisihnya persis MDR. Itu benar:
    // MDR adalah biaya nyata yang mengurangi kas.
    expect(kas.reduce((a, b) => a + b.amount, 0)).toBe(-175_000);
  });

  it("tidak menulis apa pun — fungsinya murni", () => {
    const asli = s();
    const salinan = { ...asli };
    usulanJurnalPencairan(asli, "edc-penampungan");
    expect(asli).toEqual(salinan);
  });
});

describe("kontrol MDR% per acquirer per bulan", () => {
  const data: Settlement[] = [
    s({ id: "a", acquirer: "BCA", settlementDate: "2026-01-05", grossRp: 10_000_000, netRp: 9_825_000 }),
    s({ id: "b", acquirer: "BCA", settlementDate: "2026-01-20", grossRp: 20_000_000, netRp: 19_650_000 }),
    s({ id: "c", acquirer: "BRI", settlementDate: "2026-01-10", grossRp: 5_000_000, netRp: 4_900_000 }),
  ];

  it("mengelompokkan per acquirer per bulan, rasio = MDR / bruto", () => {
    const r = ringkasMdr(data);
    expect(r).toHaveLength(2);
    const bca = r.find((x) => x.acquirer === "BCA")!;
    expect(bca.grossRp).toBe(30_000_000);
    expect(bca.rasio).toBeCloseTo(0.0175, 6);
    const bri = r.find((x) => x.acquirer === "BRI")!;
    expect(bri.rasio).toBeCloseTo(0.02, 6);
  });

  it("acquirer TIDAK digabung — pergeseran satu akan tenggelam kalau digabung", () => {
    const r = ringkasMdr(data);
    expect(new Set(r.map((x) => x.acquirer))).toEqual(new Set(["BCA", "BRI"]));
  });

  it("batch void diabaikan", () => {
    const r = ringkasMdr([...data, s({ id: "z", acquirer: "BCA", grossRp: 999_999_999, netRp: 1, void: true })]);
    expect(r.find((x) => x.acquirer === "BCA")!.rasio).toBeCloseTo(0.0175, 6);
  });

  it("🔴 pergeseran tarif antar bulan TERDETEKSI", () => {
    // Persentase yang bergeser tanpa perubahan perjanjian adalah TEMUAN.
    const dgnGeser = [
      ...data,
      s({ id: "d", acquirer: "BCA", settlementDate: "2026-02-05", grossRp: 10_000_000, netRp: 9_700_000 }),
    ];
    const g = pergeseranMdr(ringkasMdr(dgnGeser));
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ acquirer: "BCA", dari: "2026-01", ke: "2026-02" });
    expect(g[0]!.rasioKe).toBeCloseTo(0.03, 6);
  });

  it("tarif stabil ⇒ tidak ada temuan", () => {
    const stabil = [
      ...data,
      s({ id: "e", acquirer: "BCA", settlementDate: "2026-02-05", grossRp: 8_000_000, netRp: 7_860_000 }),
    ];
    expect(pergeseranMdr(ringkasMdr(stabil))).toHaveLength(0);
  });

  it("ambang adalah ambang PELAPORAN — melonggarkannya tak menolak apa pun", () => {
    const dgnGeser = [
      ...data,
      s({ id: "d", acquirer: "BCA", settlementDate: "2026-02-05", grossRp: 10_000_000, netRp: 9_700_000 }),
    ];
    expect(pergeseranMdr(ringkasMdr(dgnGeser), 0.5)).toHaveLength(0);
  });
});
