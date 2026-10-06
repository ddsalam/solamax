/**
 * Judul yatim pada LAPORAN SUNGGUHAN (bukan tabel mainan pdf-layout.test):
 * builder asli + model asli dengan baris sintetis, ditata pdfmake (dengan
 * applyPdfDefaults produksi) sampai halaman AKHIR. Sebuah pengatur jarak digeser
 * melintasi satu tinggi halaman penuh di depan isi, sehingga setiap judul
 * berpasangan pernah jatuh di dasar halaman. Untuk tiap posisi: halaman judul ==
 * halaman baris badan pertama tabelnya, dan tak ada halaman kosong. Kontrol:
 * tanpa penjaga (yatim > 0) dan penjaga LAMA fase 7b (ambang 60 pt tanpa
 * pemulihan polyline) yang masih meyatimkan "Evaluasi" & baris pertama tinggi.
 *
 * Batas: ini bukti atas posisi & baris yang DIUJI (langkah sapuan 5 pt, isi
 * sintetis), bukan jaminan mutlak untuk sembarang dokumen.
 */
import type { Content, ContentTable, TDocumentDefinitions } from "pdfmake/interfaces";
import pdfMakeImport from "pdfmake/build/pdfmake";
import vfsImport from "pdfmake/build/vfs_fonts";
import { describe, expect, it } from "vitest";
import type { AnomalyItem } from "@/lib/anomalies";
import { buildBoardCore, buildBoardEval, type BoardModel, type BoardUnit, type SalesGrainRow } from "@/lib/board-model";
import { buildHarianModel } from "@/lib/harian-model";
import { buildLaporanModel, type LaporanRaw } from "@/lib/laporan-model";
import { addDays, resolveBoardPeriod, todayWib } from "@/lib/periods";
import type { DailyGlRow, DailySalesRow } from "@/lib/queries";
import type { ScopedUnit, ScopedUnitId } from "@/lib/scope-rule";
import { buildBoardDocDefinition, type BoardDocMeta } from "./board-doc";
import { DEFAULT_EXPORT_CONFIG } from "./config";
import { buildHarianDocDefinition, type HarianDocMeta } from "./harian-doc";
import { buildLaporanDocDefinition, type LaporanDocMeta } from "./laporan-doc";
import { applyPdfDefaults } from "./pdf-defaults";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfMake: any = (pdfMakeImport as any).default ?? pdfMakeImport;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vfsAny: any = (vfsImport as any).default ?? vfsImport;
pdfMake.vfs = vfsAny.pdfMake?.vfs ?? vfsAny.vfs ?? vfsAny;

type Node = Record<string, unknown>;

/** Teks polos sebuah sel/simpul pdfmake (text string|array, stack, columns). */
function plain(n: unknown): string {
  if (typeof n === "string") return n;
  if (Array.isArray(n)) return n.map(plain).join("");
  if (n && typeof n === "object") {
    const o = n as Node;
    if ("text" in o) return plain(o.text);
    if ("stack" in o) return plain(o.stack);
    if ("columns" in o) return plain((o.columns as unknown[])[0]);
  }
  return "";
}

interface Pair {
  heading: string;
  firstRow: string;
}

/** Pasangan judul ↔ BARIS BADAN pertama (sesudah headerRows), dijangkar pada sel
 *  pertama yang cukup khas (sel "#"/"OK" terlalu pendek untuk dicari). */
function pairsOf(doc: TDocumentDefinitions): Pair[] {
  const content = doc.content as unknown as Node[];
  return content
    .filter((n) => typeof n.id === "string" && /^keep-\d+$/.test(n.id))
    .map((h) => {
      const t = (content.find((n) => n.id === `${h.id as string}-body`) as unknown as ContentTable).table;
      const cells = t.body[t.headerRows ?? 0]!.map((c) => plain(c).trim());
      return { heading: plain(h), firstRow: cells.find((c) => c.length >= 4) ?? cells[0]! };
    });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Pages = any[];
type Line = { page: number; y: number; text: string };

/** Halaman tata letak AKHIR pdfmake, dengan default produksi (applyPdfDefaults). */
const render = (doc: TDocumentDefinitions): Promise<Pages> =>
  new Promise((r) => pdfMake.createPdf(applyPdfDefaults(doc))._getPages({}, r));

/** Baris teks tata letak AKHIR (halaman, y, teks) dalam urutan dokumen. */
function linesOf(pages: Pages): Line[] {
  return pages.flatMap((p, page) =>
    p.items
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((x: any) => x.type === "line")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((x: any) => ({ page, y: x.item.y, text: x.item.inlines.map((i: any) => i.text).join("").trim() })),
  );
}

/** Halaman judul vs halaman baris badan pertama (baris pertama sel bisa terbungkus). */
function placement(lines: Line[], p: Pair): { heading: number; firstRow: number } {
  const hi = lines.findIndex((l) => l.text.startsWith(p.heading.trim()));
  const ri = lines.findIndex((l, i) => i > hi && l.text.length >= 3 && p.firstRow.trim().startsWith(l.text));
  return { heading: lines[hi]?.page ?? -1, firstRow: lines[ri]?.page ?? -1 };
}

/** Indeks halaman tanpa teks/vektor di area isi (di luar kop & kaki). */
function blankPages(pages: Pages, doc: TDocumentDefinitions): number[] {
  const [, top, , bottom] = doc.pageMargins as number[];
  const height = doc.pageOrientation === "landscape" ? 595.28 : 841.89;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const yOf = (x: any): number | undefined => x.type === "line" ? x.item.y
    : x.type === "vector" ? x.item.y ?? x.item.y1 ?? x.item.points?.[0]?.y : undefined;
  return pages.flatMap((p, i) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.items.some((x: any) => { const y = yOf(x); return y !== undefined && y >= top! - 1 && y <= height - bottom!; }) ? [] : [i]);
}

/** Penjaga LAMA fase 7b (kontrol): ambang 60 pt atas posisi TENTATIF tabel,
 *  tanpa penanda baris pertama dan tanpa pemulihan polyline. */
function legacyFloorGuard(node: { id?: string }, following: { id?: string; startPosition?: { verticalRatio: number; pageInnerHeight: number } }[]): boolean {
  if (typeof node.id !== "string" || !/^keep-\d+$/.test(node.id)) return false;
  const body = following.find((n) => n.id === `${node.id}-body`)?.startPosition;
  return !body || (1 - body.verticalRatio) * body.pageInnerHeight < 60;
}

type Mode = "guarded" | "unguarded" | "legacy";

/**
 * Geser pengatur jarak 0..tinggi halaman; kumpulkan kasus yatim per judul untuk
 * penjaga kini, tanpa penjaga, dan (opsional) penjaga lama. `build` dipanggil
 * ulang tiap render (pdfmake memutasi docDefinition). `check` menerima halaman
 * berpenjaga & tanpa penjaga pada offset yang sama.
 */
async function sweep(
  build: () => TDocumentDefinitions, innerHeight: number, step: number,
  opts: { legacy?: boolean; check?: (guarded: Pages, unguarded: Pages, off: number) => void } = {},
) {
  const pairs = pairsOf(build());
  const modes: Mode[] = ["guarded", "unguarded", ...(opts.legacy ? ["legacy" as const] : [])];
  const orphans = Object.fromEntries(modes.map((m) => [m, new Map<string, number[]>(pairs.map((p) => [p.heading, []]))])) as
    Record<Mode, Map<string, number[]>>;
  for (let off = 0; off < innerHeight; off += step) {
    const rendered: Partial<Record<Mode, Pages>> = {};
    for (const mode of modes) {
      const doc = build();
      doc.content = [{ canvas: [{ type: "rect", x: 0, y: 0, w: 1, h: off }] }, ...(doc.content as Content[])];
      if (mode === "unguarded") delete doc.pageBreakBefore;
      if (mode === "legacy") doc.pageBreakBefore = legacyFloorGuard as never;
      const pages = (rendered[mode] = await render(doc));
      if (mode === "guarded") expect(blankPages(pages, doc), `blank page @${off}`).toEqual([]);
      const lines = linesOf(pages);
      for (const p of pairs) {
        const at = placement(lines, p);
        expect(at.heading, `${p.heading} @${off}`).toBeGreaterThanOrEqual(0);
        expect(at.firstRow, `${p.firstRow} @${off}`).toBeGreaterThanOrEqual(0);
        if (at.heading !== at.firstRow) orphans[mode].get(p.heading)!.push(off);
      }
    }
    opts.check?.(rendered.guarded!, rendered.unguarded!, off);
  }
  const out = (m: Mode) => Object.fromEntries(orphans[m] ?? []);
  const count = (m: Mode) => Object.fromEntries([...(orphans[m] ?? [])].map(([h, offs]) => [h, offs.length]));
  return { pairs, guarded: out("guarded"), unguarded: count("unguarded"), legacy: out("legacy") };
}

/** Sparkline tren board: posisinya relatif terhadap judul "Tren omset". */
function trendChart(pages: Pages): { pageDelta: number; dy: number } {
  const title = linesOf(pages).find((l) => l.text.startsWith("Tren omset"))!;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const poly = pages.flatMap((p, page) => p.items.filter((x: any) => x.type === "vector" && x.item.type === "polyline")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((x: any) => ({ page, y: Math.min(...x.item.points.map((q: any) => q.y)) })))[0]!;
  return { pageDelta: poly.page - title.page, dy: Math.round(poly.y - title.y) };
}

// A4 tinggi isi = tinggi halaman − margin atas − margin bawah.
const PORTRAIT_INNER = 841.89 - 40 - 44;
const LANDSCAPE_INNER_BOARD = 595.28 - 40 - 44;
const LANDSCAPE_INNER_HARIAN = 595.28 - 32 - 40;
const STEP = 5;
// Satu sapuan = ±100 render penuh; beri ruang saat suite penuh berjalan paralel.
const SWEEP_TIMEOUT = 300_000;

// ── Laporan Operasional: Alokasi + Arus (dengan catatan artefak) ──
const LAPORAN_RAW = {
  prodDay: [{ ckdbbm: "P", nama: "SINTETIS P", vol: 30, omzet: 300_000, harga: 10_000 }],
  glRows: [],
  zeroClosing: [],
  prodMonth: [{ ckdbbm: "P", nama: "SINTETIS P", vol: 900, omzet: 9_000_000, harga: 10_000 }],
  delivMonth: [],
  doDay: [],
  doAnomalies: [],
  doSuspects: [],
  shift: { shifts: 3, last_dtgljam: null },
  hargaDeviasi: [],
  corrections: 0,
  cash: [],
  saldo: {
    awal: { piutangLokal: 5000, piutangOnline: 0, hutangLokal: 0 },
    akhir: { piutangLokal: 6000, piutangOnline: 0, hutangLokal: 0 },
  },
  recapPelanggan: [],
  recapEdc: [],
  recapDeposit: [],
  recapPendapatanLain: [],
  recapPengeluaran: [],
  recapSetoran: [],
  terra: [],
  tetanggaSebelum: { f: [], g: [], i: [] },
  tetanggaSesudah: { f: [], g: [], i: [] },
} as unknown as LaporanRaw;
const LAPORAN_META: LaporanDocMeta = {
  unitDotted: "SYNTHETIC", unitName: "SYNTHETIC PAGINASI", dateLong: "Kamis, 11 Juni 2026",
  monthName: "Juni", dayOfMonth: 11, daysInMonth: 30, staleDays: 30, generatedLabel: "x",
};
const glSource = (o: Partial<DailyGlRow>): DailyGlRow => ({
  d: "2026-06-11", ckdbbm: "P", nama: "SINTETIS P", fisik_prev: 6_000, pen_do: 0, sales_gross: 30,
  tera: 0, fisik: 0, gl: null, gl_raw: -5_970, gl_suspect: "penutup_nol", movement_invalid: false,
  excluded_tanks: 0, provisional: true, ...o,
});
const suspect = (i: number, nama: string) => ({ cnoso: `40605463${10 + i}`, ckdbbm: `BB-0${i}`, nama,
  ditebus: 16_000, diterima: 0, outstanding: 16_000, sejak: "2026-03-15", umur_hari: 88, aktif: true });

function laporanDoc(alokasiName: string): () => TDocumentDefinitions {
  return () => {
    const m = buildLaporanModel(
      { ...LAPORAN_RAW, doSuspects: [suspect(1, alokasiName), suspect(2, "PERTAMAX")],
        glRows: [glSource({}), glSource({ ckdbbm: "Q", nama: "SINTETIS Q", fisik_prev: 200, fisik: 220, pen_do: 50,
          gl: 0, gl_raw: undefined, gl_suspect: undefined, provisional: false })] } as unknown as LaporanRaw,
      { unitCode: "SYNTHETIC", date: "2026-06-11", today: "2026-07-02",
        mi: { month: 6, year: 2026, dayOfMonth: 11, daysInMonth: 30 }, detail: true },
    );
    return buildLaporanDocDefinition({ model: m, meta: LAPORAN_META, config: DEFAULT_EXPORT_CONFIG });
  };
}

// ── Laporan Harian: tabel harian + MTD (dua baris header), 7 unit ──
const HU = (id: number): ScopedUnit => ({ unit_id: id as ScopedUnitId, code: String(6478110 + id), name: `SPBU ${id}` });
const H_UNITS = Array.from({ length: 7 }, (_, i) => HU(i + 1));
const H_DATE = "2026-07-22";
const H_PRODUCTS = ["PERTALITE", "PERTAMAX", "PERTAMAX TURBO", "SOLAR", "DEXLITE", "PERTAMINA DEX"];
const H_META: HarianDocMeta = { ptLabel: "PT Uji", dateLong: "Rabu, 22 Juli 2026", unitsCount: 7, divisor: 22,
  generatedLabel: "x", freshnessLabel: "sinkron terlama: baru saja" };
function harianDoc(): TDocumentDefinitions {
  const dailySales: DailySalesRow[] = H_UNITS.flatMap((u) =>
    [0, -1, -2, -21].flatMap((back) => H_PRODUCTS.map((nama, k) => ({
      unit_id: u.unit_id, d: addDays(H_DATE, back), ckdbbm: `BB-${k}`, nama,
      vol: 1000 + 37 * k + u.unit_id, omzet: (1000 + 37 * k + u.unit_id) * 10_000 }))));
  const model = buildHarianModel({
    units: H_UNITS, date: H_DATE, dailySales, gl: new Map(),
    coverage: H_UNITS.map((u) => ({ unit_id: u.unit_id, sales_min: "2020-01-01" })),
    sync: H_UNITS.map((u) => ({ unit_id: u.unit_id, last_run: "2026-07-24T07:00:00Z" })), recordFloor: "2025-12-29",
  });
  return buildHarianDocDefinition({ model, meta: H_META });
}

// ── Ringkasan Direksi: ranking 7 unit terisi + anomali (deskripsi panjang = baris tinggi) ──
const B_NOW = new Date("2026-07-16T03:00:00Z");
const B_TODAY = todayWib(B_NOW);
const B_PERIOD = resolveBoardPeriod("bulan", {}, B_NOW);
const B_UNITS: BoardUnit[] = Array.from({ length: 7 }, (_, i) => ({ unit_id: i + 1, code: String(6478111 + i),
  name: `SPBU Sintetis Nomor ${i + 1}` }));
const B_SALES: SalesGrainRow[] = B_UNITS.flatMap((u) => [
  { unit_id: u.unit_id, d: B_TODAY, ckdbbm: "PL", nama: "PERTALITE", vol: 1000 + u.unit_id, omzet: 10_000_000 + u.unit_id },
  { unit_id: u.unit_id, d: B_TODAY, ckdbbm: "PX", nama: "PERTAMAX", vol: 120, omzet: 1_800_000 },
]);
const B_META: BoardDocMeta = { dateLong: "Kamis, 16 Juli 2026", periodLabel: "1 Jul 2026 – 16 Jul 2026",
  unitsLabel: "Semua unit (7)", modeLabel: "Kumulatif", unitsCount: 7, generatedLabel: "x", ptLabel: "PT Uji" };
const anomaly = (descWords: number): AnomalyItem => ({ tone: "warning", tier: "major", sev: 1,
  dateIso: addDays(B_TODAY, -1), title: "ANOMALIPERTAMA", unit: "64.781.11",
  desc: Array.from({ length: descWords }, (_, i) => `keterangan${i}`).join(" "), time: "" });
function boardDoc(anomalies: AnomalyItem[]): () => TDocumentDefinitions {
  return () => {
    const input = { units: B_UNITS, period: B_PERIOD, today: B_TODAY, dailySales: B_SALES };
    const empty = new Map();
    const model: BoardModel = { mode: "kumulatif",
      core: buildBoardCore({ ...input, mode: "kumulatif", glRange: empty,
        shift: new Map(B_UNITS.map((u) => [u.unit_id, { shifts: 3, last_dtgljam: null }])), anomalies }),
      eval: buildBoardEval({ ...input, gl: { range: empty, momPrev: empty, yoyPrev: empty, ytdCur: empty, ytdPrev: empty },
        coverage: new Map(B_UNITS.map((u) => [u.unit_id, "2022-08-31"])), incompleteToday: false }),
    };
    return buildBoardDocDefinition({ model, meta: B_META, config: DEFAULT_EXPORT_CONFIG });
  };
}

const none = (headings: string[]) => Object.fromEntries(headings.map((h) => [h, []]));

describe("judul tak yatim pada laporan sungguhan (tata letak akhir pdfmake)", () => {
  it("Laporan Operasional: Alokasi & Arus (catatan artefak di antara judul dan tabel)", async () => {
    const r = await sweep(laporanDoc("PERTAMAX TURBO"), PORTRAIT_INNER, STEP);
    const headings = r.pairs.map((p) => p.heading);
    expect(headings.some((h) => h.startsWith("Alokasi Penerimaan Tidak Sesuai"))).toBe(true);
    expect(headings.some((h) => h.startsWith("Arus Minyak Harian"))).toBe(true);
    expect(r.guarded).toEqual(none(headings));
    for (const h of headings.filter((x) => /^(Alokasi|Arus)/.test(x))) expect(r.unguarded[h], h).toBeGreaterThan(0);
  }, SWEEP_TIMEOUT);

  it("Laporan Operasional: baris pertama Alokasi terbungkus beberapa baris", async () => {
    const longName = `PERTAMAX TURBO ${Array.from({ length: 14 }, (_, i) => `SINTETIS${i}`).join(" ")}`;
    const build = laporanDoc(longName);
    const r = await sweep(build, PORTRAIT_INNER, STEP);
    const headings = r.pairs.map((p) => p.heading);
    const alokasi = headings.find((h) => h.startsWith("Alokasi Penerimaan Tidak Sesuai"))!;
    // Prasyarat: baris pertamanya benar-benar terbungkus (≥ 3 baris teks).
    const lines = linesOf(await render(build()));
    const head = lines.findIndex((l) => l.text.startsWith(alokasi));
    expect(lines.slice(head).filter((l) => l.text.startsWith("SINTETIS")).length).toBeGreaterThanOrEqual(2);
    expect(r.guarded).toEqual(none(headings));
    expect(r.unguarded[alokasi]).toBeGreaterThan(0);
  }, SWEEP_TIMEOUT);

  it("Laporan Harian: tabel harian dan MTD dua-baris-header, 7 unit", async () => {
    const r = await sweep(harianDoc, LANDSCAPE_INNER_HARIAN, STEP);
    const headings = r.pairs.map((p) => p.heading);
    expect(headings).toEqual(expect.arrayContaining(["Omzet penjualan — bulanan (MTD)", "Gain / Losses — bulanan (MTD) · SEMENTARA"]));
    expect(r.guarded).toEqual(none(headings));
    for (const h of headings.filter((x) => x.includes("(MTD)"))) expect(r.unguarded[h], h).toBeGreaterThan(0);
  }, SWEEP_TIMEOUT);

  it("Ringkasan Direksi: ranking 7 unit terisi & anomali; grafik tren utuh; penjaga lama gagal di Evaluasi", async () => {
    const r = await sweep(boardDoc([anomaly(12)]), LANDSCAPE_INNER_BOARD, STEP, {
      legacy: true,
      // Pemindahan judul memicu tata letak ULANG; sparkline tren tetap tepat di bawah judulnya.
      check: (g, u, off) => expect(trendChart(g), `tren @${off}`).toEqual(trendChart(u)),
    });
    const headings = r.pairs.map((p) => p.heading);
    expect(headings).toEqual(["Evaluasi per cabang", "Ranking 7 unit", "Anomali & Exception"]);
    expect(r.guarded).toEqual(none(headings));
    for (const h of headings) expect(r.unguarded[h], h).toBeGreaterThan(0);
    // Kontrol merah: ambang 60 pt fase 7b meyatimkan Evaluasi (bukti fase 8: offset 90..100).
    expect(r.legacy["Evaluasi per cabang"]).toEqual(expect.arrayContaining([90, 95, 100]));
  }, SWEEP_TIMEOUT);

  it("Ringkasan Direksi: baris pertama anomali tinggi (deskripsi panjang) melampaui ambang lama", async () => {
    const build = boardDoc([anomaly(160), anomaly(3)]);
    const r = await sweep(build, LANDSCAPE_INNER_BOARD, 2 * STEP, { legacy: true });
    // Prasyarat: baris pertama memang lebih tinggi dari ambang lama 60 pt.
    const lines = linesOf(await render(build()));
    const desc = lines.filter((l) => l.text.startsWith("keterangan") || / keterangan\d+/.test(l.text));
    expect(desc.at(-1)!.y - desc[0]!.y).toBeGreaterThan(60);
    expect(r.guarded["Anomali & Exception"]).toEqual([]);
    expect(r.unguarded["Anomali & Exception"]).toBeGreaterThan(0);
    expect(r.legacy["Anomali & Exception"]!.length).toBeGreaterThan(0);
  }, SWEEP_TIMEOUT);
});
