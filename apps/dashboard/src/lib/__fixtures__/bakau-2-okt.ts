/**
 * Fixture "Bakau 2 Okt 2026" SEBELUM tambalan reklasifikasi 1-1800 — rencana
 * 2026-11-07 (Batalkan & Balik), AE1/AE2. Hanya untuk uji.
 *
 * Tiga baris pintu Finance ganda tanpa mutasi kas: MDR manual 7.560 (di atas
 * MDR otomatis settlement), "Biaya Admin Bank" 30.000 (pasangan sahnya bertaut
 * BCA), dan NK LAINNYA +50.000 berkode 6-9900 (pasangan sahnya 4200 bertaut
 * BCA). Neto +12.440. Angka dasar disusun tangan supaya keadaan SEBELUM sama
 * dengan layar produksi (Cash flow check 11.676,5; laba bersih 11.073.820) —
 * vault `2026-11-06-selisih-pemeriksa-tutup-hari-bakau-2-dan-4-okt`. Yang diuji
 * adalah jalur hitung produksi dari baris `manual_entry` sampai panel.
 */
import { kumpulkanBeban, pilahManualEntry, type BarisManualLaporan } from "../keuangan-beban";
import type { DayTotals } from "../keuangan-mesin";
import {
  balanceInputDari,
  cashFlowInputDari,
  labaBersihDari,
  langkahHarianRinci,
  panelBalance,
  panelCashFlow,
  panelIncome,
  type BahanLangkahHarian,
} from "../keuangan-laporan-model";

export const BAKAU_D = "2026-10-02";
export const BAKAU_GANDA = ["Biaya MDR EDC", "Biaya Admin Bank (ganda)", "NK - LAINNYA KORCPU (6-9900)"];

const me = (o: Partial<BarisManualLaporan>): BarisManualLaporan => ({
  businessDate: BAKAU_D,
  accountingAccount: "6-9100",
  amountRp: 0,
  keterangan: "",
  void: false,
  section: "pengeluaran",
  operationalCategory: null,
  ...o,
});

export const BAKAU_BARIS: readonly BarisManualLaporan[] = [
  me({ keterangan: BAKAU_GANDA[0], accountingAccount: "7-1200", amountRp: 7_560 }),
  me({ keterangan: BAKAU_GANDA[1], amountRp: 30_000 }),
  me({ keterangan: BAKAU_GANDA[2], section: "pendapatan_lain", accountingAccount: "6-9900", amountRp: 50_000 }),
  // Pasangan sah yang dipertahankan (bertaut BCA).
  me({ keterangan: "biaya admin bank", amountRp: 30_000, cashLedgerId: "k1" }),
  me({ keterangan: "NK - LAINNYA KORCPU", section: "pendapatan_lain", accountingAccount: "4200", amountRp: 50_000, cashLedgerId: "k2" }),
];

const TOTALS: DayTotals = {
  revenue: 400_000,
  teraValue: 0,
  cogs: 0,
  grossProfit: 11_041_380,
  lossesGainValue: 0,
  inventoryValue: 700_000_000,
  soValue: 300_000_000,
  incomplete: [],
  perusakGp: [],
};

export const bakauBatalkan = (rows: readonly BarisManualLaporan[]): BarisManualLaporan[] =>
  rows.map((r) => (BAKAU_GANDA.includes(r.keterangan) ? { ...r, void: true } : r));
export const bakauReklas1800 = (rows: readonly BarisManualLaporan[]): BarisManualLaporan[] =>
  rows.map((r) => (BAKAU_GANDA.includes(r.keterangan) ? { ...r, accountingAccount: "1-1800" } : r));

/** Panel Layar 2 dari baris `manual_entry` hari itu — jalur hitung produksi. */
export function hitungBakau(rows: readonly BarisManualLaporan[]) {
  const p = pilahManualEntry(rows);
  const beban = kumpulkanBeban({ manual_entry: p.manualBeban, noncash_expense: [] }, BAKAU_D, BAKAU_D);
  const cashFlow = panelCashFlow(
    cashFlowInputDari({
      totals: TOTALS,
      sebabKas: null,
      kasAwalPerAkun: [{ nama: "BCA", saldo: 1_000_000 }],
      kasAkhir: 1_420_763.5,
      deltaPiutangEasymax: 0,
      // Deposit pelanggan EasyMax (#468): Bakau 2 Okt tanpa pemakaian/top-up deposit.
      deltaDepositEasymax: 0,
      arusHutangPiutangNonEasymax: 0,
      penebusanSo: 0,
      arusTemporaryInvestment: 0,
      arusPenampung: 0,
      pendapatanLain: p.pendapatanLain,
      beban,
      arusTitipanBright: p.titipanBright,
      kontribusi: p.kontribusi,
    }),
  );
  const income = panelIncome({ totals: TOTALS, beban, pendapatanLain: p.pendapatanLain, incomeAdjustment: null });
  const bahan: BahanLangkahHarian = {
    totals: TOTALS,
    kasAkhir: 1_420_763.5,
    sebabKas: null,
    piutangEasymax: 0,
    depositEasymax: 0,
    hutangPiutangNonEasymax: 0,
    penampung: 0,
    temporaryInvestment: 0,
    beban,
    pendapatanLain: p.pendapatanLain,
    totalAssetKemarin: 1_000_000_000,
    kontribusi: p.kontribusi,
    saldoTitipanBright: 0,
  };
  const laba = labaBersihDari(bahan);
  const balance = panelBalance(balanceInputDari(bahan, laba));
  return {
    cashFlow,
    income,
    balance,
    cfCheck: cashFlow.pemeriksa.nilai,
    laba,
    langkah: langkahHarianRinci(bahan).penuh,
  };
}
