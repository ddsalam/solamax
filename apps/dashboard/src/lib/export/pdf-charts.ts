/**
 * Chart vektor pdfmake (canvas) untuk board — sparkline (polyline), bar (rect),
 * dot (ellipse). Semua digambar dari angka yang sudah dihitung server-side →
 * deterministik, tajam di segala zoom, tanpa PNG/headless. Dibedakan aman-grayscale
 * (abu-abu berbeda) + selalu didampingi label/nilai oleh pemanggil.
 */
import type { Content } from "pdfmake/interfaces";
import { PDF } from "./pdf-tokens";

/** Sparkline: garis + area terisi, dari nilai mentah. */
export function sparklineCanvas(vals: number[], width: number, height: number): Content {
  const n = vals.length;
  if (n < 2) return { canvas: [], width } as unknown as Content;
  const mn = Math.min(...vals);
  const mx = Math.max(...vals, 1);
  const pts = vals.map((v, i) => ({
    x: (i * width) / (n - 1),
    y: height - ((v - mn) / Math.max(mx - mn, 1)) * (height - 4) - 2,
  }));
  return {
    canvas: [
      // Rect kotak-penuh (putih) MENGUNCI tinggi elemen canvas: pdfmake menurunkan
      // tinggi box dari extent rect, BUKAN dari polyline → tanpa ini sparkline
      // ber-box 0 tinggi & konten berikutnya menimpanya. (h == height reserved.)
      { type: "rect", x: 0, y: 0, w: width, h: height, color: "#FFFFFF" },
      // area (fill abu-abu muda)
      {
        type: "polyline",
        closePath: true,
        color: PDF.zebra,
        lineWidth: 0,
        points: [{ x: 0, y: height }, ...pts, { x: width, y: height }],
      },
      // garis
      { type: "polyline", lineWidth: 1.2, lineColor: PDF.navy, points: pts },
    ],
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
