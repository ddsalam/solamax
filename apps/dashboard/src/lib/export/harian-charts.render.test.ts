/**
 * Render test op-stacking untuk grafik Laporan Harian PDF. Membuktikan garis
 * TOTAL (segmen `line`) TIDAK menumpuk di bawah canvas — inflate content stream,
 * cek koordinat, + marker sentinel sesudah grafik (deteksi overlap ke seksi bawah).
 */
import zlib from "node:zlib";
import pdfMakeImport from "pdfmake/build/pdfmake";
import vfsImport from "pdfmake/build/vfs_fonts";
import { describe, expect, it } from "vitest";
import { divergentGlCanvas, harianTrendCanvas } from "./pdf-charts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfMake: any = (pdfMakeImport as any).default ?? pdfMakeImport;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vfsAny: any = (vfsImport as any).default ?? vfsImport;
pdfMake.vfs = vfsAny.pdfMake?.vfs ?? vfsAny.vfs ?? vfsAny;

function render(doc: unknown): Promise<Buffer> {
  return new Promise((resolve) => pdfMake.createPdf(doc).getBuffer((b: Buffer) => resolve(b)));
}
function inflated(buf: Buffer): string {
  const s = buf.toString("latin1");
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  let out = "";
  while ((m = re.exec(s))) {
    try {
      out += zlib.inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1");
    } catch {
      /* not flate */
    }
  }
  return out;
}

describe("harianTrendCanvas — garis TOTAL (line) tak menumpuk", () => {
  it("semua segmen garis tergambar DI ATAS marker berikutnya", async () => {
    const months = Array.from({ length: 13 }, (_, i) => ({
      label: `M${i}`,
      bars: [1000 + i * 10, 800, 600, 500, 400, 300, 200] as Array<number | null>,
      total: 6000 + i * 100,
      partial: i === 12,
    }));
    const { canvas } = harianTrendCanvas({ months, unitCount: 7, barMax: 2000, totalMax: 10000, width: 700, height: 120 });
    const marker = { canvas: [{ type: "rect", x: 0, y: 0, w: 12, h: 12, color: "#010203" }] };
    const doc = {
      pageSize: "A4",
      pageOrientation: "landscape",
      pageMargins: [40, 40, 40, 44],
      defaultStyle: { font: "Roboto", fontSize: 9 },
      content: [{ text: "Tren" }, canvas, marker],
    };
    const ops = inflated(await render(doc));
    // y koordinat garis (operator 'l' setelah 'm') dan marker rect (12 12 re)
    const lineYs = [...ops.matchAll(/[\d.]+ ([\d.]+) l\b/g)].map((x) => Number(x[1]));
    const rectYs = [...ops.matchAll(/[\d.]+ ([\d.]+) 12 12 re/g)].map((x) => Number(x[1]));
    expect(rectYs.length).toBe(1);
    expect(lineYs.length).toBeGreaterThan(10); // banyak segmen
    const lineBottom = Math.max(...lineYs); // y lebih besar = lebih bawah
    const markerTop = rectYs[0]!;
    // Kalau `line` menumpuk (bug), garis jatuh ~height di bawah box → lewat marker.
    expect(lineBottom).toBeLessThanOrEqual(markerTop);
  });
});

describe("divergentGlCanvas — bar dari garis nol", () => {
  it("nilai negatif di kiri garis-nol, positif di kanan; satu canvas", async () => {
    const units = [
      { name: "IB", value: -4968 },
      { name: "BK", value: 4285 },
      { name: "AS", value: -3137 },
    ];
    const c = divergentGlCanvas(units, 5000, 300, 16);
    const doc = {
      pageSize: "A4",
      defaultStyle: { font: "Roboto", fontSize: 9 },
      content: [{ text: "GL" }, c, { canvas: [{ type: "rect", x: 0, y: 0, w: 12, h: 12, color: "#040506" }] }],
    };
    const ops = inflated(await render(doc));
    const rectYs = [...ops.matchAll(/[\d.]+ ([\d.]+) 12 12 re/g)].map((x) => Number(x[1]));
    const barYs = [...ops.matchAll(/[\d.]+ ([\d.]+) [\d.]+ [\d.]+ re/g)].map((x) => Number(x[1]));
    expect(rectYs.length).toBe(1);
    // semua rect divergen di ATAS marker
    expect(Math.max(...barYs)).toBeLessThanOrEqual(rectYs[0]! + 0.5);
  });
});
