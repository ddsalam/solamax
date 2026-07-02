/**
 * Model Laporan Operasional Harian — SUMBER TUNGGAL untuk render layar DAN ekspor
 * PDF. Murni (tanpa I/O); dibangun dari hasil query yang SUDAH ber-scope
 * (ScopedUnitId). Semua derivasi (alarm, G/L RESUME, DO, target, recap, rekon)
 * dihitung SEKALI di sini → angka PDF identik dengan layar "ke rupiah". Konsumen
 * (page.tsx & laporan-doc.ts) memformat via lib/format yang sama.
 */
import {
  canonicalProductKey,
  classifyProduct,
  DO_PRODUCTS,
  resolveDoProduct,
  targetVolumePerDay,
} from "@/lib/config";
import { aggregateDailyGl, alarmScore, bauran, glPercent, type AlarmCheck } from "@/lib/derive";
import { parenNeg, pct, signed } from "@/lib/format";
import type * as Q from "@/lib/queries";

/** Bentuk kembalian monthInfo() (tak diekspor sebagai tipe di lib/periods). */
interface MonthCtx {
  month: number;
  year: number;
  dayOfMonth: number;
  daysInMonth: number;
}

type Prod = Awaited<ReturnType<typeof Q.getSalesByProduct>>[number];
type GlRow = Awaited<ReturnType<typeof Q.getDailyGlByProduct>>[number];
type Deliv = Awaited<ReturnType<typeof Q.getDeliveryByProduct>>[number];
type DoRow = Awaited<ReturnType<typeof Q.getDoHarian>>[number];
type DoAnom = Awaited<ReturnType<typeof Q.getDoAnomalies>>[number];
type DoSuspect = Awaited<ReturnType<typeof Q.getDoSuspectSO>>[number];
type Shift = Awaited<ReturnType<typeof Q.getShiftInfo>>;
type Cash = Awaited<ReturnType<typeof Q.getCashForDate>>[number];
type Saldo = Awaited<ReturnType<typeof Q.getSaldoPelanggan>>;
type Manual = Awaited<ReturnType<typeof Q.getManualEntries>>[number];
type RpRow = { rp: number };

export type Tone = "success" | "warning" | "danger";

export interface SalesRow {
  ckdbbm: string;
  nama: string;
  vol: number;
  gl: number | null;
  tera: number;
  omzet: number;
}
export interface GlMonthRow {
  ckdbbm: string;
  nama: string;
  selisih: number;
  vol: number;
}
export interface TargetRow {
  ckdbbm: string;
  nama: string;
  vol: number;
  avgPerDay: number;
  terima: number;
  alok: number | null;
  sel: number | null;
}
export interface DoHarianRow {
  key: string;
  label: string;
  doAwal: number;
  penerimaan: number;
  penebusan: number;
  sisa: number;
  recon: number;
}
export interface HargaRow {
  ckdbbm: string;
  nama: string;
  harga: number | null;
}
export interface RekonRow {
  l: string;
  label: string;
  val: number | null;
  op?: string;
  em?: boolean;
  formula?: string;
}

export interface LaporanModel {
  detail: boolean;
  header: {
    isPartial: boolean;
    shifts: number;
    lastDtgljam: string | null;
    scoreText: string;
    scoreTone: Tone;
    provisionalCount: number;
    fail: number;
    omzetTotal: number;
  };
  checks: AlarmCheck[]; // termasuk "na"; konsumen memfilter untuk tampil
  sales: {
    rows: SalesRow[];
    totVol: number;
    totOmzet: number;
    glTotal: number;
    totTera: number;
    glPctDay: number | null;
    glProvisional: boolean;
    glGarbageCount: number;
    gasMix: number | null;
    oilMix: number | null;
  };
  recap: {
    hasRecap: boolean;
    hasSaldo: boolean;
    saldoRows: { label: string; val: number; danger?: boolean }[];
    recapBoxes: { label: string; val: number; note: string }[];
  };
  glMonthly: {
    rows: GlMonthRow[];
    glMonthTotal: number;
    glPctMonth: number | null;
  };
  target: { rows: TargetRow[] };
  doHarian: {
    rows: DoHarianRow[];
    totals: { doAwal: number; penerimaan: number; penebusan: number; sisa: number };
    suspects: DoSuspect[];
    anomRows: (DoAnom & { label: string })[];
  };
  harga: { rows: HargaRow[] };
  rekon: { rows: RekonRow[]; cashTotal: number };
  corrections: number;
}

export interface LaporanRaw {
  prodDay: Prod[];
  glRows: GlRow[];
  prodMonth: Prod[];
  delivMonth: Deliv[];
  doDay: DoRow[];
  doAnomalies: DoAnom[];
  doSuspects: DoSuspect[];
  shift: Shift;
  corrections: number;
  cash: Cash[];
  saldo: Saldo;
  recapPelanggan: RpRow[];
  recapEdc: RpRow[];
  recapDeposit: RpRow[];
  recapPendapatanLain: Manual[];
  recapPengeluaran: Manual[];
  recapSetoran: Manual[];
}

const orderBy = <T extends { nama: string }>(xs: T[]): T[] =>
  [...xs].sort((a, b) => (classifyProduct(a.nama)?.order ?? 9) - (classifyProduct(b.nama)?.order ?? 9));

export function buildLaporanModel(
  raw: LaporanRaw,
  ctx: { unitCode: string; date: string; today: string; mi: MonthCtx; detail: boolean },
): LaporanModel {
  const { unitCode, date, today, mi, detail } = ctx;
  const {
    prodDay,
    glRows,
    prodMonth,
    delivMonth,
    doDay,
    doAnomalies,
    doSuspects,
    shift,
    cash,
    saldo,
  } = raw;

  // ── DO Harian (6 produk tetap) ──
  const doRows: DoHarianRow[] = DO_PRODUCTS.map((dp) => {
    const r = doDay.find((x) => resolveDoProduct(x.nama)?.key === dp.key);
    const doAwal = r?.do_awal ?? 0;
    const penerimaan = r?.penerimaan ?? 0;
    const penebusan = r?.penebusan ?? 0;
    const sisa = r?.sisa ?? 0;
    return {
      key: dp.key,
      label: dp.label,
      doAwal,
      penerimaan,
      penebusan,
      sisa,
      recon: Math.round(doAwal + penebusan - penerimaan - sisa),
    };
  });
  const doTotals = doRows.reduce(
    (a, r) => ({
      doAwal: a.doAwal + r.doAwal,
      penerimaan: a.penerimaan + r.penerimaan,
      penebusan: a.penebusan + r.penebusan,
      sisa: a.sisa + r.sisa,
    }),
    { doAwal: 0, penerimaan: 0, penebusan: 0, sisa: 0 },
  );
  const anomRows = orderBy(
    doAnomalies.map((a) => ({ ...a, label: resolveDoProduct(a.nama)?.label ?? a.nama })),
  );

  // ── Omset / G/L (RESUME) / Tera ──
  const totSales = prodDay.reduce((s, p) => s + p.vol, 0);
  const totOmzet = prodDay.reduce((s, p) => s + p.omzet, 0);
  const dayAgg = aggregateDailyGl(glRows.filter((r) => r.d === date));
  const monthAgg = aggregateDailyGl(glRows);
  const glByCode = new Map([...dayAgg.byProduct].map(([k, v]) => [k, v.signed] as const));
  const teraByCode = new Map([...dayAgg.byProduct].map(([k, v]) => [k, v.tera] as const));
  const glTotal = dayAgg.totalSigned;
  const totTera = dayAgg.totalTera;
  const glPctDay = dayAgg.hasGl ? glPercent(glTotal, totSales) : null;
  const glProvisional = dayAgg.provisional;
  const glGarbageCount = dayAgg.excludedTanks;

  const salesRows: SalesRow[] = orderBy(prodDay).map((p) => ({
    ckdbbm: p.ckdbbm,
    nama: p.nama,
    vol: p.vol,
    gl: glByCode.get(p.ckdbbm) ?? null,
    tera: teraByCode.get(p.ckdbbm) ?? 0,
    omzet: p.omzet,
  }));

  const volMonth = prodMonth.reduce((s, p) => s + p.vol, 0);
  const glMonthTotal = monthAgg.totalSigned;
  const glPctMonth = monthAgg.hasGl ? glPercent(glMonthTotal, volMonth) : null;

  const isToday = date === today;
  const isPartial = isToday && shift.shifts < 3;
  const gasMix = bauran(prodDay, "gasoline");
  const oilMix = bauran(prodDay, "gasoil");

  // ── Alarm (3 aktif, 8 menunggu data) ──
  const targetGap = prodMonth.map((p) => {
    const perDay = targetVolumePerDay(unitCode, mi.month, p.nama);
    return perDay !== null ? p.vol - perDay * mi.dayOfMonth : null;
  });
  const worstGap = targetGap.filter((x): x is number => x !== null).sort((a, b) => a - b)[0];
  const hasTarget = targetGap.some((x) => x !== null);

  const na = (label: string, domain: string): AlarmCheck => ({
    label,
    state: "na",
    note: `belum tersedia · ${domain}`,
  });

  const dailyLoss = (): AlarmCheck => {
    if (glPctDay === null)
      return {
        label: "Losses harian — menunggu opname",
        state: "na",
        note: "opname penutup belum ada",
      };
    if (glProvisional)
      return {
        label: "Losses harian — sementara",
        state: "provisional",
        note: `${signed(glTotal)} L berjalan · belum final, menunggu opname penutup${glGarbageCount > 0 ? ` · ${glGarbageCount} baris dikecualikan` : ""}`,
      };
    const within = Math.abs(glTotal) <= 100 && Math.abs(glPctDay) <= 0.005;
    return {
      label: within ? "Losses harian aman" : "Losses harian di atas ambang",
      state: within ? "ok" : "fail",
      note: `${signed(glTotal)} L · ${pct(Math.abs(glPctDay), 2)}${glGarbageCount > 0 ? ` · ${glGarbageCount} baris dikecualikan` : ""}`,
    };
  };

  const monthlyWithin = glPctMonth === null || Math.abs(glPctMonth) <= 0.005;
  const monthlyLoss: AlarmCheck = {
    label: monthlyWithin ? "Losses bulanan aman" : "Losses bulanan di atas ambang",
    state: monthlyWithin ? "ok" : "fail",
    note: glPctMonth !== null ? `${signed(glMonthTotal)} L · ${pct(Math.abs(glPctMonth), 2)}` : "—",
  };

  const targetCheck = (): AlarmCheck => {
    if (!hasTarget)
      return {
        label: "Target bulan ini — belum diisi",
        state: "na",
        note: "target bulan ini belum diisi",
      };
    const met = (worstGap ?? 0) >= 0;
    return {
      label: met ? "Target bulan ini tercapai" : "Target bulan ini di bawah prorata",
      state: met ? "ok" : "fail",
      note:
        worstGap !== undefined && worstGap < 0 ? `${parenNeg(worstGap)} vs prorata` : "sesuai prorata",
    };
  };

  const checks: AlarmCheck[] = [
    dailyLoss(),
    monthlyLoss,
    na("Setoran Bank Sesuai", "Domain setoran"),
    targetCheck(),
    na("Pencatatan DO Sesuai", "Domain DO"),
    na("Pengeluaran Sudah Disahkan", "modul kas dorman"),
    na("Harga Beli/Jual Benar", "master harga beli"),
    na("Saldo Hutang/Piutang Pelanggan Sesuai", "Domain deposit"),
    na("DO Untuk Penerimaan Besok Cukup", "Domain DO"),
    na("Permintaan Besok Sudah Cukup", "Domain DO"),
    na("Settlement EDC Sudah Sesuai", "Domain EDC"),
  ];
  const score = alarmScore(checks);
  const scoreTone: Tone =
    score.fail >= 2 ? "danger" : score.fail === 1 ? "warning" : score.provisional > 0 ? "warning" : "success";

  const cashTotal = cash.filter((c) => !c.sbatal).reduce((s, c) => s + (c.ntotal ?? 0), 0);

  // ── Recap harian + Saldo ──
  const recapBoxes = [
    {
      label: "Transaksi Pelanggan",
      val: raw.recapPelanggan.reduce((s, r) => s + r.rp, 0),
      note: "penjualan tempo (RFID/voucher)",
    },
    {
      label: "Pengeluaran",
      val: raw.recapPengeluaran.reduce((s, r) => s + r.amount, 0),
      note: "input pengawas",
    },
    { label: "EDC", val: raw.recapEdc.reduce((s, r) => s + r.rp, 0), note: "non-tunai per channel" },
    {
      label: "Pendapatan Lain",
      val: raw.recapPendapatanLain.reduce((s, r) => s + r.amount, 0),
      note: "input pengawas",
    },
    { label: "Transfer", val: raw.recapDeposit.reduce((s, r) => s + r.rp, 0), note: "deposit / non-tunai" },
    {
      label: "Setoran Bank",
      val: raw.recapSetoran.reduce((s, r) => s + r.amount, 0),
      note: "disetor ke bank (pengawas)",
    },
  ];
  const saldoRows = [
    { label: "Saldo Piutang Pelanggan Lokal", val: saldo.piutangLokal },
    { label: "Saldo Piutang Pelanggan Online", val: saldo.piutangOnline },
    { label: "Saldo Hutang Pelanggan Lokal", val: saldo.hutangLokal, danger: true },
  ];
  const hasSaldo =
    saldo.piutangLokal !== 0 || saldo.piutangOnline !== 0 || saldo.hutangLokal !== 0;
  const hasRecap = hasSaldo || recapBoxes.some((b) => b.val !== 0);

  // ── G/L kumulatif bulanan (rows) ──
  const glMonthRows: GlMonthRow[] = orderBy(
    [...monthAgg.byProduct].map(([ckdbbm, v]) => ({
      ckdbbm,
      nama: v.nama ?? ckdbbm,
      selisih: v.signed,
      vol: prodMonth.find((p) => p.ckdbbm === ckdbbm)?.vol ?? 0,
    })),
  );

  // ── Realisasi & Target (rows) ──
  const targetRows: TargetRow[] = orderBy(prodMonth).map((p) => {
    const perDay = targetVolumePerDay(unitCode, mi.month, p.nama);
    const alok = perDay !== null ? perDay * mi.daysInMonth : null;
    const sel = perDay !== null ? p.vol - perDay * mi.dayOfMonth : null;
    const terima =
      delivMonth.find((d) => canonicalProductKey(d.nama) === canonicalProductKey(p.nama))?.vol ?? 0;
    return {
      ckdbbm: p.ckdbbm,
      nama: p.nama,
      vol: p.vol,
      avgPerDay: p.vol / mi.dayOfMonth,
      terima,
      alok,
      sel,
    };
  });

  // ── Harga (rows) ──
  const hargaRows: HargaRow[] = orderBy(prodDay).map((p) => ({
    ckdbbm: p.ckdbbm,
    nama: p.nama,
    harga: p.harga,
  }));

  // ── Rekonsiliasi A–I ──
  const rekonRows: RekonRow[] = [
    { l: "A", label: "Omset Penjualan", val: totOmzet, op: "" },
    { l: "B", label: "Tera / Nozzle Test", val: null, op: "−" },
    { l: "C", label: "Pelanggan (piutang)", val: null, op: "−" },
    { l: "D", label: "EDC", val: null, op: "−" },
    { l: "E", label: "Penjualan Tunai", val: null, em: true, formula: "E = A − (B + C + D)" },
    { l: "F", label: "Pendapatan Lain", val: null, op: "+" },
    { l: "G", label: "Pengeluaran", val: cash.length > 0 ? cashTotal : null, op: "−" },
    { l: "H", label: "Uang Tunai", val: null, em: true, formula: "H = E + F − G" },
    { l: "I", label: "Setoran Bank", val: null, em: true },
  ];

  return {
    detail,
    header: {
      isPartial,
      shifts: shift.shifts,
      lastDtgljam: shift.last_dtgljam,
      scoreText: score.text,
      scoreTone,
      provisionalCount: score.provisional,
      fail: score.fail,
      omzetTotal: totOmzet,
    },
    checks,
    sales: {
      rows: salesRows,
      totVol: totSales,
      totOmzet,
      glTotal,
      totTera,
      glPctDay,
      glProvisional,
      glGarbageCount,
      gasMix,
      oilMix,
    },
    recap: { hasRecap, hasSaldo, saldoRows, recapBoxes },
    glMonthly: { rows: glMonthRows, glMonthTotal, glPctMonth },
    target: { rows: targetRows },
    doHarian: { rows: doRows, totals: doTotals, suspects: doSuspects, anomRows },
    harga: { rows: hargaRows },
    rekon: { rows: rekonRows, cashTotal },
    corrections: raw.corrections,
  };
}
