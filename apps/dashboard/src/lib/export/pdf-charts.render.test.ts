/**
 * Test RENDER (bukan sekadar "op ada"): render PDF via pdfmake, inflate content
 * stream, dan pastikan sparkline TERGAMBAR di dalam box-nya — di ATAS elemen
 * berikutnya (tak menimpa). Test ini AKAN GAGAL pada bug stacking canvas pdfmake
 * (garis tergambar ~h di bawah box) yang lolos dari assertion struktural.
 */
import zlib from "node:zlib";
import pdfMakeImport from "pdfmake/build/pdfmake";
import vfsImport from "pdfmake/build/vfs_fonts";
import { describe, expect, it } from "vitest";
import { sparklineCanvas } from "./pdf-charts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfMake: any = (pdfMakeImport as any).default ?? pdfMakeImport;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vfsAny: any = (vfsImport as any).default ?? vfsImport;
pdfMake.vfs = vfsAny.pdfMake?.vfs ?? vfsAny.vfs ?? vfsAny;

function render(doc: unknown): Promise<Buffer> {
  return new Promise((resolve) => pdfMake.createPdf(doc).getBuffer((b: Buffer) => resolve(b)));
}

function inflatedOps(buf: Buffer): string {
  const s = buf.toString("latin1");
  const re = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  let out = "";
  while ((m = re.exec(s))) {
    try {
      out += zlib.inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1");
    } catch {
      /* not a flate stream */
    }
  }
  return out;
}

describe("sparkline render position (no overlap)", () => {
  it("polyline tergambar di ATAS marker berikutnya (tak menimpa section bawah)", async () => {
    const vals = [1, 5, 2, 8, 3, 9, 4, 6, 7, 2, 5, 8, 1, 9];
    const marker = { canvas: [{ type: "rect", x: 0, y: 0, w: 12, h: 12, color: "#010203" }] };
    const doc = {
      pageSize: "A4",
      pageOrientation: "landscape",
      pageMargins: [40, 40, 40, 44],
      defaultStyle: { font: "Roboto", fontSize: 9 },
      content: [{ text: "Tren omset grup" }, sparklineCanvas(vals, 762, 60), marker],
    };
    const ops = inflatedOps(await render(doc));
    // y polyline (m/l) dan y marker rect (re) di ruang top-down mentah pdfmake:
    const polyYs = [...ops.matchAll(/[\d.]+ ([\d.]+) [ml]\b/g)].map((x) => Number(x[1]));
    const rectYs = [...ops.matchAll(/[\d.]+ ([\d.]+) 12 12 re/g)].map((x) => Number(x[1]));
    expect(polyYs.length).toBeGreaterThan(2);
    expect(rectYs.length).toBe(1);
    const polyBottom = Math.max(...polyYs); // y lebih besar = lebih bawah di halaman
    const markerTop = rectYs[0]!;
    // Sparkline harus SELESAI sebelum marker mulai (tanpa bug stacking, benar).
    expect(polyBottom).toBeLessThanOrEqual(markerTop);
  });
});
