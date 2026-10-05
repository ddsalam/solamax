/**
 * Model halaman "Laporan Harian Total" — MURNI (tanpa import server, tanpa I/O).
 * Layar dan PDF membaca model YANG SAMA → angka mustahil berbeda antar keduanya.
 *
 * Semua rumus dikunci oleh data pada Fase 1 (bukan ditebak dari judul kolom):
 *   - OMZET = LITER (volume), bukan rupiah. Bukti: harian 22 Jul 2026 cocok
 *     digit-per-digit dengan laporan Excel di 7 unit × 7 produk, TOTAL 304.106.
 *   - "Rata-Rata" bulanan = Kumulatif ÷ HARI KALENDER BERJALAN (day-of-month
 *     tanggal laporan). Bukti: 6.445.250 ÷ 292.966 = 22,000 (22 Jul);
 *     74.262 ÷ 3.909 = 19,000 (19 Jul).
 *   - Baris "Total" RASIO ≡ bauran gasoil = (Dexlite + P.Dex) ÷ Solar.
 *   - "Persentase BBK" ≠ bauran: BBK = NPSO ÷ (NPSO + PSO) dalam jenis yang sama
 *     ≡ b/(1+b). Bukti KB MTD 22 Jul: gasoline 11,444 % (PDF 11,44 %),
 *     diesel 28,266 % (PDF 28,27 %) — sedangkan bauran memberi 12,93 % / 39,40 %.
 *   - Rekor = SATU tanggal saat TOTAL grup tertinggi, rincian = aktual tanggal
 *     itu. Hipotesis "hari terbaik masing-masing unit" GUGUR: hari terbaik tiap
 *     unit semuanya tanggal berbeda (IB 2 Apr, BK 18 Mar, AS 31 Mar, KB 8 Mar,
 *     BL 1 Apr, KR 6 Nov 2021, 28 Okt 7 Jul 2022).
 */
import { canonicalProductKey, FLEET_RECORD_FLOOR } from "./config";
import { bauran, GARBAGE_DAY_SALES_L, isDailyGlSuspect, normalizeProductIdentity, type ProductVol } from "./derive";
import { worstSyncAt, worstSyncUnitId } from "./freshness";
import { addDays, monthInfo, monthStart } from "./periods";
import type { DailyGlRow, DailySalesRow, SyncRow, UnitCoverageRow } from "./queries";
import type { ScopedUnit } from "./scope-rule";

// ---------------------------------------------------------------------------
// Baris produk
// ---------------------------------------------------------------------------

/**
 * Urutan baris = urutan laporan Excel yang berjalan, DIKURANGI "Pertalite
 * Khusus". Produk itu ADA di master (`product.BB-01`, bernama "PLK" di 5 unit
 * dan "PREMIUM" di IB/BK) dan pernah terjual besar (KB 64,4 juta L s/d 2018;
 * KR 35,0 juta L s/d Nov 2021), tetapi **0 L di seluruh 13 bulan terakhir pada
 * ketujuh unit**. Dibuang dari tabel + disebut di catatan kaki. Kalau ia pernah
 * terjual lagi, ia TIDAK hilang: `canonicalProductKey("PLK") === null` → masuk
 * baris "Lain-lain" dan tetap ikut TOTAL.
 */
export const HARIAN_PRODUCTS = [
  { key: "PERTAMAX", label: "Pertamax" },
  { key: "SOLAR", label: "Solar" },
  { key: "DEXLITE", label: "Dexlite" },
  { key: "PERTALITE", label: "Pertalite" },
  { key: "PERTAMINA DEX", label: "Pertamina Dex" },
  { key: "PERTAMAX TURBO", label: "Pertamax Turbo" },
] as const;

export type HarianProductKey = (typeof HARIAN_PRODUCTS)[number]["key"];
/** Baris tampung produk tak dikenal — WAJIB, bukan hiasan: kode `P1` di IB
 *  terjual 50 L pada 2026-06-01 dan tidak ada di master `product`. */
export const OTHER_KEY = "__lain__";
export type RowKey = HarianProductKey | typeof OTHER_KEY;

// ---------------------------------------------------------------------------
// Bentuk keluaran
// ---------------------------------------------------------------------------

export interface UnitRef {
  unitId: number;
  code: string;
  name: string;
}

/** Status per unit pada tanggal D — dua dimensi kesegaran (keputusan owner №7). */
export interface UnitStatus extends UnitRef {
  /** Unit belum punya data sama sekali pada/ sebelum D (belum onboard). */
  notYet: boolean;
  /** Tanggal data terakhir unit ini yang ≤ D; null bila tak ada. */
  lastDataDate: string | null;
  /** Hari tertinggal terhadap D (0 = mutakhir); null bila notYet. */
  daysBehind: number | null;
  /** true = ada data lebih tua dari D → kolom ditandai & TOTAL tak lengkap. */
  stale: boolean;
}

export interface ValueRow<T = number> {
  key: RowKey;
  label: string;
  /** nilai per unitId; undefined = unit tak punya baris (dirender "—"/0 sesuai konteks) */
  byUnit: Record<number, T>;
  total: T;
}

export interface MonthlyCell<T = number> {
  kum: T;
  avg: T;
}
export interface MonthlyRow<T = number> {
  key: RowKey;
  label: string;
  byUnit: Record<number, MonthlyCell<T>>;
  total: MonthlyCell<T>;
}

export interface TrendMonth {
  ym: string; // "2026-07"
  label: string; // "Jul 26"
  /** KL per unit; null = unit belum beroperasi bulan itu (≠ 0 = tak jualan). */
  byUnit: Record<number, number | null>;
  totalKl: number;
  /** KL/hari */
  avgByUnit: Record<number, number | null>;
  avgTotalKl: number;
  /** true = bulan berjalan (dipotong di D) */
  partial: boolean;
  days: number;
}

export interface RatioCell {
  dexSolar: number | null;
  pdexSolar: number | null;
  total: number | null;
}
export interface BbkCell {
  gasoline: number | null;
  diesel: number | null;
}

export interface ShareRow extends UnitRef {
  kum: number;
  avg: number;
  /** proporsi 0..1; null bila total 0 */
  pct: number | null;
}

export interface RecordFact {
  /** Awal periode pembanding (lantai armada). */
  from: string;
  to: string;
  date: string | null;
  byUnit: Record<number, number>;
  total: number;
  /** unit-hari yang dibuang karena di luar batas wajar (GARBAGE_DAY_SALES_L). */
  droppedUnitDays: number;
}

export interface Freshness {
  /** MIN lintas unit (unit TERBURUK), ISO; null = ada unit tanpa data sinkron. */
  worstSyncAt: string | null;
  worstSyncUnit: UnitRef | null;
  /** Unit dengan data lebih tua dari D. */
  staleUnits: UnitStatus[];
  /** true bila TOTAL halaman ini menjumlah unit yang datanya belum lengkap. */
  incomplete: boolean;
}

export interface HarianModel {
  date: string;
  /** Pembagi Rata-Rata bulanan = hari kalender 1..D. */
  avgDivisor: number;
  monthFrom: string;
  units: UnitStatus[];
  freshness: Freshness;
  daily: { rows: ValueRow[]; totalsByUnit: Record<number, number>; grandTotal: number };
  /** Δ total unit hari D vs D−1; null bila D−1 tak berdata untuk unit itu. */
  deltaByUnit: Record<number, number | null>;
  deltaTotal: number | null;
  monthly: { rows: MonthlyRow[]; totalsByUnit: Record<number, MonthlyCell>; grand: MonthlyCell };
  glDaily: { rows: ValueRow<number | null>[]; totalsByUnit: Record<number, number | null>; grandTotal: number | null };
  glMonthly: { rows: MonthlyRow<number | null>[]; totalsByUnit: Record<number, MonthlyCell<number | null>>; grand: MonthlyCell<number | null> };
  glMonthlyProvisional: boolean;
  share: ShareRow[];
  /**
   * Skala tren DIPISAH: batang per-unit dan garis TOTAL punya orde berbeda
   * (~1.500 KL vs ~9.200 KL). Keduanya dipakai untuk DUA sumbu BERLABEL —
   * kiri = per unit, kanan = TOTAL (keputusan owner D6).
   */
  trend: {
    months: TrendMonth[];
    barMaxKum: number;
    totalMaxKum: number;
    barMaxAvg: number;
    totalMaxAvg: number;
  };
  ratios: { daily: Record<number, RatioCell>; monthly: Record<number, RatioCell>; dailyTotal: RatioCell; monthlyTotal: RatioCell };
  bbk: { monthly: Record<number, BbkCell>; monthlyTotal: BbkCell };
  record: RecordFact;
  /** Sel G/L yang tersentuh penutup opname bernilai NOL (lihat glZeroNotes). */
  glSuspectUnits: UnitRef[];
  /**
   * true = ADA baris G/L hari-D yang masih PROVISIONAL (penutup D+1 belum
   * terekam / anchor D−1 hilang / ada celah opname). Terjadi setiap kali D =
   * hari berjalan: opname penutup baru masuk pagi berikutnya, sehingga angka
   * G/L hari ini terlihat sebagai kerugian raksasa yang sepenuhnya semu.
   * Ditandai, BUKAN disembunyikan.
   */
  glProvisional: boolean;
  /** Missing product/day or uncomputable stock in MTD. Null cells and any
   * dependent total stay unavailable; one valid product cannot hide another. */
  glIncomplete: boolean;
  /** Cakupan per unit: hari berpenjualan vs hari ber-baris-G/L dalam jendela. */
  glCoverage: Array<{ unitId: number; code: string; salesDays: number; glDays: number }>;
  notes: string[];
}

export interface HarianInput {
  units: ScopedUnit[];
  date: string;
  /** Grain harian × produk × unit atas [spanFrom .. D]. */
  dailySales: DailySalesRow[];
  /** Baris G/L HARIAN per unit atas [monthStart(D) .. D]. */
  gl: Map<number, DailyGlRow[]>;
  coverage: UnitCoverageRow[];
  sync: SyncRow[];
  /** Unit yang punya penutup opname 0 mencurigakan dalam bulan berjalan. */
  glSuspect?: Set<number>;
  /** Dated zero-closing events affect that day and its following stock anchor. */
  glSuspectDates?: Array<{ unitId: number; date: string }>;
  recordFloor?: string;
}

// ---------------------------------------------------------------------------
// Util tanggal bulan
// ---------------------------------------------------------------------------

export function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const t = (y * 12 + (m - 1) + n) % 12;
  const yy = Math.floor((y * 12 + (m - 1) + n) / 12);
  return `${String(yy).padStart(4, "0")}-${String(t + 1).padStart(2, "0")}`;
}

export function daysInYm(ym: string): number {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const MONTH_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"];
export function ymLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return `${MONTH_ID[m - 1]} ${String(y).slice(2)}`;
}

/** Awal jendela grain yang dibutuhkan halaman: 12 bulan ke belakang, dan tak
 *  pernah lebih lambat dari lantai rekor (agar periode rekor utuh apa adanya). */
export function harianSpanFrom(date: string, recordFloor = FLEET_RECORD_FLOOR): string {
  const trendFrom = `${addMonths(date.slice(0, 7), -12)}-01`;
  return trendFrom < recordFloor ? trendFrom : recordFloor;
}

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

const zero = (): Record<number, number> => ({});

function rowKeyOf(nama: string | null, ckdbbm: string | null): RowKey {
  return (canonicalProductKey(nama ?? normalizeProductIdentity(ckdbbm)) as HarianProductKey | null) ?? OTHER_KEY;
}

function labelOf(key: RowKey): string {
  return key === OTHER_KEY
    ? "Lain-lain"
    : (HARIAN_PRODUCTS.find((p) => p.key === key)?.label ?? key);
}

function emptyRatio(): RatioCell {
  return { dexSolar: null, pdexSolar: null, total: null };
}

function ratioOf(v: Partial<Record<HarianProductKey, number>>): RatioCell {
  const solar = v.SOLAR ?? 0;
  if (solar <= 0) return emptyRatio();
  const dex = (v.DEXLITE ?? 0) / solar;
  const pdex = (v["PERTAMINA DEX"] ?? 0) / solar;
  return { dexSolar: dex, pdexSolar: pdex, total: dex + pdex };
}

/** BBK = NPSO / (NPSO + PSO) dalam satu jenis ≡ b/(1+b). */
function bbkOf(products: ProductVol[]): BbkCell {
  const conv = (b: number | null): number | null => (b === null ? null : b / (1 + b));
  return { gasoline: conv(bauran(products, "gasoline")), diesel: conv(bauran(products, "gasoil")) };
}

export function buildHarianModel(input: HarianInput): HarianModel {
  const { units, date, dailySales, gl, coverage, sync } = input;
  const recordFloor = input.recordFloor ?? FLEET_RECORD_FLOOR;
  const unitIds = units.map((u) => u.unit_id as number);
  const idSet = new Set(unitIds);
  const mFrom = monthStart(date);
  const prev = addDays(date, -1);
  const { dayOfMonth } = monthInfo(date);

  // ── Indeks grain (sekali jalan) ────────────────────────────────────────────
  const salesMin = new Map<number, string | null>();
  for (const c of coverage) salesMin.set(c.unit_id, c.sales_min);

  /** unit → tanggal data terakhir ≤ D */
  const lastData = new Map<number, string>();
  /** (unit,key) → liter hari D */
  const dayCell = new Map<string, number>();
  /** (unit,key) → liter MTD */
  const mtdCell = new Map<string, number>();
  /** unit → total hari D-1 */
  const prevTotal = new Map<number, number>();
  /** (ym,unit) → liter */
  const monthly = new Map<string, number>();
  /** (d,unit) → liter (untuk rekor) */
  const dayUnit = new Map<string, number>();
  /** Hari unik berpenjualan per unit dalam [mFrom..date] — pembanding guard G/L. */
  const salesDaysByUnit = new Map<number, Set<string>>();

  for (const r of dailySales) {
    if (!idSet.has(r.unit_id)) continue; // sabuk pengaman; RLS+scope sudah menjamin
    const key = rowKeyOf(r.nama, r.ckdbbm);
    const prevMax = lastData.get(r.unit_id);
    if (r.d <= date && (prevMax === undefined || r.d > prevMax)) lastData.set(r.unit_id, r.d);

    const dk = `${r.d}|${r.unit_id}`;
    dayUnit.set(dk, (dayUnit.get(dk) ?? 0) + r.vol);

    const ym = r.d.slice(0, 7);
    const mk = `${ym}|${r.unit_id}`;
    monthly.set(mk, (monthly.get(mk) ?? 0) + r.vol);

    if (r.d === date) {
      const k = `${r.unit_id}|${key}`;
      dayCell.set(k, (dayCell.get(k) ?? 0) + r.vol);
    }
    if (r.d === prev) prevTotal.set(r.unit_id, (prevTotal.get(r.unit_id) ?? 0) + r.vol);
    if (r.d >= mFrom && r.d <= date) {
      const k = `${r.unit_id}|${key}`;
      mtdCell.set(k, (mtdCell.get(k) ?? 0) + r.vol);
      const set = salesDaysByUnit.get(r.unit_id) ?? new Set<string>();
      set.add(r.d);
      salesDaysByUnit.set(r.unit_id, set);
    }
  }

  // ── Status & kesegaran per unit ───────────────────────────────────────────
  const statuses: UnitStatus[] = units.map((u) => {
    const id = u.unit_id as number;
    const min = salesMin.get(id) ?? null;
    const last = lastData.get(id) ?? null;
    const notYet = last === null && (min === null || min > date);
    const daysBehind =
      last === null ? null : Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86_400_000);
    return {
      unitId: id,
      code: u.code,
      name: u.name,
      notYet,
      lastDataDate: last,
      daysBehind,
      stale: !notYet && (last === null || last < date),
    };
  });
  const staleUnits = statuses.filter((s) => s.stale);
  const worstId = worstSyncUnitId(unitIds, sync);
  const worstRef = statuses.find((s) => s.unitId === worstId) ?? null;
  const freshness: Freshness = {
    worstSyncAt: worstSyncAt(unitIds, sync),
    worstSyncUnit: worstRef ? { unitId: worstRef.unitId, code: worstRef.code, name: worstRef.name } : null,
    staleUnits,
    incomplete: staleUnits.length > 0,
  };

  // ── Baris nilai (harian & bulanan) ────────────────────────────────────────
  const activeKeys: RowKey[] = [...HARIAN_PRODUCTS.map((p) => p.key as RowKey)];
  const hasOther =
    [...dayCell.keys()].some((k) => k.endsWith(`|${OTHER_KEY}`)) ||
    [...mtdCell.keys()].some((k) => k.endsWith(`|${OTHER_KEY}`));
  if (hasOther) activeKeys.push(OTHER_KEY);

  const dailyRows: ValueRow[] = activeKeys.map((key) => {
    const byUnit = zero();
    let total = 0;
    for (const id of unitIds) {
      const v = dayCell.get(`${id}|${key}`) ?? 0;
      byUnit[id] = v;
      total += v;
    }
    return { key, label: labelOf(key), byUnit, total };
  });
  const dailyTotals = zero();
  let dailyGrand = 0;
  for (const id of unitIds) {
    const v = dailyRows.reduce((s, r) => s + (r.byUnit[id] ?? 0), 0);
    dailyTotals[id] = v;
    dailyGrand += v;
  }

  const monthlyRows: MonthlyRow[] = activeKeys.map((key) => {
    const byUnit: Record<number, MonthlyCell> = {};
    let kum = 0;
    for (const id of unitIds) {
      const v = mtdCell.get(`${id}|${key}`) ?? 0;
      byUnit[id] = { kum: v, avg: v / dayOfMonth };
      kum += v;
    }
    return { key, label: labelOf(key), byUnit, total: { kum, avg: kum / dayOfMonth } };
  });
  const monthlyTotals: Record<number, MonthlyCell> = {};
  let monthlyGrandKum = 0;
  for (const id of unitIds) {
    const v = monthlyRows.reduce((s, r) => s + (r.byUnit[id]?.kum ?? 0), 0);
    monthlyTotals[id] = { kum: v, avg: v / dayOfMonth };
    monthlyGrandKum += v;
  }

  // ── Δ vs hari sebelumnya ──────────────────────────────────────────────────
  const deltaByUnit: Record<number, number | null> = {};
  let deltaTotal: number | null = 0;
  for (const id of unitIds) {
    const p = prevTotal.get(id);
    if (p === undefined) {
      deltaByUnit[id] = null;
      deltaTotal = null;
    } else {
      deltaByUnit[id] = (dailyTotals[id] ?? 0) - p;
      if (deltaTotal !== null) deltaTotal += deltaByUnit[id]!;
    }
  }

  // ── G/L ───────────────────────────────────────────────────────────────────
  const glDayCell = new Map<string, number | null>();
  const glMtdCell = new Map<string, number | null>();
  const glSeen = new Set<string>();
  const staleGlUnits = new Set(staleUnits.map((u) => u.unitId));
  let glMonthlyProvisional = staleGlUnits.size > 0 || units.some((u) => input.glSuspect?.has(u.unit_id));
  const suspectIds = new Set(input.glSuspect ?? []);
  const addGl = (map: Map<string, number | null>, key: string, value: number | null) => {
    map.set(key, value === null || map.get(key) === null ? null : (map.get(key) ?? 0) + value);
  };
  let glProvisional = staleGlUnits.size > 0;
  for (const suspect of input.glSuspectDates ?? []) {
    if (!unitIds.includes(suspect.unitId)) continue;
    const following = addDays(suspect.date, 1);
    if (suspect.date <= date && following >= mFrom) {
      suspectIds.add(suspect.unitId);
      glMonthlyProvisional = true;
    }
    if (suspect.date === date || following === date) glProvisional = true;
  }
  /** Hari unik ber-baris-G/L per unit dalam [mFrom..date] — bahan guard cakupan. */
  const glDaysByUnit = new Map<number, Set<string>>();
  for (const id of unitIds) {
    for (const r of gl.get(id) ?? []) {
      if (r.d < mFrom || r.d > date) continue;
      const product = normalizeProductIdentity(r.ckdbbm);
      const invalid = product === null || r.gl === null || r.excluded_tanks > 0;
      const suspect = isDailyGlSuspect(r);
      if (suspect) suspectIds.add(id);
      if (r.provisional || invalid || suspect) {
        glMonthlyProvisional = true;
        if (r.d === date) glProvisional = true;
      }
      const key = rowKeyOf(r.nama, r.ckdbbm);
      const k = `${id}|${key}`;
      if (product !== null && !invalid) glSeen.add(`${id}|${r.d}|${product}`);
      if (r.d === date) addGl(glDayCell, k, invalid ? null : r.gl);
      if (r.d >= mFrom && r.d <= date) {
        addGl(glMtdCell, k, invalid ? null : r.gl);
        if (invalid) continue;
        const set = glDaysByUnit.get(id) ?? new Set<string>();
        set.add(r.d);
        glDaysByUnit.set(id, set);
      }
    }
  }
  // Coverage is unit × business date × product. One valid product cannot
  // hide a missing product on the same day. A genuine measured zero stays zero.
  for (const r of dailySales) {
    if (!unitIds.includes(r.unit_id) || r.d < mFrom || r.d > date) continue;
    const product = normalizeProductIdentity(r.ckdbbm);
    // A zero-volume sales row proves that the business date exists, not that
    // its unobserved G/L was zero. Neutral absent-product zeros require at
    // least one usable G/L observation for this unit/date.
    const hasGlDay = glDaysByUnit.get(r.unit_id)?.has(r.d) ?? false;
    if (product !== null && ((r.vol === 0 && r.omzet === 0 && hasGlDay) || glSeen.has(`${r.unit_id}|${r.d}|${product}`))) continue;
    const key = rowKeyOf(r.nama, product);
    const k = `${r.unit_id}|${key}`;
    glMtdCell.set(k, null);
    glMonthlyProvisional = true;
    if (r.d === date) { glDayCell.set(k, null); glProvisional = true; }
  }
  const sumGl = (values: Array<number | null>): number | null =>
    values.reduce<number | null>((sum, value) => sum === null || value === null ? null : sum + value, 0);
  const glKeys: RowKey[] = [...HARIAN_PRODUCTS.map((p) => p.key as RowKey)];
  if (
    [...glDayCell.keys()].some((k) => k.endsWith(`|${OTHER_KEY}`)) ||
    [...glMtdCell.keys()].some((k) => k.endsWith(`|${OTHER_KEY}`))
  ) {
    glKeys.push(OTHER_KEY);
  }
  const mkValueRows = (src: Map<string, number | null>) => {
    // Empty scopes/windows have no measured balance. Zero is only a neutral
    // absent-product contribution once this window contains an observed G/L.
    const hasObservedGl = [...src.values()].some((v) => v !== null);
    const rows: ValueRow<number | null>[] = glKeys.map((key) => {
      const byUnit: Record<number, number | null> = {};
      for (const id of unitIds) {
        const k = `${id}|${key}`;
        // A known active unit without current sales has unknown movements,
        // even if old G/L rows cover every sales row received so far.
        byUnit[id] = !hasObservedGl || staleGlUnits.has(id) ? null : src.has(k) ? src.get(k)! : 0;
      }
      return { key, label: labelOf(key), byUnit, total: hasObservedGl ? sumGl(unitIds.map((id) => byUnit[id]!)) : null };
    });
    const totalsByUnit: Record<number, number | null> = {};
    for (const id of unitIds) totalsByUnit[id] = sumGl(rows.map((r) => r.byUnit[id]!));
    return { rows, totalsByUnit, grandTotal: hasObservedGl ? sumGl(unitIds.map((id) => totalsByUnit[id]!)) : null };
  };
  const glDaily = mkValueRows(glDayCell);
  const glMonthlyFlat = mkValueRows(glMtdCell);
  if (glDaily.grandTotal === null) glProvisional = true;
  if (glMonthlyFlat.grandTotal === null) glMonthlyProvisional = true;
  const monthlyGl = (v: number | null): MonthlyCell<number | null> => ({
    kum: v, avg: v === null ? null : v / dayOfMonth,
  });
  const glMonthly = {
    rows: glMonthlyFlat.rows.map((r) => ({
      key: r.key, label: r.label,
      byUnit: Object.fromEntries(unitIds.map((id) => [id, monthlyGl(r.byUnit[id]!)])),
      total: monthlyGl(r.total),
    })),
    totalsByUnit: Object.fromEntries(unitIds.map((id) => [id, monthlyGl(glMonthlyFlat.totalsByUnit[id]!)])),
    grand: monthlyGl(glMonthlyFlat.grandTotal),
  };

  // ── Share (pengganti pie) ─────────────────────────────────────────────────
  const share: ShareRow[] = statuses.map((s) => {
    const c = monthlyTotals[s.unitId] ?? { kum: 0, avg: 0 };
    return {
      unitId: s.unitId,
      code: s.code,
      name: s.name,
      kum: c.kum,
      avg: c.avg,
      pct: monthlyGrandKum > 0 ? c.kum / monthlyGrandKum : null,
    };
  });

  // ── Tren 13 bulan (KL) ────────────────────────────────────────────────────
  const endYm = date.slice(0, 7);
  const months: TrendMonth[] = [];
  for (let i = -12; i <= 0; i++) {
    const ym = addMonths(endYm, i);
    const partial = ym === endYm;
    const days = partial ? dayOfMonth : daysInYm(ym);
    const byUnit: Record<number, number | null> = {};
    const avgByUnit: Record<number, number | null> = {};
    let totalKl = 0;
    for (const id of unitIds) {
      const min = salesMin.get(id) ?? null;
      // Unit belum beroperasi sepanjang bulan itu → null (≠ 0 "tak jualan").
      const monthEnd = `${ym}-${String(daysInYm(ym)).padStart(2, "0")}`;
      if (min === null || min > monthEnd) {
        byUnit[id] = null;
        avgByUnit[id] = null;
        continue;
      }
      const kl = (monthly.get(`${ym}|${id}`) ?? 0) / 1000;
      byUnit[id] = kl;
      avgByUnit[id] = kl / days;
      totalKl += kl;
    }
    months.push({
      ym,
      label: ymLabel(ym),
      byUnit,
      totalKl,
      avgByUnit,
      avgTotalKl: totalKl / days,
      partial,
      days,
    });
  }
  const barMaxKum = Math.max(1, ...months.flatMap((m) => unitIds.map((id) => m.byUnit[id] ?? 0)));
  const totalMaxKum = Math.max(1, ...months.map((m) => m.totalKl));
  const barMaxAvg = Math.max(1, ...months.flatMap((m) => unitIds.map((id) => m.avgByUnit[id] ?? 0)));
  const totalMaxAvg = Math.max(1, ...months.map((m) => m.avgTotalKl));

  // ── Rasio & BBK ───────────────────────────────────────────────────────────
  const volsFor = (src: Map<string, number>, id: number): Partial<Record<HarianProductKey, number>> => {
    const o: Partial<Record<HarianProductKey, number>> = {};
    for (const p of HARIAN_PRODUCTS) o[p.key] = src.get(`${id}|${p.key}`) ?? 0;
    return o;
  };
  const toProductVol = (v: Partial<Record<HarianProductKey, number>>): ProductVol[] =>
    HARIAN_PRODUCTS.map((p) => ({ nama: p.key, vol: v[p.key] ?? 0 }));
  const sumVols = (src: Map<string, number>): Partial<Record<HarianProductKey, number>> => {
    const o: Partial<Record<HarianProductKey, number>> = {};
    for (const p of HARIAN_PRODUCTS) {
      o[p.key] = unitIds.reduce((s, id) => s + (src.get(`${id}|${p.key}`) ?? 0), 0);
    }
    return o;
  };

  const ratiosDaily: Record<number, RatioCell> = {};
  const ratiosMonthly: Record<number, RatioCell> = {};
  const bbkMonthly: Record<number, BbkCell> = {};
  for (const id of unitIds) {
    ratiosDaily[id] = ratioOf(volsFor(dayCell, id));
    const mv = volsFor(mtdCell, id);
    ratiosMonthly[id] = ratioOf(mv);
    bbkMonthly[id] = bbkOf(toProductVol(mv));
  }
  const dayAll = sumVols(dayCell);
  const mtdAll = sumVols(mtdCell);

  // ── Rekor grup ────────────────────────────────────────────────────────────
  const recFrom = recordFloor;
  let bestDate: string | null = null;
  let bestTotal = -1;
  let dropped = 0;
  const perDay = new Map<string, number>();
  for (const [k, v] of dayUnit) {
    const d = k.slice(0, 10);
    if (d < recFrom || d > date) continue;
    if (v > GARBAGE_DAY_SALES_L) {
      dropped += 1;
      continue;
    }
    perDay.set(d, (perDay.get(d) ?? 0) + v);
  }
  for (const [d, v] of [...perDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (v > bestTotal) {
      bestTotal = v;
      bestDate = d;
    }
  }
  const recByUnit = zero();
  if (bestDate) {
    for (const id of unitIds) recByUnit[id] = dayUnit.get(`${bestDate}|${id}`) ?? 0;
  }
  const record: RecordFact = {
    from: recFrom,
    to: date,
    date: bestDate,
    byUnit: recByUnit,
    // TOTAL = jumlah baris, BUKAN angka terpisah — cacat #3 laporan Excel
    // (satu sel IB salah membuat TOTAL headline salah) mustahil terulang.
    total: bestDate ? unitIds.reduce((s, id) => s + (recByUnit[id] ?? 0), 0) : 0,
    droppedUnitDays: dropped,
  };

  // ── Catatan kaki ──────────────────────────────────────────────────────────
  const notes: string[] = [];
  if (hasOther) {
    const codes = [...new Set(dailySales.filter((r) => rowKeyOf(r.nama, r.ckdbbm) === OTHER_KEY).map((r) => normalizeProductIdentity(r.ckdbbm) ?? "tanpa kode produk"))];
    notes.push(
      `Baris "Lain-lain" memuat kode produk yang tak dikenali klasifikasi SolaMax (${codes.join(", ")}). Nilainya TETAP ikut TOTAL.`,
    );
  }
  notes.push(
    'Baris "Pertalite Khusus" tidak ditampilkan: 0 liter sepanjang periode laporan di seluruh unit (produk BB-01/PLK/Premium, terakhir terjual 2018–2021). Bila terjual lagi, ia muncul di baris "Lain-lain".',
  );
  if (record.droppedUnitDays > 0) {
    notes.push(
      `Pencarian rekor mengabaikan ${record.droppedUnitDays} unit-hari di luar batas wajar (>${GARBAGE_DAY_SALES_L.toLocaleString("id-ID")} L/unit/hari).`,
    );
  }
  if (glProvisional) {
    notes.push(
      "Gain/Losses tanggal ini masih SEMENTARA: opname penutup/awal belum final atau belum valid. Angka akan berubah — jangan diambil sebagai kesimpulan.",
    );
  }
  if (glMonthlyProvisional) notes.push('Gain/Losses bulan berjalan SEMENTARA: ada hari yang belum final atau belum terhitung dalam jendela MTD.');
  // ── Guard cakupan G/L ─────────────────────────────────────────────────────
  const glCoverage = statuses.map((s) => ({
    unitId: s.unitId,
    code: s.code,
    salesDays: salesDaysByUnit.get(s.unitId)?.size ?? 0,
    glDays: glDaysByUnit.get(s.unitId)?.size ?? 0,
  }));
  // Counts are diagnostic only. Exact unit/date/product coverage above has
  // already propagated every missing contribution to the dependent total.
  const glIncomplete = glMonthly.grand.kum === null;
  if (glIncomplete) {
    notes.push(
      'Gain/Losses TIDAK LENGKAP: ada produk/hari tanpa G/L terhitung atau stok penutup tidak valid. Sel tersebut dan total yang bergantung padanya tampil “—”, bukan 0. Periksa laporan operasional unit dan data opname/penjualan/penerimaan di EasyMax.',
    );
  }

  const suspects = statuses.filter((s) => suspectIds.has(s.unitId));
  if (suspects.length > 0) {
    notes.push(
      `Gain/Losses ${suspects.map((s) => s.name).join(", ")} tersentuh penutup opname bernilai 0 pada bulan ini — hasil G/L perlu pemeriksaan data sumber. Angka tidak dikoreksi; perlu perbaikan entri di EasyMax.`,
    );
  }

  return {
    date,
    avgDivisor: dayOfMonth,
    monthFrom: mFrom,
    units: statuses,
    freshness,
    daily: { rows: dailyRows, totalsByUnit: dailyTotals, grandTotal: dailyGrand },
    deltaByUnit,
    deltaTotal,
    monthly: {
      rows: monthlyRows,
      totalsByUnit: monthlyTotals,
      grand: { kum: monthlyGrandKum, avg: monthlyGrandKum / dayOfMonth },
    },
    glDaily,
    glMonthly,
    share,
    trend: { months, barMaxKum, totalMaxKum, barMaxAvg, totalMaxAvg },
    ratios: {
      daily: ratiosDaily,
      monthly: ratiosMonthly,
      dailyTotal: ratioOf(dayAll),
      monthlyTotal: ratioOf(mtdAll),
    },
    bbk: { monthly: bbkMonthly, monthlyTotal: bbkOf(toProductVol(mtdAll)) },
    record,
    glSuspectUnits: suspects.map((s) => ({ unitId: s.unitId, code: s.code, name: s.name })),
    glProvisional,
    glMonthlyProvisional,
    glIncomplete,
    glCoverage,
    notes,
  };
}
