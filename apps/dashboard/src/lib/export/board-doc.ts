/**
 * docDefinition pdfmake untuk Ringkasan Direksi (board) — A4 LANSKAP, multi-unit.
 * Murni. Chart = vektor pdfmake canvas (sparkline polyline, bar rect, dot ellipse),
 * dibedakan aman-grayscale + label. Memuat HANYA unit ber-scope (model dibangun
 * dari perUnit ter-scope). Native "Halaman X dari Y"; ranking = tabel (headerRows +
 * dontBreakRows). Glyph via sanitizer bersama.
 */
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import type { ExportConfig } from "./config";
import { barCanvas, bauranFill, dotCanvas, productFill, sparklineCanvas } from "./pdf-charts";
import { pdfText } from "./glyphs";
import { CONTENT_WIDTH_LANDSCAPE as CW, ledgerLayout, th } from "./pdf-layout";
import { PDF } from "./pdf-tokens";
import { fmtKL, pct, rpShort, signed } from "@/lib/format";
import type { BoardModel, RatioRow } from "@/lib/board-model";

export interface BoardDocMeta {
  dateLong: string;
  periodLabel: string;
  unitsCount: number;
  generatedLabel: string;
}

const toneColor = (t: string): string =>
  t === "danger" ? PDF.danger : t === "warning" ? PDF.warning : t === "success" ? PDF.success : PDF.textMuted;

function kpiCard(label: string, value: string, note: Content): Content {
  return {
    width: "*",
    stack: [
      { text: label, fontSize: 8, color: PDF.textMuted },
      { text: value, fontSize: 16, bold: true, color: PDF.navy, marginTop: 2 },
      note,
    ],
    margin: [0, 0, 8, 0],
  } as unknown as Content;
}

function ratioPanel(title: string, group: BoardModel["ratios"]["gasGroup"], rows: RatioRow[]): Content {
  const body: Content[] = [
    {
      columns: [
        { text: title, fontSize: 8.5, bold: true, color: PDF.textSecondary, width: "*" },
        {
          text:
            group.actual !== null
              ? `${pct(group.actual)}${group.target !== null ? ` / target ${pct(group.target)}` : ""}`
              : "—",
          fontSize: 9,
          bold: true,
          color: group.below ? PDF.warning : PDF.navy,
          alignment: "right",
          width: "auto",
        },
      ],
      marginBottom: 4,
    },
  ];
  if (rows.length === 0)
    body.push({ text: "Belum ada penjualan jenis ini.", italics: true, color: PDF.textMuted, fontSize: 8 });
  for (const r of rows) {
    body.push({
      columns: [
        { text: pdfText(r.name), width: 92, fontSize: 8, color: r.cls === "best" ? PDF.navy : PDF.textSecondary },
        barCanvas(r.barW / 100, r.tickW !== null ? r.tickW / 100 : null, 150, 9, bauranFill(r.cls)),
        {
          text: [
            { text: pct(r.actual), bold: true },
            r.deltaPt !== null
              ? { text: `  ${signed(r.deltaPt, 1)} pt`, color: r.below ? PDF.warning : PDF.success }
              : { text: "" },
          ],
          width: "*",
          fontSize: 8,
          alignment: "right",
        },
      ],
      columnGap: 6,
      marginBottom: 3,
    });
  }
  return { width: "*", stack: body, margin: [0, 0, 10, 0] } as unknown as Content;
}

function rankingTable(model: BoardModel): Content {
  const body: TableCell[][] = [
    [
      th("#"),
      th("SPBU"),
      th("Omset", "right"),
      th("Volume", "right"),
      th("Gain/Loss", "right"),
      th("NPSO gas", "right"),
      th("Input"),
    ],
  ];
  for (const r of model.ranking) {
    body.push([
      { text: String(r.rank), alignment: "center", color: PDF.textMuted },
      { text: pdfText(`${r.dotted} · ${r.name}`), bold: true },
      { text: r.omzet, alignment: "right", noWrap: true },
      { text: r.vol, alignment: "right", noWrap: true },
      {
        text: r.gl,
        alignment: "right",
        color: r.glAbnormal ? (r.glProvisional ? PDF.warning : PDF.danger) : PDF.textPrimary,
        bold: r.glAbnormal,
      },
      { text: r.rg, alignment: "right", color: PDF.textSecondary },
      { text: r.inputLabel, color: toneColor(r.inputTone), fontSize: 8 },
    ]);
  }
  return {
    table: { headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, widths: [18, "*", 90, 80, 70, 64, 110], body },
    layout: ledgerLayout,
    marginBottom: 4,
  };
}

function productMix(model: BoardModel): Content[] {
  const out: Content[] = [{ text: "Bauran volume per produk per unit", style: "sectionTitle", marginTop: 12, marginBottom: 4 }];
  for (const r of model.ranking) {
    const rows: Content[] = [{ text: pdfText(`${r.dotted} · ${r.name}`), fontSize: 8.5, bold: true, color: PDF.navy, marginBottom: 2 }];
    for (const p of r.products) {
      rows.push({
        columns: [
          { text: pdfText(p.name), width: 110, fontSize: 8, color: PDF.textSecondary },
          barCanvas(p.widthPct / 100, null, 200, 8, productFill(p.fill)),
          { text: p.volLabel, width: "*", fontSize: 8, alignment: "right", color: PDF.textMuted },
        ],
        columnGap: 6,
        marginBottom: 2,
      });
    }
    out.push({ stack: rows, marginBottom: 6, unbreakable: true } as Content);
  }
  return out;
}

function anomaliesSection(model: BoardModel): Content[] {
  const body: TableCell[][] = [[th("Anomali"), th("Unit"), th("Tanggal", "right")]];
  if (model.anomalies.length === 0) {
    body.push([{ text: "Tidak ada anomali.", colSpan: 3, italics: true, color: PDF.textMuted }, "", ""]);
  } else {
    for (const a of model.anomalies) {
      body.push([
        {
          stack: [
            {
              text: [
                { text: "• ", color: toneColor(a.tone), bold: true },
                { text: pdfText(a.title), bold: true },
              ],
            },
            { text: pdfText(a.desc), fontSize: 7.5, color: PDF.textMuted },
          ],
        },
        { text: pdfText(a.unit), fontSize: 8 },
        { text: a.dateIso ?? a.time ?? "—", alignment: "right", fontSize: 8, color: PDF.textMuted },
      ]);
    }
  }
  return [
    { text: "Anomali & Exception", style: "sectionTitle", marginTop: 12, marginBottom: 4 },
    { table: { headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, widths: ["*", 120, 90], body }, layout: ledgerLayout },
  ];
}

export function buildBoardDocDefinition(args: {
  model: BoardModel;
  meta: BoardDocMeta;
  config: ExportConfig;
  logoDataUrl?: string;
}): TDocumentDefinitions {
  const { model, meta, logoDataUrl } = args;
  const k = model.kpi;

  const kopRight: Content = logoDataUrl
    ? { image: logoDataUrl, width: 120, alignment: "right" }
    : { text: "SolaMax", style: "kopSpbu", alignment: "right" };

  // KPI notes
  const omzetNote: Content =
    k.delta !== null
      ? { text: `${pdfText(k.delta >= 0 ? "▲" : "▼")} ${pct(Math.abs(k.delta))}`, fontSize: 8, color: k.delta >= 0 ? PDF.success : PDF.danger, marginTop: 1 }
      : { text: "—", fontSize: 8, color: PDF.textMuted, marginTop: 1 };
  const glNote: Content = {
    columns: [
      dotCanvas(k.confirmedAbnormal > 0 ? PDF.danger : k.provisionalUnits > 0 ? PDF.warning : PDF.success),
      {
        text:
          k.confirmedAbnormal > 0
            ? `${k.confirmedAbnormal} unit di atas ambang`
            : k.provisionalUnits > 0
              ? "sebagian sementara"
              : "dalam ambang ±0,5%",
        fontSize: 8,
        color: PDF.textMuted,
        width: "*",
      },
    ],
    columnGap: 4,
    marginTop: 2,
  };
  const inputNote: Content = {
    columns: [
      dotCanvas(k.bolongNames.length > 0 ? PDF.warning : PDF.success),
      {
        text: k.bolongNames.length > 0 ? `${pdfText(k.bolongNames.join(", "))} belum` : "lengkap hari ini",
        fontSize: 8,
        color: PDF.textMuted,
        width: "*",
      },
    ],
    columnGap: 4,
    marginTop: 2,
  };

  const chipsText: Content =
    model.verdict.chips.length > 0
      ? {
          text: model.verdict.chips.slice(0, 6).flatMap((c) => [
            { text: "• ", color: toneColor(c.tone), bold: true },
            { text: `${pdfText(c.text)}    `, color: PDF.textSecondary },
          ]),
          fontSize: 8.5,
          marginTop: 4,
        }
      : { text: "" };

  const content: Content[] = [
    {
      columns: [
        {
          width: "*",
          stack: [
            { text: "SolaGroup — Ringkasan Direksi", style: "kopSpbu" },
            { text: `Tanggal bisnis ${meta.dateLong} · Periode ${meta.periodLabel}`, style: "kopAddr", marginTop: 2 },
          ],
        },
        { width: 130, stack: [kopRight] },
      ],
    },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: CW, y2: 0, lineWidth: 1.2, lineColor: PDF.navy }], marginTop: 6 },
    { text: "RINGKASAN DIREKSI", style: "docTitle", alignment: "center", marginTop: 12 },
    { text: pdfText(model.verdict.headline), style: "docDate", alignment: "center" },
    chipsText,
    {
      text: `Unit tercakup: ${meta.unitsCount} · Mata uang: Rupiah (Rp) · Volume: KiloLiter (KL) · lokal id-ID`,
      style: "scopeLine",
      marginTop: 4,
      marginBottom: 6,
    },
    // KPI
    {
      columns: [
        kpiCard("Omset penjualan", rpShort(k.omzet), omzetNote),
        kpiCard("Volume tersalur (gasoline)", fmtKL(k.volG), { text: `gasoil ${fmtKL(k.volD)}`, fontSize: 8, color: PDF.textMuted, marginTop: 2 }),
        kpiCard("Gain / Loss", k.glGroupPct !== null ? `${signed(k.glGroupPct * 100, 2)}%` : "—", glNote),
        kpiCard("Kepatuhan input", `${k.shiftsDone}/${k.shiftsTarget}`, inputNote),
      ],
      columnGap: 10,
      marginBottom: 8,
    },
    // Sparkline
    { text: `Tren omset grup · 14 hari · rata-rata ${rpShort(model.spark.trendAvg)}/hari`, style: "sectionTitle", marginTop: 4, marginBottom: 3 },
    sparklineCanvas(model.spark.vals, CW, 60),
    // Bauran
    { text: "Bauran NPSO / PSO", style: "sectionTitle", marginTop: 12, marginBottom: 4 },
    {
      columns: [
        ratioPanel("Gasoline — (Pertamax + Turbo) / Pertalite", model.ratios.gasGroup, model.ratios.rg),
        ratioPanel("Gasoil — (Dexlite + Dex) / Solar", model.ratios.oilGroup, model.ratios.rd),
      ],
      columnGap: 16,
    },
    // Ranking
    { text: `Ranking ${meta.unitsCount} unit`, style: "sectionTitle", marginTop: 12, marginBottom: 4 },
    rankingTable(model),
    ...productMix(model),
    ...anomaliesSection(model),
    {
      text: `Sumber: EasyMax POS · sinkron tiap 1–5 menit · Dibuat ${meta.generatedLabel} WIB · Zona waktu WIB (Asia/Pontianak)`,
      style: "footNote",
      alignment: "center",
      marginTop: 14,
    },
  ];

  return {
    content,
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [40, 40, 40, 44],
    info: {
      title: `Ringkasan Direksi — SolaGroup — ${meta.dateLong}`,
      author: "SolaMax",
      subject: "Ringkasan Direksi (board) SolaGroup",
      creator: "SolaMax Dashboard",
    },
    defaultStyle: { font: "Roboto", fontSize: 9, color: PDF.textPrimary, lineHeight: 1.12 },
    header: (currentPage) =>
      currentPage > 1
        ? {
            columns: [
              { text: `Ringkasan Direksi · SolaGroup`, fontSize: 7.5, color: PDF.textMuted },
              { text: meta.dateLong, fontSize: 7.5, color: PDF.textMuted, alignment: "right" },
            ],
            margin: [40, 20, 40, 0],
          }
        : undefined,
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: `SolaMax · Ringkasan Direksi · ${meta.unitsCount} unit`, fontSize: 7.5, color: PDF.textMuted },
        { text: `Halaman ${currentPage} dari ${pageCount}`, fontSize: 7.5, color: PDF.textMuted, alignment: "right" },
      ],
      margin: [40, 12, 40, 0],
    }),
    styles: {
      kopSpbu: { fontSize: 13, bold: true, color: PDF.navy },
      kopAddr: { fontSize: 9, color: PDF.textSecondary },
      docTitle: { fontSize: 16, bold: true, color: PDF.navy, characterSpacing: 1 },
      docDate: { fontSize: 11, color: PDF.textSecondary },
      scopeLine: { fontSize: 8, color: PDF.textMuted },
      sectionTitle: { fontSize: 11, bold: true, color: PDF.navy },
      footNote: { fontSize: 8, color: PDF.textMuted },
    },
  };
}
