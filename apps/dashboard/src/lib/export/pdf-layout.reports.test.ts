/**
 * Judul yatim pada LAPORAN SUNGGUHAN (bukan tabel mainan pdf-layout.test):
 * builder asli + model asli dengan baris sintetis, ditata pdfmake (dengan
 * applyPdfDefaults produksi) sampai halaman AKHIR. Sebuah pengatur jarak digeser
 * melintasi satu tinggi halaman penuh di depan isi, sehingga setiap judul
 * berpasangan pernah jatuh di dasar halaman. Untuk tiap posisi: halaman judul ==
 * halaman baris badan pertama tabelnya, tak ada halaman kosong, dan isi di atas
 * judul yang dipindah identik dengan tata letak tanpa penjaga. Kontrol:
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
import { GL_VERIFY_STEPS } from "@/lib/gl-verification";
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
  /** Status di kolom kanan judul `columns` (mis. "belum final"); null = tak ada. */
  status: string | null;
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
      const status = Array.isArray(h.columns) ? plain((h.columns as unknown[])[1]).trim() : "";
      return { heading: plain(h), firstRow: cells.find((c) => c.length >= 4) ?? cells[0]!, status: status || null };
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

/** Halaman judul vs halaman baris badan pertama (baris pertama sel bisa terbungkus)
 *  dan halaman status judulnya. Status yang tertinggal di halaman sebelumnya
 *  mendahului judul dalam urutan baris → diambil kemunculan terdekat. */
function placement(lines: Line[], p: Pair): { heading: number; firstRow: number; status: number | null } {
  const hi = lines.findIndex((l) => l.text.startsWith(p.heading.trim()));
  const ri = lines.findIndex((l, i) => i > hi && l.text.length >= 3 && p.firstRow.trim().startsWith(l.text));
  let si = -1;
  if (p.status !== null)
    lines.forEach((l, i) => {
      if (l.text.length >= 3 && p.status!.startsWith(l.text) && (si < 0 || Math.abs(i - hi) < Math.abs(si - hi))) si = i;
    });
  return { heading: lines[hi]?.page ?? -1, firstRow: lines[ri]?.page ?? -1, status: p.status === null ? null : lines[si]?.page ?? -1 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yOf = (x: any): number | undefined => x.type === "line" ? x.item.y
  : x.type === "vector" ? x.item.y ?? x.item.y1 ?? x.item.points?.[0]?.y : undefined;

/** y di area isi (di luar kop & kaki). */
function inBody(doc: TDocumentDefinitions): (y: number | undefined) => boolean {
  const [, top, , bottom] = doc.pageMargins as number[];
  const height = doc.pageOrientation === "landscape" ? 595.28 : 841.89;
  return (y) => y !== undefined && y >= top! - 1 && y <= height - bottom!;
}

/** Indeks halaman tanpa teks/vektor di area isi (di luar kop & kaki). */
function blankPages(pages: Pages, doc: TDocumentDefinitions): number[] {
  const body = inBody(doc);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return pages.flatMap((p, i) => p.items.some((x: any) => body(yOf(x))) ? [] : [i]);
}

/**
 * Kontrak penjaga pada tata letak AKHIR, dibandingkan dengan tata letak tanpa
 * penjaga (satu lintasan, tanpa tata letak ulang): beda pertama di area isi
 * WAJIB sebuah judul berpasangan yang pindah ke halaman lebih belakang dan
 * menjadi isi teratas halamannya; semua baris sebelumnya identik (halaman & y).
 * pdfmake tak menilai ulang judul yang sudah dinilai, jadi bila isi di atas
 * judul yang dipindah ikut bergeser saat tata letak ulang, judul lama bisa
 * yatim tanpa terdeteksi. null = patuh; selain itu uraian pelanggarannya.
 */
function guardDrift(guarded: Pages, unguarded: Pages, doc: TDocumentDefinitions, headings: string[]): string | null {
  const body = inBody(doc);
  const g = linesOf(guarded).filter((l) => body(l.y));
  const u = linesOf(unguarded).filter((l) => body(l.y));
  // Sesudah judul dipindah, header tabel berulang bisa tercetak lebih/kurang sekali: hanya prefiks yang dibandingkan.
  const k = g.findIndex((l, i) => i >= u.length || l.page !== u[i]!.page || Math.abs(l.y - u[i]!.y) > 0.01 || l.text !== u[i]!.text);
  if (k < 0) return g.length === u.length ? null : `tanpa penjaga ada ${u.length - g.length} baris lebih`;
  if (k >= u.length) return `dengan penjaga ada ${g.length - u.length} baris lebih`;
  const [a, b] = [g[k]!, u[k]!];
  const where = `"${a.text}" p${a.page}@${a.y.toFixed(1)} (tanpa penjaga p${b.page}@${b.y.toFixed(1)})`;
  if (!headings.some((h) => a.text.startsWith(h.trim())) || a.page <= b.page) return `beda pertama bukan judul yang dipindah: ${where}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const above = guarded[a.page].items.some((x: any) => { const y = yOf(x); return body(y) && y! < a.y - 0.5; });
  return above ? `judul dipindah tetapi bukan isi teratas halamannya: ${where}` : null;
}

/** Penjaga LAMA fase 7b (kontrol): ambang 60 pt atas posisi TENTATIF tabel,
 *  tanpa penanda baris pertama dan tanpa pemulihan polyline. */
function legacyFloorGuard(node: { id?: string }, following: { id?: string; startPosition?: { verticalRatio: number; pageInnerHeight: number } }[]): boolean {
  if (typeof node.id !== "string" || !/^keep-\d+$/.test(node.id)) return false;
  const body = following.find((n) => n.id === `${node.id}-body`)?.startPosition;
  return !body || (1 - body.verticalRatio) * body.pageInnerHeight < 60;
}

/**
 * guarded = produksi; unguarded = tanpa penjaga yatim; legacy = penjaga lama
 * fase 7b; nonatomic = produksi tetapi judul TIDAK atomik (kontrol status judul
 * `columns` yang tertinggal, temuan browser phase 13).
 */
type Mode = "guarded" | "unguarded" | "legacy" | "nonatomic";

/**
 * Geser pengatur jarak 0..tinggi halaman; kumpulkan kasus yatim per judul (judul
 * ≠ halaman baris badan pertama) dan status judul yang terpisah dari judulnya,
 * per mode. `build` dipanggil ulang tiap render (pdfmake memutasi
 * docDefinition). `before`: pengatur jarak disisipkan tepat sebelum judul-judul
 * itu (bukan di depan isi), sehingga judulnya menyapu SETIAP posisi dasar
 * halaman walau isi di atasnya berbaris tak terpecah. `check` menerima halaman
 * guarded & unguarded pada offset yang sama (bila mode itu dijalankan); bila
 * keduanya dijalankan, `drift` mencatat offset yang melanggar `guardDrift`.
 *
 * Pengatur jarak = objek BARU per titik sisip. pdfmake menggeser koordinat
 * vektor canvas di tempat; `resetXY` sebelum tata letak ulang memulihkan nilai
 * yang dicatat pada kunjungan TERAKHIR, jadi satu objek di dua titik dipulihkan
 * ke y kunjungan pertamanya dan membengkak sebesar itu pada tata letak ulang
 * (temuan phase 16). `sharedSpacer` = kontrol merah cacat itu.
 */
async function sweep(
  build: () => TDocumentDefinitions, innerHeight: number, step: number,
  opts: {
    legacy?: boolean; modes?: Mode[]; before?: string[]; sharedSpacer?: boolean;
    check?: (guarded: Pages, unguarded: Pages, off: number) => void;
  } = {},
) {
  const pairs = pairsOf(build());
  const modes: Mode[] = opts.modes ?? ["guarded", "unguarded", ...(opts.legacy ? ["legacy" as const] : [])];
  const perHeading = () => Object.fromEntries(modes.map((m) => [m, new Map<string, number[]>(pairs.map((p) => [p.heading, []]))])) as
    Record<Mode, Map<string, number[]>>;
  const orphans = perHeading();
  const splits = perHeading();
  const drift: Record<number, string> = {};
  for (let off = 0; off < innerHeight; off += step) {
    const rendered: Partial<Record<Mode, Pages>> = {};
    let guardedDoc: TDocumentDefinitions | undefined;
    for (const mode of modes) {
      const doc = build();
      const fresh = (): Content => ({ canvas: [{ type: "rect", x: 0, y: 0, w: 1, h: off }] });
      const shared = fresh();
      const spacer = opts.sharedSpacer ? () => shared : fresh;
      const content = (doc.content as Content[]).flatMap((n) => {
        const node = mode === "nonatomic" && (n as unknown as Node).headlineLevel === 1 ? { ...(n as object), unbreakable: false } as Content : n;
        return opts.before?.some((h) => plain(n).startsWith(h)) ? [spacer(), node] : [node];
      });
      doc.content = opts.before ? content : [spacer(), ...content];
      if (mode === "guarded") guardedDoc = doc;
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
        if (at.status !== null) {
          expect(at.status, `${p.status} @${off}`).toBeGreaterThanOrEqual(0);
          if (at.status !== at.heading) splits[mode].get(p.heading)!.push(off);
        }
      }
    }
    if (rendered.guarded && rendered.unguarded) {
      const why = guardDrift(rendered.guarded, rendered.unguarded, guardedDoc!, pairs.map((p) => p.heading));
      if (why !== null) drift[off] = why;
    }
    opts.check?.(rendered.guarded!, rendered.unguarded!, off);
  }
  const out = (m: Mode, src = orphans) => Object.fromEntries(src[m] ?? []);
  const count = (m: Mode) => Object.fromEntries([...(orphans[m] ?? [])].map(([h, offs]) => [h, offs.length]));
  return { pairs, guarded: out("guarded"), unguarded: count("unguarded"), legacy: out("legacy"), drift,
    split: { guarded: out("guarded", splits), nonatomic: out("nonatomic", splits) } };
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

/**
 * Tabel "G/L Belum terverifikasi" (R1 board: sebab "Terjual …"): header ada di
 * SETIAP halaman yang memuat barisnya (berulang saat tabel terpecah), dan
 * subjudul "Cara memverifikasi" sehalaman dengan blok langkah pertamanya.
 * Mengembalikan jumlah halaman yang dilintasi baris tabel.
 */
function glTableIntact(pages: Pages, off: number): number {
  const lines = linesOf(pages);
  const pagesOf = (pred: (t: string) => boolean) => [...new Set(lines.filter((l) => pred(l.text)).map((l) => l.page))];
  const rowPages = pagesOf((t) => t.startsWith("Terjual "));
  expect(rowPages.length, `baris G/L @${off}`).toBeGreaterThan(0);
  expect(pagesOf((t) => t === "Sebab"), `header G/L @${off}`).toEqual(rowPages);
  const cara = lines.find((l) => l.text === "Cara memverifikasi");
  const first = lines.find((l) => l.text === GL_VERIFY_STEPS.penutup_tak_ada.judul);
  expect(cara?.page ?? -1, `Cara memverifikasi @${off}`).toBeGreaterThanOrEqual(0);
  expect(cara?.page, `Cara memverifikasi @${off}`).toBe(first?.page);
  return rowPages.length;
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

// ── Laporan Operasional: Unit 1, 2 Feb — mutasi tak valid (temuan browser phase 13) ──
// Angka sumber fixture phase 3: Stock Awal 10.100, Fisik 10.000, jual kotor 4.100,
// DO nominal NULL (→ movement_invalid, gl & gl_raw NULL). REAL 8.000 bukan input
// builder mana pun (penerimaan = nominal), jadi tak boleh muncul di PDF.
const FEB2 = "2026-02-02";
const FEB2_GL: DailyGlRow = {
  d: FEB2, ckdbbm: "BB-02", nama: "PERTALITE", fisik_prev: 10_100, fisik: 10_000, pen_do: 0, sales_gross: 4_100,
  tera: 0, movement_invalid: true, gl: null, gl_raw: null, gl_suspect: null, excluded_tanks: 0,
  tanks: ["T1"], tanks_invalid: null, tanks_prev: ["T1"], prev_date: "2026-02-01", prior_teori: null, provisional: true,
};
const feb2Model = () => buildLaporanModel(
  { ...LAPORAN_RAW, glRows: [FEB2_GL],
    prodDay: [{ ckdbbm: "BB-02", nama: "PERTALITE", vol: 4_100, omzet: 41_000_000, harga: 10_000 }],
    prodMonth: [{ ckdbbm: "BB-02", nama: "PERTALITE", vol: 8_200, omzet: 82_000_000, harga: 10_000 }] } as unknown as LaporanRaw,
  { unitCode: "6478111", date: FEB2, today: "2026-10-06", mi: { month: 2, year: 2026, dayOfMonth: 2, daysInMonth: 28 }, detail: true },
);
const feb2Doc = (): TDocumentDefinitions => buildLaporanDocDefinition({ model: feb2Model(), config: DEFAULT_EXPORT_CONFIG,
  meta: { ...LAPORAN_META, unitDotted: "64.781.11", unitName: "UNIT 1", dateLong: "Senin, 2 Februari 2026",
    monthName: "Februari", dayOfMonth: 2, daysInMonth: 28 } });

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
    expect(r.split.guarded).toEqual(none(headings));
    expect(r.drift).toEqual({});
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
    expect(r.split.guarded).toEqual(none(headings));
    expect(r.drift).toEqual({});
    expect(r.unguarded[alokasi]).toBeGreaterThan(0);
  }, SWEEP_TIMEOUT);

  it("Laporan Operasional (Unit 1, 2 Feb, mutasi tak valid): status judul tak tertinggal dari judul & baris pertamanya", async () => {
    // Prasyarat model: G/L ditahan, persen & MTD tak lengkap, rincian dari metadata baris itu.
    const m = feb2Model();
    expect(m.sales.rows).toMatchObject([{ ckdbbm: "BB-02", gl: null, glUnverified: true }]);
    expect([m.sales.glTotal, m.sales.glPctDay, m.glMonthly.glMonthTotal, m.glMonthly.glPctMonth]).toEqual([null, null, null, null]);
    expect(m.glMonthly.provisional).toBe(true);
    expect(m.arusMinyak.provisional).toBe(true);
    expect(m.glUnverified).toEqual([expect.objectContaining({ d: FEB2, ckdbbm: "BB-02", reason: "mutasi_tak_valid",
      tangki: ["T1"], audit: null })]);
    expect(m.checks.some((c) => c.label.startsWith("G/L") && c.state === "fail")).toBe(false);
    expect(JSON.stringify(feb2Doc().content)).not.toMatch(/8\.000|NaN|undefined/);

    const targets = ["Arus Minyak Harian", "G/L Belum terverifikasi"];
    // Setiap titik (langkah 1 pt): judul, statusnya, dan baris badan pertama sehalaman; tanpa halaman kosong;
    // isi di atas judul yang dipindah identik dengan tata letak tanpa penjaga.
    const r = await sweep(feb2Doc, PORTRAIT_INNER, 1, { modes: ["guarded", "unguarded"], before: targets });
    const pairs = targets.map((t) => r.pairs.find((p) => p.heading === t)!);
    expect(pairs.map((p) => p.status)).toEqual(["belum final", "1 nilai ditahan · bulan berjalan 1–2 Februari"]);
    const headings = r.pairs.map((p) => p.heading);
    expect(r.guarded).toEqual(none(headings));
    expect(r.split.guarded).toEqual(none(headings));
    expect(r.drift).toEqual({});
    // Kontrol merah: judul `columns` yang tak atomik meninggalkan statusnya (Arus "belum final" & seksi G/L).
    const c = await sweep(feb2Doc, PORTRAIT_INNER, 2, { modes: ["nonatomic"], before: targets });
    for (const t of targets) expect(c.split.nonatomic[t]!.length, t).toBeGreaterThan(0);
    // Kontrol merah (cacat uji phase 16): SATU objek pengatur jarak di kedua titik sisip membengkak saat tata
    // letak ulang → yatim pada rentang kegagalan suite penuh phase 16 (G/L 0–34 & 646–691, Recap 179–207 &
    // 516–521), dan guardDrift menangkap pergeserannya.
    const s = await sweep(feb2Doc, PORTRAIT_INNER, 10, { modes: ["guarded", "unguarded"], before: targets, sharedSpacer: true });
    const failed: Record<string, [number, number][]> = {
      "G/L Belum terverifikasi": [[0, 34], [646, 691]], "Saldo Hutang/Piutang & Recap Harian": [[179, 207], [516, 521]] };
    expect(s.guarded["G/L Belum terverifikasi"]!.length).toBeGreaterThan(0);
    for (const [h, offs] of Object.entries(s.guarded))
      expect(offs.filter((o) => !(failed[h] ?? []).some(([a, b]) => o >= a && o <= b)), h).toEqual([]);
    expect(Object.keys(s.drift).length).toBeGreaterThan(0);
  }, 2 * SWEEP_TIMEOUT);

  it("Laporan Harian: tabel harian dan MTD dua-baris-header, 7 unit", async () => {
    const r = await sweep(harianDoc, LANDSCAPE_INNER_HARIAN, STEP);
    const headings = r.pairs.map((p) => p.heading);
    expect(headings).toEqual(expect.arrayContaining(["Omzet penjualan — bulanan (MTD)", "Gain / Losses — bulanan (MTD) · SEMENTARA"]));
    expect(r.guarded).toEqual(none(headings));
    expect(r.drift).toEqual({});
    for (const h of headings.filter((x) => x.includes("(MTD)"))) expect(r.unguarded[h], h).toBeGreaterThan(0);
  }, SWEEP_TIMEOUT);

  it("Ringkasan Direksi: ranking 7 unit terisi & anomali; grafik tren utuh; penjaga lama gagal di Evaluasi", async () => {
    let glSpan = 0;
    const r = await sweep(boardDoc([anomaly(12)]), LANDSCAPE_INNER_BOARD, STEP, {
      legacy: true,
      check: (g, u, off) => {
        // Pemindahan judul memicu tata letak ULANG; sparkline tren tetap tepat di bawah judulnya.
        expect(trendChart(g), `tren @${off}`).toEqual(trendChart(u));
        glSpan = Math.max(glSpan, glTableIntact(g, off));
      },
    });
    // Prasyarat: tabel G/L benar-benar terpecah antarhalaman di sebagian offset (header berulang teruji).
    expect(glSpan).toBeGreaterThan(1);
    const headings = r.pairs.map((p) => p.heading);
    // Penjualan hari ini tanpa baris G/L (R1) → seksi "G/L Belum terverifikasi" (12 dari 14 baris).
    expect(headings).toEqual(["Evaluasi per cabang", "Ranking 7 unit", "G/L Belum terverifikasi", "Anomali & Exception"]);
    expect(r.guarded).toEqual(none(headings));
    expect(r.split.guarded).toEqual(none(headings));
    expect(r.drift).toEqual({});
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
    expect(r.drift).toEqual({});
    expect(r.unguarded["Anomali & Exception"]).toBeGreaterThan(0);
    expect(r.legacy["Anomali & Exception"]!.length).toBeGreaterThan(0);
  }, SWEEP_TIMEOUT);
});
