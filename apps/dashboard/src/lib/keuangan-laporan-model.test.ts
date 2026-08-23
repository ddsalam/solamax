import { describe, expect, it } from "vitest";
import type { BarisBeban } from "./keuangan-beban";
import type { DayTotals } from "./keuangan-mesin";
import {
  PENJELASAN_KOSONG,
  deltaKategori,
  deltaKategoriSampai,
  nadaPemeriksa,
  panelBalance,
  panelCashFlow,
  panelIncome,
  type BalanceInput,
  type CashFlowInput,
} from "./keuangan-laporan-model";

const totals = (o: Partial<DayTotals> = {}): DayTotals => ({
  revenue: 327_828_456,
  teraValue: 0,
  cogs: -316_592_795,
  grossProfit: 11_235_661,
  lossesGainValue: 1_139_745,
  inventoryValue: 747_646_746,
  soValue: 573_658_336,
  incomplete: [],
  ...o,
});

const beban = (n: number): BarisBeban[] => [
  { sumber: "manual_entry", businessDate: "2026-01-15", accountingAccount: "6-9100", amountRp: n, keterangan: "x" },
];

const cf = (o: Partial<CashFlowInput> = {}): CashFlowInput => ({
  sebabKas: null,
  kasAwalPerAkun: [{ nama: "Kas Besar", saldo: 100_000 }, { nama: "BCA", saldo: 900_000 }],
  kasAkhir: 1_320_000,
  omzet: 400_000,
  teraValue: 0,
  transaksiPiutangEasymax: -50_000,
  hutangPiutangNonEasymax: 10_000,
  penebusanSo: 0,
  pendapatanLain: 500,
  biayaOperasional: -40_500,
  ...o,
});

const bs = (o: Partial<BalanceInput> = {}): BalanceInput => ({
  sebabKas: null,
  cashOnHand: 7_304_915_872,
  inventoryValue: 747_646_746,
  soValue: 573_658_336,
  piutangEasymax: 7_245_821_009,
  hutangPiutangNonEasymax: -2_177_793_746,
  openedRetainedEarnings: 13_682_504_614,
  netIncome: 11_875_869,
  incomeAdjustment: 0,
  totalAssetKemarin: null,
  deltaKontribusi: 0,
  ...o,
});

describe("Income Statement — susunan mengikuti sheet LaporanHarian", () => {
  it("angka Bakau 15 Jan 2026 tersusun seperti di mockup", () => {
    // 📌 Pendapatan lain-lain = 463,50 (baris "Pembulatan" di Rincian
    // Penjualan), yang di mockup DITAMPILKAN sebagai 464. Memakai 464 di sini
    // akan menghasilkan Net profit 11.875.870 — selisih Rp 1 dari mockup, dan
    // selisih itu bukan cacat model melainkan pembulatan tampilan. Yang dihitung
    // model selalu nilai penuh; pembulatan terjadi di layar, sekali, di akhir.
    const p = panelIncome({ totals: totals(), beban: beban(500_000), pendapatanLain: 463.5, incomeAdjustment: null });
    const n = (l: string) => p.baris.find((b) => b.label === l)!.nilai;
    expect(n("Gross profit")).toBe(11_235_661);
    expect(n("Operating profit")).toBe(12_375_406);
    expect(n("Biaya operasional")).toBe(-500_000);
    expect(n("Net profit")).toBe(11_875_869.5);
    expect(Math.trunc(n("Net profit")!)).toBe(11_875_869); // seperti tampil di mockup
  });

  it("margin bersih = net / omzet, dan itu satu-satunya tambahan atas workbook", () => {
    const p = panelIncome({ totals: totals(), beban: beban(500_000), pendapatanLain: 463.5, incomeAdjustment: null });
    expect(p.marginBersih).toBeCloseTo(11_875_869.5 / 327_828_456, 12);
    expect((p.marginBersih! * 100).toFixed(2)).toBe("3.62");
  });

  it("omzet nol ⇒ margin null, BUKAN nol atau Infinity", () => {
    const p = panelIncome({ totals: totals({ revenue: 0 }), beban: [], pendapatanLain: 0, incomeAdjustment: null });
    expect(p.marginBersih).toBeNull();
  });

  it("🔴 beban dari KEDUA sumber ikut — jalur penggabungan tunggal", () => {
    const dua: BarisBeban[] = [
      ...beban(500_000),
      { sumber: "noncash_expense", businessDate: "2026-01-15", accountingAccount: "7-1200", amountRp: 175_000, keterangan: "MDR" },
    ];
    const p = panelIncome({ totals: totals(), beban: dua, pendapatanLain: 0, incomeAdjustment: null });
    expect(p.baris.find((b) => b.label === "Biaya operasional")!.nilai).toBe(-675_000);
  });

  it("income adjustment tak bersumber ⇒ null bernama, bukan nol", () => {
    const p = panelIncome({ totals: totals(), beban: [], pendapatanLain: 0, incomeAdjustment: null });
    const b = p.baris.find((x) => x.label === "Income adjustment")!;
    expect(b.nilai).toBeNull();
    expect(b.sebab).toBe("tak_bersumber");
  });
});

describe("Cash Flow — check di kaki panel", () => {
  it("net cash change & check dihitung saat semua komponen ada", () => {
    const p = panelCashFlow(cf());
    expect(p.baris.find((b) => b.label === "Net cash change")!.nilai).toBe(320_000);
    // kas awal 1.000.000 + 320.000 = 1.320.000 = kas akhir ⇒ check 0
    expect(p.pemeriksa.nilai).toBe(0);
    expect(nadaPemeriksa(p.pemeriksa.nilai)).toBe("baik");
  });

  it("🔴 SATU komponen null ⇒ net cash change null, bukan jumlah yang terlihat sah", () => {
    // Menjumlah dengan `?? 0` akan melahirkan angka dari pos yang tak diketahui.
    const p = panelCashFlow(cf({ penebusanSo: null }));
    expect(p.baris.find((b) => b.label === "Net cash change")!.nilai).toBeNull();
    expect(p.pemeriksa.nilai).toBeNull();
    expect(nadaPemeriksa(p.pemeriksa.nilai)).toBe("tak_terhitung");
  });

  it("tanpa akun kas: kas awal & akhir null, dan sebabnya menyebut SIAPA", () => {
    const p = panelCashFlow(cf({ kasAwalPerAkun: null, kasAkhir: null, sebabKas: "belum_ada_akun_kas" }));
    const awal = p.baris.find((b) => b.label === "Kas awal")!;
    expect(awal.nilai).toBeNull();
    expect(awal.sebab).toBe("belum_ada_akun_kas");
    expect(PENJELASAN_KOSONG[awal.sebab!]).toMatch(/tim keuangan/);
  });

  it("🔴 AKUN ADA tapi buku KOSONG: sebabnya 'belum ada mutasi', BUKAN 'belum ada akun'", () => {
    // §10.21 — nama yang salah membuat pembacanya mencari akun yang sebenarnya
    // sudah terdaftar. Ini bukan soal gaya: ia mengirim orang ke pekerjaan yang
    // salah.
    const p = panelCashFlow(
      cf({ kasAwalPerAkun: null, kasAkhir: null, sebabKas: "belum_ada_mutasi_kas" }),
    );
    const awal = p.baris.find((b) => b.label === "Kas awal")!;
    expect(awal.nilai).toBeNull();
    expect(awal.sebab).toBe("belum_ada_mutasi_kas");
    expect(PENJELASAN_KOSONG.belum_ada_mutasi_kas).toContain("sudah terdaftar");
    expect(PENJELASAN_KOSONG.belum_ada_mutasi_kas).toContain("BELUM DIKETAHUI, bukan nol");
  });

  it("🔴 pemanggil yang DIAM tidak dikarangkan sebabnya — jatuh ke tak_bersumber", () => {
    const p = panelCashFlow(cf({ kasAwalPerAkun: null, kasAkhir: null, sebabKas: null }));
    expect(p.baris.find((b) => b.label === "Kas awal")!.sebab).toBe("tak_bersumber");
  });

  it("tiap akun kas tampil sebagai rincian di bawah kas awal", () => {
    const p = panelCashFlow(cf());
    expect(p.baris.filter((b) => b.ind).map((b) => b.label)).toEqual(["Kas Besar", "BCA"]);
  });
});

describe("Balance Sheet — kumulatif vs LANGKAH harian", () => {
  it("angka Bakau 15 Jan tersusun, dan BSCheck = equity − asset", () => {
    const p = panelBalance(bs());
    const n = (l: string) => p.baris.find((b) => b.label === l)!.nilai;
    expect(n("Asset − liabilities")).toBe(13_694_248_217);
    expect(n("Equity")).toBe(13_694_380_483);
    expect(p.pemeriksa.nilai).toBe(13_694_380_483 - 13_694_248_217);
  });

  it("🔴 tanpa saldo pembuka: equity & BSCheck null — laporan tak dipaksa jadi angka", () => {
    const p = panelBalance(bs({ openedRetainedEarnings: null }));
    expect(p.baris.find((b) => b.label === "Equity")!.nilai).toBeNull();
    expect(p.pemeriksa.nilai).toBeNull();
    expect(p.pemeriksa.sebab).toBe("belum_ada_saldo_pembuka");
    expect(PENJELASAN_KOSONG.belum_ada_saldo_pembuka).toMatch(/workbook/);
  });

  it("🔴 LANGKAH HARIAN tetap terhitung TANPA saldo pembuka", () => {
    // Inilah yang membuat gerbang §3 bisa bekerja hari ini: yang dinilai adalah
    // BSCheck(d) − BSCheck(d−1), dan itu tidak butuh nilai kumulatifnya.
    const asset = 13_694_248_217;
    const p = panelBalance(bs({ openedRetainedEarnings: null, totalAssetKemarin: asset - 11_875_869 }));
    expect(p.pemeriksa.nilai).toBeNull();
    expect(p.langkahHarian).toBe(0);
  });

  it("langkah harian menangkap hari yang patah meski kumulatifnya tak diketahui", () => {
    // Bakau 29-01-2026: langkah −52.779.482 dalam sehari.
    const asset = 1_000_000_000;
    const p = panelBalance(
      bs({ openedRetainedEarnings: null, netIncome: 0, totalAssetKemarin: asset - 52_779_482,
           cashOnHand: asset, inventoryValue: 0, soValue: 0, piutangEasymax: 0, hutangPiutangNonEasymax: 0 }),
    );
    expect(p.langkahHarian).toBe(-52_779_482);
    expect(nadaPemeriksa(p.langkahHarian)).toBe("buruk");
  });

  it("satu komponen asset null ⇒ asset null, dan langkah ikut null", () => {
    const p = panelBalance(bs({ cashOnHand: null, totalAssetKemarin: 1 }));
    expect(p.baris.find((b) => b.label === "Asset − liabilities")!.nilai).toBeNull();
    expect(p.langkahHarian).toBeNull();
  });
});

describe("nadaPemeriksa — toleransi GL Rp 0 (§3.1)", () => {
  it("nol baik, bukan-nol buruk, null tak terhitung", () => {
    expect(nadaPemeriksa(0)).toBe("baik");
    expect(nadaPemeriksa(1)).toBe("buruk");
    expect(nadaPemeriksa(-1)).toBe("buruk");
    expect(nadaPemeriksa(null)).toBe("tak_terhitung");
  });

  it("🔴 tidak ada toleransi diam-diam: Rp 1 sudah buruk", () => {
    // §3.1 mematok Rp 0 untuk akuntansi/GL. Toleransi yang diselundupkan di
    // lapisan tampilan akan menghijaukan hari yang gerbangnya tolak.
    expect(nadaPemeriksa(1)).not.toBe("baik");
  });
});

describe("saldo vs arus — dua angka dari kategori yang SAMA", () => {
  // ⛔ Neraca butuh SALDO (kumulatif ≤ hari ini); Cash Flow butuh ARUS (hari itu
  // saja). Menukarnya tidak memunculkan galat apa pun — kedua angka sah, dan
  // yang salah hanya tempatnya. Karena itu diuji perilakunya, bukan namanya.
  const mut = [
    { id: "a", accountId: "K", businessDate: "2026-01-10", keterangan: "x", jenis: "debet" as const,
      categorySide: "debet" as const, categoryLabel: "Hutang Piutang", amount: 1_000_000, void: false,
      sourceManualEntryId: null },
    { id: "b", accountId: "K", businessDate: "2026-01-15", keterangan: "x", jenis: "debet" as const,
      categorySide: "debet" as const, categoryLabel: "Hutang Piutang", amount: 250_000, void: false,
      sourceManualEntryId: null },
    { id: "c", accountId: "K", businessDate: "2026-01-15", keterangan: "x", jenis: "debet" as const,
      categorySide: "debet" as const, categoryLabel: "Pindah Buku", amount: 900_000, void: false,
      sourceManualEntryId: null },
  ];

  it("🔴 keduanya BERBEDA pada fixture ini — daya-beda ada", () => {

    const saldo = deltaKategoriSampai(mut, "2026-01-15", "Hutang Piutang");
    const arus = deltaKategori(mut, "2026-01-15", "Hutang Piutang");
    expect(saldo).toBe(1_250_000);
    expect(arus).toBe(250_000);
    // Tanpa baris ini, uji di atas tetap hijau bila keduanya fungsi yang sama.
    expect(saldo).not.toBe(arus);
  });

  it("kategori lain tidak ikut, dan void tidak ikut", () => {

    expect(deltaKategoriSampai(mut, "2026-01-15", "Hutang Piutang")).toBe(1_250_000);
    const denganVoid = [...mut, { ...mut[1]!, id: "d", amount: 9_000_000, void: true }];
    expect(deltaKategoriSampai(denganVoid, "2026-01-15", "Hutang Piutang")).toBe(1_250_000);
  });

  it("saldo tidak memasukkan mutasi SESUDAH tanggalnya", () => {

    const besok = [...mut, { ...mut[1]!, id: "e", businessDate: "2026-01-20", amount: 7_000 }];
    expect(deltaKategoriSampai(besok, "2026-01-15", "Hutang Piutang")).toBe(1_250_000);
  });
});
