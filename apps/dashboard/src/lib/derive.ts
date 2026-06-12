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
