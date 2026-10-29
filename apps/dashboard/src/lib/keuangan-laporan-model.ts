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
  | "sebelum_cut_over"
  | "produk_tanpa_harga_beli"
  | "belum_ada_harga_beli"
  | "belum_ada_opname"
  | "data_stok_gl_tak_lengkap"
  | "belum_ada_saldo_pembuka"
  | "tak_bersumber";

export const PENJELASAN_KOSONG: Record<SebabKosong, string> = {
  // §10.23 — produknya DISEBUT oleh pemanggil (spanduk `incomplete`); kalimat
  // ini menerangkan artinya, bukan menggantikan daftarnya.
  produk_tanpa_harga_beli:
    "Ada produk yang belum punya harga beli pada tanggal ini, jadi beban pokoknya " +
    "tak terhitung — laba yang dijumlahkan tanpa itu akan LEBIH SAJI. Tim keuangan " +
    "mengisinya di Layar 3 blok 1; produk mana saja disebut di peringatan halaman.",
  // ⛔ BUKAN sama dengan `belum_ada_akun_kas` (§10.21). Akunnya ADA; yang belum
  //    ada adalah isinya. Nama yang salah membuat pembacanya mencari akun yang
  //    sebenarnya sudah terdaftar.
  belum_ada_mutasi_kas:
    "Rekeningnya sudah terdaftar tetapi buku kasnya belum diisi satu baris pun — " +
    "saldonya BELUM DIKETAHUI, bukan nol. Tim keuangan yang mengisinya di Layar 3 blok 2.",
  belum_ada_akun_kas:
    "Unit ini belum punya daftar rekening kas/bank — tim keuangan yang mendaftarkannya.",
  // §10.26 — pembukuan SolaMax dimulai di tanggal cut-over. Hari sebelumnya
  // TIDAK dibukukan di sini; menjumlah mutasi lama yang kebetulan ada akan
  // menampilkan saldo yang tampak sah padahal bukunya belum dimulai.
  sebelum_cut_over:
    "Tanggal ini SEBELUM pembukuan kas di SolaMax dimulai (tanggal cut-over saldo pembuka) — " +
    "kasnya tidak dibukukan di sini, bukan nol.",
  belum_ada_harga_beli:
    "Harga beli produk belum diisi untuk tanggal ini — tim keuangan, di Layar 3 blok 1.",
  belum_ada_opname: "Opname penutup hari ini belum masuk dari EasyMax.",
  data_stok_gl_tak_lengkap:
    "Data stok atau mutasi minyak dari EasyMax belum lengkap atau tidak valid — " +
    "Gain/Losses dan nilai turunannya belum bisa dihitung. Periksa laporan operasional; " +
    "produk terdampak disebut di peringatan halaman.",
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
  /**
   * Penanda keadaan yang WAJIB ikut angkanya, mis. "saldo pembuka sementara"
   * (§10.26). Dirender di layar & PDF di samping label — bukan di tooltip.
   */
  tanda?: string;
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
  /** R16 — Σ buku kas kategori `Pembelian BBM` hari itu (keluar = negatif). */
  penebusanSo: number | null;
  /** §1.3 — Σ buku kas kategori `Temporary Investment` hari itu. */
  temporaryInvestment: number | null;
  /** KTD8 — Σ buku kas penampung `Mutasi Belum Teridentifikasi` hari itu. */
  penampung: number | null;
  pendapatanLain: number;
  biayaOperasional: number;
  /** §10.27 — titipan outlet Bright hari itu (diterima − diserahkan). Kas, bukan laba. */
  arusTitipanBright: number;
  /**
   * §10.29 — arus ekuitas bersih hari itu (keluar ke pemilik − masuk dari pemilik),
   * dari biaya pengawas yang direklasifikasi ke prive/kontribusi. POSITIF = keluar.
   */
  kontribusiPemilik: number;
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
      sebab: i.penebusanSo === null ? sebabKas(i.sebabKas) : undefined,
    },
    { label: "Pendapatan lain-lain", nilai: i.pendapatanLain },
    { label: "Biaya operasional", nilai: i.biayaOperasional },
    {
      label: "Temporary investment",
      nilai: i.temporaryInvestment,
      sebab: i.temporaryInvestment === null ? sebabKas(i.sebabKas) : undefined,
    },
    // KTD8 — uang yang belum dikenali tetap ARUS (ia ada di rekening), di baris
    // sendiri sampai dipindahkan ke tujuannya.
    {
      label: "Mutasi belum teridentifikasi (penampung)",
      nilai: i.penampung,
      sebab: i.penampung === null ? sebabKas(i.sebabKas) : undefined,
    },
    // §10.27 — uang titipan outlet Bright ikut laci & setoran SPBU, jadi ia ARUS
    // KAS — tetapi bukan pendapatan. Baris sendiri, supaya tak tercampur.
    { label: "Titipan outlet Bright (bukan pendapatan)", nilai: i.arusTitipanBright },
    // §10.29 — uang ke/dari pemilik yang dicatat pengawas sebagai biaya lalu
    // direklasifikasi Finance: tetap ARUS KAS, tetapi bukan beban.
    { label: "Prive / kontribusi pemilik (bukan beban)", nilai: -i.kontribusiPemilik },
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
  // ⛔ RAMBATAN `null` YANG DISENGAJA (§10.23). Setiap pos di bawah GP mewarisi
  //    ketidaktahuannya; menggantinya dengan 0 di sini akan mengembalikan persis
  //    angka lebih saji yang keputusan itu tutup, satu baris lebih rendah.
  const operating = t.grossProfit === null || t.lossesGainValue === null
    ? null : t.grossProfit + t.lossesGainValue;
  const net = operating === null ? null : operating + biaya + i.pendapatanLain;
  const margin = net === null || t.revenue === 0 ? null : net / t.revenue;
  // Sebabnya mengikuti himpunan yang BENAR-BENAR merusak GP — syarat yang sama
  // dengan `grossProfit === null`. Dua tempat dengan himpunan berbeda akan
  // menghasilkan "belum bisa dihitung" tanpa sebab, atau sebab tanpa null.
  const sebabGp = t.perusakGp.length > 0 ? ("produk_tanpa_harga_beli" as const) : undefined;
  const sebabGl = t.lossesGainValue === null ? ("data_stok_gl_tak_lengkap" as const) : undefined;
  const sebabLaba = sebabGp ?? sebabGl;

  return {
    baris: [
      { label: "Omzet penjualan", nilai: t.revenue },
      { label: "Tera nozzle", nilai: t.teraValue },
      { label: "COGS", nilai: t.cogs },
      { label: "Gross profit", nilai: t.grossProfit, sum: true, sebab: sebabGp },
      { label: "Gain / losses", nilai: t.lossesGainValue, sebab: sebabGl },
      { label: "Operating profit", nilai: operating, sum: true, sebab: sebabLaba },
      { label: "Biaya operasional", nilai: biaya },
      { label: "Pendapatan lain-lain", nilai: i.pendapatanLain },
      { label: "Net profit", nilai: net, sum: true, sebab: sebabLaba },
      {
        label: "Income adjustment",
        nilai: i.incomeAdjustment,
        sebab: i.incomeAdjustment === null ? "tak_bersumber" : undefined,
      },
    ],
    pemeriksa: { label: "Margin bersih", nilai: margin, sebab: sebabLaba },
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
  inventoryValue: number | null;
  soValue: number;
  piutangEasymax: number | null;
  /**
   * KTD2 — Σ saldo pihak lawan (positif = piutang) + baris lama tanpa pihak
   * lawan. Menggantikan agregat "Hutang Piutang" yang tandanya terbalik.
   */
  hutangPiutangNonEasymax: number | null;
  /** Bagian `hutangPiutangNonEasymax` yang pihak lawannya belum ditetapkan (ditampilkan). */
  pihakLawanBelumDitetapkan?: number | null;
  /** §10.26 — ada saldo pembuka pihak lawan berlaku yang sementara. */
  pihakLawanSementara?: boolean;
  /** KTD8 — term penampung (−Σ amount). `null` = tanpa akun kas. */
  penampung: number | null;
  /** §1.2 — Temporary investment (−Σ amount kategori itu). `null` = tanpa akun kas. */
  temporaryInvestment: number | null;
  /** `Total Equity(d−1) − ΔKontribusi`. `null` = belum ada saldo pembuka. */
  openedRetainedEarnings: number | null;
  /** `null` = laba tak terhitung (§10.23). JANGAN dinolkan di pemanggil. */
  netIncome: number | null;
  incomeAdjustment: number | null;
  /** Total Asset kemarin — untuk LANGKAH harian. `null` = tak terhitung. */
  totalAssetKemarin: number | null;
  /** Δ kontribusi/dividend hari ini (arus keluar ekuitas). */
  deltaKontribusi: number | null;
  /** §10.27 — SALDO liabilitas titipan outlet Bright. Mengurangi asset bersih. */
  saldoTitipanBright: number;
  /** U5/U6 — rincian liabilitas titipan per pemilik; Σ = `saldoTitipanBright`. */
  titipanPerPemilik?: readonly { nama: string; saldo: number }[];
  /** §10.26 — ada saldo pembuka pemilik titipan berlaku yang sementara. */
  titipanSementara?: boolean;
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
  const komponen = [
    i.cashOnHand,
    i.inventoryValue,
    i.piutangEasymax,
    i.hutangPiutangNonEasymax,
    i.penampung,
    i.temporaryInvestment,
  ];
  const asset = komponen.some((k) => k === null)
    ? null
    : (i.cashOnHand ?? 0) +
      (i.inventoryValue ?? 0) +
      i.soValue +
      (i.piutangEasymax ?? 0) +
      (i.hutangPiutangNonEasymax ?? 0) +
      (i.penampung ?? 0) +
      (i.temporaryInvestment ?? 0) -
      i.saldoTitipanBright;
  const SEMENTARA = "saldo pembuka sementara";

  // ⛔ `netIncome` boleh `null` sejak §10.23. Menggantinya 0 di sini — atau di
  //    pemanggil dengan `?? 0` — memasukkan kembali angka lebih saji yang
  //    keputusan itu tutup, lewat pintu belakang.
  const equity =
    i.openedRetainedEarnings === null || i.netIncome === null
      ? null
      : i.openedRetainedEarnings + i.netIncome + (i.incomeAdjustment ?? 0);

  const bsCheck = equity === null || asset === null ? null : equity - asset;

  // Langkah harian TIDAK butuh saldo pembuka — ia bisa dihitung sekarang:
  //   ΔBSCheck = NetIncome + IncomeAdj − ΔKontribusi − ΔAsset
  // Itulah sebabnya gerbang §3 bisa bekerja meski BSCheck kumulatif belum ada.
  const langkah =
    asset === null || i.totalAssetKemarin === null || i.netIncome === null
      ? null
      : i.netIncome + (i.incomeAdjustment ?? 0) - (i.deltaKontribusi ?? 0) - (asset - i.totalAssetKemarin);

  return {
    baris: [
      { label: "Asset − liabilities", nilai: asset, sum: true,
        sebab: i.inventoryValue === null ? "data_stok_gl_tak_lengkap" : undefined },
      { label: "Cash on hand", nilai: i.cashOnHand, ind: true, sebab: i.cashOnHand === null ? sebabKas(i.sebabKas) : undefined },
      { label: "Nilai stock", nilai: i.inventoryValue, ind: true,
        sebab: i.inventoryValue === null ? "data_stok_gl_tak_lengkap" : undefined },
      { label: "Nilai DO", nilai: i.soValue, ind: true },
      { label: "Hutang piutang pelanggan EasyMax", nilai: i.piutangEasymax, ind: true, sebab: i.piutangEasymax === null ? "tak_bersumber" : undefined },
      { label: "Hutang piutang non-EasyMax", nilai: i.hutangPiutangNonEasymax, ind: true, sebab: i.hutangPiutangNonEasymax === null ? sebabKas(i.sebabKas) : undefined,
        tanda: i.pihakLawanSementara ? SEMENTARA : undefined },
      // KTD3 — baris lama tanpa pihak lawan tetap DIIMBANGI (langkah 0), tetapi
      // terlihat sampai Finance menetapkannya.
      ...(i.pihakLawanBelumDitetapkan
        ? [{ label: "· pihak lawan belum ditetapkan", nilai: i.pihakLawanBelumDitetapkan, ind: true }]
        : []),
      { label: "Temporary investment", nilai: i.temporaryInvestment, ind: true, sebab: i.temporaryInvestment === null ? sebabKas(i.sebabKas) : undefined },
      { label: "Penampung mutasi belum teridentifikasi", nilai: i.penampung, ind: true, sebab: i.penampung === null ? sebabKas(i.sebabKas) : undefined },
      { label: "Titipan outlet Bright (liabilitas)", nilai: -i.saldoTitipanBright, ind: true,
        tanda: i.titipanSementara ? SEMENTARA : undefined },
      ...(i.titipanPerPemilik ?? []).map((t) => ({ label: `· ${t.nama}`, nilai: -t.saldo, ind: true })),
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

/**
 * Bagian neraca yang bersumber dari BUKU KAS — dihitung dua kali untuk KTD15
 * (dengan dan tanpa baris susulan hari itu).
 */
export interface SisiKasLangkah {
  kasAkhir: number | null;
  hutangPiutangNonEasymax: number | null;
  penampung: number | null;
  temporaryInvestment: number | null;
  saldoTitipanBright: number;
  /** §10.29 — arus ekuitas hari itu (reklasifikasi + buku kas). POSITIF = keluar. */
  kontribusi: number;
}

/**
 * KTD15 / §10.34 — bahan langkah "dinilai": sisi kas tanpa baris susulan hari
 * itu, DAN laba tanpa `manual_entry` pintu Finance yang bertaut
 * (`cash_ledger_id`, 0053) ke baris susulan itu. Pasangan klasifikasi (kas +
 * beban/pendapatan lain-lain) sudah seimbang di dalam SolaMax: mencabut hanya
 * kakinya yang kas melahirkan selisih palsu sebesar bebannya, dan koreksi
 * susulan lawannya. Wajib (bukan opsional) supaya penyusun bahan baru tak bisa
 * lupa memotong labanya.
 */
export interface SisiLangkahDinilai extends SisiKasLangkah {
  beban: readonly BarisBeban[];
  pendapatanLain: number;
}

/** Bagian `BahanLaporan` yang menentukan langkah harian — struktural, tanpa I/O. */
export interface BahanLangkahHarian extends SisiKasLangkah {
  totals: DayTotals;
  sebabKas: SebabKasInput;
  piutangEasymax: number;
  beban: readonly BarisBeban[];
  pendapatanLain: number;
  totalAssetKemarin: number | null;
  /**
   * KTD15 — sisi kas yang SAMA tetapi tanpa baris yang dibukukan hari itu
   * dengan tanggal asal lebih awal — beserta laba tanpa beban/pendapatan yang
   * bertaut baris itu (§10.34). `undefined` = tak ada baris susulan.
   */
  tanpaSusulan?: SisiLangkahDinilai;
}

/** Bahan lengkap untuk panel neraca (Layar 2, papan, Layar 4). */
export interface BahanNeraca extends BahanLangkahHarian {
  pihakLawanBelumDitetapkan?: number | null;
  pihakLawanSementara?: boolean;
  titipanPerPemilik?: readonly { nama: string; saldo: number }[];
  titipanSementara?: boolean;
}

/** Bahan untuk panel arus kas. */
export interface BahanArus {
  totals: DayTotals;
  sebabKas: SebabKasInput;
  kasAwalPerAkun: { nama: string; saldo: number }[] | null;
  kasAkhir: number | null;
  deltaPiutangEasymax: number;
  arusHutangPiutangNonEasymax: number | null;
  penebusanSo: number | null;
  arusTemporaryInvestment: number | null;
  arusPenampung: number | null;
  pendapatanLain: number;
  beban: readonly BarisBeban[];
  arusTitipanBright: number;
  kontribusi: number;
}

/**
 * ⛔ SATU penyusun `BalanceInput` dari bahan — dipakai Layar 2, papan, Layar 4,
 * dan `langkahHarianRinci`. Empat salinan susunan inline dulu menjawab sama
 * hanya selama tak ada yang menambah term; U6 menambah tiga.
 */
export function balanceInputDari(b: BahanNeraca, netIncome: number | null, sisi: SisiKasLangkah = b): BalanceInput {
  return {
    cashOnHand: sisi.kasAkhir,
    sebabKas: b.sebabKas,
    inventoryValue: b.totals.inventoryValue,
    soValue: b.totals.soValue,
    piutangEasymax: b.piutangEasymax,
    hutangPiutangNonEasymax: sisi.hutangPiutangNonEasymax,
    pihakLawanBelumDitetapkan: b.pihakLawanBelumDitetapkan,
    pihakLawanSementara: b.pihakLawanSementara,
    penampung: sisi.penampung,
    temporaryInvestment: sisi.temporaryInvestment,
    openedRetainedEarnings: null,
    netIncome,
    incomeAdjustment: null,
    totalAssetKemarin: b.totalAssetKemarin,
    // §10.29 — prive/kontribusi (reklasifikasi biaya pengawas + buku kas).
    deltaKontribusi: sisi.kontribusi,
    saldoTitipanBright: sisi.saldoTitipanBright,
    titipanPerPemilik: b.titipanPerPemilik,
    titipanSementara: b.titipanSementara,
  };
}

/** ⛔ SATU penyusun `CashFlowInput` dari bahan — Layar 2 dan Layar 4. */
export function cashFlowInputDari(b: BahanArus): CashFlowInput {
  return {
    kasAwalPerAkun: b.kasAwalPerAkun,
    sebabKas: b.sebabKas,
    kasAkhir: b.kasAkhir,
    omzet: b.totals.revenue,
    teraValue: b.totals.teraValue,
    transaksiPiutangEasymax: b.deltaPiutangEasymax,
    hutangPiutangNonEasymax: b.arusHutangPiutangNonEasymax,
    penebusanSo: b.penebusanSo,
    temporaryInvestment: b.arusTemporaryInvestment,
    penampung: b.arusPenampung,
    pendapatanLain: b.pendapatanLain,
    biayaOperasional: -b.beban.reduce((s, x) => s + x.amountRp, 0),
    arusTitipanBright: b.arusTitipanBright,
    kontribusiPemilik: b.kontribusi,
  };
}

/** Laba bersih hari itu — jalur `panelIncome` yang sama dengan layar. `null` = tak terhitung (§10.23). */
export function labaBersihDari(b: Pick<BahanLangkahHarian, "totals" | "beban" | "pendapatanLain">): number | null {
  return panelIncome({
    totals: b.totals,
    beban: b.beban,
    pendapatanLain: b.pendapatanLain,
    incomeAdjustment: null,
  }).baris.find((x) => x.label === "Net profit")!.nilai;
}

export interface RincianLangkah {
  /** Langkah neraca dengan SEMUA baris kas (yang tampil di Layar 2). */
  penuh: number | null;
  /** Langkah tanpa baris susulan hari itu — yang DINILAI tangga toleransi (KTD15). */
  dinilai: number | null;
  /** `penuh − dinilai`; `null` bila salah satunya tak terhitung. */
  koreksiSusulan: number | null;
}

/**
 * KTD15 / R32 — langkah harian dihitung DUA KALI: dengan semua baris, dan
 * tanpa baris yang dibukukan hari itu bertanggal asal lebih awal. Baris susulan
 * berpihak lawan menyumbang nol (sudah seimbang di dalam SolaMax); yang
 * menyumbang adalah baris yang lawannya sudah tercatat di EasyMax pada tanggal
 * asalnya (transfer pelanggan, penebusan).
 */
export function langkahHarianRinci(b: BahanLangkahHarian): RincianLangkah {
  const penuh = panelBalance(balanceInputDari(b, labaBersihDari(b))).langkahHarian;
  const t = b.tanpaSusulan;
  // §10.34 — laba `dinilai` juga tanpa beban/pendapatan yang bertaut baris
  // susulan; memakai laba penuh di sini membuat pasangan seimbang menyumbang.
  const dinilai =
    t === undefined
      ? penuh
      : panelBalance(
          balanceInputDari(b, labaBersihDari({ totals: b.totals, beban: t.beban, pendapatanLain: t.pendapatanLain }), t),
        ).langkahHarian;
  const koreksi = penuh === null || dinilai === null ? null : Math.round((penuh - dinilai) * 100) / 100 || 0;
  return { penuh, dinilai, koreksiSusulan: koreksi };
}

/**
 * ⛔ SATU JALUR HITUNG `day_close.difference_rp` (§1.2, §4.6) — dipakai Layar 4
 * saat dibuka (§10.15) DAN oleh `tutupHari` di bawah kuncinya (rencana
 * 2026-10-29 U2/KTD5). Dua salinan susunan ini akan menjawab berbeda begitu
 * salah satunya disunting, dan yang kalah adalah angka yang dipakai menutup.
 *
 * `null` dirambatkan apa adanya: hari yang belum bisa dinilai tak boleh
 * mendapat angka (nol terbaca "seimbang", §10.15).
 *
 * KTD15 (U6) — yang dikembalikan adalah langkah **DINILAI** (tanpa koreksi
 * susulan). Koreksi susulannya: {@link langkahHarianRinci}. Kolom `day_close`
 * untuk menyimpannya & tampilan layarnya milik U12.
 */
export function langkahHarianDari(b: BahanLangkahHarian): number | null {
  return langkahHarianRinci(b).dinilai;
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
export type SebabKasInput = "belum_ada_akun_kas" | "belum_ada_mutasi_kas" | "sebelum_cut_over" | null;

/**
 * ⛔ SATU PEMBUAT VONIS untuk "kenapa sisi kas kosong" (§10.21). Dipakai
 * `getBahanLaporan`; dipisah ke sini supaya bisa diuji tanpa DB — aturannya
 * terlalu penting untuk hanya hidup di dalam sebuah kueri.
 *
 * `null` (bukan sebab) berarti kasnya BISA dihitung.
 */
export function sebabKasDari(
  jumlahAkun: number,
  jumlahMutasiAktif: number,
  /** §10.26 — tanggal laporan & cut-over TERAWAL antar akun (`null` = belum ada saldo pembuka). */
  cutOver?: { tanggal: string; terawal: string | null },
): SebabKasInput {
  if (jumlahAkun === 0) return "belum_ada_akun_kas";
  if (cutOver?.terawal != null && cutOver.tanggal < cutOver.terawal) return "sebelum_cut_over";
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
