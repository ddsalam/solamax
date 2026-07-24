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
        {units.map((u) => {
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
                {/* Warna HANYA menyandikan TANDA. Memakai palet per-unit di sini
                    membuat unit ke-2 (merah) tampak rugi padahal untung — cacat
                    yang tertangkap saat pemeriksaan render, bukan oleh test. */}
                <div
                  className="harian-gl-fill"
                  style={{
                    left: v < 0 ? `${50 - w}%` : "50%",
                    width: `${w}%`,
                    background: v < 0 ? "var(--color-danger)" : "var(--color-success)",
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
const H = 268;
const PAD_L = 46;
/** Ruang untuk sumbu KANAN (TOTAL) — tanpa ini tick-nya terpotong. */
const PAD_R = 52;
const PAD_B = 34;
const PAD_T = 22;

/**
 * Sumbu-Y "bulat": 4 tick, langkah dari tangga mantissa yang cukup rapat agar
 * puncak data tak pernah tenggelam di separuh bawah grafik. Tangga kasar
 * (1/2/5 saja) memberi maks 20.000 untuk data 9.206 — setengah bidang kosong,
 * tertangkap saat pemeriksaan render.
 */
const NICE_STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
export function niceAxisMax(v: number): number {
  if (v <= 0) return 1;
  const step0 = v / 4;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = NICE_STEPS.map((k) => k * mag).find((s) => s >= step0) ?? 10 * mag;
  return step * 4;
}

/**
 * Tren 13 bulan — BATANG per unit (sumbu KIRI) + GARIS TOTAL (sumbu KANAN).
 * Satuan **KL** — laporan Excel memberi judul "(Dalam Ton)" padahal angkanya KL
 * (TOTAL Juli 6.445 = 6.446.221 L ÷ 1000); tak ada konversi densitas di mana pun.
 *
 * SUMBU GANDA, DENGAN SENGAJA DAN DIBERI LABEL (keputusan owner D6). Batang
 * per-unit (~1.500 KL) dan TOTAL grup (~9.200 KL) berbeda orde; satu sumbu
 * bersama membuat batangnya tenggelam tak terbaca. Bentuk ini yang dibaca
 * direksi tiap hari, jadi bentuknya dipertahankan — TETAPI cacat Excel-nya
 * diperbaiki: di sana skala keduanya disembunyikan, di sini KEDUA sumbu diberi
 * label eksplisit ("KL per unit" kiri, "KL TOTAL" kanan) dan tick-nya dicetak.
 * Sumbu ganda yang berlabel bukan tipuan; yang menyesatkan adalah yang
 * disembunyikan. (Varian batang-bertumpuk sempat dibangun & ditolak owner —
 * kandidat backlog bernama "tren tumpuk satu-sumbu", jangan dihidupkan diam-diam.)
 */
export function TrendCombo({
  units,
  months,
  barMax,
  totalMax,
  mode,
  title,
}: {
  units: UnitStatus[];
  months: TrendMonth[];
  /** Nilai per-unit terbesar → skala sumbu KIRI. */
  barMax: number;
  /** TOTAL grup terbesar → skala sumbu KANAN. */
  totalMax: number;
  mode: "kum" | "avg";
  title: string;
}) {
  const plotW = W - PAD_L - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const slot = plotW / months.length;
  const barW = Math.max(1.5, (slot * 0.74) / Math.max(1, units.length));
  const leftMax = niceAxisMax(barMax);
  const rightMax = niceAxisMax(totalMax);
  /** Sumbu KIRI (batang). */
  const yL = (v: number) => PAD_T + plotH - (v / leftMax) * plotH;
  /** Sumbu KANAN (garis TOTAL) — skala BERBEDA, karena itu diberi label. */
  const yR = (v: number) => PAD_T + plotH - (v / rightMax) * plotH;

  const pick = (m: TrendMonth, id: number): number | null =>
    mode === "kum" ? m.byUnit[id] ?? null : m.avgByUnit[id] ?? null;
  const total = (m: TrendMonth): number => (mode === "kum" ? m.totalKl : m.avgTotalKl);
  const fr = [0, 0.25, 0.5, 0.75, 1];
  const line = months.map((m, i) => `${PAD_L + i * slot + slot / 2},${yR(total(m))}`).join(" ");

  return (
    <div className="card card-pad-lg mt5">
      <div className="text-caption w600 t-secondary">{title}</div>
      <div className="harian-chart-scroll mt3">
        <svg viewBox={`0 0 ${W} ${H}`} className="harian-chart" role="img" aria-label={title}>
          {/* Judul kedua sumbu — inilah yang membuat skala ganda jadi jujur. */}
          <text x={2} y={PAD_T - 5} className="harian-axis-title">
            KL per unit ▮
          </text>
          <text x={W - 2} y={PAD_T - 5} textAnchor="end" className="harian-axis-title">
            ▬ KL TOTAL grup
          </text>
          {fr.map((f, i) => (
            <g key={i}>
              <line
                x1={PAD_L}
                y1={PAD_T + plotH - f * plotH}
                x2={W - PAD_R}
                y2={PAD_T + plotH - f * plotH}
                stroke="var(--color-border-hairline)"
              />
              <text x={PAD_L - 6} y={PAD_T + plotH - f * plotH + 4} textAnchor="end" className="harian-axis">
                {idn(Math.round(f * leftMax))}
              </text>
              <text
                x={W - PAD_R + 6}
                y={PAD_T + plotH - f * plotH + 4}
                className="harian-axis harian-axis-right"
              >
                {idn(Math.round(f * rightMax))}
              </text>
            </g>
          ))}
          {months.map((m, mi) => {
            const cx = PAD_L + mi * slot + slot / 2;
            const x0 = cx - (barW * units.length) / 2;
            return (
              <g key={m.ym}>
                {units.map((u, ui) => {
                  const v = pick(m, u.unitId);
                  if (v === null) return null; // belum beroperasi → TAK ADA batang
                  const yTop = yL(v);
                  return (
                    <rect
                      key={u.unitId}
                      x={x0 + ui * barW}
                      y={yTop}
                      width={Math.max(1, barW - 0.8)}
                      height={Math.max(0, PAD_T + plotH - yTop)}
                      fill={seriesColor(ui)}
                      opacity={m.partial ? 0.6 : 1}
                    />
                  );
                })}
                <text x={cx} y={H - PAD_B + 16} textAnchor="middle" className="harian-axis">
                  {m.label}
                </text>
                {m.partial && (
                  <text x={cx} y={H - PAD_B + 28} textAnchor="middle" className="harian-axis-sub">
                    parsial
                  </text>
                )}
              </g>
            );
          })}
          <polyline points={line} fill="none" stroke="var(--color-text-primary)" strokeWidth={1.8} />
          {months.map((m, i) => (
            <g key={m.ym}>
              <circle
                cx={PAD_L + i * slot + slot / 2}
                cy={yR(total(m))}
                r={2.6}
                fill="var(--color-text-primary)"
              />
              <text
                x={PAD_L + i * slot + slot / 2}
                y={yR(total(m)) - 7}
                textAnchor="middle"
                className="harian-axis-val"
              >
                {idn(Math.round(total(m)))}
              </text>
            </g>
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
          <i className="harian-legend-line" />
          TOTAL grup (sumbu kanan)
        </span>
      </div>
    </div>
  );
}

export function TrendSection({
  units,
  months,
  barMaxKum,
  totalMaxKum,
  barMaxAvg,
  totalMaxAvg,
}: {
  units: UnitStatus[];
  months: TrendMonth[];
  barMaxKum: number;
  totalMaxKum: number;
  barMaxAvg: number;
  totalMaxAvg: number;
}) {
  return (
    <div className="mt10">
      <div className="section-h">
        <div className="text-h5 t-brand">Penjualan 13 bulan terakhir</div>
        <span className="fs16 t-tertiary">
          satuan <b>KL</b> (kilo liter) · <b>dua skala</b>: batang = sumbu kiri, garis TOTAL = sumbu
          kanan · bulan berjalan dipotong di tanggal laporan
        </span>
      </div>
      <TrendCombo
        units={units}
        months={months}
        barMax={barMaxKum}
        totalMax={totalMaxKum}
        mode="kum"
        title="Kumulatif per bulan (KL)"
      />
      <TrendCombo
        units={units}
        months={months}
        barMax={barMaxAvg}
        totalMax={totalMaxAvg}
        mode="avg"
        title="Rata-rata per hari (KL/hari)"
      />
    </div>
  );
}
