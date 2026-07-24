/**
 * Grafik Laporan Harian — SVG inline, dihitung server-side dari model yang sama
 * dengan tabel & PDF. Tak ada pustaka chart, tak ada canvas raster.
 *
 * Pie SENGAJA TIDAK ADA (keputusan owner №6): pie 3-D di laporan Excel menutupi
 * 2 dari 7 labelnya dan membandingkan luas dalam perspektif tidak pernah jujur.
 * Penggantinya bar 100 % + nilai + persen — bisa dibaca, bisa diurutkan.
 */
import { idn, pct } from "@/lib/format";
import type { ShareRow, TrendMonth, UnitStatus } from "@/lib/harian-model";

/** Palet aman-grayscale: 7 langkah kontras berbeda (bukan hue saja). */
const SERIES = [
  "var(--chart-1, #1f3d7a)",
  "var(--chart-2, #a3172b)",
  "var(--chart-3, #1668b3)",
  "var(--chart-4, #1f8a53)",
  "var(--chart-5, #3fb6c4)",
  "var(--chart-6, #4a2f8f)",
  "var(--chart-7, #d9a400)",
];
export const seriesColor = (i: number): string => SERIES[i % SERIES.length]!;

// ---------------------------------------------------------------------------

export function ShareBars({ share, incomplete }: { share: ShareRow[]; incomplete: boolean }) {
  const max = Math.max(1, ...share.map((s) => s.kum));
  return (
    <div className="mt10">
      <div className="section-h">
        <div className="text-h5 t-brand">Kontribusi per SPBU — bulan berjalan</div>
        <span className="fs16 t-tertiary">kumulatif liter &amp; rata-rata per hari</span>
      </div>
      <div className="card card-pad-lg mt5">
        {share.map((s, i) => (
          <div key={s.unitId} className="harian-share-row">
            <div className="fs16 t-primary harian-share-name">{s.name}</div>
            <div className="harian-share-track">
              <div
                className="harian-share-fill"
                style={{ width: `${(s.kum / max) * 100}%`, background: seriesColor(i) }}
              />
            </div>
            <div className="fs16 w600 num right">{idn(Math.round(s.kum))}</div>
            <div className="fs15 t-tertiary num right">{idn(Math.round(s.avg))}/hari</div>
            <div className="fs16 w600 num right">{s.pct === null ? "—" : pct(s.pct, 1)}</div>
          </div>
        ))}
        {incomplete && (
          <div className="fs15 t-warning mt3">
            ⚠ Porsi dihitung dari TOTAL yang belum lengkap — unit yang tertinggal tampak lebih kecil
            dari sebenarnya.
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Bar divergen G/L MTD per unit. Semua unit memakai KUMULATIF — cacat #2
 *  laporan Excel (satu unit memakai Rata-Rata sehingga tampak nyaris nol). */
export function GlBars({
  units,
  totals,
}: {
  units: UnitStatus[];
  totals: Record<number, { kum: number; avg: number }>;
}) {
  const vals = units.map((u) => totals[u.unitId]?.kum ?? 0);
  const max = Math.max(1, ...vals.map((v) => Math.abs(v)));
  return (
    <div className="mt10">
      <div className="section-h">
        <div className="text-h5 t-brand">Gain / Losses kumulatif bulan berjalan</div>
        <span className="fs16 t-tertiary">semua unit memakai nilai Kumulatif (liter)</span>
      </div>
      <div className="card card-pad-lg mt5">
        {units.map((u, i) => {
          const v = totals[u.unitId]?.kum ?? 0;
          const w = (Math.abs(v) / max) * 50;
          return (
            <div key={u.unitId} className="harian-gl-row">
              <div className="fs16 t-primary harian-gl-name">
                {u.stale && <span aria-hidden>⚠ </span>}
                {u.name}
              </div>
              <div className="harian-gl-track">
                <div className="harian-gl-zero" />
                <div
                  className="harian-gl-fill"
                  style={{
                    left: v < 0 ? `${50 - w}%` : "50%",
                    width: `${w}%`,
                    background: v < 0 ? "var(--color-danger)" : seriesColor(i),
                  }}
                />
              </div>
              <div className={`fs16 w600 num right ${v < 0 ? "t-danger" : ""}`}>
                {v < 0 ? `(${idn(Math.round(Math.abs(v)))})` : idn(Math.round(v))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const W = 900;
const H = 260;
const PAD_L = 44;
const PAD_B = 34;
const PAD_T = 16;

/**
 * Combo 13 bulan: batang per unit + garis TOTAL. Satuan **KL** — laporan Excel
 * memberi judul "(Dalam Ton)" padahal angkanya KL (TOTAL Juli 6.445 = 6.446.221 L
 * ÷ 1000); tak ada konversi densitas di mana pun. Nol asumsi: kami menulis KL.
 */
export function TrendCombo({
  units,
  months,
  yMax,
  mode,
  title,
}: {
  units: UnitStatus[];
  months: TrendMonth[];
  yMax: number;
  mode: "kum" | "avg";
  title: string;
}) {
  const plotW = W - PAD_L - 8;
  const plotH = H - PAD_T - PAD_B;
  const slot = plotW / months.length;
  const barW = Math.max(2, (slot * 0.72) / Math.max(1, units.length));
  const y = (v: number) => PAD_T + plotH - (v / yMax) * plotH;

  const pick = (m: TrendMonth, id: number): number | null =>
    mode === "kum" ? m.byUnit[id] ?? null : m.avgByUnit[id] ?? null;
  const total = (m: TrendMonth): number => (mode === "kum" ? m.totalKl : m.avgTotalKl);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const line = months
    .map((m, i) => `${PAD_L + i * slot + slot / 2},${y(total(m))}`)
    .join(" ");

  return (
    <div className="card card-pad-lg mt5">
      <div className="text-caption w600 t-secondary">{title}</div>
      <div className="harian-chart-scroll mt3">
        <svg viewBox={`0 0 ${W} ${H}`} className="harian-chart" role="img" aria-label={title}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={PAD_L} y1={y(t)} x2={W - 8} y2={y(t)} stroke="var(--color-border-hairline)" />
              <text x={PAD_L - 6} y={y(t) + 4} textAnchor="end" className="harian-axis">
                {idn(Math.round(t))}
              </text>
            </g>
          ))}
          {months.map((m, mi) => {
            const x0 = PAD_L + mi * slot + slot * 0.14;
            return (
              <g key={m.ym}>
                {units.map((u, ui) => {
                  const v = pick(m, u.unitId);
                  if (v === null) return null; // belum beroperasi → TAK ADA batang
                  const h = Math.max(0, PAD_T + plotH - y(v));
                  return (
                    <rect
                      key={u.unitId}
                      x={x0 + ui * barW}
                      y={y(v)}
                      width={Math.max(1, barW - 0.8)}
                      height={h}
                      fill={seriesColor(ui)}
                      opacity={m.partial ? 0.55 : 1}
                    />
                  );
                })}
                <text
                  x={PAD_L + mi * slot + slot / 2}
                  y={H - PAD_B + 16}
                  textAnchor="middle"
                  className="harian-axis"
                >
                  {m.label}
                </text>
                {m.partial && (
                  <text
                    x={PAD_L + mi * slot + slot / 2}
                    y={H - PAD_B + 28}
                    textAnchor="middle"
                    className="harian-axis-sub"
                  >
                    parsial
                  </text>
                )}
              </g>
            );
          })}
          <polyline points={line} fill="none" stroke="var(--color-text-primary)" strokeWidth={1.8} />
          {months.map((m, i) => (
            <circle
              key={m.ym}
              cx={PAD_L + i * slot + slot / 2}
              cy={y(total(m))}
              r={2.6}
              fill="var(--color-text-primary)"
            />
          ))}
        </svg>
      </div>
      <div className="harian-legend mt3">
        {units.map((u, i) => (
          <span key={u.unitId} className="harian-legend-item fs15 t-secondary">
            <i style={{ background: seriesColor(i) }} />
            {u.name}
          </span>
        ))}
        <span className="harian-legend-item fs15 t-secondary">
          <i style={{ background: "var(--color-text-primary)" }} />
          TOTAL
        </span>
      </div>
    </div>
  );
}

export function TrendSection({
  units,
  months,
  yMaxKum,
  yMaxAvg,
}: {
  units: UnitStatus[];
  months: TrendMonth[];
  yMaxKum: number;
  yMaxAvg: number;
}) {
  return (
    <div className="mt10">
      <div className="section-h">
        <div className="text-h5 t-brand">Penjualan 13 bulan terakhir</div>
        <span className="fs16 t-tertiary">
          satuan <b>KL</b> (kilo liter) · bulan berjalan dipotong di tanggal laporan
        </span>
      </div>
      <TrendCombo units={units} months={months} yMax={yMaxKum} mode="kum" title="Kumulatif per bulan (KL)" />
      <TrendCombo units={units} months={months} yMax={yMaxAvg} mode="avg" title="Rata-rata per hari (KL/hari)" />
    </div>
  );
}
