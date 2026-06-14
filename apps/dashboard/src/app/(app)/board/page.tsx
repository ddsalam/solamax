import Link from "next/link";
import { AnomalyFeed } from "@/components/AnomalyFeed";
import { RankingTable, type RankRow } from "@/components/board/RankingTable";
import { buildAnomalies } from "@/lib/anomalies";
import { classifyProduct, unitDotted } from "@/lib/config";
import {
  aggregateClosingGl,
  bauranVsTarget,
  glPercent,
  verdictHeadline,
  type BauranStatus,
  type VerdictChip,
} from "@/lib/derive";
import { dateLong, fmtKL, idn, pct, rpShort, signed, timeWib } from "@/lib/format";
import { addDays, monthInfo, resolvePeriod, todayWib, type PeriodKey } from "@/lib/periods";
import {
  getClosingOpname,
  getDailyOmzet,
  getSalesByProduct,
  getSalesTotals,
  getShiftInfo,
  getUnits,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

const PERIODS: PeriodKey[] = ["today", "week", "month"];

export default async function BoardPage({
  searchParams,
}: {
  searchParams: { p?: string };
}) {
  const pkey: PeriodKey = PERIODS.includes(searchParams.p as PeriodKey)
    ? (searchParams.p as PeriodKey)
    : "today";
  const period = resolvePeriod(pkey);
  const today = todayWib();
  const { month } = monthInfo(today);
  const units = await getUnits();

  if (units.length === 0) {
    return <BoardEmpty />;
  }

  // ===== Per-unit data =====
  const perUnit = await Promise.all(
    units.map(async (u) => {
      const [products, totals, prevTotals, closing, shift, daily] = await Promise.all([
        getSalesByProduct(u.unit_id, period.from, period.to),
        getSalesTotals(u.unit_id, period.from, period.to),
        getSalesTotals(u.unit_id, period.prevFrom, period.prevTo),
        getClosingOpname(u.unit_id, period.from, period.to),
        getShiftInfo(u.unit_id, today),
        getDailyOmzet(u.unit_id, addDays(today, -13), today),
      ]);
      const gl = aggregateClosingGl(closing);
      const glPct = glPercent(gl.totalSigned, totals.vol);
      const glAbnormal = gl.abnormal.length > 0;
      const gas = bauranVsTarget(products, u.code, month, "gasoline");
      const oil = bauranVsTarget(products, u.code, month, "gasoil");
      return { u, products, totals, prevTotals, glPct, glAbnormal, gas, oil, shift, daily };
    }),
  );

  const hasData = perUnit.some((x) => x.totals.vol > 0);
  if (!hasData) return <BoardEmpty />;

  // ===== KPI grup =====
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
  const glAll = perUnit.reduce(
    (s, x) => s + (x.glPct !== null ? x.glPct * x.totals.vol : 0),
    0,
  );
  const glGroupPct = totalVol > 0 ? glAll / totalVol : null;
  const abnormalUnits = perUnit.filter((x) => x.glAbnormal).length;

  const shiftsDone = perUnit.reduce((s, x) => s + Math.min(x.shift.shifts, 3), 0);
  const shiftsTarget = units.length * 3;
  const bolong = perUnit.filter((x) => x.shift.shifts < 3);

  // ===== Verdict chips =====
  const chips: VerdictChip[] = [];
  for (const x of perUnit) {
    if (x.glAbnormal && x.glPct !== null) {
      chips.push({ tone: "danger", text: `Losses ${x.u.name} ${pct(x.glPct, 2)}` });
    }
  }
  const gasBelow = perUnit.filter((x) => x.gas.below).length;
  const oilBelow = perUnit.filter((x) => x.oil.below).length;
  if (gasBelow + oilBelow > 0) {
    chips.push({ tone: "warning", text: "Bauran NPSO di bawah target" });
  }
  for (const x of bolong) {
    chips.push({ tone: "warning", text: `${x.u.name}: shift ${x.shift.shifts}/3` });
  }

  // ===== Sparkline grup 14 hari =====
  const sparkMap = new Map<string, number>();
  for (const x of perUnit)
    for (const d of x.daily) sparkMap.set(d.d, (sparkMap.get(d.d) ?? 0) + d.omzet);
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

  // ===== Ratio lists =====
  const mkRatio = (key: "gas" | "oil") => {
    const sorted = [...perUnit]
      .filter((x) => x[key].actual !== null)
      .sort((a, b) => (b[key].actual ?? 0) - (a[key].actual ?? 0));
    const scaleMax = Math.max(...sorted.map((x) => x[key].actual ?? 0), ...sorted.map((x) => x[key].target ?? 0), 0.01) * 1.15;
    return sorted.map((x, i) => {
      const st = x[key] as BauranStatus;
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
  const gasGroup = bauranVsTarget(
    perUnit.flatMap((x) => x.products),
    units[0]!.code,
    month,
    "gasoline",
  );
  const oilGroup = bauranVsTarget(
    perUnit.flatMap((x) => x.products),
    units[0]!.code,
    month,
    "gasoil",
  );

  // ===== Ranking rows =====
  const ranked = [...perUnit].sort((a, b) => b.totals.omzet - a.totals.omzet);
  const rows: RankRow[] = ranked.map((x, i) => {
    const maxP = Math.max(...x.products.map((p) => p.vol), 1);
    const sparkVals14 = sparkDays.map((d) => x.daily.find((dd) => dd.d === d)?.omzet ?? 0);
    const sMax = Math.max(...sparkVals14, 1);
    const notes: RankRow["notes"] = [];
    if (x.glAbnormal && x.glPct !== null)
      notes.push({ tone: "danger", text: `Losses ${pct(x.glPct, 2)} — di atas ambang 0,5%/100 L` });
    if (x.gas.below && x.gas.deltaPt !== null)
      notes.push({ tone: "warning", text: `Bauran gasoline ${idn(Math.abs(x.gas.deltaPt), 1)} pt di bawah target` });
    if (x.oil.below && x.oil.deltaPt !== null)
      notes.push({ tone: "warning", text: `Bauran gasoil ${idn(Math.abs(x.oil.deltaPt), 1)} pt di bawah target` });
    if (x.shift.shifts < 3)
      notes.push({
        tone: "warning",
        text: `Penjualan shift ${x.shift.shifts + 1} belum diinput${x.shift.last_dtgljam ? ` (terakhir ${timeWib(x.shift.last_dtgljam)} WIB)` : ""}`,
      });
    if (notes.length === 0)
      notes.push({ tone: "success", text: "Semua modul aktif terinput tepat waktu" });

    return {
      rank: i + 1,
      code: x.u.code,
      dotted: unitDotted(x.u.code),
      name: x.u.name,
      omzet: rpShort(x.totals.omzet),
      vol: fmtKL(x.totals.vol),
      gl: x.glPct !== null ? `${signed(x.glPct * 100, 2)}%` : "—",
      glAbnormal: x.glAbnormal,
      rg: x.gas.actual !== null ? pct(x.gas.actual) : "—",
      inputTone: x.shift.shifts >= 3 ? "success" : x.shift.shifts > 0 ? "warning" : "danger",
      inputLabel:
        x.shift.shifts >= 3 ? "3/3 shift" : `${x.shift.shifts}/3 · belum lengkap`,
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

  const anomalies = await buildAnomalies(units);
  const lastShift = perUnit
    .map((x) => x.shift.last_dtgljam)
    .filter((x): x is string => x !== null)
    .sort()
    .pop();

  return (
    <div>
      {/* Verdict + periode */}
      <div className="board-head">
        <div>
          <div className="text-eyebrow t-tertiary">
            Tanggal bisnis · {dateLong(today)}
            {lastShift ? ` · input terakhir ${timeWib(lastShift)} WIB` : ""}
          </div>
          <h1 className="text-h3 t-brand mt2 verdict-h">{verdictHeadline(chips)}</h1>
          <div className="chip-row mt3">
            {chips.slice(0, 4).map((c, i) => (
              <span key={i} className={`chip-issue ${c.tone}`}>
                <span className={`dot ${c.tone}`} />
                {c.text}
              </span>
            ))}
          </div>
        </div>
        <div className="seg">
          {PERIODS.map((k) => (
            <Link key={k} href={`/board?p=${k}`} className={`seg-btn${pkey === k ? " active" : ""}`}>
              {k === "today" ? "Hari ini" : k === "week" ? "7 hari" : "30 hari"}
            </Link>
          ))}
        </div>
      </div>

      {/* KPI */}
      <div className="kpi-grid mt8">
        <div className="kpi-card">
          <div className="text-caption t-tertiary">Omset penjualan</div>
          <div className="text-h2 t-primary num mt2">{rpShort(omzet)}</div>
          <div className="kpi-note">
            {delta !== null ? (
              <>
                <span className={delta >= 0 ? "kpi-delta-up" : "kpi-delta-down"}>
                  {delta >= 0 ? "▲" : "▼"} {pct(Math.abs(delta))}
                </span>
                <span>{period.deltaVs}</span>
              </>
            ) : (
              <span>—</span>
            )}
          </div>
        </div>
        <div className="kpi-card">
          <div className="text-caption t-tertiary">Volume tersalur</div>
          <div className="text-h2 t-primary num mt2">{fmtKL(volG)}</div>
          <div className="kpi-note">gasoline · gasoil {fmtKL(volD)}</div>
        </div>
        <div className="kpi-card">
          <div className="text-caption t-tertiary">Gain / Loss</div>
          <div className="text-h2 t-primary num mt2">
            {glGroupPct !== null ? `${signed(glGroupPct * 100, 2)}%` : "—"}
          </div>
          <div className="kpi-note">
            <span className={`dot ${abnormalUnits > 0 ? "danger" : "success"}`} />
            <span>
              {abnormalUnits > 0
                ? `${abnormalUnits} unit di atas ambang ±0,5%`
                : "dalam ambang ±0,5%"}
            </span>
          </div>
        </div>
        <div className="kpi-card">
          <div className="text-caption t-tertiary">Kepatuhan input</div>
          <div className="text-h2 t-primary num mt2">
            {shiftsDone}/{shiftsTarget}
          </div>
          <div className="kpi-note">
            <span className={`dot ${bolong.length > 0 ? "warning" : "success"}`} />
            <span>
              shift terinput hari ini
              {bolong.length > 0 ? ` · ${bolong.map((x) => x.u.name).join(", ")} belum` : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Tren */}
      <div className="card card-pad trend-card mt4">
        <div className="trend-meta">
          <div className="text-caption t-tertiary">Tren omset grup · 14 hari</div>
          <div className="text-h5 num mt1">{rpShort(trendAvg)}</div>
          <div className="fs16 t-tertiary">rata-rata / hari</div>
        </div>
        <svg viewBox="0 0 560 72" className="trend-svg" preserveAspectRatio="none" role="img" aria-label="Tren omset 14 hari">
          <polygon points={`0,72 ${pts.join(" ")} 560,72`} className="spark-area" />
          <polyline points={pts.join(" ")} className="spark-line" />
        </svg>
      </div>

      {/* NPSO/PSO */}
      <div className="mt10">
        <div className="section-h">
          <div className="text-h5 t-brand">Bauran NPSO / PSO</div>
          <span className="fs16 t-tertiary">
            rasio volume non-subsidi terhadap subsidi — makin tinggi, makin sehat margin
          </span>
        </div>
        <div className="ratio-grid mt5">
          {[
            { title: "Gasoline — (Pertamax + Turbo) / Pertalite", list: rg, group: gasGroup },
            { title: "Gasoil — (Dexlite + Dex) / Solar", list: rd, group: oilGroup },
          ].map((panel) => (
            <div key={panel.title} className="card card-pad-lg">
              <div className="ratio-head">
                <div className="text-caption w600 t-secondary">{panel.title}</div>
                <div className="ratio-val">
                  <span className="text-h5 num">
                    {panel.group.actual !== null ? pct(panel.group.actual) : "—"}
                  </span>
                  {panel.group.target !== null && (
                    <span className={`fs15 w600 ${panel.group.below ? "t-warning" : "t-success"}`}>
                      target {pct(panel.group.target)}
                    </span>
                  )}
                </div>
              </div>
              <div className="ratio-rows mt4">
                {panel.list.length === 0 && (
                  <div className="empty-inline">Belum ada penjualan jenis ini pada periode.</div>
                )}
                {panel.list.map((r) => (
                  <div key={r.name} className="ratio-row">
                    <div className={`ratio-name ${r.nameCls}`}>{r.name}</div>
                    <div className="ratio-bar">
                      <div className={`ratio-fill ${r.cls}`} style={{ width: `${r.barW}%` }} />
                      {r.tickW !== null && (
                        <div className="ratio-tick" style={{ left: `${r.tickW}%` }} />
                      )}
                    </div>
                    <div className="ratio-val">
                      <span className="fs16 w600 num">{pct(r.actual)}</span>
                      {r.deltaPt !== null && (
                        <span
                          className={`fs15 w600 num ${
                            r.below ? (r.deltaPt < -4 ? "t-danger" : "t-warning") : "t-success"
                          }`}
                        >
                          {signed(r.deltaPt, 1)} pt
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Ranking */}
      <div className="mt10">
        <div className="section-h">
          <div className="text-h5 t-brand">Ranking {units.length} unit</div>
          <span className="fs16 t-tertiary">klik baris untuk drilldown produk &amp; tren unit</span>
        </div>
        <RankingTable rows={rows} />
        {units.length < 7 && (
          <div className="fs15 t-tertiary mt2">
            Pilot 1 unit — baris bertambah otomatis saat SPBU lain tersambung (siap 7 unit).
          </div>
        )}
      </div>

      {/* Anomali */}
      <div className="mt10">
        <div className="section-h">
          <div className="text-h5 t-brand">Anomali &amp; exception</div>
          <span className="fs16 t-tertiary">diurutkan dari yang paling perlu tindakan</span>
        </div>
        <div className="mt5">
          <AnomalyFeed items={anomalies} withLinks={false} />
        </div>
      </div>

      <div className="page-foot mt8">
        <span>
          Sumber: EasyMax POS · sinkron tiap 1–5 menit · angka dengan ⟳ pernah dikoreksi (revisi
          totalisator)
        </span>
        <span>Zona waktu WIB (Asia/Pontianak)</span>
      </div>
    </div>
  );
}

function BoardEmpty() {
  return (
    <div className="empty-hero">
      <div className="empty-hero-icon">—</div>
      <div className="text-h5 t-primary mt5">Belum ada data untuk tanggal bisnis ini</div>
      <p className="text-body t-secondary empty-hero-p">
        Shift 1 baru dibuka dan sinkronisasi pertama belum masuk. Data muncul otomatis 1–5 menit
        setelah pengawas menginput di EasyMax.
      </p>
      <div className="empty-hero-cta">
        <Link href="/board?p=week" className="btn-navy">
          Lihat 7 hari
        </Link>
        <Link href="/board" className="btn-outline">
          Muat ulang
        </Link>
      </div>
    </div>
  );
}
