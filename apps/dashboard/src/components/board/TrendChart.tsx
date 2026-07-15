"use client";

/**
 * Tren omset/volume mengikuti filter (pengganti sparkline 14-hari statis).
 * Toggle Rp ↔ Liter (state tampilan lokal, bukan URL); multi-seri per unit
 * saat mode Perbandingan. Skala-Y berbasis 0 agar antar-seri jujur dibanding.
 */
import { useState } from "react";
import { fmtKL, rpShort, dateShort } from "@/lib/format";
import type { TrendModel } from "@/lib/board-model";

const W = 560;
const H = 140;
const PAD_Y = 8;

export function TrendChart({ trend, banding }: { trend: TrendModel; banding: boolean }) {
  const [vu, setVu] = useState<"rp" | "liter">("rp");
  const { days, series, avgRp, avgLiter, note } = trend;
  const n = days.length;

  const vals = (s: TrendModel["series"][number]) => (vu === "rp" ? s.rp : s.liter);
  const maxV = Math.max(1, ...series.flatMap((s) => vals(s)));
  const pts = (s: TrendModel["series"][number]): string =>
    vals(s)
      .map((v, i) => {
        const x = n > 1 ? (i * W) / (n - 1) : W / 2;
        const y = H - PAD_Y - (v / maxV) * (H - PAD_Y * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  return (
    <div className="card card-pad trend-card mt4">
      <div className="trend-meta">
        <div className="text-caption t-tertiary">
          Tren {vu === "rp" ? "omset" : "volume"} · {n} hari
        </div>
        <div className="text-h5 num mt1">{vu === "rp" ? rpShort(avgRp) : fmtKL(avgLiter)}</div>
        <div className="fs16 t-tertiary">rata-rata / hari</div>
        <div className="seg mt3 trend-toggle">
          {(
            [
              { k: "rp" as const, label: "Rp" },
              { k: "liter" as const, label: "Liter" },
            ]
          ).map(({ k, label }) => (
            <button
              key={k}
              type="button"
              className={`seg-btn${vu === k ? " active" : ""}`}
              onClick={() => setVu(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="trend-body">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="trend-svg trend-svg-tall"
          preserveAspectRatio="none"
          role="img"
          aria-label={`Tren ${vu === "rp" ? "omset" : "volume"} mengikuti filter`}
        >
          <line x1="0" y1={H - PAD_Y} x2={W} y2={H - PAD_Y} className="trend-axis" />
          {series.length === 1 ? (
            <>
              <polygon points={`0,${H - PAD_Y} ${pts(series[0]!)} ${W},${H - PAD_Y}`} className="spark-area" />
              <polyline points={pts(series[0]!)} className="spark-line" />
            </>
          ) : (
            series.map((s, i) => (
              <polyline key={s.code} points={pts(s)} className={`trend-line trend-s${i % 6}`} />
            ))
          )}
        </svg>
        <div className="trend-foot">
          <span className="fs15 t-tertiary">{dateShort(days[0]!)}</span>
          {banding && series.length > 1 && (
            <div className="trend-legend">
              {series.map((s, i) => (
                <span key={s.code} className="fs15 t-secondary trend-legend-item">
                  <span className={`trend-swatch trend-s${i % 6}`} />
                  {s.name}
                </span>
              ))}
            </div>
          )}
          {note && <span className="fs15 t-warning">{note}</span>}
          <span className="fs15 t-tertiary">{dateShort(days[n - 1]!)}</span>
        </div>
      </div>
    </div>
  );
}
