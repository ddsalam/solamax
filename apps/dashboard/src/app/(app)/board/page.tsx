import Link from "next/link";
import { AnomalyFeed } from "@/components/AnomalyFeed";
import { BoardExport } from "@/components/board/BoardExport";
import { RankingTable } from "@/components/board/RankingTable";
import { buildAnomalies } from "@/lib/anomalies";
import { buildBoardModel } from "@/lib/board-model";
import { aggregateDailyGl, bauranVsTarget, glPercent } from "@/lib/derive";
import { dateLong, dateShort, fmtKL, pct, rpShort, signed, timeWib } from "@/lib/format";
import { addDays, monthInfo, resolvePeriod, todayWib, type PeriodKey } from "@/lib/periods";
import {
  getDailyGlByProduct,
  getDailyOmzet,
  getSalesByProduct,
  getSalesTotals,
  getShiftInfo,
} from "@/lib/queries";
import { getDataScope } from "@/lib/scope";

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
  const scope = await getDataScope();
  const units = scope.units;

  if (units.length === 0) {
    return <BoardEmpty />;
  }

  // ===== Per-unit data =====
  const perUnit = await Promise.all(
    units.map(async (u) => {
      const [products, totals, prevTotals, glRows, shift, daily] = await Promise.all([
        getSalesByProduct(u.unit_id, period.from, period.to),
        getSalesTotals(u.unit_id, period.from, period.to),
        getSalesTotals(u.unit_id, period.prevFrom, period.prevTo),
        // G/L metode RESUME (reuse laporan harian): Σ baris harian per produk pada
        // rentang periode. Anchor Fisik(D−1) ditangani di query (lag lewat `from`).
        getDailyGlByProduct(u.unit_id, period.from, period.to),
        getShiftInfo(u.unit_id, today),
        getDailyOmzet(u.unit_id, addDays(today, -13), today),
      ]);
      const gl = aggregateDailyGl(glRows);
      const glPct = gl.hasGl ? glPercent(gl.totalSigned, totals.vol) : null;
      // Abnormal grup/unit = di atas ambang ±0,5% (selaras cek bulanan laporan &
      // teks KPI card). RESUME per-produk-hari di-rollup → satu angka per unit.
      const glAbnormal = glPct !== null && Math.abs(glPct) > 0.005;
      const glProvisional = gl.provisional;
      const gas = bauranVsTarget(products, u.code, month, "gasoline");
      const oil = bauranVsTarget(products, u.code, month, "gasoil");
      return { u, products, totals, prevTotals, glPct, glAbnormal, glProvisional, gas, oil, shift, daily };
    }),
  );

  const hasData = perUnit.some((x) => x.totals.vol > 0);
  if (!hasData) return <BoardEmpty />;

  // SUMBER TUNGGAL: model dari perUnit (HANYA unit ber-scope) dipakai render layar
  // DAN ekspor PDF → PDF memuat hanya unit yang boleh dilihat caller (principle 11).
  const anomalies = await buildAnomalies(units);
  const model = buildBoardModel(
    { perUnit, anomalies },
    { firstUnitCode: units[0]!.code, month, today },
  );
  const { kpi, verdict, spark, ratios } = model;
  const {
    omzet,
    delta,
    volG,
    volD,
    glGroupPct,
    confirmedAbnormal,
    provisionalUnits,
    shiftsDone,
    shiftsTarget,
    bolongNames,
  } = kpi;
  const chips = verdict.chips;
  const { pts, trendAvg } = spark;
  const { rg, rd, gasGroup, oilGroup } = ratios;
  const rows = model.ranking;
  const lastShift = model.lastShift;

  const generatedDate = today;
  const exportMeta = {
    dateLong: dateLong(today),
    periodLabel: period.label,
    unitsCount: model.unitsCount,
    generatedLabel: `${dateShort(today)} · ${timeWib(new Date().toISOString())}`,
  };

  return (
    <div>
      <BoardExport generatedDate={generatedDate} model={model} meta={exportMeta} />

      {/* Verdict + periode */}
      <div className="board-head">
        <div>
          <div className="text-eyebrow t-tertiary">
            Tanggal bisnis · {dateLong(today)}
            {lastShift ? ` · input terakhir ${timeWib(lastShift)} WIB` : ""}
          </div>
          <h1 className="text-h3 t-brand mt2 verdict-h">{verdict.headline}</h1>
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
            <span
              className={`dot ${confirmedAbnormal > 0 ? "danger" : provisionalUnits > 0 ? "warning" : "success"}`}
            />
            <span>
              {confirmedAbnormal > 0
                ? `${confirmedAbnormal} unit di atas ambang ±0,5%`
                : provisionalUnits > 0
                  ? "sebagian sementara — menunggu opname"
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
            <span className={`dot ${bolongNames.length > 0 ? "warning" : "success"}`} />
            <span>
              shift terinput hari ini
              {bolongNames.length > 0 ? ` · ${bolongNames.join(", ")} belum` : ""}
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
