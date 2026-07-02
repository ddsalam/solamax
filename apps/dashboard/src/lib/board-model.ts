/**
 * Model Ringkasan Direksi (board) — SUMBER TUNGGAL untuk render layar DAN ekspor
 * PDF. Murni (tanpa I/O). Dibangun dari `perUnit` yang HANYA berisi unit ber-scope
 * (getDataScope().units) → PDF memuat hanya unit yang boleh dilihat caller
 * (principle 11 utk dokumen multi-unit). Angka via lib/format yang sama dgn layar.
 */
import { classifyProduct, unitDotted } from "@/lib/config";
import { bauranVsTarget, verdictHeadline, type BauranStatus, type VerdictChip } from "@/lib/derive";
import { fmtKL, idn, pct, rpShort, signed, timeWib } from "@/lib/format";
import { addDays } from "@/lib/periods";
import type { AnomalyItem } from "@/lib/anomalies";
import type { RankRow } from "@/components/board/RankingTable";

export interface PerUnitAgg {
  u: { code: string; name: string };
  products: { ckdbbm: string; nama: string; vol: number }[];
  totals: { vol: number; omzet: number };
  prevTotals: { omzet: number };
  glPct: number | null;
  glAbnormal: boolean;
  glProvisional: boolean;
  gas: BauranStatus;
  oil: BauranStatus;
  shift: { shifts: number; last_dtgljam: string | null };
  daily: { d: string; omzet: number }[];
}

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

export interface BoardModel {
  kpi: {
    omzet: number;
    delta: number | null;
    volG: number;
    volD: number;
    glGroupPct: number | null;
    confirmedAbnormal: number;
    provisionalUnits: number;
    shiftsDone: number;
    shiftsTarget: number;
    bolongNames: string[];
  };
  verdict: { headline: string; chips: VerdictChip[] };
  spark: { pts: string[]; trendAvg: number; days: string[]; vals: number[] };
  ratios: { rg: RatioRow[]; rd: RatioRow[]; gasGroup: BauranStatus; oilGroup: BauranStatus };
  ranking: RankRow[];
  anomalies: AnomalyItem[];
  lastShift: string | undefined;
  unitsCount: number;
}

export function buildBoardModel(
  input: { perUnit: PerUnitAgg[]; anomalies: AnomalyItem[] },
  ctx: { firstUnitCode: string; month: number; today: string },
): BoardModel {
  const { perUnit, anomalies } = input;
  const { firstUnitCode, month, today } = ctx;

  // ── KPI grup ──
  const omzet = perUnit.reduce((s, x) => s + x.totals.omzet, 0);
  const omzetPrev = perUnit.reduce((s, x) => s + x.prevTotals.omzet, 0);
  const delta = omzetPrev > 0 ? (omzet - omzetPrev) / omzetPrev : null;

  let volG = 0;
  let volD = 0;
  for (const x of perUnit)
    for (const p of x.products) {
      const cls = classifyProduct(p.nama);
      if (cls?.kind === "gasoline") volG += p.vol;
      else if (cls?.kind === "gasoil") volD += p.vol;
    }

  const totalVol = perUnit.reduce((s, x) => s + x.totals.vol, 0);
  const glAll = perUnit.reduce((s, x) => s + (x.glPct !== null ? x.glPct * x.totals.vol : 0), 0);
  const glGroupPct = totalVol > 0 ? glAll / totalVol : null;
  const confirmedAbnormal = perUnit.filter((x) => x.glAbnormal && !x.glProvisional).length;
  const provisionalUnits = perUnit.filter((x) => x.glProvisional).length;

  const shiftsDone = perUnit.reduce((s, x) => s + Math.min(x.shift.shifts, 3), 0);
  const shiftsTarget = perUnit.length * 3;
  const bolong = perUnit.filter((x) => x.shift.shifts < 3);

  // ── Verdict chips ──
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
  const gasBelow = perUnit.filter((x) => x.gas.below).length;
  const oilBelow = perUnit.filter((x) => x.oil.below).length;
  if (gasBelow + oilBelow > 0) chips.push({ tone: "warning", text: "Bauran NPSO di bawah target" });
  for (const x of bolong) chips.push({ tone: "warning", text: `${x.u.name}: shift ${x.shift.shifts}/3` });

  // ── Sparkline grup 14 hari ──
  const sparkMap = new Map<string, number>();
  for (const x of perUnit) for (const d of x.daily) sparkMap.set(d.d, (sparkMap.get(d.d) ?? 0) + d.omzet);
  const sparkDays = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const sparkVals = sparkDays.map((d) => sparkMap.get(d) ?? 0);
  const mn = Math.min(...sparkVals);
  const mx = Math.max(...sparkVals, 1);
  const pts = sparkVals.map((v, i) => {
    const x = ((i * 560) / 13).toFixed(1);
    const y = (64 - ((v - mn) / Math.max(mx - mn, 1)) * 52 + 2).toFixed(1);
    return `${x},${y}`;
  });
  const trendAvg = sparkVals.reduce((a, b) => a + b, 0) / 14;

  // ── Ratio lists ──
  const mkRatio = (key: "gas" | "oil"): RatioRow[] => {
    const sorted = [...perUnit]
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
  const rg = mkRatio("gas");
  const rd = mkRatio("oil");
  const allProducts = perUnit.flatMap((x) => x.products);
  const gasGroup = bauranVsTarget(allProducts, firstUnitCode, month, "gasoline");
  const oilGroup = bauranVsTarget(allProducts, firstUnitCode, month, "gasoil");

  // ── Ranking rows ──
  const ranked = [...perUnit].sort((a, b) => b.totals.omzet - a.totals.omzet);
  const ranking: RankRow[] = ranked.map((x, i) => {
    const maxP = Math.max(...x.products.map((p) => p.vol), 1);
    const sparkVals14 = sparkDays.map((d) => x.daily.find((dd) => dd.d === d)?.omzet ?? 0);
    const sMax = Math.max(...sparkVals14, 1);
    const notes: RankRow["notes"] = [];
    if (x.glAbnormal && x.glPct !== null)
      notes.push(
        x.glProvisional
          ? { tone: "warning", text: "Losses sementara — menunggu opname penutup" }
          : { tone: "danger", text: `Losses ${pct(x.glPct, 2)} — di atas ambang 0,5%/100 L` },
      );
    if (x.gas.below && x.gas.deltaPt !== null)
      notes.push({ tone: "warning", text: `Bauran gasoline ${idn(Math.abs(x.gas.deltaPt), 1)} pt di bawah target` });
    if (x.oil.below && x.oil.deltaPt !== null)
      notes.push({ tone: "warning", text: `Bauran gasoil ${idn(Math.abs(x.oil.deltaPt), 1)} pt di bawah target` });
    if (x.shift.shifts < 3)
      notes.push({
        tone: "warning",
        text: `Penjualan shift ${x.shift.shifts + 1} belum diinput${x.shift.last_dtgljam ? ` (terakhir ${timeWib(x.shift.last_dtgljam)} WIB)` : ""}`,
      });
    if (notes.length === 0) notes.push({ tone: "success", text: "Semua modul aktif terinput tepat waktu" });

    return {
      rank: i + 1,
      code: x.u.code,
      dotted: unitDotted(x.u.code),
      name: x.u.name,
      omzet: rpShort(x.totals.omzet),
      vol: fmtKL(x.totals.vol),
      gl: x.glPct !== null ? `${signed(x.glPct * 100, 2)}%` : "—",
      glAbnormal: x.glAbnormal,
      glProvisional: x.glProvisional,
      rg: x.gas.actual !== null ? pct(x.gas.actual) : "—",
      inputTone: x.shift.shifts >= 3 ? "success" : x.shift.shifts > 0 ? "warning" : "danger",
      inputLabel: x.shift.shifts >= 3 ? "3/3 shift" : `${x.shift.shifts}/3 · belum lengkap`,
      products: x.products
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
      laporanHref: `/unit/${x.u.code}/laporan/${today}`,
    };
  });

  const lastShift = perUnit
    .map((x) => x.shift.last_dtgljam)
    .filter((x): x is string => x !== null)
    .sort()
    .pop();

  return {
    kpi: {
      omzet,
      delta,
      volG,
      volD,
      glGroupPct,
      confirmedAbnormal,
      provisionalUnits,
      shiftsDone,
      shiftsTarget,
      bolongNames: bolong.map((x) => x.u.name),
    },
    verdict: { headline: verdictHeadline(chips), chips },
    spark: { pts, trendAvg, days: sparkDays, vals: sparkVals },
    ratios: { rg, rd, gasGroup, oilGroup },
    ranking,
    anomalies,
    lastShift,
    unitsCount: perUnit.length,
  };
}
