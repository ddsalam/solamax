import { describe, expect, it } from "vitest";
import { barCanvas, sparklineCanvas } from "./pdf-charts";

type CanvasOp = { type: string; h?: number; w?: number };
function ops(c: unknown): CanvasOp[] {
  return (c as { canvas: CanvasOp[] }).canvas;
}

describe("pdf-charts vector helpers", () => {
  it("sparkline MENGUNCI tinggi box via rect kotak-penuh (cegah overlap konten)", () => {
    const height = 60;
    const c = ops(sparklineCanvas([1, 5, 2, 8, 3, 9, 4, 6, 7, 2, 5, 8, 1, 9], 560, height));
    // Wajib ada rect setinggi `height` yang me-reserve box (root-cause blocker board).
    const anchor = c.find((op) => op.type === "rect" && op.h === height);
    expect(anchor).toBeDefined();
    // dan garis + area (polyline) tetap tergambar
    expect(c.filter((op) => op.type === "polyline").length).toBe(2);
  });

  it("bar: track + isi (rect) + tick target (line)", () => {
    const c = ops(barCanvas(0.5, 0.3, 100, 9, "#1A3252"));
    expect(c.filter((op) => op.type === "rect").length).toBe(2); // track + isi
    expect(c.some((op) => op.type === "line")).toBe(true); // tick target
    expect(c.every((op) => op.type !== "rect" || op.h === 9)).toBe(true);
  });
});
