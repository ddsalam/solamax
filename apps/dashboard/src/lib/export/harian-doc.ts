/**
 * docDefinition pdfmake untuk "Laporan Harian Total" — A4 LANSKAP, 7 unit.
 *
 * PRESENTATION-ONLY: dibangun dari `HarianModel` yang SAMA dengan halaman
 * (buildHarianModel) — NOL hitung-ulang, nol query. Angka & cakupan PDF identik
 * layar; hanya unit ber-scope. Chart vektor tunduk op-stacking (pdf-charts):
 * satu polyline/canvas, garis TOTAL = segmen `line` (terbukti tak menumpuk).
 *
 * PENANDA WAJIB ikut ke PDF (pelajaran arc ini — makna dibawa STYLING + LABEL
 * TEKS, bukan glyph pengganti sendirian):
 *   - banner data-basi (blok merah) bila freshness.incomplete;
 *   - kolom unit basi bertanda + sel "—" + TOTAL "TIDAK LENGKAP";
 *   - provisional → "SEMENTARA" + catatan kaki;
 *   - glIncomplete → peringatan merah tabel G/L;
 *   - catatan kaki penutup-nol (glSuspectUnits) + Pertalite Khusus (notes);
 *   - kesegaran MIN di FOOTER tiap halaman.
 */
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import { idn, pct, signed } from "@/lib/format";
import type {
  HarianModel,
  MonthlyRow,
  RatioCell,
  UnitStatus,
  ValueRow,
} from "@/lib/harian-model";
import { pdfText } from "./glyphs";
import { divergentGlCanvas, harianSeriesColor, harianTrendCanvas } from "./pdf-charts";
import { CONTENT_WIDTH_LANDSCAPE as CW } from "./pdf-layout";
import { PDF } from "./pdf-tokens";

export interface HarianDocMeta {
  ptLabel: string;
  dateLong: string;
  unitsCount: number;
  divisor: number;
  generatedLabel: string;
  /** "sinkron terlama: <unit>, <ago>" — dihitung server (ago butuh waktu kini). */
  freshnessLabel: string;
}

const cellNum = (v: number, bold = false, danger = false): TableCell => ({
  text: idn(Math.round(v)),
  alignment: "right",
  bold,
  fontSize: 7.5,
  color: danger && v < 0 ? PDF.danger : PDF.textPrimary,
});

/** Sel per-unit: "—" bila belum-ada / basi; angka selainnya. */
function unitCell(u: UnitStatus, v: number | undefined, opts: { bold?: boolean; danger?: boolean } = {}): TableCell {
  if (u.notYet || u.stale) return { text: "—", alignment: "right", fontSize: 7.5, color: PDF.textMuted };
  return cellNum(v ?? 0, opts.bold, opts.danger);
}

/** Header kolom unit — unit basi diberi tanda "!" (glyph ⚠→!) + baris "s/d dd/mm". */
function unitHead(u: UnitStatus): TableCell {
  if (u.stale && u.lastDataDate) {
    return {
      stack: [
        { text: pdfText(`⚠ ${u.name}`), bold: true, color: PDF.warning, fontSize: 7 },
        { text: `s/d ${u.lastDataDate.slice(8)}/${u.lastDataDate.slice(5, 7)}`, color: PDF.warning, fontSize: 6 },
      ],
      alignment: "right",
    };
  }
  return { text: u.name, style: "th", alignment: "right", fontSize: 7 };
}

const harianLayout = {
  fillColor: (rowIndex: number) => (rowIndex === 0 ? PDF.navy : rowIndex % 2 === 0 ? PDF.zebra : null),
  hLineWidth: () => 0.4,
  vLineWidth: () => 0,
  hLineColor: () => PDF.border,
  paddingTop: () => 2,
  paddingBottom: () => 2,
  paddingLeft: () => 4,
  paddingRight: () => 4,
};

function matrixTable(
  title: string,
  hint: string,
  units: UnitStatus[],
  rows: ValueRow[],
  totalsByUnit: Record<number, number>,
  grandTotal: number,
  incomplete: boolean,
  opts: { danger?: boolean; deltaByUnit?: Record<number, number | null>; deltaTotal?: number | null } = {},
): Content[] {
  const widths = ["auto", ...units.map(() => "*"), "auto"];
  const body: TableCell[][] = [];
  body.push([
    { text: "Produk", style: "th", fontSize: 7 },
    ...units.map(unitHead),
    { text: pdfText(incomplete ? "TOTAL ⚠" : "TOTAL"), style: "th", alignment: "right", fontSize: 7 },
  ]);
  for (const r of rows) {
    body.push([
      { text: r.label, fontSize: 7.5 },
      ...units.map((u) => unitCell(u, r.byUnit[u.unitId], { danger: opts.danger })),
      cellNum(r.total, true, opts.danger),
    ]);
  }
  body.push([
    { text: "Total", bold: true, fontSize: 7.5, color: PDF.navy },
    ...units.map((u) => unitCell(u, totalsByUnit[u.unitId], { bold: true, danger: opts.danger })),
    cellNum(grandTotal, true, opts.danger),
  ]);
  if (opts.deltaByUnit) {
    body.push([
      { text: pdfText("Δ vs hari sebelumnya"), fontSize: 7, color: PDF.textMuted },
      ...units.map((u) => {
        const d = opts.deltaByUnit![u.unitId];
        return {
          text: d === null || d === undefined ? "—" : signed(Math.round(d)),
          alignment: "right",
          fontSize: 7,
          color: d === null || d === undefined ? PDF.textMuted : d < 0 ? PDF.danger : PDF.success,
        } as TableCell;
      }),
      {
        text: opts.deltaTotal === null || opts.deltaTotal === undefined ? "—" : signed(Math.round(opts.deltaTotal)),
        alignment: "right",
        fontSize: 7,
        bold: true,
        color: opts.deltaTotal && opts.deltaTotal < 0 ? PDF.danger : PDF.success,
      } as TableCell,
    ]);
  }
  return [
    { text: title, style: "sectionTitle", marginTop: 10 },
    { text: pdfText(hint), style: "hint", marginBottom: 3 },
    { table: { headerRows: 1, dontBreakRows: true, widths, body }, layout: harianLayout },
  ];
}

function monthlyTable(
  title: string,
  units: UnitStatus[],
  rows: MonthlyRow[],
  totalsByUnit: Record<number, { kum: number; avg: number }>,
  grand: { kum: number; avg: number },
  divisor: number,
  danger: boolean,
): Content[] {
  const widths = ["auto", ...units.flatMap(() => ["*", "auto"]), "*", "auto"];
  const cell = (u: UnitStatus, c: { kum: number; avg: number } | undefined, bold = false): TableCell[] =>
    u.notYet || u.stale
      ? [
          { text: "—", alignment: "right", fontSize: 7, color: PDF.textMuted },
          { text: "—", alignment: "right", fontSize: 6.5, color: PDF.textMuted },
        ]
      : [
          cellNum(c?.kum ?? 0, bold, danger),
          { text: idn(Math.round(c?.avg ?? 0)), alignment: "right", fontSize: 6.5, color: PDF.textMuted },
        ];
  const head: TableCell[] = [{ text: "Produk", style: "th", fontSize: 7 }];
  for (const u of units) {
    head.push({ text: pdfText(`${u.stale ? "⚠ " : ""}${u.name}`), style: "th", alignment: "right", fontSize: 6.5, colSpan: 2 } as TableCell, {} as TableCell);
  }
  head.push({ text: "TOTAL", style: "th", alignment: "right", fontSize: 6.5, colSpan: 2 } as TableCell, {} as TableCell);
  const body: TableCell[][] = [head];
  body.push([
    { text: `Kum · Rata (÷${divisor})`, fontSize: 6, italics: true, color: PDF.onNavy, fillColor: PDF.navy },
    ...units.flatMap(() => [
      { text: "Kum", fontSize: 6, alignment: "right", color: PDF.onNavy, fillColor: PDF.navy } as TableCell,
      { text: "Rata", fontSize: 6, alignment: "right", color: PDF.onNavy, fillColor: PDF.navy } as TableCell,
    ]),
    { text: "Kum", fontSize: 6, alignment: "right", color: PDF.onNavy, fillColor: PDF.navy } as TableCell,
    { text: "Rata", fontSize: 6, alignment: "right", color: PDF.onNavy, fillColor: PDF.navy } as TableCell,
  ]);
  for (const r of rows) {
    body.push([{ text: r.label, fontSize: 7.5 }, ...units.flatMap((u) => cell(u, r.byUnit[u.unitId])), cellNum(r.total.kum, true, danger), { text: idn(Math.round(r.total.avg)), alignment: "right", fontSize: 6.5, color: PDF.textMuted }]);
  }
  body.push([{ text: "Total", bold: true, fontSize: 7.5, color: PDF.navy }, ...units.flatMap((u) => cell(u, totalsByUnit[u.unitId], true)), cellNum(grand.kum, true, danger), { text: idn(Math.round(grand.avg)), alignment: "right", fontSize: 6.5, bold: true, color: PDF.textMuted }]);
  return [
    { text: title, style: "sectionTitle", marginTop: 10, marginBottom: 3 },
    { table: { headerRows: 2, dontBreakRows: true, widths, body }, layout: harianLayout },
  ];
}

function ratioBbkTable(model: HarianModel): Content[] {
  const units = model.units;
  const widths = ["auto", ...units.map(() => "*"), "*"];
  const P = (v: number | null) => (v === null ? "—" : pct(v, 2));
  const body: TableCell[][] = [];
  body.push([{ text: "Rasio / BBK", style: "th", fontSize: 7 }, ...units.map(unitHead), { text: "TOTAL", style: "th", alignment: "right", fontSize: 7 }]);
  const sub = (label: string) => body.push([{ text: label, bold: true, fontSize: 6.5, color: PDF.textMuted, colSpan: units.length + 2, fillColor: PDF.zebra } as TableCell, ...units.map(() => ({}) as TableCell), {} as TableCell]);
  const ratioRow = (name: string, pick: (c: RatioCell) => number | null, get: (id: number) => RatioCell, total: RatioCell) =>
    body.push([{ text: name, fontSize: 7.5 }, ...units.map((u) => ({ text: u.notYet || u.stale ? "—" : P(pick(get(u.unitId))), alignment: "right", fontSize: 7.5 }) as TableCell), { text: P(pick(total)), alignment: "right", bold: true, fontSize: 7.5 }]);
  sub("HARIAN");
  ratioRow("% Dexlite / Solar", (c) => c.dexSolar, (id) => model.ratios.daily[id] ?? emptyRatio(), model.ratios.dailyTotal);
  ratioRow("% P Dex / Solar", (c) => c.pdexSolar, (id) => model.ratios.daily[id] ?? emptyRatio(), model.ratios.dailyTotal);
  ratioRow("Total (= bauran gasoil)", (c) => c.total, (id) => model.ratios.daily[id] ?? emptyRatio(), model.ratios.dailyTotal);
  sub("BULANAN (MTD)");
  ratioRow("% Dexlite / Solar", (c) => c.dexSolar, (id) => model.ratios.monthly[id] ?? emptyRatio(), model.ratios.monthlyTotal);
  ratioRow("% P Dex / Solar", (c) => c.pdexSolar, (id) => model.ratios.monthly[id] ?? emptyRatio(), model.ratios.monthlyTotal);
  ratioRow("Total (= bauran gasoil)", (c) => c.total, (id) => model.ratios.monthly[id] ?? emptyRatio(), model.ratios.monthlyTotal);
  sub("PERSENTASE BBK (bulan berjalan)");
  body.push([{ text: "GASOLINE", fontSize: 7.5 }, ...units.map((u) => ({ text: u.notYet || u.stale ? "—" : P(model.bbk.monthly[u.unitId]?.gasoline ?? null), alignment: "right", fontSize: 7.5 }) as TableCell), { text: P(model.bbk.monthlyTotal.gasoline), alignment: "right", bold: true, fontSize: 7.5 }]);
  body.push([{ text: "DIESEL", fontSize: 7.5 }, ...units.map((u) => ({ text: u.notYet || u.stale ? "—" : P(model.bbk.monthly[u.unitId]?.diesel ?? null), alignment: "right", fontSize: 7.5 }) as TableCell), { text: P(model.bbk.monthlyTotal.diesel), alignment: "right", bold: true, fontSize: 7.5 }]);
  return [
    { text: "Rasio & Persentase BBK", style: "sectionTitle", marginTop: 10 },
    { text: pdfText("Rasio: pembilang ÷ Solar (Total ≡ bauran gasoil). BBK: NPSO ÷ (NPSO+PSO) jenis sama ≡ b/(1+b). Keduanya bukan angka yang sama."), style: "hint", marginBottom: 3 },
    { table: { headerRows: 1, dontBreakRows: true, widths, body }, layout: harianLayout },
  ];
}
function emptyRatio(): RatioCell {
  return { dexSolar: null, pdexSolar: null, total: null };
}

function trendCharts(model: HarianModel): Content[] {
  const units = model.units;
  const mk = (mode: "kum" | "avg", barMax: number, totalMax: number, title: string): Content => {
    const months = model.trend.months.map((m) => ({
      label: m.label,
      bars: units.map((u) => (mode === "kum" ? m.byUnit[u.unitId] ?? null : m.avgByUnit[u.unitId] ?? null)),
      total: mode === "kum" ? m.totalKl : m.avgTotalKl,
      partial: m.partial,
    }));
    const w = CW / 2 - 6;
    const h = 92;
    const { canvas } = harianTrendCanvas({ months, unitCount: units.length, barMax, totalMax, width: w, height: h });
    // Canvas adalah anak LANGSUNG stack (bukan nested columns) → tinggi
    // ter-reserve. Label sumbu eksplisit lewat RENTANG di subtitle (D6:
    // kedua sumbu diberi label) — lebih robust dari kolom angka-tick yang
    // hilang saat di-nest (ditemukan pemeriksaan mata Gate PDF-B).
    return {
      width: CW / 2,
      stack: [
        { text: title, fontSize: 7.5, bold: true, color: PDF.textSecondary } as Content,
        { text: pdfText(`sumbu KIRI ▮ KL/unit 0–${idn(Math.round(barMax))} · sumbu KANAN —— KL TOTAL grup 0–${idn(Math.round(totalMax))}`), fontSize: 5.5, color: PDF.textMuted } as Content,
        canvas,
        { text: months.map((m) => m.label).join("  "), fontSize: 4.4, color: PDF.textMuted, marginTop: 1 } as Content,
      ],
    } as unknown as Content;
  };
  return [
    { text: "Penjualan 13 bulan terakhir — satuan KL, dua sumbu", style: "sectionTitle", marginTop: 10, marginBottom: 3 },
    {
      columns: [
        mk("kum", model.trend.barMaxKum, model.trend.totalMaxKum, "Kumulatif per bulan (KL)"),
        mk("avg", model.trend.barMaxAvg, model.trend.totalMaxAvg, "Rata-rata per hari (KL/hari)"),
      ],
      columnGap: 16,
    },
    ...legendRow(units),
  ];
}
function legendRow(units: UnitStatus[]): Content[] {
  return [
    {
      columns: units.map((u, i) => ({
        width: "auto",
        columns: [
          { canvas: [{ type: "rect", x: 0, y: 2, w: 7, h: 7, color: harianSeriesColor(i) }], width: 9 },
          { text: u.name, fontSize: 6, color: PDF.textSecondary },
        ],
        columnGap: 2,
      })),
      columnGap: 8,
      marginTop: 2,
    } as Content,
  ];
}

export function buildHarianDocDefinition(args: {
  model: HarianModel;
  meta: HarianDocMeta;
  logoDataUrl?: string;
}): TDocumentDefinitions {
  const { model, meta, logoDataUrl } = args;
  const units = model.units;
  const incomplete = model.freshness.incomplete;

  const kopRight: Content = logoDataUrl
    ? { image: logoDataUrl, width: 110, alignment: "right" }
    : { text: "SolaMax", style: "kopSpbu", alignment: "right" };

  const content: Content[] = [
    {
      columns: [
        { width: "*", stack: [
          { text: pdfText(`${meta.ptLabel} — Laporan Harian Total`), style: "kopSpbu" },
          { text: pdfText(meta.dateLong), style: "kopAddr", marginTop: 2 },
        ] },
        { width: 120, stack: [kopRight] },
      ],
    },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: CW, y2: 0, lineWidth: 1.2, lineColor: PDF.navy }], marginTop: 5 },
  ];

  // ── Banner data-basi (blok merah) — makna dari STYLING + LABEL, bukan glyph ──
  if (incomplete) {
    const s = model.freshness.staleUnits;
    content.push({
      table: {
        widths: ["*"],
        body: [[{
          stack: [
            { text: pdfText(`TOTAL TIDAK LENGKAP — ${s.length} dari ${units.length} SPBU belum mengirim data untuk ${meta.dateLong}.`), bold: true, color: PDF.danger, fontSize: 9 },
            { text: pdfText(s.map((u) => (u.lastDataDate ? `${u.name} (terakhir ${u.lastDataDate}, −${u.daysBehind} hari)` : `${u.name} (belum ada data)`)).join(" · ")), fontSize: 7.5, color: PDF.textSecondary, marginTop: 1 },
            { text: pdfText("Kolom unit yang tertinggal ditandai dan selnya dirender “—” (tidak ada data — bukan nol). TOTAL menjumlah unit yang PUNYA data → terlalu kecil."), fontSize: 7, color: PDF.textMuted, marginTop: 1 },
          ],
          margin: [6, 4, 6, 4],
        }]],
      },
      layout: { fillColor: () => "#FDECEC", hLineWidth: () => 1, vLineWidth: () => 1, hLineColor: () => PDF.danger, vLineColor: () => PDF.danger },
      marginTop: 6,
    } as Content);
  }

  // ── Kartu ringkas ────────────────────────────────────────────────────────
  const sfx = incomplete ? " ≥" : "";
  const card = (t: string, v: string, sub: string): Content =>
    ({
      width: "*",
      stack: [
        { text: t, fontSize: 7, color: PDF.textMuted },
        { text: pdfText(v), fontSize: 14, bold: true, color: PDF.navy, marginTop: 1 },
        { text: pdfText(sub), fontSize: 6.5, color: PDF.textMuted, marginTop: 1 },
      ],
    }) as unknown as Content;
  content.push({
    columns: [
      card("Total hari ini (L)", idn(Math.round(model.daily.grandTotal)) + sfx, model.deltaTotal === null ? "Δ vs kemarin —" : `Δ vs kemarin ${idn(Math.round(model.deltaTotal))}`),
      card("Total bulan berjalan (L)", idn(Math.round(model.monthly.grand.kum)) + sfx, `rata-rata ${idn(Math.round(model.monthly.grand.avg))} L/hari (÷${meta.divisor})`),
      card("G/L hari ini (L)", idn(Math.round(model.glDaily.grandTotal)), model.glDaily.grandTotal < 0 ? "losses" : "gain"),
      card("G/L bulan berjalan (L)", idn(Math.round(model.glMonthly.grand.kum)), model.glMonthly.grand.kum < 0 ? "losses" : "gain"),
    ],
    columnGap: 10,
    marginTop: 8,
  });

  content.push(...matrixTable("Omzet penjualan — harian", `${meta.dateLong} · liter`, units, model.daily.rows, model.daily.totalsByUnit, model.daily.grandTotal, incomplete, { deltaByUnit: model.deltaByUnit, deltaTotal: model.deltaTotal }));
  content.push(...shareSection(model));
  content.push(...matrixTable("Gain / Losses — harian", "liter · metode RESUME operasional", units, model.glDaily.rows, model.glDaily.totalsByUnit, model.glDaily.grandTotal, incomplete, { danger: true }));
  if (model.glProvisional) content.push(glWarn("Angka G/L tanggal ini SEMENTARA — opname penutup belum lengkap (baru terekam pagi berikutnya). Nilai akan berubah."));
  if (model.glIncomplete) content.push(glWarn("Gain/Losses TIDAK LENGKAP — jendela memuat lebih sedikit hari daripada yang punya penjualan; sel tanpa data tampil 0. Jangan dibaca sampai cakupan penuh."));
  content.push(...monthlyTable("Omzet penjualan — bulanan (MTD)", units, model.monthly.rows, model.monthly.totalsByUnit, model.monthly.grand, meta.divisor, false));
  content.push(...divergentSection(model));
  content.push(...monthlyTable("Gain / Losses — bulanan (MTD)", units, model.glMonthly.rows, model.glMonthly.totalsByUnit, model.glMonthly.grand, meta.divisor, true));
  content.push(...trendCharts(model));
  content.push(...ratioBbkTable(model));
  content.push(...recordSection(model));

  // ── Catatan kaki (Pertalite Khusus, penutup-nol 28 Okt, dll) ──────────────
  if (model.notes.length > 0) {
    content.push({ text: "Catatan data", style: "sectionTitle", marginTop: 10, marginBottom: 2 });
    content.push({ ul: model.notes.map((n) => ({ text: pdfText(n), fontSize: 7, color: PDF.textSecondary })) } as Content);
  }
  content.push({
    text: pdfText(`Sumber: EasyMax POS · volume liter · grafik 13 bulan KL · Dibuat ${meta.generatedLabel} WIB · WIB (Asia/Pontianak)`),
    style: "footNote",
    alignment: "center",
    marginTop: 10,
  });

  return {
    content,
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [28, 32, 28, 40],
    info: { title: `Laporan Harian — ${meta.ptLabel} — ${meta.dateLong}`, author: "SolaMax", creator: "SolaMax Dashboard" },
    defaultStyle: { font: "Roboto", fontSize: 8, color: PDF.textPrimary, lineHeight: 1.1 },
    // FOOTER tiap halaman: kesegaran MIN + nama unit terburuk (lembar terpisah
    // tetap membawa peringatan) + Halaman X dari Y.
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: pdfText(`SolaMax · Laporan Harian · ${meta.unitsCount} SPBU · ${meta.freshnessLabel}`), fontSize: 7, color: incomplete ? PDF.danger : PDF.textMuted },
        { text: `Halaman ${currentPage} dari ${pageCount}`, fontSize: 7, color: PDF.textMuted, alignment: "right" },
      ],
      margin: [28, 8, 28, 0],
    }),
    styles: {
      kopSpbu: { fontSize: 12, bold: true, color: PDF.navy },
      kopAddr: { fontSize: 8, color: PDF.textSecondary },
      sectionTitle: { fontSize: 9.5, bold: true, color: PDF.navy },
      hint: { fontSize: 6.5, color: PDF.textMuted },
      th: { color: PDF.onNavy, bold: true },
      footNote: { fontSize: 6.5, color: PDF.textMuted },
    },
  };
}

function glWarn(msg: string): Content {
  return { text: pdfText(`⚠ ${msg}`), fontSize: 7, color: PDF.danger, marginTop: 2, bold: true };
}

function shareSection(model: HarianModel): Content[] {
  const max = Math.max(1, ...model.share.map((s) => s.kum));
  const rows: TableCell[][] = model.share.map((s, i) => [
    { text: s.name, fontSize: 7.5 },
    { canvas: [{ type: "rect", x: 0, y: 1, w: Math.max(0.5, (s.kum / max) * 200), h: 7, color: harianSeriesColor(i) }], width: 200 },
    { text: idn(Math.round(s.kum)), alignment: "right", fontSize: 7.5, bold: true },
    { text: `${idn(Math.round(s.avg))}/hari`, alignment: "right", fontSize: 6.5, color: PDF.textMuted },
    { text: s.pct === null ? "—" : pct(s.pct, 1), alignment: "right", fontSize: 7.5, bold: true },
  ]);
  return [
    { text: "Kontribusi per SPBU — bulan berjalan", style: "sectionTitle", marginTop: 10, marginBottom: 3 },
    { table: { widths: ["auto", 200, "auto", "auto", "auto"], body: rows }, layout: "noBorders" },
  ];
}

function divergentSection(model: HarianModel): Content[] {
  const units = model.units.map((u) => ({ name: u.name, value: model.glMonthly.totalsByUnit[u.unitId]?.kum ?? 0 }));
  const max = Math.max(1, ...units.map((u) => Math.abs(u.value)));
  const rowH = 12;
  const labels = {
    width: 90,
    stack: units.map((u) => ({ text: pdfText(`${u.name}`), fontSize: 6.5, margin: [0, 2, 0, 2] as [number, number, number, number] })),
  } as unknown as Content;
  const values = {
    width: 60,
    stack: units.map((u) => ({ text: u.value < 0 ? `(${idn(Math.round(Math.abs(u.value)))})` : idn(Math.round(u.value)), fontSize: 6.5, alignment: "right" as const, color: u.value < 0 ? PDF.danger : PDF.textPrimary, margin: [0, 2, 0, 2] as [number, number, number, number] })),
  } as unknown as Content;
  return [
    { text: "Gain / Losses kumulatif bulan berjalan", style: "sectionTitle", marginTop: 10 },
    { text: "semua unit memakai nilai Kumulatif (liter) · merah = losses, hijau = gain", style: "hint", marginBottom: 3 },
    { columns: [labels, { width: 300, stack: [divergentGlCanvas(units, max, 300, rowH)] }, values], columnGap: 4 },
  ];
}

function recordSection(model: HarianModel): Content[] {
  const r = model.record;
  const units = model.units;
  if (r.date === null) {
    return [{ text: "Rekor — penjualan grup tertinggi 1 hari", style: "sectionTitle", marginTop: 10 }, { text: "Belum ada hari yang bisa dibandingkan.", style: "hint" }];
  }
  const widths = ["auto", ...units.map(() => "*"), "*"];
  const body: TableCell[][] = [
    [{ text: "Tanggal", style: "th", fontSize: 7 }, ...units.map((u) => ({ text: u.name, style: "th", alignment: "right", fontSize: 7 }) as TableCell), { text: "TOTAL", style: "th", alignment: "right", fontSize: 7 }],
    [{ text: r.date, bold: true, fontSize: 7.5, color: PDF.navy }, ...units.map((u) => cellNum(r.byUnit[u.unitId] ?? 0)), cellNum(r.total, true)],
  ];
  return [
    { text: "Rekor — penjualan grup tertinggi dalam 1 hari", style: "sectionTitle", marginTop: 10 },
    { text: pdfText(`periode pembanding ${r.from} – ${r.to} · sejak seluruh armada terpantau (rekor lama tak sebanding)`), style: "hint", marginBottom: 3 },
    { table: { widths, body }, layout: harianLayout },
  ];
}
