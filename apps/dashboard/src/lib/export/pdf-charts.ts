/**
 * Chart vektor pdfmake (canvas) untuk board — sparkline (polyline), bar (rect),
 * dot (ellipse). Semua digambar dari angka yang sudah dihitung server-side →
 * deterministik, tajam di segala zoom, tanpa PNG/headless. Dibedakan aman-grayscale
 * (abu-abu berbeda) + selalu didampingi label/nilai oleh pemanggil.
 */
import type { Content } from "pdfmake/interfaces";
import { PDF } from "./pdf-tokens";

/**
 * Sparkline: SATU polyline (garis), dari nilai mentah.
 *
 * PENTING (root-cause blocker board): elemen `canvas` pdfmake dgn BANYAK op
 * MENUMPUK op secara vertikal — op ke-2 di-offset sebesar tinggi op sebelumnya
 * (rect(h) → polyline tergambar +h di bawahnya). Versi lama (area-polyline + line
 * + rect-anchor = 3 op) karena itu menggambar garis ~h di bawah box-nya, menimpa
 * section berikutnya. SATU op polyline ter-colokasi dgn benar & tinggi box otomatis
 * ter-reserve dari extent titik → JANGAN tambah op (rect/area) ke canvas ini.
 * (Titik y dinormalkan ke [2, height]; verifikasi posisi via test render.)
 */
export function sparklineCanvas(
  vals: number[],
  width: number,
  height: number,
  opts?: {
    /**
     * Indeks HARI BERJALAN: segmen [idx-1..idx] digambar putus-putus. TIDAK
     * boleh sebagai op ke-2 di canvas yang sama — bug op-stacking pdfmake
     * TERBUKTI berlaku juga utk 2 op polyline (test render: dash jatuh ~50pt
     * di bawah box). Solusi: DUA canvas satu-op disandingkan via `columns`
     * (columnGap 0), normalisasi-Y GLOBAL bersama → garis menyambung mulus.
     */
    dashFromIdx?: number | null;
  },
): Content {
  const n = vals.length;
  if (n < 2) return { canvas: [], width } as unknown as Content;
  const mn = Math.min(...vals);
  const mx = Math.max(...vals, 1);
  const pts = vals.map((v, i) => ({
    x: (i * width) / (n - 1),
    y: height - ((v - mn) / Math.max(mx - mn, 1)) * (height - 4) - 2,
  }));
  const dashIdx = opts?.dashFromIdx ?? null;
  if (dashIdx !== null && dashIdx > 0 && dashIdx < n) {
    const splitX = pts[dashIdx - 1]!.x;
    const solidPts = pts.slice(0, dashIdx);
    // Rebase x segmen dash ke origin kolom keduanya.
    const dashPts = pts
      .slice(dashIdx - 1, dashIdx + 1)
      .map((p) => ({ x: p.x - splitX, y: p.y }));
    return {
      columns: [
        {
          width: splitX,
          canvas: [{ type: "polyline", lineWidth: 1.5, lineColor: PDF.navy, points: solidPts }],
        },
        {
          width: width - splitX,
          canvas: [
            {
              type: "polyline",
              lineWidth: 1.5,
              lineColor: PDF.navy,
              dash: { length: 3, space: 3 },
              points: dashPts,
            },
          ],
        },
      ],
      columnGap: 0,
    } as unknown as Content;
  }
  return {
    canvas: [{ type: "polyline", lineWidth: 1.5, lineColor: PDF.navy, points: pts }],
    width,
  } as unknown as Content;
}

/** Bar horizontal: track + isi (frac 0..1) + tick target opsional. */
export function barCanvas(
  frac: number,
  tickFrac: number | null,
  width: number,
  height: number,
  fill: string,
): Content {
  const w = Math.max(1, Math.min(1, frac) * width);
  const canvas: unknown[] = [
    { type: "rect", x: 0, y: 0, w: width, h: height, color: PDF.zebra },
    { type: "rect", x: 0, y: 0, w, h: height, color: fill },
  ];
  if (tickFrac !== null) {
    const tx = Math.min(1, tickFrac) * width;
    canvas.push({ type: "line", x1: tx, y1: -1, x2: tx, y2: height + 1, lineWidth: 1, lineColor: PDF.borderStrong });
  }
  return { canvas, width } as unknown as Content;
}

/** Titik status kecil (ellipse) berwarna tone. */
export function dotCanvas(color: string, r = 3): Content {
  return { canvas: [{ type: "ellipse", x: r, y: r, r1: r, r2: r, color }], width: r * 2 + 2 } as unknown as Content;
}

/** Warna bar bauran per-kelas (abu-abu berbeda; dipadu label nilai). */
export function bauranFill(cls: string): string {
  return cls === "best"
    ? PDF.navy
    : cls === "worst"
      ? PDF.textMuted
      : cls === "below"
        ? PDF.borderStrong
        : PDF.textSecondary;
}

/** Warna bar mix produk (pso/npso/npso2 → abu-abu berbeda). */
export function productFill(fill: string): string {
  return fill === "pso" ? PDF.borderStrong : fill === "npso2" ? PDF.navy : PDF.textSecondary;
}

// ===========================================================================
// Grafik Laporan Harian (PDF). Semua tunduk aturan op-stacking di atas:
// SATU polyline per canvas; rect/line boleh banyak dalam satu canvas (barCanvas
// preseden). Skala-Y dihitung SEKALI di model (harian-model) → di sini hanya
// dipetakan ke koordinat, tak dihitung ulang.
// ===========================================================================

/** Palet 7 seri untuk PDF — abu-abu/nada berbeda, aman grayscale + berlabel. */
const HARIAN_SERIES = [
  PDF.navy,
  PDF.danger,
  "#1668b3",
  PDF.success,
  "#3fb6c4",
  "#4a2f8f",
  PDF.warning,
];
export function harianSeriesColor(i: number): string {
  return HARIAN_SERIES[i % HARIAN_SERIES.length]!;
}

export interface TrendMonthPdf {
  label: string;
  bars: Array<number | null>;
  total: number;
  partial: boolean;
}

/**
 * Combo tren 13 bulan (PDF) — bentuk LAYAR (D6): batang per unit (sumbu KIRI) +
 * garis TOTAL (sumbu KANAN), DUA sumbu berlabel.
 *
 * OP-STACKING: garis TOTAL digambar sebagai SEGMEN `line` (bukan `polyline`) di
 * canvas yang SAMA dengan batang. Preseden `barCanvas`: satu `line` (tick) sesudah
 * `rect` TIDAK ikut ter-offset — hanya tipe `polyline`/`area` yang menumpuk (lihat
 * catatan sparklineCanvas). Jadi rect×N + line×M dalam satu canvas aman, dan tak
 * perlu overlay dua-canvas yang rapuh. DIBUKTIKAN oleh test render (koordinat).
 * Bila kelak `line` ternyata ikut menumpuk, fallback: buang garis TOTAL, cetak
 * nilai TOTAL di atas tiap batang (dilaporkan eksplisit).
 *
 * `barMax`/`totalMax` dari model (niceAxisMax diterapkan saat D6) — tak dihitung
 * ulang. Mengembalikan { canvas, axes } agar pemanggil mencetak label sumbu
 * (angka tick kiri/kanan) sebagai teks di luar canvas.
 */
export function harianTrendCanvas(args: {
  months: TrendMonthPdf[];
  unitCount: number;
  barMax: number;
  totalMax: number;
  width: number;
  height: number;
}): { canvas: Content; barMax: number; totalMax: number; plotH: number } {
  const { months, unitCount, barMax, totalMax, width, height } = args;
  const plotH = height;
  const slot = width / Math.max(1, months.length);
  const barW = Math.max(0.8, (slot * 0.72) / Math.max(1, unitCount));
  const yL = (v: number) => plotH - (v / Math.max(1, barMax)) * plotH;
  const yR = (v: number) => plotH - (v / Math.max(1, totalMax)) * plotH;

  const ops: unknown[] = [
    // Bounding box (memaksa canvas mereservasi tinggi penuh walau di-nest) +
    // garis panduan tick (0/½/1) + sumbu bawah.
    { type: "rect", x: 0, y: 0, w: width, h: plotH, lineColor: PDF.border, color: undefined },
    { type: "line", x1: 0, y1: plotH / 2, x2: width, y2: plotH / 2, lineWidth: 0.3, lineColor: PDF.zebra },
    { type: "line", x1: 0, y1: plotH, x2: width, y2: plotH, lineWidth: 0.5, lineColor: PDF.border },
  ];
  // batang
  months.forEach((m, mi) => {
    const x0 = mi * slot + slot / 2 - (barW * unitCount) / 2;
    m.bars.forEach((v, ui) => {
      if (v === null || v <= 0) return;
      const yTop = yL(v);
      ops.push({
        type: "rect",
        x: x0 + ui * barW,
        y: yTop,
        w: Math.max(0.6, barW - 0.4),
        h: plotH - yTop,
        color: harianSeriesColor(ui),
        fillOpacity: m.partial ? 0.6 : 1,
      });
    });
  });
  // garis TOTAL = segmen `line` antar bulan (bukan polyline)
  for (let i = 1; i < months.length; i++) {
    ops.push({
      type: "line",
      x1: (i - 1) * slot + slot / 2,
      y1: yR(months[i - 1]!.total),
      x2: i * slot + slot / 2,
      y2: yR(months[i]!.total),
      lineWidth: 1,
      lineColor: PDF.textPrimary,
    });
  }
  return { canvas: { canvas: ops, width } as unknown as Content, barMax, totalMax, plotH };
}

/**
 * Bar divergen G/L kumulatif per unit (PDF). Warna = TANDA saja (danger/success),
 * BUKAN palet per-unit — cacat #2 Excel & bug warna-palet. Satu canvas: track +
 * garis-nol + isi per unit (semua rect/line, aman).
 */
export function divergentGlCanvas(
  units: Array<{ name: string; value: number }>,
  max: number,
  width: number,
  rowH: number,
): Content {
  const mid = width / 2;
  const ops: unknown[] = [{ type: "line", x1: mid, y1: 0, x2: mid, y2: units.length * rowH, lineWidth: 0.5, lineColor: PDF.borderStrong }];
  units.forEach((u, i) => {
    const y = i * rowH + rowH * 0.2;
    const h = rowH * 0.6;
    const w = (Math.abs(u.value) / Math.max(1, max)) * (width / 2 - 2);
    const x = u.value < 0 ? mid - w : mid;
    ops.push({ type: "rect", x, y, w: Math.max(0.5, w), h, color: u.value < 0 ? PDF.danger : PDF.success });
  });
  return { canvas: ops, width } as unknown as Content;
}
