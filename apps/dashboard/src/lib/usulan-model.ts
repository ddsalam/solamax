/**
 * Model Usulan Penebusan SO (view form) — SUMBER TUNGGAL untuk render layar
 * (UsulanForm) DAN ekspor PDF. Murni (tanpa I/O); dibangun dari hasil query yang
 * SUDAH ber-scope (ScopedUnitId). Nilai disimpan Liter; konversi ke KL hanya di
 * batas tampilan via fmtKL (layar & PDF pakai fungsi sama → identik "ke KL").
 */
import { DO_PRODUCTS, resolveDoProduct } from "@/lib/config";
import { enduranceDays, enduranceLevel } from "@/lib/derive";
import type * as Q from "@/lib/queries";
import type { UsulanStatus } from "@/lib/queries";

export interface UsulanRow {
  key: string;
  label: string;
  /** Liter; null bila stock penutup D−1 belum final (provisional). */
  sisaStock: number | null;
  sisaStockProvisional: boolean;
  /** Hari; null bila stock/avg tak tersedia. */
  ketahanan: number | null;
  ketahananLevel: "danger" | "warning" | "ok" | "unknown";
  sisaDo: number; // Liter
  penerimaanHari: number; // Liter (persisted)
  permintaanBesok: number; // Liter (persisted)
  usulanPenebusan: number; // Liter (persisted)
}

export interface UsulanTotals {
  sisaStock: number;
  sisaDo: number;
  penerimaanHari: number;
  permintaanBesok: number;
  usulanPenebusan: number;
}

export interface UsulanModel {
  rows: UsulanRow[];
  totals: UsulanTotals;
  status: UsulanStatus;
  anyProvisional: boolean;
}

export interface UsulanRaw {
  glPrev: Awaited<ReturnType<typeof Q.getDailyGlByProduct>>;
  doDay: Awaited<ReturnType<typeof Q.getDoHarian>>;
  avg7: Awaited<ReturnType<typeof Q.getAvgDailySales>>;
  existing: Awaited<ReturnType<typeof Q.getUsulanSo>>;
}

/** Bangun model Usulan (form) dari data mentah ber-scope. Murni & serializable. */
export function buildUsulanModel(raw: UsulanRaw): UsulanModel {
  const { glPrev, doDay, avg7, existing } = raw;

  // Agregasi per slot produk DO (6 kanonik). ckdbbm→key dari nama Fisik penutup.
  const stockByKey = new Map<string, number>();
  const provByKey = new Map<string, boolean>();
  const ckdbbmToKey = new Map<string, string>();
  for (const r of glPrev) {
    const key = resolveDoProduct(r.nama)?.key;
    if (!key) continue;
    ckdbbmToKey.set(r.ckdbbm, key);
    if (r.provisional || r.fisik === null) provByKey.set(key, true);
    else stockByKey.set(key, (stockByKey.get(key) ?? 0) + r.fisik);
  }
  const avgByKey = new Map<string, number>();
  for (const a of avg7) {
    const key = ckdbbmToKey.get(a.ckdbbm) ?? resolveDoProduct(a.ckdbbm)?.key;
    if (!key) continue;
    avgByKey.set(key, (avgByKey.get(key) ?? 0) + a.avg_vol);
  }
  const doAwalByKey = new Map<string, number>();
  for (const r of doDay) {
    const key = resolveDoProduct(r.nama)?.key;
    if (key) doAwalByKey.set(key, (doAwalByKey.get(key) ?? 0) + r.do_awal);
  }
  const savedByKey = new Map(existing.map((e) => [e.productKey, e]));
  const status: UsulanStatus = existing[0]?.status ?? "draft";

  const rows: UsulanRow[] = DO_PRODUCTS.map((p) => {
    const provisional = provByKey.get(p.key) ?? !stockByKey.has(p.key);
    const sisaStock = provisional ? null : stockByKey.get(p.key)!;
    const days = enduranceDays(sisaStock, avgByKey.get(p.key) ?? 0);
    const s = savedByKey.get(p.key);
    return {
      key: p.key,
      label: p.label,
      sisaStock,
      sisaStockProvisional: provisional,
      ketahanan: days,
      ketahananLevel: enduranceLevel(days),
      sisaDo: doAwalByKey.get(p.key) ?? 0,
      penerimaanHari: s?.penerimaanHari ?? 0,
      permintaanBesok: s?.permintaanBesok ?? 0,
      usulanPenebusan: s?.usulanPenebusan ?? 0,
    };
  });

  const totals = rows.reduce<UsulanTotals>(
    (a, r) => ({
      sisaStock: a.sisaStock + (r.sisaStock ?? 0),
      sisaDo: a.sisaDo + r.sisaDo,
      penerimaanHari: a.penerimaanHari + r.penerimaanHari,
      permintaanBesok: a.permintaanBesok + r.permintaanBesok,
      usulanPenebusan: a.usulanPenebusan + r.usulanPenebusan,
    }),
    { sisaStock: 0, sisaDo: 0, penerimaanHari: 0, permintaanBesok: 0, usulanPenebusan: 0 },
  );

  return { rows, totals, status, anyProvisional: rows.some((r) => r.sisaStockProvisional) };
}
