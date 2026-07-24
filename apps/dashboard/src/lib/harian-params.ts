/**
 * Parser state URL halaman "Laporan Harian" — MURNI (tanpa import server).
 *
 * URL KANONIK, SATU sumber kebenaran: tanggal + pilihan unit hidup di QUERY
 * STRING, tidak di cookie dan tidak di path. Alasan memilih query-string
 * (keputusan Fase 2, disetujui owner):
 *   - Halaman ini MULTI-unit dan tidak ikut picker tanggal topbar. `/board`
 *     persis begini, dan `deriveTopbarSelection` (selection-keys.ts) sengaja
 *     jatuh ke cabang seed untuk rute semacam ini.
 *   - Menaruh tanggal di PATH memaksa menambah regex ke selection-keys.ts —
 *     berkas yang dipakai SELURUH rute laporan, dan akar bug desync picker
 *     (PR #73). Nol sentuhan di sana = nol risiko desync.
 *
 * KEAMANAN unit: lewat intersectScopedUnits (salinan tunggal, unit-params.ts).
 */
import { addDays, todayWib } from "./periods";
import type { ScopedUnit } from "./scope-rule";
import { DATE_RE } from "./selection-keys";
import { intersectScopedUnits } from "./unit-params";

export interface HarianSearchParams {
  d?: string;
  units?: string;
}

export interface HarianParams {
  /** Unit terpilih — SELALU ⊆ scope caller. */
  units: ScopedUnit[];
  allUnits: boolean;
  /** Tanggal bisnis laporan (ISO). */
  date: string;
}

/**
 * Tanggal default = KEMARIN WIB (keputusan owner 2026-07-24 №2). Bukan hari ini:
 * opname PENUTUP hari D baru terekam pagi D+1 (jadi G/L hari ini masih
 * provisional), dan sebagian unit belum memposting penjualan hari berjalan —
 * pada probe 24 Jul pukul 14:30 WIB tiga dari tujuh unit belum punya satu baris
 * pun untuk hari itu. Default "hari ini" akan menyajikan laporan grup yang
 * separuh kosong sebagai kalau-kalau lengkap.
 */
export function defaultHarianDate(now: Date = new Date()): string {
  return addDays(todayWib(now), -1);
}

export function parseHarianParams(
  sp: HarianSearchParams,
  scopeUnits: ScopedUnit[],
  now: Date = new Date(),
): HarianParams {
  const { units, allUnits } = intersectScopedUnits(sp.units, scopeUnits);
  const date = sp.d && DATE_RE.test(sp.d) ? sp.d : defaultHarianDate(now);
  return { units, allUnits, date };
}

/**
 * Serialisasi state → query string KANONIK. `d` SELALU ditulis eksplisit (tak
 * ada default tersembunyi yang bisa desync dengan yang ditampilkan); `units`
 * hanya bila bukan "semua unit ber-scope".
 */
export function harianParamsToQuery(args: {
  date: string;
  unitCodes: string[];
  allUnits: boolean;
}): string {
  const q = new URLSearchParams();
  q.set("d", args.date);
  if (!args.allUnits && args.unitCodes.length > 0) q.set("units", args.unitCodes.join(","));
  return `?${q.toString()}`;
}
