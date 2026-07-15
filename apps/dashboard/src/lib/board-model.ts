/**
 * Model Ringkasan Direksi (board, redesign filter+evaluasi) — SUMBER TUNGGAL
 * untuk render layar DAN ekspor PDF. Murni (tanpa I/O; grain data disuntik
 * pemanggil). Dibangun dari unit HASIL INTERSECT scope (parseBoardParams ∩
 * getDataScope) → layar & PDF hanya memuat unit yang boleh dilihat caller.
 *
 * Dua tahap (streaming): buildBoardCore = jendela AKTIF saja (verdict, 4 kartu
 * KPI, tren, bauran, ranking) — cepat; buildBoardEval = pembanding MoM/YoY/YTD
 * (butuh G/L jendela panjang) — dirender menyusul di bawah Suspense.
 *
 * Metodologi TERKUNCI (FASE 0): MoM = bulan kalender MTD-vs-MTD; YoY = rentang
 * sama tahun lalu ("—" bila histori unit tak mencakup); YTD = 1 Jan..to vs
 * tahun lalu. Definisi KPI TIDAK berubah (omzet/vol sales DTGLJUAL; G/L RESUME
 * Σ harian; bauran rasio NPSO/PSO); target bauran rentang = tertimbang hari.
 */
import { classifyProduct, unitDotted } from "@/lib/config";
import {
  aggregateDailyGl,
  bauranVsTargetRange,
  glPercent,
  verdictHeadline,
  type BauranStatus,
  type DailyGlInput,
  type VerdictChip,
} from "@/lib/derive";
import { dateShort, fmtKL, idn, pct, rpShort, signed, timeWib } from "@/lib/format";
import { addDays, rangeDays, type BoardPeriod, type DateRange } from "@/lib/periods";
import type { AnomalyItem } from "@/lib/anomalies";
import type { RankRow } from "@/components/board/RankingTable";

export type BoardMode = "kumulatif" | "banding";

export interface BoardUnit {
  unit_id: number;
  code: string;
  name: string;
}

/** Grain harian × produk × unit (struktural — hindari import queries/db). */
export interface SalesGrainRow {
  unit_id: number;
  d: string;
  ckdbbm: string;
  nama: string | null;
  vol: number;
  omzet: number;
}

export interface ShiftToday {
  shifts: number;
  last_dtgljam: string | null;
}

// ---------------------------------------------------------------------------
// Agregasi grain — helper murni
// ---------------------------------------------------------------------------

interface SalesAgg {
  vol: number;
  omzet: number;
  products: { ckdbbm: string; nama: string | null; vol: number }[];
}

function sliceSales(rows: SalesGrainRow[], unitIds: ReadonlySet<number>, w: DateRange): SalesAgg {
  let vol = 0;
  let omzet = 0;
  const byProduct = new Map<string, { ckdbbm: string; nama: string | null; vol: number }>();
  for (const r of rows) {
    if (!unitIds.has(r.unit_id) || r.d < w.from || r.d > w.to) continue;
    vol += r.vol;
    omzet += r.omzet;
    const cur = byProduct.get(r.ckdbbm);
    if (cur) cur.vol += r.vol;
    else byProduct.set(r.ckdbbm, { ckdbbm: r.ckdbbm, nama: r.nama, vol: r.vol });
  }
  return { vol, omzet, products: [...byProduct.values()] };
}

function glAgg(glByUnit: ReadonlyMap<number, DailyGlInput[]>, unitIds: ReadonlySet<number>) {
  const rows: DailyGlInput[] = [];
  for (const [uid, r] of glByUnit) if (unitIds.has(uid)) rows.push(...r);
  return aggregateDailyGl(rows);
}

// ---------------------------------------------------------------------------
// Sel delta (MoM/YoY/YTD) — format + tone
// ---------------------------------------------------------------------------

export interface DeltaCell {
  /** "▲ 4,1%" / "+0,8 pt" / "—" */
  text: string;
  tone: "up" | "down" | "flat" | "na";
  /** keterangan "—": "histori < 1 tahun" dst. */
  note?: string;
  provisional?: boolean;
}

const NA: DeltaCell = { text: "—", tone: "na" };

/** Δ relatif (omzet/volume): (cur−prev)/prev. prev ≤ 0 → "—". */
function relDelta(cur: number, prev: number, provisional = false): DeltaCell {
  if (prev <= 0) return { ...NA, note: "pembanding 0" };
  const d = (cur - prev) / prev;
  return {
    text: `${d >= 0 ? "▲" : "▼"} ${pct(Math.abs(d))}`,
    tone: d > 0 ? "up" : d < 0 ? "down" : "flat",
    provisional: provisional || undefined,
  };
}

/** Δ poin persen (G/L %, bauran): (cur−prev)×100 pt. null → "—". */
function ptDelta(cur: number | null, prev: number | null, provisional = false): DeltaCell {
  if (cur === null || prev === null) return { ...NA, note: "tak terhitung" };
  const d = (cur - prev) * 100;
  return {
    text: `${signed(d, 2)} pt`,
    tone: d > 0 ? "up" : d < 0 ? "down" : "flat",
    provisional: provisional || undefined,
  };
}

function fmtRangeShort(r: DateRange): string {
  return r.from === r.to ? dateShort(r.from) : `${dateShort(r.from)} – ${dateShort(r.to)}`;
}

// ---------------------------------------------------------------------------
// CORE — jendela aktif (cepat)
// ---------------------------------------------------------------------------

export interface RatioRow {
  name: string;
  actual: number;
  target: number | null;
  deltaPt: number | null;
  below: boolean;
  barW: number;
  tickW: number | null;
  cls: string;
  nameCls: string;
}

export interface KpiCardCore {
  key: "omzet" | "gl" | "gas" | "oil";
  title: string;
  value: string;
  /** baris kedua: volume KL / liter G/L / target rata-rata periode */
  sub: string | null;
  subTone: "muted" | "success" | "warning" | "danger";
  /** jendela aktif belum final (G/L provisional / hari berjalan belum lengkap) */
  provisional: boolean;
  /** mode banding: nilai per unit (side-by-side dalam kartu) */
  perUnit: { name: string; value: string; sub: string | null }[] | null;
}

export interface TrendModel {
  days: string[];
  series: { code: string; name: string; rp: number[]; liter: number[] }[];
  avgRp: number;
  avgLiter: number;
  /** catatan bila tren bukan persis rentang (filter 1 hari → konteks 14 hari) */
  note: string | null;
}

export interface BoardCore {
  verdict: { headline: string; chips: VerdictChip[] };
  kpi: KpiCardCore[];
  trend: TrendModel;
  ratios: { rg: RatioRow[]; rd: RatioRow[]; gasGroup: BauranStatus; oilGroup: BauranStatus };
  ranking: RankRow[];
  anomalies: AnomalyItem[];
  lastShift: string | undefined;
  unitsCount: number;
  /** rentang menyentuh hari ini & ada unit shift < 3 (badge sel terpengaruh) */
  incompleteToday: boolean;
}

export interface BoardCoreInput {
  units: BoardUnit[];
  period: BoardPeriod;
  mode: BoardMode;
  today: string;
  /** grain sales — minimal mencakup [range.from − 13 hr .. range.to] */
  dailySales: SalesGrainRow[];
  /** baris G/L jendela aktif per unit_id */
  glRange: ReadonlyMap<number, DailyGlInput[]>;
  shift: ReadonlyMap<number, ShiftToday>;
  anomalies: AnomalyItem[];
}

export function buildBoardCore(input: BoardCoreInput): BoardCore {
  const { units, period, mode, today, dailySales, glRange, shift, anomalies } = input;
  const range = period.range;
  const allIds = new Set(units.map((u) => u.unit_id));
  const touchesToday = range.to >= today;

  // ── Per unit (jendela aktif) ──
  const perUnit = units.map((u) => {
    const ids = new Set([u.unit_id]);
    const sales = sliceSales(dailySales, ids, range);
    const gl = glAgg(glRange, ids);
    const glPct = gl.hasGl ? glPercent(gl.totalSigned, sales.vol) : null;
    const glAbnormal = glPct !== null && Math.abs(glPct) > 0.005;
    const gas = bauranVsTargetRange(sales.products, u.code, range, "gasoline");
    const oil = bauranVsTargetRange(sales.products, u.code, range, "gasoil");
    const sh = shift.get(u.unit_id) ?? { shifts: 0, last_dtgljam: null };
    return { u, sales, gl, glPct, glAbnormal, glProvisional: gl.provisional, gas, oil, sh };
  });

  const incompleteToday = touchesToday && perUnit.some((x) => x.sh.shifts < 3);

  // ── KPI agregat ──
  const groupSales = sliceSales(dailySales, allIds, range);
  const groupGl = glAgg(glRange, allIds);
  const groupGlPct = groupGl.hasGl ? glPercent(groupGl.totalSigned, groupSales.vol) : null;
  const firstCode = units[0]?.code ?? "";
  const gasGroup = bauranVsTargetRange(groupSales.products, firstCode, range, "gasoline");
  const oilGroup = bauranVsTargetRange(groupSales.products, firstCode, range, "gasoil");
  const confirmedAbnormal = perUnit.filter((x) => x.glAbnormal && !x.glProvisional).length;
  const provisionalUnits = perUnit.filter((x) => x.glProvisional).length;

  const bauranSub = (st: BauranStatus): { sub: string | null; subTone: KpiCardCore["subTone"] } =>
    st.target !== null
      ? { sub: `target rata-rata periode ${pct(st.target)}`, subTone: st.below ? "warning" : "success" }
      : { sub: null, subTone: "muted" };

  const kpi: KpiCardCore[] = [
    {
      key: "omzet",
      title: "Omset penjualan",
      value: rpShort(groupSales.omzet),
      sub: `volume ${fmtKL(groupSales.vol)}`,
      subTone: "muted",
      provisional: incompleteToday,
      perUnit:
        mode === "banding"
          ? perUnit.map((x) => ({
              name: x.u.name,
              value: rpShort(x.sales.omzet),
              sub: fmtKL(x.sales.vol),
            }))
          : null,
    },
    {
      key: "gl",
      title: "Gain / Loss",
      value: groupGlPct !== null ? `${signed(groupGlPct * 100, 2)}%` : "—",
      sub: groupGl.hasGl ? `${signed(groupGl.totalSigned, 0)} L` : "belum terhitung",
      subTone:
        confirmedAbnormal > 0 ? "danger" : provisionalUnits > 0 ? "warning" : "success",
      provisional: groupGl.provisional,
      perUnit:
        mode === "banding"
          ? perUnit.map((x) => ({
              name: x.u.name,
              value: x.glPct !== null ? `${signed(x.glPct * 100, 2)}%` : "—",
              sub: x.gl.hasGl ? `${signed(x.gl.totalSigned, 0)} L` : null,
            }))
          : null,
    },
    {
      key: "gas",
      title: "% NPSO/PSO Gasoline",
      value: gasGroup.actual !== null ? pct(gasGroup.actual) : "—",
      ...bauranSub(gasGroup),
      provisional: incompleteToday,
      perUnit:
        mode === "banding"
          ? perUnit.map((x) => ({
              name: x.u.name,
              value: x.gas.actual !== null ? pct(x.gas.actual) : "—",
              sub: x.gas.target !== null ? `tgt ${pct(x.gas.target)}` : null,
            }))
          : null,
    },
    {
      key: "oil",
      title: "% NPSO/PSO Gasoil",
      value: oilGroup.actual !== null ? pct(oilGroup.actual) : "—",
      ...bauranSub(oilGroup),
      provisional: incompleteToday,
      perUnit:
        mode === "banding"
          ? perUnit.map((x) => ({
              name: x.u.name,
              value: x.oil.actual !== null ? pct(x.oil.actual) : "—",
              sub: x.oil.target !== null ? `tgt ${pct(x.oil.target)}` : null,
            }))
          : null,
    },
  ];

  // ── Verdict chips (identitas halaman: management by exception) ──
  const chips: VerdictChip[] = [];
  for (const x of perUnit) {
    if (x.glAbnormal && x.glPct !== null) {
      chips.push(
        x.glProvisional
          ? { tone: "warning", text: `Losses ${x.u.name} · sementara (opname belum final)` }
          : { tone: "danger", text: `Losses ${x.u.name} ${pct(x.glPct, 2)}` },
      );
    }
  }
  if (perUnit.some((x) => x.gas.below) || perUnit.some((x) => x.oil.below))
    chips.push({ tone: "warning", text: "Bauran NPSO di bawah target" });
  if (touchesToday)
    for (const x of perUnit.filter((p) => p.sh.shifts < 3))
      chips.push({ tone: "warning", text: `${x.u.name}: shift ${x.sh.shifts}/3` });

  // ── Tren mengikuti filter (Rp & Liter; multi-seri saat banding) ──
  const oneDay = rangeDays(range) < 2;
  const trendRange: DateRange = oneDay ? { from: addDays(range.to, -13), to: range.to } : range;
  const nDays = rangeDays(trendRange);
  const days = Array.from({ length: nDays }, (_, i) => addDays(trendRange.from, i));
  const seriesOf = (ids: ReadonlySet<number>): { rp: number[]; liter: number[] } => {
    const rpMap = new Map<string, number>();
    const lMap = new Map<string, number>();
    for (const r of dailySales) {
      if (!ids.has(r.unit_id) || r.d < trendRange.from || r.d > trendRange.to) continue;
      rpMap.set(r.d, (rpMap.get(r.d) ?? 0) + r.omzet);
      lMap.set(r.d, (lMap.get(r.d) ?? 0) + r.vol);
    }
    return { rp: days.map((d) => rpMap.get(d) ?? 0), liter: days.map((d) => lMap.get(d) ?? 0) };
  };
  const series =
    mode === "banding"
      ? units.map((u) => ({ code: u.code, name: u.name, ...seriesOf(new Set([u.unit_id])) }))
      : [{ code: "all", name: "Semua unit terpilih", ...seriesOf(allIds) }];
  const totRp = seriesOf(allIds);
  const avgRp = totRp.rp.reduce((a, b) => a + b, 0) / Math.max(nDays, 1);
  const avgLiter = totRp.liter.reduce((a, b) => a + b, 0) / Math.max(nDays, 1);
  const trend: TrendModel = {
    days,
    series,
    avgRp,
    avgLiter,
    note: oneDay ? "filter 1 hari — ditampilkan konteks 14 hari terakhir" : null,
  };

  // ── Panel rasio bauran (per unit bars) ──
  const mkRatio = (key: "gas" | "oil"): RatioRow[] => {
    const sorted = perUnit
      .filter((x) => x[key].actual !== null)
      .sort((a, b) => (b[key].actual ?? 0) - (a[key].actual ?? 0));
    const scaleMax =
      Math.max(...sorted.map((x) => x[key].actual ?? 0), ...sorted.map((x) => x[key].target ?? 0), 0.01) *
      1.15;
    return sorted.map((x, i) => {
      const st = x[key];
      const worst = i === sorted.length - 1 && sorted.length > 1;
      return {
        name: x.u.name,
        actual: st.actual ?? 0,
        target: st.target,
        deltaPt: st.deltaPt,
        below: st.below,
        barW: Math.min(100, ((st.actual ?? 0) / scaleMax) * 100),
        tickW: st.target !== null ? (st.target / scaleMax) * 100 : null,
        cls: i === 0 ? "best" : worst && st.below ? "worst" : st.below ? "below" : "ok",
        nameCls: i === 0 ? "t-brand w700" : worst && st.below ? "t-danger w700" : "t-secondary",
      };
    });
  };

  // ── Ranking (kolom NPSO gasoil BARU; mini-spark 14 hari berakhir di range.to) ──
  const sparkDays = Array.from({ length: 14 }, (_, i) => addDays(range.to, i - 13));
  const ranked = [...perUnit].sort((a, b) => b.sales.omzet - a.sales.omzet);
  const ranking: RankRow[] = ranked.map((x, i) => {
    const maxP = Math.max(...x.sales.products.map((p) => p.vol), 1);
    const uid = new Set([x.u.unit_id]);
    const daily = new Map<string, number>();
    for (const r of dailySales)
      if (uid.has(r.unit_id)) daily.set(r.d, (daily.get(r.d) ?? 0) + r.omzet);
    const sparkVals14 = sparkDays.map((d) => daily.get(d) ?? 0);
    const sMax = Math.max(...sparkVals14, 1);
    const notes: RankRow["notes"] = [];
    if (x.glAbnormal && x.glPct !== null)
      notes.push(
        x.glProvisional
          ? { tone: "warning", text: "Losses sementara — menunggu opname penutup" }
          : { tone: "danger", text: `Losses ${pct(x.glPct, 2)} — di atas ambang 0,5%/100 L` },
      );
    if (x.gas.below && x.gas.deltaPt !== null)
      notes.push({
        tone: "warning",
        text: `Bauran gasoline ${idn(Math.abs(x.gas.deltaPt), 1)} pt di bawah target`,
      });
    if (x.oil.below && x.oil.deltaPt !== null)
      notes.push({
        tone: "warning",
        text: `Bauran gasoil ${idn(Math.abs(x.oil.deltaPt), 1)} pt di bawah target`,
      });
    if (touchesToday && x.sh.shifts < 3)
      notes.push({
        tone: "warning",
        text: `Penjualan shift ${x.sh.shifts + 1} belum diinput${x.sh.last_dtgljam ? ` (terakhir ${timeWib(x.sh.last_dtgljam)} WIB)` : ""}`,
      });
    if (notes.length === 0) notes.push({ tone: "success", text: "Semua modul aktif terinput tepat waktu" });

    return {
      rank: i + 1,
      code: x.u.code,
      dotted: unitDotted(x.u.code),
      name: x.u.name,
      omzet: rpShort(x.sales.omzet),
      vol: fmtKL(x.sales.vol),
      gl: x.glPct !== null ? `${signed(x.glPct * 100, 2)}%` : "—",
      glAbnormal: x.glAbnormal,
      glProvisional: x.glProvisional,
      rg: x.gas.actual !== null ? pct(x.gas.actual) : "—",
      rd: x.oil.actual !== null ? pct(x.oil.actual) : "—",
      inputTone: x.sh.shifts >= 3 ? "success" : x.sh.shifts > 0 ? "warning" : "danger",
      inputLabel: x.sh.shifts >= 3 ? "3/3 shift" : `${x.sh.shifts}/3 · belum lengkap`,
      products: x.sales.products
        .map((p) => ({ p, cls: classifyProduct(p.nama) }))
        .sort((a, b) => (a.cls?.order ?? 9) - (b.cls?.order ?? 9))
        .map(({ p, cls }) => ({
          name: p.nama ?? p.ckdbbm,
          volLabel: `${idn(p.vol)} L`,
          widthPct: (p.vol / maxP) * 100,
          fill: (cls?.pso ? "pso" : cls?.order === 3 || cls?.order === 6 ? "npso2" : "npso") as
            | "pso"
            | "npso"
            | "npso2",
        })),
      sparkHeights: sparkVals14.map((v) => 18 + (v / sMax) * 46),
      notes,
      laporanHref: `/unit/${x.u.code}/laporan/${range.to}`,
    };
  });

  const lastShift = perUnit
    .map((x) => x.sh.last_dtgljam)
    .filter((x): x is string => x !== null)
    .sort()
    .pop();

  return {
    verdict: { headline: verdictHeadline(chips), chips },
    kpi,
    trend,
    ratios: { rg: mkRatio("gas"), rd: mkRatio("oil"), gasGroup, oilGroup },
    ranking,
    anomalies,
    lastShift,
    unitsCount: units.length,
    incompleteToday,
  };
}

// ---------------------------------------------------------------------------
// EVAL — pembanding MoM / YoY / YTD (streamed)
// ---------------------------------------------------------------------------

export type GlWindows = Record<
  "range" | "momPrev" | "yoyPrev" | "ytdCur" | "ytdPrev",
  ReadonlyMap<number, DailyGlInput[]>
>;

export interface BoardEvalInput {
  units: BoardUnit[];
  period: BoardPeriod;
  today: string;
  /** grain sales union span penuh: [ytd.prev.from .. range.to] */
  dailySales: SalesGrainRow[];
  gl: GlWindows;
  /** min tanggal sales per unit_id (null = tanpa data) */
  coverage: ReadonlyMap<number, string | null>;
  incompleteToday: boolean;
}

export interface KpiEvalCells {
  mom: DeltaCell;
  yoy: DeltaCell;
  ytdValue: string;
  ytdDelta: DeltaCell;
  ytdProvisional: boolean;
}

export interface EvalMetricRow {
  metric: "Omset" | "Volume" | "Gain/Loss" | "NPSO (G)" | "NPSO (D)";
  cur: string;
  curProvisional: boolean;
  mom: DeltaCell;
  yoy: DeltaCell;
  ytd: string;
  ytdDelta: DeltaCell;
}

export interface EvalUnitBlock {
  code: string;
  dotted: string;
  name: string;
  rows: EvalMetricRow[];
}

export interface BoardEval {
  labels: { range: string; mom: string; yoy: string; ytd: string };
  cards: Record<"omzet" | "gl" | "gas" | "oil", KpiEvalCells>;
  units: EvalUnitBlock[];
}

/** Unit yang historinya TIDAK mencakup jendela pembanding (sales_min > from). */
function uncovered(
  units: BoardUnit[],
  coverage: ReadonlyMap<number, string | null>,
  w: DateRange,
): BoardUnit[] {
  return units.filter((u) => {
    const min = coverage.get(u.unit_id) ?? null;
    return min === null || min > w.from;
  });
}

function noHistoryCell(missing: BoardUnit[], reason: string): DeltaCell {
  const who = missing.map((u) => u.name).join(", ");
  return { text: "—", tone: "na", note: `${reason} (${who})` };
}

export function buildBoardEval(input: BoardEvalInput): BoardEval {
  const { units, period, dailySales, gl, coverage, incompleteToday } = input;

  const labels = {
    range: fmtRangeShort(period.range),
    mom: `${period.key === "bulan" ? "MoM (MTD)" : "MoM"} · vs ${fmtRangeShort(period.mom.prev)}`,
    yoy: `YoY · vs ${fmtRangeShort(period.yoy.prev)}`,
    ytd: `YTD · ${fmtRangeShort(period.ytd.cur)} vs ${fmtRangeShort(period.ytd.prev)}`,
  };

  /** Metrik lengkap satu himpunan unit (agregat grup ATAU satu unit). */
  const metricsFor = (subset: BoardUnit[]) => {
    const ids = new Set(subset.map((u) => u.unit_id));
    const firstCode = subset[0]?.code ?? "";
    const win = (w: DateRange, glMap: ReadonlyMap<number, DailyGlInput[]>, withTarget: boolean) => {
      const sales = sliceSales(dailySales, ids, w);
      const g = glAgg(glMap, ids);
      const glPct = g.hasGl ? glPercent(g.totalSigned, sales.vol) : null;
      const gas = bauranVsTargetRange(sales.products, firstCode, w, "gasoline", withTarget);
      const oil = bauranVsTargetRange(sales.products, firstCode, w, "gasoil", withTarget);
      return { sales, g, glPct, gas, oil };
    };
    const cur = win(period.range, gl.range, true);
    const mom = win(period.mom.prev, gl.momPrev, false);
    const yoy = win(period.yoy.prev, gl.yoyPrev, false);
    const ytd = win(period.ytd.cur, gl.ytdCur, true);
    const ytdPrev = win(period.ytd.prev, gl.ytdPrev, false);

    const missMom = uncovered(subset, coverage, period.mom.prev);
    const missYoy = uncovered(subset, coverage, period.yoy.prev);
    const missYtdPrev = uncovered(subset, coverage, period.ytd.prev);

    /** Gate histori: jendela pembanding hanya sah bila SEMUA unit tercakup. */
    const gate = (miss: BoardUnit[], reason: string, cell: () => DeltaCell): DeltaCell =>
      miss.length > 0 ? noHistoryCell(miss, reason) : cell();

    const evalOf = (
      curV: { rel?: [number, number]; pt?: [number | null, number | null] },
      miss: BoardUnit[],
      reason: string,
      provisional = false,
    ): DeltaCell =>
      gate(miss, reason, () =>
        curV.rel
          ? relDelta(curV.rel[0], curV.rel[1], provisional)
          : ptDelta(curV.pt![0], curV.pt![1], provisional),
      );

    return { cur, mom, yoy, ytd, ytdPrev, missMom, missYoy, missYtdPrev, evalOf };
  };

  /** Sel kartu KPI agregat. */
  const m = metricsFor(units);
  const glProvAny = m.cur.g.provisional;
  const ytdProv = m.ytd.g.provisional;

  const cards: BoardEval["cards"] = {
    omzet: {
      mom: m.evalOf({ rel: [m.cur.sales.omzet, m.mom.sales.omzet] }, m.missMom, "histori tak mencakup", incompleteToday),
      yoy: m.evalOf({ rel: [m.cur.sales.omzet, m.yoy.sales.omzet] }, m.missYoy, "histori < 1 tahun", incompleteToday),
      ytdValue: rpShort(m.ytd.sales.omzet),
      ytdDelta: m.evalOf({ rel: [m.ytd.sales.omzet, m.ytdPrev.sales.omzet] }, m.missYtdPrev, "histori < 1 tahun"),
      ytdProvisional: incompleteToday,
    },
    gl: {
      mom: m.evalOf({ pt: [m.cur.glPct, m.mom.glPct] }, m.missMom, "histori tak mencakup", glProvAny || m.mom.g.provisional),
      yoy: m.evalOf({ pt: [m.cur.glPct, m.yoy.glPct] }, m.missYoy, "histori < 1 tahun", glProvAny || m.yoy.g.provisional),
      ytdValue: m.ytd.glPct !== null ? `${signed(m.ytd.glPct * 100, 2)}%` : "—",
      ytdDelta: m.evalOf({ pt: [m.ytd.glPct, m.ytdPrev.glPct] }, m.missYtdPrev, "histori < 1 tahun", ytdProv),
      ytdProvisional: ytdProv,
    },
    gas: {
      mom: m.evalOf({ pt: [m.cur.gas.actual, m.mom.gas.actual] }, m.missMom, "histori tak mencakup", incompleteToday),
      yoy: m.evalOf({ pt: [m.cur.gas.actual, m.yoy.gas.actual] }, m.missYoy, "histori < 1 tahun", incompleteToday),
      ytdValue: m.ytd.gas.actual !== null ? pct(m.ytd.gas.actual) : "—",
      ytdDelta: m.evalOf({ pt: [m.ytd.gas.actual, m.ytdPrev.gas.actual] }, m.missYtdPrev, "histori < 1 tahun"),
      ytdProvisional: incompleteToday,
    },
    oil: {
      mom: m.evalOf({ pt: [m.cur.oil.actual, m.mom.oil.actual] }, m.missMom, "histori tak mencakup", incompleteToday),
      yoy: m.evalOf({ pt: [m.cur.oil.actual, m.yoy.oil.actual] }, m.missYoy, "histori < 1 tahun", incompleteToday),
      ytdValue: m.ytd.oil.actual !== null ? pct(m.ytd.oil.actual) : "—",
      ytdDelta: m.evalOf({ pt: [m.ytd.oil.actual, m.ytdPrev.oil.actual] }, m.missYtdPrev, "histori < 1 tahun"),
      ytdProvisional: incompleteToday,
    },
  };

  // ── Blok evaluasi per cabang: 5 baris metrik per unit ──
  const unitBlocks: EvalUnitBlock[] = units.map((u) => {
    const s = metricsFor([u]);
    const glProv = s.cur.g.provisional;
    const rows: EvalMetricRow[] = [
      {
        metric: "Omset",
        cur: rpShort(s.cur.sales.omzet),
        curProvisional: incompleteToday,
        mom: s.evalOf({ rel: [s.cur.sales.omzet, s.mom.sales.omzet] }, s.missMom, "histori tak mencakup"),
        yoy: s.evalOf({ rel: [s.cur.sales.omzet, s.yoy.sales.omzet] }, s.missYoy, "histori < 1 tahun"),
        ytd: rpShort(s.ytd.sales.omzet),
        ytdDelta: s.evalOf({ rel: [s.ytd.sales.omzet, s.ytdPrev.sales.omzet] }, s.missYtdPrev, "histori < 1 tahun"),
      },
      {
        metric: "Volume",
        cur: fmtKL(s.cur.sales.vol),
        curProvisional: incompleteToday,
        mom: s.evalOf({ rel: [s.cur.sales.vol, s.mom.sales.vol] }, s.missMom, "histori tak mencakup"),
        yoy: s.evalOf({ rel: [s.cur.sales.vol, s.yoy.sales.vol] }, s.missYoy, "histori < 1 tahun"),
        ytd: fmtKL(s.ytd.sales.vol),
        ytdDelta: s.evalOf({ rel: [s.ytd.sales.vol, s.ytdPrev.sales.vol] }, s.missYtdPrev, "histori < 1 tahun"),
      },
      {
        metric: "Gain/Loss",
        cur: s.cur.glPct !== null ? `${signed(s.cur.glPct * 100, 2)}%` : "—",
        curProvisional: glProv,
        mom: s.evalOf({ pt: [s.cur.glPct, s.mom.glPct] }, s.missMom, "histori tak mencakup", glProv || s.mom.g.provisional),
        yoy: s.evalOf({ pt: [s.cur.glPct, s.yoy.glPct] }, s.missYoy, "histori < 1 tahun", glProv || s.yoy.g.provisional),
        ytd: s.ytd.glPct !== null ? `${signed(s.ytd.glPct * 100, 2)}%` : "—",
        ytdDelta: s.evalOf({ pt: [s.ytd.glPct, s.ytdPrev.glPct] }, s.missYtdPrev, "histori < 1 tahun", s.ytd.g.provisional),
      },
      {
        metric: "NPSO (G)",
        cur: s.cur.gas.actual !== null ? pct(s.cur.gas.actual) : "—",
        curProvisional: incompleteToday,
        mom: s.evalOf({ pt: [s.cur.gas.actual, s.mom.gas.actual] }, s.missMom, "histori tak mencakup"),
        yoy: s.evalOf({ pt: [s.cur.gas.actual, s.yoy.gas.actual] }, s.missYoy, "histori < 1 tahun"),
        ytd: s.ytd.gas.actual !== null ? pct(s.ytd.gas.actual) : "—",
        ytdDelta: s.evalOf({ pt: [s.ytd.gas.actual, s.ytdPrev.gas.actual] }, s.missYtdPrev, "histori < 1 tahun"),
      },
      {
        metric: "NPSO (D)",
        cur: s.cur.oil.actual !== null ? pct(s.cur.oil.actual) : "—",
        curProvisional: incompleteToday,
        mom: s.evalOf({ pt: [s.cur.oil.actual, s.mom.oil.actual] }, s.missMom, "histori tak mencakup"),
        yoy: s.evalOf({ pt: [s.cur.oil.actual, s.yoy.oil.actual] }, s.missYoy, "histori < 1 tahun"),
        ytd: s.ytd.oil.actual !== null ? pct(s.ytd.oil.actual) : "—",
        ytdDelta: s.evalOf({ pt: [s.ytd.oil.actual, s.ytdPrev.oil.actual] }, s.missYtdPrev, "histori < 1 tahun"),
      },
    ];
    return { code: u.code, dotted: unitDotted(u.code), name: u.name, rows };
  });

  return { labels, cards, units: unitBlocks };
}

// ---------------------------------------------------------------------------
// Model gabungan (layar bagian eval + PDF)
// ---------------------------------------------------------------------------

export interface BoardModel {
  mode: BoardMode;
  core: BoardCore;
  eval: BoardEval;
}
