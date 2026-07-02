/**
 * docDefinition pdfmake untuk Usulan Penebusan SO (view form) — layout KERTAS A4
 * potret. Murni (tanpa instance pdfmake). Volume dalam KiloLiter (KL) via fmtKL
 * (satuan di judul kolom). Nilai = snapshot tersimpan (getUsulanSo) → identik
 * dengan layar "ke KL". Native "Halaman X dari Y", header berulang, tak memecah
 * baris, zebra aman-grayscale, glyph via sanitizer bersama.
 */
import type { Content, ContentTable, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import { pdfText } from "./glyphs";
import { CONTENT_WIDTH_PORTRAIT as CW, ledgerLayout, th } from "./pdf-layout";
import { PDF } from "./pdf-tokens";
import type { ExportConfig } from "./config";
import { fmtKL, idn } from "@/lib/format";
import type { UsulanModel, UsulanRow } from "@/lib/usulan-model";

export interface UsulanDocMeta {
  unitDotted: string;
  unitName: string;
  /** "Kamis, 11 Juni 2026" (tanggal usulan). */
  dateLong: string;
  /** "Rabu, 10 Juni 2026" (penutup D−1, dasar Sisa Stock/DO awal). */
  prevDateLong: string;
  /** "diajukan" | "draft" — status usulan tersimpan. */
  statusLabel: string;
  generatedLabel: string;
}

const kl3 = (n: number) => fmtKL(n, 3);

function ketahananCell(r: UsulanRow): TableCell {
  const txt = r.ketahanan !== null ? `${idn(r.ketahanan, 1)} hari` : "—";
  const color =
    r.ketahananLevel === "danger"
      ? PDF.danger
      : r.ketahananLevel === "warning"
        ? PDF.warning
        : r.ketahanan !== null
          ? PDF.textPrimary
          : PDF.textMuted;
  const bold = r.ketahananLevel === "danger" || r.ketahananLevel === "warning";
  return { text: txt, alignment: "right", color, bold };
}

function sisaStockCell(r: UsulanRow): TableCell {
  if (r.sisaStock === null) {
    return { text: "— sementara", alignment: "right", italics: true, color: PDF.textMuted };
  }
  return { text: kl3(r.sisaStock), alignment: "right", color: PDF.textSecondary };
}

function usulanTable(model: UsulanModel): Content {
  const header: TableCell[] = [
    th("Produk"),
    th("Sisa Stock awal (KL)", "right"),
    th("Ketahanan", "right"),
    th("Sisa DO awal (KL)", "right"),
    th("Penerimaan Hari (KL)", "right"),
    th("Plan Permintaan Besok (KL)", "right"),
    th("Usulan Penebusan (KL)", "right"),
  ];
  const body: TableCell[][] = [header];

  for (const r of model.rows) {
    body.push([
      { text: pdfText(r.label), color: PDF.textPrimary },
      sisaStockCell(r),
      ketahananCell(r),
      { text: kl3(r.sisaDo), alignment: "right", color: PDF.textSecondary },
      { text: kl3(r.penerimaanHari), alignment: "right" },
      { text: kl3(r.permintaanBesok), alignment: "right" },
      { text: kl3(r.usulanPenebusan), alignment: "right" },
    ]);
  }

  const t = model.totals;
  const totCell = (text: string): TableCell => ({
    text,
    style: "totalCell",
    alignment: "right",
    fillColor: PDF.totalFill,
    noWrap: true,
  });
  body.push([
    { text: "TOTAL", style: "totalCell", fillColor: PDF.totalFill },
    totCell(model.anyProvisional ? `${kl3(t.sisaStock)} (sebagian)` : kl3(t.sisaStock)),
    { text: "—", alignment: "right", color: PDF.textMuted, fillColor: PDF.totalFill },
    totCell(kl3(t.sisaDo)),
    totCell(kl3(t.penerimaanHari)),
    totCell(kl3(t.permintaanBesok)),
    totCell(kl3(t.usulanPenebusan)),
  ]);

  const table: ContentTable = {
    table: {
      headerRows: 1,
      keepWithHeaderRows: 1,
      dontBreakRows: true,
      widths: ["*", 62, 46, 58, 62, 70, 62],
      body,
    },
    layout: ledgerLayout,
    marginTop: 4,
  };
  return table;
}

function signatureBlock(): Content {
  const col = (role1: string, role2: string): Content => ({
    stack: [
      { text: role1, color: PDF.textSecondary, fontSize: 9 },
      { text: "\n\n\n", fontSize: 9 },
      {
        canvas: [
          { type: "line", x1: 0, y1: 0, x2: 180, y2: 0, lineWidth: 0.6, lineColor: PDF.borderStrong },
        ],
      },
      { text: role2, marginTop: 3, fontSize: 9, color: PDF.textPrimary },
    ],
  });
  return {
    columns: [col("Disusun oleh,", "Pengawas SPBU"), col("Diterima,", "Keuangan")],
    columnGap: 24,
    marginTop: 24,
    unbreakable: true,
  } as Content;
}

export function buildUsulanDocDefinition(args: {
  model: UsulanModel;
  meta: UsulanDocMeta;
  config: ExportConfig;
  logoDataUrl?: string;
}): TDocumentDefinitions {
  const { model, meta, config, logoDataUrl } = args;

  const kopRight: Content = logoDataUrl
    ? { image: logoDataUrl, width: 120, alignment: "right" }
    : { text: "SolaMax", style: "kopSpbu", alignment: "right" };

  const scopeBits = [
    `Unit: SPBU ${meta.unitDotted} · ${pdfText(meta.unitName)}`,
    `Tanggal usulan: ${meta.dateLong}`,
    `Status: ${meta.statusLabel}`,
    "Satuan: KiloLiter (KL), lokal id-ID",
  ];

  const content: Content[] = [
    {
      columns: [
        {
          width: "*",
          stack: [
            { text: `SPBU ${meta.unitDotted} · ${pdfText(meta.unitName)}`, style: "kopSpbu" },
            {
              text: `Sisa Stock & Sisa DO = awal hari (penutup ${meta.prevDateLong})`,
              style: "kopAddr",
              marginTop: 2,
            },
          ],
        },
        { width: 130, stack: [kopRight] },
      ],
    },
    {
      canvas: [{ type: "line", x1: 0, y1: 0, x2: CW, y2: 0, lineWidth: 1.2, lineColor: PDF.navy }],
      marginTop: 6,
    },
    { text: "USULAN PENEBUSAN SO", style: "docTitle", alignment: "center", marginTop: 14 },
    { text: `Tanggal usulan ${meta.dateLong}`, style: "docDate", alignment: "center", marginBottom: 8 },
    { text: scopeBits.join("   ·   "), style: "scopeLine", marginBottom: 4 },
    usulanTable(model),
  ];

  if (config.includeSignature) content.push(signatureBlock());

  content.push({
    text:
      `Ditujukan ke Keuangan · Sisa Stock awal = penutup ${meta.prevDateLong}; ` +
      `Sisa DO awal = saldo DO per-SO awal hari · Dibuat ${meta.generatedLabel} WIB`,
    style: "footNote",
    marginTop: 16,
  });

  return {
    content,
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [40, 40, 40, 44],
    info: {
      title: `Usulan Penebusan SO — SPBU ${meta.unitDotted} — ${meta.dateLong}`,
      author: "SolaMax",
      subject: "Usulan Penebusan SO harian SPBU",
      creator: "SolaMax Dashboard",
    },
    defaultStyle: { font: "Roboto", fontSize: 9, color: PDF.textPrimary, lineHeight: 1.12 },
    header: (currentPage) =>
      currentPage > 1
        ? {
            columns: [
              { text: `Usulan Penebusan SO · SPBU ${meta.unitDotted}`, fontSize: 7.5, color: PDF.textMuted },
              { text: meta.dateLong, fontSize: 7.5, color: PDF.textMuted, alignment: "right" },
            ],
            margin: [40, 20, 40, 0],
          }
        : undefined,
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: `SolaMax · Usulan Penebusan SO · SPBU ${meta.unitDotted}`, fontSize: 7.5, color: PDF.textMuted },
        {
          text: `Halaman ${currentPage} dari ${pageCount}`,
          fontSize: 7.5,
          color: PDF.textMuted,
          alignment: "right",
        },
      ],
      margin: [40, 12, 40, 0],
    }),
    styles: {
      kopSpbu: { fontSize: 13, bold: true, color: PDF.navy },
      kopAddr: { fontSize: 9, color: PDF.textSecondary },
      docTitle: { fontSize: 16, bold: true, color: PDF.navy, characterSpacing: 1 },
      docDate: { fontSize: 10, color: PDF.textSecondary },
      scopeLine: { fontSize: 8, color: PDF.textMuted },
      th: { bold: true, color: PDF.onNavy, fontSize: 8 },
      totalCell: { bold: true, color: PDF.navy },
      footNote: { fontSize: 8, color: PDF.textMuted, alignment: "center" },
    },
  };
}
