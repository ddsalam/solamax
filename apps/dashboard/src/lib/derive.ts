/**
 * Derivasi murni untuk panel-panel spec (teruji unit test):
 * bauran NPSO/PSO, gain/loss %, ketahanan stok, verdict, dan cek alarm.
 * Aturan status TETAP dari compliance.ts — tidak ada aturan baru.
 */
import { classifyProduct, targetBauran, type FuelKind } from "./config";
import { isSelisihAbnormal } from "./compliance";

export interface ProductVol {
  nama: string | null;
  vol: number;
}

/**
 * Bauran (definisi workbook, TERKONFIRMASI): rasio volume —
 * gasoline = (Pertamax + Turbo) / Pertalite; gasoil = (Dexlite + Dex) / Solar.
 * null bila penyebut 0 (tak ada penjualan PSO jenis itu).
 */
export function bauran(products: ProductVol[], kind: FuelKind): number | null {
  let npso = 0;
  let pso = 0;
  for (const p of products) {
    const cls = classifyProduct(p.nama);
    if (!cls || cls.kind !== kind) continue;
    if (cls.pso) pso += p.vol;
    else npso += p.vol;
  }
  if (pso <= 0) return null;
  return npso / pso;
}

export interface BauranStatus {
  kind: FuelKind;
  actual: number | null;
  target: number | null;
  /** delta dalam poin persen (actual−target)×100; null bila salah satu null */
  deltaPt: number | null;
  below: boolean;
}

export function bauranVsTarget(
  products: ProductVol[],
  unitCode: string,
  month: number,
  kind: FuelKind,
): BauranStatus {
  const actual = bauran(products, kind);
  const target = targetBauran(unitCode, kind, month);
  const deltaPt =
    actual !== null && target !== null ? (actual - target) * 100 : null;
  return { kind, actual, target, deltaPt, below: deltaPt !== null && deltaPt < 0 };
}

/** Gain/Loss % = total selisih opname ÷ total volume jual (bertanda). */
export function glPercent(totalSelisih: number, totalVol: number): number | null {
  if (totalVol <= 0) return null;
  return totalSelisih / totalVol;
}

/** Ambang spec: abnormal bila |selisih| > 100 L atau > 0,5% basis. */
export { isSelisihAbnormal };

// ---------------------------------------------------------------------------
// Gain/Loss dari opname PENUTUP + guard data-garbage (tambahan A)
// ---------------------------------------------------------------------------

/**
 * Ambang kewajaran fisik (bukan ambang losses operasional). Satu tangki SPBU
 * 20–40 KL; pembacaan/selisih di luar batas ini = error entri EasyMax (mis.
 * stok buku ±2 juta L 5 Jun; DO 452.729 L), BUKAN losses → dikecualikan dari
 * KPI/alarm G/L dan dimunculkan sebagai anomali KUALITAS DATA.
 */
export const GARBAGE_STOCK_L = 100_000; // tak ada tangki SPBU sebesar ini
export const GARBAGE_SELISIH_L = 50_000; // selisih sebesar ini = salah entri

export function isOpnameGarbage(bk: number | null, op: number | null): boolean {
  if (bk === null || op === null) return false; // null ditangani terpisah
  if (bk < 0 || op < 0) return true;
  if (bk > GARBAGE_STOCK_L || op > GARBAGE_STOCK_L) return true;
  if (Math.abs(op - bk) > GARBAGE_SELISIH_L) return true;
  return false;
}

/** Satu baris opname penutup per tangki (signed = fisik − buku). */
export interface ClosingRow {
  d: string; // tanggal bisnis
  ckdtangki: string;
  ckdbbm: string | null;
  nama: string | null;
  bk: number | null; // stok buku
  op: number | null; // stok fisik
  signed: number; // op − bk (bertanda; − = losses)
  dtgljam: string | null;
  provisional: boolean; // penutup D+1 belum terekam
}

export interface ClosingAgg {
  byProduct: Map<string, { nama: string | null; signed: number }>;
  totalSigned: number;
  provisional: boolean;
  /** Baris losses abnormal (lolos garbage, |signed|>100 L atau >0,5% buku). */
  abnormal: ClosingRow[];
  /** Baris kualitas-data (di luar ambang fisik). */
  garbage: ClosingRow[];
}

/**
 * Agregasi G/L dari baris opname penutup: jumlahkan SIGNED dari baris yang
 * lolos garbage guard; pisahkan baris garbage & abnormal untuk anomali.
 */
export function aggregateClosingGl(rows: ClosingRow[]): ClosingAgg {
  const byProduct = new Map<string, { nama: string | null; signed: number }>();
  const abnormal: ClosingRow[] = [];
  const garbage: ClosingRow[] = [];
  let totalSigned = 0;
  let provisional = false;

  for (const r of rows) {
    if (isOpnameGarbage(r.bk, r.op)) {
      garbage.push(r);
      continue;
    }
    if (r.provisional) provisional = true;
    totalSigned += r.signed;
    const key = r.ckdbbm ?? r.ckdtangki;
    const cur = byProduct.get(key);
    if (cur) cur.signed += r.signed;
    else byProduct.set(key, { nama: r.nama, signed: r.signed });
    if (isSelisihAbnormal(r.signed, r.bk)) abnormal.push(r);
  }
  return { byProduct, totalSigned, provisional, abnormal, garbage };
}

/** Stok kini = stok opname − terjual sejak opname + diterima sejak opname. */
export function stockNow(
  stockOp: number | null,
  soldSince: number,
  receivedSince: number,
): number | null {
  if (stockOp === null) return null;
  return stockOp - soldSince + receivedSince;
}

/** Ketahanan hari = stok ÷ rata-rata jual harian; null bila tak terhitung. */
export function enduranceDays(
  stock: number | null,
  avgDaily: number,
): number | null {
  if (stock === null || avgDaily <= 0) return null;
  return stock / avgDaily;
}

/** Warna ketahanan ala spec: <1,5 hari merah, <3 kuning, else normal. */
export function enduranceLevel(days: number | null): "danger" | "warning" | "ok" | "unknown" {
  if (days === null) return "unknown";
  if (days < 1.5) return "danger";
  if (days < 3) return "warning";
  return "ok";
}

// ---------------------------------------------------------------------------
// Verdict & chips (Board)
// ---------------------------------------------------------------------------

export interface VerdictChip {
  tone: "danger" | "warning";
  text: string;
}

export function verdictHeadline(chips: VerdictChip[]): string {
  if (chips.length === 0) return "Grup sehat.";
  const n = ["Satu", "Dua", "Tiga", "Empat", "Lima"][chips.length - 1] ?? String(chips.length);
  return `Grup sehat. ${n} hal perlu perhatian.`;
}

// ---------------------------------------------------------------------------
// Alarm indikator (Laporan Operasional) — 11 cek spec
// ---------------------------------------------------------------------------

export type AlarmState = "ok" | "fail" | "na";

export interface AlarmCheck {
  label: string;
  state: AlarmState;
  note: string;
}

/** Skor "n/m sesuai · k menunggu data" dari daftar cek (№6). */
export function alarmScore(checks: AlarmCheck[]): {
  ok: number;
  active: number;
  na: number;
  text: string;
} {
  const active = checks.filter((c) => c.state !== "na").length;
  const ok = checks.filter((c) => c.state === "ok").length;
  const na = checks.length - active;
  return { ok, active, na, text: `${ok}/${active}` };
}
