import { describe, expect, it } from "vitest";
import { barCanvas, sparklineCanvas } from "./pdf-charts";

type CanvasOp = { type: string; h?: number; w?: number };
function ops(c: unknown): CanvasOp[] {
  return (c as { canvas: CanvasOp[] }).canvas;
}

describe("pdf-charts vector helpers", () => {
  it("sparkline = SATU op polyline (banyak op → pdfmake menumpuk & overlap)", () => {
    const height = 60;
    const c = ops(sparklineCanvas([1, 5, 2, 8, 3, 9, 4, 6, 7, 2, 5, 8, 1, 9], 560, height));
    // Cegah regresi stacking: TEPAT satu op, polyline, tanpa rect/area tambahan.
    expect(c).toHaveLength(1);
    expect(c[0]!.type).toBe("polyline");
    // Semua titik dalam [0, height] (co-lokasi di dalam box-nya).
    const ys = (c[0] as unknown as { points: { y: number }[] }).points.map((p) => p.y);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(height);
  });

  it("bar: track + isi (rect) + tick target (line)", () => {
    const c = ops(barCanvas(0.5, 0.3, 100, 9, "#1A3252"));
    expect(c.filter((op) => op.type === "rect").length).toBe(2); // track + isi
    expect(c.some((op) => op.type === "line")).toBe(true); // tick target
    expect(c.every((op) => op.type !== "rect" || op.h === 9)).toBe(true);
  });
});
