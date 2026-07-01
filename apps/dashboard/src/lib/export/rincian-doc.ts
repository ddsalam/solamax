/**
 * Bangun docDefinition pdfmake untuk Rincian Penjualan — layout khusus KERTAS
 * (bukan layar). Murni (tanpa instance pdfmake) → dapat diuji tanpa lib.
 *
 * Prinsip yang dipenuhi di sini:
 *  4  A4 (pageSize dikunci)          5  layout dokumen khusus cetak
 *  6  hierarki: kop → isi → footer   7  tabel: header berulang (headerRows),
 *     tanpa memecah baris (dontBreakRows), satuan di judul kolom, angka rata
 *     kanan/desimal konsisten, subtotal+total, filter dinyatakan di atas tabel,
 *     zebra aman-grayscale
 *  6  footer "Halaman X dari Y" NATIF via footer:(currentPage,pageCount)
 * 10  angka/tanggal sudah id-ID/WIB dari lib/format (via rincian-model)
 */
import type {
  Content,
  ContentTable,
  CustomTableLayout,
  TableCell,
  TDocumentDefinitions,
} from "pdfmake/interfaces";
import { sectionEnabled, type ExportConfig } from "./config";
import { PDF } from "./pdf-tokens";
import type { RincianModel, Section, SummaryRow } from "@/lib/rincian-model";

export interface RincianDocMeta {
  unitDotted: string;
  unitName: string;
  address: string;
  pt: string;
  /** Tanggal bisnis panjang, mis. "Kamis, 11 Juni 2026". */
  dateLong: string;
  /** Label "dibuat" untuk footnote, mis. "1 Jul 2026 · 09.14". */
  generatedLabel: string;
}

const CONTENT_WIDTH = 515; // A4 (595.28pt) − margin kiri/kanan 40+40

/** Layout tabel ledger: header navy, zebra abu-abu muda, garis tipis. */
const ledgerLayout: CustomTableLayout = {
  fillColor: (rowIndex) => {
    if (rowIndex === 0) return PDF.navy; // header
    return rowIndex % 2 === 0 ? PDF.zebra : null; // zebra aman-grayscale
  },
  hLineWidth: () => 0.5,
  vLineWidth: () => 0,
  hLineColor: () => PDF.border,
  paddingTop: () => 3,
  paddingBottom: () => 3,
  paddingLeft: () => 5,
  paddingRight: () => 5,
};

function th(text: string, alignment?: "right"): TableCell {
  return { text, style: "th", alignment };
}

/** Satu section ledger → tabel pdfmake (header berulang + tak memecah baris). */
function sectionTable(sec: Section): Content {
  const header: TableCell[] = [
    th("No"),
    th("Keterangan"),
    th("Volume (L)", "right"),
    th("Nilai (Rp)", "right"),
  ];

  const body: TableCell[][] = [header];

  if (sec.rows.length === 0) {
    body.push([
      { text: "", border: [false, false, false, false] },
      {
        text: "Tidak ada transaksi pada tanggal ini.",
        colSpan: 3,
        italics: true,
        color: PDF.textMuted,
      },
      "",
      "",
    ]);
  } else {
    for (const r of sec.rows) {
      body.push([
        { text: r.no, color: PDF.textMuted },
        { text: r.ket, color: PDF.textPrimary },
        { text: r.vol, alignment: "right", color: PDF.textSecondary },
        { text: r.rpv, alignment: "right", noWrap: true },
      ]);
    }
    body.push([
      { text: "", fillColor: PDF.totalFill },
      { text: sec.totalLabel, style: "totalCell", fillColor: PDF.totalFill },
      { text: sec.totalVol, style: "totalCell", alignment: "right", fillColor: PDF.totalFill },
      {
        text: sec.totalRp ?? "",
        style: "totalCell",
        alignment: "right",
        noWrap: true,
        fillColor: PDF.totalFill,
      },
    ]);
  }

  const table: ContentTable = {
    table: {
      headerRows: 1, // Prinsip 7: header berulang tiap halaman
      keepWithHeaderRows: 1,
      dontBreakRows: true, // Prinsip 7: jangan memecah satu baris antar-halaman
      widths: [18, "*", 68, 92],
      body,
    },
    layout: ledgerLayout,
    marginBottom: 10,
  };

  return {
    stack: [
      {
        columns: [
          { text: `${sec.num}. ${sec.title}`, style: "sectionTitle", width: "auto" },
          { text: sec.meta, style: "sectionMeta", alignment: "right", width: "*" },
        ],
        marginTop: 8,
        marginBottom: 3,
      },
      table,
    ],
    unbreakable: false,
  } as Content;
}

/** Tabel SUMMARY A–I (rekonsiliasi kas). */
function summaryTable(summary: SummaryRow[]): Content {
  const rows = summary.filter((s) => s.val !== null);
  const header: TableCell[] = [th("No"), th("Keterangan"), th("Jumlah", "right")];
  const body: TableCell[][] = [header];

  for (const s of rows) {
    const label: Content[] = [
      { text: s.label, bold: s.em, color: PDF.textPrimary },
    ];
    if (s.formula) label.push({ text: s.formula, fontSize: 7.5, color: PDF.textMuted });
    if (s.note) {
      label.push({
        text: `${s.note.tone === "ok" ? "✓ " : "⚠ "}${s.note.text}`,
        fontSize: 7.5,
        color: s.note.tone === "ok" ? PDF.success : PDF.danger,
      });
    }
    const emFill = s.em ? PDF.zebra : undefined;
    body.push([
      { text: s.l, bold: true, color: PDF.navy, fillColor: emFill },
      { stack: label, fillColor: emFill },
      { text: s.val ?? "", alignment: "right", bold: s.em, noWrap: true, fillColor: emFill },
    ]);
  }

  return {
    stack: [
      {
        columns: [
          { text: "SUMMARY", style: "sectionTitle", width: "auto" },
          { text: "rekonsiliasi kas harian", style: "sectionMeta", alignment: "right", width: "*" },
        ],
        marginTop: 14,
        marginBottom: 3,
      },
      {
        table: { headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, widths: [18, "*", 110], body },
        layout: {
          fillColor: (rowIndex) => (rowIndex === 0 ? PDF.navy : null),
          hLineWidth: () => 0.5,
          vLineWidth: () => 0,
          hLineColor: () => PDF.border,
          paddingTop: () => 3,
          paddingBottom: () => 3,
          paddingLeft: () => 5,
          paddingRight: () => 5,
        } as CustomTableLayout,
      },
    ],
  } as Content;
}

/** Blok tanda tangan dua kolom. */
function signatureBlock(): Content {
  // Dua kolom tanpa width → masing-masing '*' (setara 50/50).
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
    columns: [col("Disusun oleh,", "Pengawas SPBU"), col("Mengetahui,", "Pengawas Wilayah")],
    columnGap: 24,
    marginTop: 24,
    unbreakable: true,
  } as Content;
}

export function buildRincianDocDefinition(args: {
  model: RincianModel;
  meta: RincianDocMeta;
  config: ExportConfig;
  /** dataURL logo (PNG). Bila absen, jatuh ke wordmark teks. */
  logoDataUrl?: string;
}): TDocumentDefinitions {
  const { model, meta, config, logoDataUrl } = args;

  let sections = model.sections.filter((s) => sectionEnabled(config, s.num));
  if (config.hideEmpty) sections = sections.filter((s) => s.rows.length > 0);

  const kopRight: Content = logoDataUrl
    ? { image: logoDataUrl, width: 120, alignment: "right" }
    : { text: "SolaMax", style: "kopSpbu", alignment: "right" };

  const scopeBits = [
    `Unit: SPBU ${meta.unitDotted} · ${meta.unitName}`,
    `Tanggal bisnis: ${meta.dateLong}`,
    "Mata uang: Rupiah (Rp), lokal id-ID",
  ];
  if (config.hideEmpty) scopeBits.push("Section tanpa transaksi disembunyikan");

  const content: Content[] = [
    {
      columns: [
        {
          width: "*",
          stack: [
            { text: `SPBU ${meta.unitDotted} · ${meta.unitName}`, style: "kopSpbu" },
            { text: meta.address, style: "kopAddr", marginTop: 2 },
            { text: meta.pt, style: "kopPt", marginTop: 1 },
          ],
        },
        { width: 130, stack: [kopRight] },
      ],
    },
    {
      canvas: [
        { type: "line", x1: 0, y1: 0, x2: CONTENT_WIDTH, y2: 0, lineWidth: 1.2, lineColor: PDF.navy },
      ],
      marginTop: 6,
    },
    { text: "RINCIAN PENJUALAN", style: "docTitle", alignment: "center", marginTop: 14 },
    { text: `Tanggal bisnis ${meta.dateLong}`, style: "docDate", alignment: "center", marginBottom: 8 },
    { text: scopeBits.join("   ·   "), style: "scopeLine", marginBottom: 6 },
    ...sections.map(sectionTable),
    summaryTable(model.summary),
  ];

  if (config.includeSignature) content.push(signatureBlock());

  content.push({
    text: `Dihasilkan otomatis oleh SolaMax dari data EasyMax POS · Dicetak ${meta.generatedLabel} WIB`,
    style: "footNote",
    marginTop: 16,
  });

  return {
    content,
    pageSize: "A4",
    pageOrientation: "portrait",
    pageMargins: [40, 40, 40, 44],
    info: {
      title: `Rincian Penjualan — SPBU ${meta.unitDotted} — ${meta.dateLong}`,
      author: "SolaMax",
      subject: "Rincian Penjualan harian SPBU",
      creator: "SolaMax Dashboard",
    },
    defaultStyle: { font: "Roboto", fontSize: 9, color: PDF.textPrimary, lineHeight: 1.12 },
    // Running header pada halaman ke-2+ (kop tak diulang penuh).
    header: (currentPage) =>
      currentPage > 1
        ? {
            columns: [
              { text: `Rincian Penjualan · SPBU ${meta.unitDotted}`, fontSize: 7.5, color: PDF.textMuted },
              { text: meta.dateLong, fontSize: 7.5, color: PDF.textMuted, alignment: "right" },
            ],
            margin: [40, 20, 40, 0],
          }
        : undefined,
    // Prinsip 6: "Halaman X dari Y" NATIF, identik di semua perangkat.
    footer: (currentPage, pageCount) => ({
      columns: [
        {
          text: `SolaMax · Rincian Penjualan · SPBU ${meta.unitDotted}`,
          fontSize: 7.5,
          color: PDF.textMuted,
        },
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
      kopPt: { fontSize: 8, color: PDF.textMuted },
      docTitle: { fontSize: 16, bold: true, color: PDF.navy, characterSpacing: 1 },
      docDate: { fontSize: 10, color: PDF.textSecondary },
      scopeLine: { fontSize: 8, color: PDF.textMuted },
      sectionTitle: { fontSize: 10, bold: true, color: PDF.navy },
      sectionMeta: { fontSize: 8, color: PDF.textMuted },
      th: { bold: true, color: PDF.onNavy, fontSize: 8.5 },
      totalCell: { bold: true, color: PDF.navy },
      footNote: { fontSize: 8, color: PDF.textMuted, alignment: "center" },
    },
  };
}
