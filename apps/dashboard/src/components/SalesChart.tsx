import type { DailySales } from "@/lib/queries";

/**
 * Bar chart volume harian — SVG server-rendered, tanpa library.
 * Tooltip native via <title>.
 */
export function SalesChart({ data }: { data: DailySales[] }) {
  if (data.length === 0) {
    return <div className="empty">Belum ada data penjualan pada rentang ini.</div>;
  }
  const W = Math.max(640, data.length * 26);
  const H = 160;
  const PAD = 24;
  const maxVol = Math.max(...data.map((d) => d.vol), 1);
  const bw = (W - PAD * 2) / data.length;

  return (
    <div className="chart-wrap">
      <svg width={W} height={H + 30} role="img" aria-label="Volume harian">
        {data.map((d, i) => {
          const h = Math.round((d.vol / maxVol) * H);
          const x = PAD + i * bw;
          return (
            <g key={d.d}>
              <rect
                x={x + 2}
                y={H - h + 10}
                width={Math.max(bw - 4, 3)}
                height={h}
                rx={2}
                fill="var(--accent)"
                opacity={0.85}
              >
                <title>
                  {d.d}: {Math.round(d.vol).toLocaleString("id-ID")} L —{" "}
                  Rp {Math.round(d.omzet).toLocaleString("id-ID")}
                </title>
              </rect>
              {i % Math.ceil(data.length / 10) === 0 && (
                <text
                  x={x + bw / 2}
                  y={H + 24}
                  fontSize={10}
                  fill="var(--muted)"
                  textAnchor="middle"
                >
                  {d.d.slice(5)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="legend">
        Volume liter per hari bisnis (DTGLJUAL — shift 3 lewat tengah malam masuk
        hari bisnisnya). Arahkan kursor untuk detail.
      </div>
    </div>
  );
}
