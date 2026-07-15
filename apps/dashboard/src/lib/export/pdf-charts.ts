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
