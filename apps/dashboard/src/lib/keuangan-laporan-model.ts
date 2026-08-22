import { totalBeban, type BarisBeban } from "./keuangan-beban";
import { cashFlowCheck } from "./keuangan-kas";
import type { DayTotals } from "./keuangan-mesin";

/**
 * Model Laporan Keuangan Harian (Layar 2) — Cash Flow · Income Statement ·
 * Balance Sheet. MURNI (tanpa I/O).
 *
 * Susunan dan penamaan mengikuti sheet `LaporanHarian` workbook, supaya tak ada
 * yang perlu belajar membaca laporan baru.
 *
 * ⛔ **NILAI YANG TAK BERSUMBER ADALAH `null`, BUKAN NOL.** Nol adalah
 * pernyataan ("tidak ada arus hari ini"); `null` adalah pengakuan ("kami tidak
 * tahu"). Menyamakannya membuat laporan yang belum bisa disusun terlihat seperti
 * laporan yang hasilnya nol — persis cara COGS Solar Bakau nol berbulan-bulan
 * tanpa satu pun alarm.
 *
 * Setiap baris karena itu membawa `sumber`: apa yang belum ada dan **siapa** yang
 * mengisinya. Layar menampilkan itu apa adanya.
 */

/** Kenapa sebuah baris belum punya nilai. */
export type SebabKosong =
  | "belum_ada_akun_kas"
  | "belum_ada_mutasi_kas"
  | "belum_ada_harga_beli"
  | "belum_ada_opname"
  | "belum_ada_saldo_pembuka"
  | "tak_bersumber";

export const PENJELASAN_KOSONG: Record<SebabKosong, string> = {
  // ⛔ BUKAN sama dengan `belum_ada_akun_kas` (§10.21). Akunnya ADA; yang belum
  //    ada adalah isinya. Nama yang salah membuat pembacanya mencari akun yang
  //    sebenarnya sudah terdaftar.
  belum_ada_mutasi_kas:
    "Rekeningnya sudah terdaftar tetapi buku kasnya belum diisi satu baris pun — " +
    "saldonya BELUM DIKETAHUI, bukan nol. Tim keuangan yang mengisinya di Layar 3 blok 2.",
  belum_ada_akun_kas:
    "Unit ini belum punya daftar rekening kas/bank — tim keuangan yang mendaftarkannya.",
  belum_ada_harga_beli:
    "Harga beli produk belum diisi untuk tanggal ini — tim keuangan, di Layar 3 blok 1.",
  belum_ada_opname: "Opname penutup hari ini belum masuk dari EasyMax.",
  belum_ada_saldo_pembuka:
    "Saldo pembuka ekuitas belum punya sumber di SolaMax — ia hidup di workbook, " +
    "dan impor riwayat belum dikerjakan.",
  tak_bersumber: "Pos ini belum punya sumber otomatis maupun isian di SolaMax.",
};

export interface BarisLaporan {
  label: string;
  /** `null` = tak bisa dihitung. JANGAN diganti nol di pemanggil. */
  nilai: number | null;
  sebab?: SebabKosong;
  /** Baris jumlah (garis atas, tebal). */
  sum?: boolean;
  /** Baris rincian (menjorok). */
  ind?: boolean;
}

// ---------------------------------------------------------------------------
// Cash Flow (§1.3)
// ---------------------------------------------------------------------------

export interface CashFlowInput {
  /** Sebab kosong sisi kas — WAJIB disebut pemanggil, tidak ditebak (§10.21). */
  sebabKas: SebabKasInput;
  /** Saldo tiap akun kas pada H−1, berurut sesuai tampilan. `null` = tak ada akun. */
  kasAwalPerAkun: { nama: string; saldo: number }[] | null;
  kasAkhir: number | null;
  omzet: number;
  teraValue: number;
  /** Δ piutang pelanggan EasyMax pada hari itu (bertanda arus kas). */
  transaksiPiutangEasymax: number | null;
  /** Δ hutang-piutang non-EasyMax (buku kas kategori `Hutang Piutang`). */
  hutangPiutangNonEasymax: number | null;
  penebusanSo: number | null;
  pendapatanLain: number;
  biayaOperasional: number;
}

export interface PanelLaporan {
  baris: BarisLaporan[];
  /** Angka pemeriksa di KAKI panel — bukan sel tersembunyi. */
  pemeriksa: { label: string; nilai: number | null; sebab?: SebabKosong };
}

export function panelCashFlow(i: CashFlowInput): PanelLaporan {
  const kasAwal =
    i.kasAwalPerAkun === null
      ? null
      : i.kasAwalPerAkun.reduce((s, a) => s + a.saldo, 0);

  const arus: BarisLaporan[] = [
    { label: "Omzet penjualan", nilai: i.omzet },
    { label: "Tera nozzle", nilai: i.teraValue },
    {
      label: "Transaksi piutang pelanggan EasyMax",
      nilai: i.transaksiPiutangEasymax,
      sebab: i.transaksiPiutangEasymax === null ? "tak_bersumber" : undefined,
    },
    {
      label: "Transaksi hutang piutang non-EasyMax",
      nilai: i.hutangPiutangNonEasymax,
      sebab: i.hutangPiutangNonEasymax === null ? sebabKas(i.sebabKas) : undefined,
    },
    {
      label: "Penebusan SO",
      nilai: i.penebusanSo,
      sebab: i.penebusanSo === null ? "tak_bersumber" : undefined,
    },
    { label: "Pendapatan lain-lain", nilai: i.pendapatanLain },
    { label: "Biaya operasional", nilai: i.biayaOperasional },
  ];

  // Net cash change hanya ada bila SELURUH komponennya ada. Menjumlah dengan
  // `?? 0` akan melahirkan angka yang terlihat sah dari pos yang tak diketahui.
  const adaSemua = arus.every((b) => b.nilai !== null);
  const net = adaSemua ? arus.reduce((s, b) => s + (b.nilai ?? 0), 0) : null;

  const baris: BarisLaporan[] = [
    { label: "Kas awal", nilai: kasAwal, sebab: kasAwal === null ? sebabKas(i.sebabKas) : undefined },
    ...(i.kasAwalPerAkun ?? []).map((a) => ({ label: a.nama, nilai: a.saldo, ind: true })),
    ...arus,
    { label: "Net cash change", nilai: net, sum: true },
    {
      label: "Kas akhir",
      nilai: i.kasAkhir,
      sum: true,
      sebab: i.kasAkhir === null ? sebabKas(i.sebabKas) : undefined,
    },
  ];

  const check =
    net === null || kasAwal === null || i.kasAkhir === null
      ? null
      : cashFlowCheck({ netCashChange: net, saldoBukuAwal: kasAwal, saldoBukuAkhir: i.kasAkhir });

  return {
    baris,
    pemeriksa: {
      label: "Cash flow check",
      nilai: check,
      sebab: check === null ? sebabKas(i.sebabKas) : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Income Statement (§1.1)
// ---------------------------------------------------------------------------

export interface IncomeInput {
  totals: DayTotals;
  /** Beban dari KEDUA sumber — sudah lewat `kumpulkanBeban`. */
  beban: readonly BarisBeban[];
  pendapatanLain: number;
  /** Tak bersumber di SolaMax; selalu `null` sampai ada keputusan. */
  incomeAdjustment: number | null;
}

export function panelIncome(i: IncomeInput): PanelLaporan & { marginBersih: number | null } {
  const t = i.totals;
  const biaya = -totalBeban(i.beban);
  const operating = t.grossProfit + t.lossesGainValue;
  const net = operating + biaya + i.pendapatanLain;
  // Margin bersih: satu-satunya tambahan terhadap sheet workbook.
  const margin = t.revenue === 0 ? null : net / t.revenue;

  return {
    baris: [
      { label: "Omzet penjualan", nilai: t.revenue },
      { label: "Tera nozzle", nilai: t.teraValue },
      { label: "COGS", nilai: t.cogs },
      { label: "Gross profit", nilai: t.grossProfit, sum: true },
      { label: "Gain / losses", nilai: t.lossesGainValue },
      { label: "Operating profit", nilai: operating, sum: true },
      { label: "Biaya operasional", nilai: biaya },
      { label: "Pendapatan lain-lain", nilai: i.pendapatanLain },
      { label: "Net profit", nilai: net, sum: true },
      {
        label: "Income adjustment",
        nilai: i.incomeAdjustment,
        sebab: i.incomeAdjustment === null ? "tak_bersumber" : undefined,
      },
    ],
    pemeriksa: { label: "Margin bersih", nilai: margin },
    marginBersih: margin,
  };
}

// ---------------------------------------------------------------------------
// Balance Sheet (§1.2)
// ---------------------------------------------------------------------------

export interface BalanceInput {
  /** Sebab kosong sisi kas — WAJIB disebut pemanggil, tidak ditebak (§10.21). */
  sebabKas: SebabKasInput;
  cashOnHand: number | null;
  inventoryValue: number;
  soValue: number;
  piutangEasymax: number | null;
  hutangPiutangNonEasymax: number | null;
  /** `Total Equity(d−1) − ΔKontribusi`. `null` = belum ada saldo pembuka. */
  openedRetainedEarnings: number | null;
  netIncome: number;
  incomeAdjustment: number | null;
  /** Total Asset kemarin — untuk LANGKAH harian. `null` = tak terhitung. */
  totalAssetKemarin: number | null;
  /** Δ kontribusi/dividend hari ini (arus keluar ekuitas). */
  deltaKontribusi: number | null;
}

export interface PanelBalance extends PanelLaporan {
  /**
   * ⛔ LANGKAH HARIAN — inilah yang berarti (§1.2). `BSCheck` kumulatif adalah
   * residu yang tak pernah dinolkan; membacanya sebagai "kesalahan hari ini"
   * akan memerahkan setiap hari sesudah satu residu lama, selamanya.
   */
  langkahHarian: number | null;
}

export function panelBalance(i: BalanceInput): PanelBalance {
  const komponen = [i.cashOnHand, i.piutangEasymax, i.hutangPiutangNonEasymax];
  const asset = komponen.some((k) => k === null)
    ? null
    : (i.cashOnHand ?? 0) +
      i.inventoryValue +
      i.soValue +
      (i.piutangEasymax ?? 0) +
      (i.hutangPiutangNonEasymax ?? 0);

  const equity =
    i.openedRetainedEarnings === null
      ? null
      : i.openedRetainedEarnings + i.netIncome + (i.incomeAdjustment ?? 0);

  const bsCheck = equity === null || asset === null ? null : equity - asset;

  // Langkah harian TIDAK butuh saldo pembuka — ia bisa dihitung sekarang:
  //   ΔBSCheck = NetIncome + IncomeAdj − ΔKontribusi − ΔAsset
  // Itulah sebabnya gerbang §3 bisa bekerja meski BSCheck kumulatif belum ada.
  const langkah =
    asset === null || i.totalAssetKemarin === null
      ? null
      : i.netIncome + (i.incomeAdjustment ?? 0) - (i.deltaKontribusi ?? 0) - (asset - i.totalAssetKemarin);

  return {
    baris: [
      { label: "Asset − liabilities", nilai: asset, sum: true },
      { label: "Cash on hand", nilai: i.cashOnHand, ind: true, sebab: i.cashOnHand === null ? sebabKas(i.sebabKas) : undefined },
      { label: "Nilai stock", nilai: i.inventoryValue, ind: true },
      { label: "Nilai DO", nilai: i.soValue, ind: true },
      { label: "Hutang piutang pelanggan EasyMax", nilai: i.piutangEasymax, ind: true, sebab: i.piutangEasymax === null ? "tak_bersumber" : undefined },
      { label: "Hutang piutang non-EasyMax", nilai: i.hutangPiutangNonEasymax, ind: true, sebab: i.hutangPiutangNonEasymax === null ? sebabKas(i.sebabKas) : undefined },
      { label: "Equity", nilai: equity, sum: true, sebab: equity === null ? "belum_ada_saldo_pembuka" : undefined },
      { label: "Opened retained earnings", nilai: i.openedRetainedEarnings, ind: true, sebab: i.openedRetainedEarnings === null ? "belum_ada_saldo_pembuka" : undefined },
      { label: "Net income", nilai: i.netIncome, ind: true },
      { label: "Income adjustment", nilai: i.incomeAdjustment, ind: true, sebab: i.incomeAdjustment === null ? "tak_bersumber" : undefined },
    ],
    pemeriksa: {
      label: "Balance sheet check (kumulatif)",
      nilai: bsCheck,
      sebab: bsCheck === null ? "belum_ada_saldo_pembuka" : undefined,
    },
    langkahHarian: langkah,
  };
}

/** Nada tampilan angka pemeriksa. Toleransi akuntansi/GL = Rp 0 (§3.1). */
/**
 * Caveat "Nilai DO" — SATU sumber untuk layar DAN PDF.
 *
 * ⛔ Kata-katanya milik keputusan B7, bukan milik penyaji. Ia disalin ke kertas
 * apa adanya: berkas yang menghilangkan batasnya membuat pembacanya lebih
 * percaya diri daripada yang berhak, dan berkas hidup lebih lama dari sesi.
 *
 * 📌 Saat penutupan B7 mendarat (session-notes/2026-08-21-b7-sovalue-hasil.md),
 * kalimat ini yang disunting — satu tempat, bukan dua.
 */
export const CATATAN_NILAI_DO =
  "Nilai DO masih memakai sumbu tanggal yang belum cocok pada 4 dari 10 tanggal uji (B7). " +
  "Angkanya ditampilkan apa adanya — jangan dipakai sebagai bukti sampai sumbunya diselaraskan.";

/**
 * Sebab kosong untuk pos-pos SISI KAS — **diserahkan pemanggil, tidak ditebak**.
 *
 * ⛔ Bentuk lama meng-hardcode `belum_ada_akun_kas` untuk SETIAP `null` di sisi
 * kas. Sejak §10.21 ada dua sebab yang berbeda, dan menebak salah satunya
 * membuat pembacanya mencari akun yang sebenarnya sudah terdaftar. Kalau
 * pemanggil tak menyebut sebabnya, jatuhnya ke `tak_bersumber` — mengaku tak
 * tahu, bukan mengarang sebab.
 */
function sebabKas(s: SebabKasInput): SebabKosong {
  return s ?? "tak_bersumber";
}

/** `null` = pemanggil tak menyebutkan; JANGAN diisi tebakan. */
export type SebabKasInput = "belum_ada_akun_kas" | "belum_ada_mutasi_kas" | null;

/**
 * ⛔ SATU PEMBUAT VONIS untuk "kenapa sisi kas kosong" (§10.21). Dipakai
 * `getBahanLaporan`; dipisah ke sini supaya bisa diuji tanpa DB — aturannya
 * terlalu penting untuk hanya hidup di dalam sebuah kueri.
 *
 * `null` (bukan sebab) berarti kasnya BISA dihitung.
 */
export function sebabKasDari(jumlahAkun: number, jumlahMutasiAktif: number): SebabKasInput {
  if (jumlahAkun === 0) return "belum_ada_akun_kas";
  if (jumlahMutasiAktif === 0) return "belum_ada_mutasi_kas";
  return null;
}

export type NadaPemeriksa = "baik" | "buruk" | "tak_terhitung";

export function nadaPemeriksa(nilai: number | null): NadaPemeriksa {
  if (nilai === null) return "tak_terhitung";
  return Math.abs(nilai) < 0.005 ? "baik" : "buruk";
}

// ---------------------------------------------------------------------------
// Saldo vs arus — DUA angka dari kategori yang sama (§1.2 vs §1.3)
// ---------------------------------------------------------------------------

/** Bagian mutasi kas yang dibutuhkan kedua fungsi di bawah. */
export interface MutasiBerkategori {
  businessDate: string;
  categoryLabel: string | null;
  amount: number;
  void: boolean;
}

/** Σ mutasi berkategori tertentu SAMPAI DENGAN satu tanggal (saldo, bukan arus). */
export function deltaKategoriSampai(mutasi: readonly MutasiBerkategori[], sampai: string, label: string): number {
  let s = 0;
  for (const m of mutasi) {
    if (m.void || m.businessDate > sampai || m.categoryLabel !== label) continue;
    s += m.amount;
  }
  return s;
}

/** Σ mutasi berkategori tertentu pada satu tanggal (bertanda). */
export function deltaKategori(mutasi: readonly MutasiBerkategori[], date: string, label: string): number {
  let s = 0;
  for (const m of mutasi) {
    if (m.void || m.businessDate !== date || m.categoryLabel !== label) continue;
    s += m.amount;
  }
  return s;
}
