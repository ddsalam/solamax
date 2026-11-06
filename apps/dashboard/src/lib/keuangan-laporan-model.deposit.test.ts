import { describe, expect, it } from "vitest";
import type { BarisBeban } from "./keuangan-beban";
import type { DayTotals } from "./keuangan-mesin";
import {
  balanceInputDari,
  cashFlowInputDari,
  labaBersihDari,
  langkahHarianDari,
  panelBalance,
  panelCashFlow,
  type BahanArus,
  type BahanNeraca,
} from "./keuangan-laporan-model";

/**
 * Deposit pelanggan EasyMax (buku "Hutang Lokal").
 *
 * Bentuk kasusnya diambil dari data pilot Okt 2026; ANGKANYA ILUSTRATIF (repo
 * publik). Seorang pelanggan deposit membeli Rp 250.000 dari depositnya: omzet
 * naik, uang tidak masuk, saldo Hutang Lokal unit naik −12.000.000 →
 * −11.750.000. Sebelum perbaikan, Cash flow check dan langkah neraca
 * SAMA-SAMA 249.880. Sesudahnya keduanya −120 — sisa yang sah: setoran Rp 120
 * di atas uang tunai menurut Rincian.
 */
const totals: DayTotals = {
  revenue: 200_000_000,
  teraValue: 0,
  cogs: -194_000_000,
  grossProfit: 6_000_000,
  lossesGainValue: -1_000_000,
  inventoryValue: 900_000_000,
  soValue: 500_000_000,
  incomplete: [],
  perusakGp: [],
};

const beban: BarisBeban[] = [
  { sumber: "manual_entry", businessDate: "2026-10-04", accountingAccount: "6-2100", amountRp: 100_000, keterangan: "x" },
];

const DEPOSIT_AWAL = -12_000_000;
const DEPOSIT_AKHIR = -11_750_000;
const KAS_AKHIR = 1_170_650_120;
/** Asset bersih kemarin TANPA deposit — yang dulu dipakai. */
const ASSET_KEMARIN_LAMA = 4_076_000_000;

const arus = (o: Partial<BahanArus> = {}): BahanArus => ({
  totals,
  sebabKas: null,
  kasAwalPerAkun: [{ nama: "Semua akun", saldo: 1_000_000_000 }],
  kasAkhir: KAS_AKHIR,
  deltaPiutangEasymax: -30_000_000,
  deltaDepositEasymax: -(DEPOSIT_AKHIR - DEPOSIT_AWAL),
  arusHutangPiutangNonEasymax: 0,
  penebusanSo: 0,
  arusTemporaryInvestment: 0,
  arusPenampung: 0,
  pendapatanLain: 0,
  beban,
  arusTitipanBright: 1_000_000,
  kontribusi: 0,
  ...o,
});

const neraca = (o: Partial<BahanNeraca> = {}): BahanNeraca => ({
  totals,
  sebabKas: null,
  kasAkhir: KAS_AKHIR,
  piutangEasymax: 1_500_000_000,
  depositEasymax: DEPOSIT_AKHIR,
  hutangPiutangNonEasymax: 0,
  penampung: 0,
  temporaryInvestment: 0,
  beban,
  pendapatanLain: 0,
  totalAssetKemarin: ASSET_KEMARIN_LAMA + DEPOSIT_AWAL,
  kontribusi: 0,
  saldoTitipanBright: -10_000_000,
  ...o,
});

const cfCheck = (b: BahanArus) => panelCashFlow(cashFlowInputDari(b)).pemeriksa.nilai;

describe("deposit pelanggan EasyMax (Hutang Lokal)", () => {
  it("🔴 tanpa deposit, kedua pemeriksa melenceng sebesar pemakaian deposit (perilaku lama)", () => {
    expect(cfCheck(arus({ deltaDepositEasymax: 0 }))).toBe(249_880);
    expect(langkahHarianDari(neraca({ depositEasymax: 0, totalAssetKemarin: ASSET_KEMARIN_LAMA }))).toBe(249_880);
  });

  it("dengan deposit, keduanya menyusut ke sisa setoran sah (−120) dan tetap SAMA", () => {
    expect(cfCheck(arus())).toBe(-120);
    expect(langkahHarianDari(neraca())).toBe(-120);
  });

  it("pemakaian deposit = arus NEGATIF; top-up = arus positif", () => {
    const baris = (d: number) =>
      panelCashFlow(cashFlowInputDari(arus({ deltaDepositEasymax: d }))).baris
        .find((x) => x.label === "Transaksi deposit pelanggan EasyMax")!.nilai;
    expect(baris(-(DEPOSIT_AKHIR - DEPOSIT_AWAL))).toBe(-250_000);
    expect(baris(-(-13_000_000 - DEPOSIT_AWAL))).toBe(1_000_000);
  });

  it("neraca menampilkan deposit sebagai baris sendiri dan menghitungnya ke asset bersih", () => {
    const b = neraca();
    const p = panelBalance(balanceInputDari(b, labaBersihDari(b)));
    expect(p.baris.find((x) => x.label === "Deposit pelanggan EasyMax (hutang lokal)")!.nilai).toBe(DEPOSIT_AKHIR);
    // Baris piutang TIDAK berubah arti — buku besar membandingkannya dengan akun 1121.
    expect(p.baris.find((x) => x.label === "Hutang piutang pelanggan EasyMax")!.nilai).toBe(1_500_000_000);
    const tanpa = panelBalance(balanceInputDari({ ...b, depositEasymax: 0 }, labaBersihDari(b)));
    expect(p.baris[0]!.nilai! - tanpa.baris[0]!.nilai!).toBe(DEPOSIT_AKHIR);
  });
});
