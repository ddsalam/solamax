/**
 * docDefinition pdfmake untuk Ringkasan Direksi (board redesign) — A4 LANSKAP,
 * multi-unit. Murni. Dibangun dari MODEL YANG SAMA dengan layar ({core, eval})
 * termasuk FILTER AKTIF (unit terpilih, rentang, mode) → angka & cakupan PDF
 * identik layar; hanya unit ber-scope (principle 11). Chart vektor (canvas);
 * sparkline = SATU polyline per canvas (op-stacking gotcha — jangan gabung op).
 * Tanda ⏳ layar → "*" + catatan kaki (glyph tak ada di Roboto tertanam).
 */
import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import type { ExportConfig } from "./config";
import { barCanvas, bauranFill, productFill, sparklineCanvas } from "./pdf-charts";
import { pdfText } from "./glyphs";
import { CONTENT_WIDTH_LANDSCAPE as CW, ledgerLayout, th } from "./pdf-layout";
import { PDF } from "./pdf-tokens";
import { pct, signed } from "@/lib/format";
import type { BoardModel, DeltaCell, RatioRow } from "@/lib/board-model";

export interface BoardDocMeta {
  dateLong: string;
  periodLabel: string;
  unitsLabel: string;
  modeLabel: string;
  unitsCount: number;
  generatedLabel: string;
}

const toneColor = (t: string): string =>
  t === "danger" ? PDF.danger : t === "warning" ? PDF.warning : t === "success" ? PDF.success : PDF.textMuted;

const deltaColor = (c: DeltaCell): string =>
  c.tone === "up" ? PDF.success : c.tone === "down" ? PDF.danger : PDF.textMuted;

/** Sel delta → text pdfmake (catatan "—" ikut kecil; provisional = "*"). */
function deltaText(c: DeltaCell, fontSize = 8): Content {
  const parts: { text: string; color?: string; fontSize?: number }[] = [
    { text: pdfText(c.text) + (c.provisional ? " *" : ""), color: deltaColor(c) },
  ];
  if (c.text === "—" && c.note) parts.push({ text: `  ${pdfText(c.note)}`, color: PDF.textMuted, fontSize: 7 });
  return { text: parts, fontSize } as Content;
}

function kpiCard(model: BoardModel, key: "omzet" | "gl" | "gas" | "oil"): Content {
  const core = model.core.kpi.find((k) => k.key === key)!;
  const ev = model.eval.cards[key];
  const stack: Content[] = [
    { text: pdfText(core.title) + (core.provisional ? " *" : ""), fontSize: 8, color: PDF.textMuted },
    { text: pdfText(core.value), fontSize: 15, bold: true, color: PDF.navy, marginTop: 2 },
  ];
  if (core.sub)
    stack.push({
      text: pdfText(core.sub),
      fontSize: 7.5,
      color: core.subTone === "muted" ? PDF.textMuted : toneColor(core.subTone),
      marginTop: 1,
    });
  stack.push({
    columns: [
      { text: "MoM", fontSize: 7.5, color: PDF.textMuted, width: 24 },
      deltaText(ev.mom, 8),
    ],
    marginTop: 4,
  } as Content);
  stack.push({
    columns: [
      { text: "YoY", fontSize: 7.5, color: PDF.textMuted, width: 24 },
      deltaText(ev.yoy, 8),
    ],
    marginTop: 1,
  } as Content);
  stack.push({
    columns: [
      { text: "YTD", fontSize: 7.5, color: PDF.textMuted, width: 24 },
      {
        text: [
          { text: pdfText(ev.ytdValue) + (ev.ytdProvisional ? " *" : ""), bold: true },
          { text: "  " },
        ],
        fontSize: 8,
        width: "auto",
      },
      deltaText(ev.ytdDelta, 8),
    ],
    columnGap: 2,
    marginTop: 1,
  } as Content);
  if (core.perUnit) {
    for (const p of core.perUnit)
      stack.push({
        columns: [
          { text: pdfText(p.name), fontSize: 7.5, color: PDF.textMuted, width: 70 },
          { text: pdfText(p.value), fontSize: 8, bold: true, width: "auto" },
          { text: p.sub ? `  ${pdfText(p.sub)}` : "", fontSize: 7.5, color: PDF.textMuted, width: "*" },
        ],
        marginTop: 1,
      } as Content);
  }
  return { width: "*", stack, margin: [0, 0, 8, 0] } as unknown as Content;
}

function evalTable(model: BoardModel): Content[] {
  const body: TableCell[][] = [
    [th("Unit / Metrik"), th("Periode aktif", "right"), th("MoM", "right"), th("YoY", "right"), th("YTD", "right"), th("Δ YTD", "right")],
  ];
  for (const u of model.eval.units) {
    body.push([
      { text: pdfText(`${u.dotted} · ${u.name}`), bold: true, colSpan: 6, fillColor: PDF.zebra },
      "",
      "",
      "",
      "",
      "",
    ]);
    for (const r of u.rows) {
      body.push([
        { text: pdfText(r.metric), color: PDF.textSecondary },
        { text: pdfText(r.cur) + (r.curProvisional ? " *" : ""), alignment: "right", bold: true },
        { ...(deltaText(r.mom) as object), alignment: "right" } as TableCell,
        { ...(deltaText(r.yoy) as object), alignment: "right" } as TableCell,
        { text: pdfText(r.ytd), alignment: "right" },
        { ...(deltaText(r.ytdDelta) as object), alignment: "right" } as TableCell,
      ]);
    }
  }
  return [
    { text: "Evaluasi per cabang", style: "sectionTitle", marginTop: 12, marginBottom: 2 },
    {
      text: pdfText(`${model.eval.labels.mom} · ${model.eval.labels.yoy} · ${model.eval.labels.ytd}`),
      fontSize: 7.5,
      color: PDF.textMuted,
      marginBottom: 4,
    },
    {
      table: { headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, widths: ["*", 90, 100, 100, 90, 100], body },
      layout: ledgerLayout,
      marginBottom: 4,
    },
  ];
}

function trendSection(model: BoardModel): Content[] {
  const t = model.core.trend;
  const out: Content[] = [
    {
      text: pdfText(
        `Tren omset (Rp) · ${t.days.length} hari${t.note ? ` · ${t.note}` : ""}`,
      ),
      style: "sectionTitle",
      marginTop: 4,
      marginBottom: 3,
    },
  ];
  if (t.series.length === 1) {
    out.push(sparklineCanvas(t.series[0]!.rp, CW, 56));
  } else {
    // multi-seri: satu sparkline per unit (op-stacking → jangan overlay 1 canvas)
    for (const s of t.series) {
      out.push({ text: pdfText(s.name), fontSize: 8, color: PDF.textSecondary, marginTop: 3 });
      out.push(sparklineCanvas(s.rp, CW, 34));
    }
  }
  return out;
}

function ratioPanel(title: string, group: BoardModel["core"]["ratios"]["gasGroup"], rows: RatioRow[]): Content {
  const body: Content[] = [
    {
      columns: [
        { text: title, fontSize: 8.5, bold: true, color: PDF.textSecondary, width: "*" },
        {
          text:
            group.actual !== null
              ? `${pct(group.actual)}${group.target !== null ? ` / target rata-rata ${pct(group.target)}` : ""}`
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
      th("NPSO gasoil", "right"),
      th("Input"),
    ],
  ];
  for (const r of model.core.ranking) {
    body.push([
      { text: String(r.rank), alignment: "center", color: PDF.textMuted },
      { text: pdfText(`${r.dotted} · ${r.name}`), bold: true },
      { text: r.omzet, alignment: "right", noWrap: true },
      { text: r.vol, alignment: "right", noWrap: true },
      {
        text: r.gl + (r.glProvisional ? " *" : ""),
        alignment: "right",
        color: r.glAbnormal ? (r.glProvisional ? PDF.warning : PDF.danger) : PDF.textPrimary,
        bold: r.glAbnormal,
      },
      { text: r.rg, alignment: "right", color: PDF.textSecondary },
      { text: r.rd, alignment: "right", color: PDF.textSecondary },
      { text: r.inputLabel, color: toneColor(r.inputTone), fontSize: 8 },
    ]);
  }
  return {
    table: {
      headerRows: 1,
      keepWithHeaderRows: 1,
      dontBreakRows: true,
      widths: [18, "*", 84, 74, 66, 58, 58, 104],
      body,
    },
    layout: ledgerLayout,
    marginBottom: 4,
  };
}

function productMix(model: BoardModel): Content[] {
  const out: Content[] = [
    { text: "Bauran volume per produk per unit", style: "sectionTitle", marginTop: 12, marginBottom: 4 },
  ];
  for (const r of model.core.ranking) {
    const rows: Content[] = [
      { text: pdfText(`${r.dotted} · ${r.name}`), fontSize: 8.5, bold: true, color: PDF.navy, marginBottom: 2 },
    ];
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
  if (model.core.anomalies.length === 0) {
    body.push([{ text: "Tidak ada anomali.", colSpan: 3, italics: true, color: PDF.textMuted }, "", ""]);
  } else {
    for (const a of model.core.anomalies) {
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

  const kopRight: Content = logoDataUrl
    ? { image: logoDataUrl, width: 120, alignment: "right" }
    : { text: "SolaMax", style: "kopSpbu", alignment: "right" };

  const chipsText: Content =
    model.core.verdict.chips.length > 0
      ? {
          text: model.core.verdict.chips.slice(0, 6).flatMap((c) => [
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
            { text: "PT Sola Petra Abadi — Ringkasan Direksi", style: "kopSpbu" },
            {
              text: pdfText(`Periode ${meta.periodLabel} · s/d tanggal bisnis ${meta.dateLong}`),
              style: "kopAddr",
              marginTop: 2,
            },
          ],
        },
        { width: 130, stack: [kopRight] },
      ],
    },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: CW, y2: 0, lineWidth: 1.2, lineColor: PDF.navy }], marginTop: 6 },
    { text: "RINGKASAN DIREKSI", style: "docTitle", alignment: "center", marginTop: 12 },
    { text: pdfText(model.core.verdict.headline), style: "docDate", alignment: "center" },
    chipsText,
    {
      text: pdfText(
        `Unit: ${meta.unitsLabel} · Mode: ${meta.modeLabel} · Mata uang: Rupiah (Rp) · Volume: KiloLiter (KL) · lokal id-ID`,
      ),
      style: "scopeLine",
      marginTop: 4,
      marginBottom: 6,
    },
    // 4 kartu KPI (nilai + MoM + YoY + YTD — model sama dgn layar)
    {
      columns: [
        kpiCard(model, "omzet"),
        kpiCard(model, "gl"),
        kpiCard(model, "gas"),
        kpiCard(model, "oil"),
      ],
      columnGap: 10,
      marginBottom: 8,
    },
    ...trendSection(model),
    ...evalTable(model),
    { text: "Bauran NPSO / PSO", style: "sectionTitle", marginTop: 12, marginBottom: 4 },
    {
      columns: [
        ratioPanel("Gasoline — (Pertamax + Turbo) / Pertalite", model.core.ratios.gasGroup, model.core.ratios.rg),
        ratioPanel("Gasoil — (Dexlite + Dex) / Solar", model.core.ratios.oilGroup, model.core.ratios.rd),
      ],
      columnGap: 16,
    },
    { text: `Ranking ${meta.unitsCount} unit`, style: "sectionTitle", marginTop: 12, marginBottom: 4 },
    rankingTable(model),
    ...productMix(model),
    ...anomaliesSection(model),
    {
      text: pdfText(
        `* angka sementara (opname/input belum final) · Sumber: EasyMax POS · sinkron tiap 1–5 menit · Dibuat ${meta.generatedLabel} WIB · Zona waktu WIB (Asia/Pontianak)`,
      ),
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
      title: `Ringkasan Direksi — PT Sola Petra Abadi — ${meta.periodLabel}`,
      author: "SolaMax",
      subject: "Ringkasan Direksi (board) PT Sola Petra Abadi",
      creator: "SolaMax Dashboard",
    },
    defaultStyle: { font: "Roboto", fontSize: 9, color: PDF.textPrimary, lineHeight: 1.12 },
    header: (currentPage) =>
      currentPage > 1
        ? {
            columns: [
              { text: `Ringkasan Direksi · PT Sola Petra Abadi`, fontSize: 7.5, color: PDF.textMuted },
              { text: pdfText(meta.periodLabel), fontSize: 7.5, color: PDF.textMuted, alignment: "right" },
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
