import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import { PIUTANG_BOOKS, piutangBookLabel, type PiutangExportView, type PiutangSection, type PiutangViewRow } from "@/lib/piutang-model";
import { susunCsv } from "./csv";
import { footerKeuangan, gayaKeuangan, kopKeuangan, type KopKeuangan } from "./keuangan-kop";
import { pdfText } from "./glyphs";
import { PDF } from "./pdf-tokens";

export const PIUTANG_BOUNDARY_NOTE =
  "Saldo awal memakai transaksi dtgl < D (s.d. D−1); saldo akhir memakai dtgl <= D (s.d. D). " +
  "Piutang Lokal, Piutang Online, dan Hutang Lokal adalah tiga bucket terpisah dan tidak " +
  "dijumlahkan/netto. Hanya baris COALESCE(sbatal,0)=0.";

/** Text imported from EasyMax is neutralised before RFC-4180 quoting. */
export function safeSpreadsheetText(value: string): string {
  return /^[\t\r]/.test(value) || /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
}

const numeric = (value: number): string => String(Object.is(value, -0) ? 0 : value);
const PDF_NUMBER = new Intl.NumberFormat("id-ID");

function piutangProvenance(view: PiutangExportView): string {
  return `${PIUTANG_BOUNDARY_NOTE} Snapshot formula ${view.metadata.formulaVersion}, dihitung ` +
    `${view.metadata.computedAt} setelah siklus sumber ` +
    `${view.metadata.sourceCycleId}/${view.metadata.sourceCompletedAt}.`;
}

export function piutangCsv(input: {
  unit: { code: string; name: string };
  ptLabel: string;
  view: PiutangExportView;
  generatedLabel: string;
  generatedBy: string;
}): string {
  const { unit, view } = input;
  const text = safeSpreadsheetText;
  const rows: string[][] = [
    ["Laporan", "Daftar Saldo Hutang Piutang per Pelanggan"],
    ["PT", text(input.ptLabel)],
    ["Unit", text(unit.name)],
    ["Kode unit", text(unit.code)],
    ["Tanggal", view.asOfDate],
    ["Dibuat", text(input.generatedLabel)],
    ["Dicetak oleh", text(input.generatedBy)],
    ["Catatan", text(piutangProvenance(view))],
    ["Pelanggan unik", String(view.resultCount)],
    ["Kemunculan dalam seksi", String(view.occurrenceCount)],
    ["Catatan seksi nol", "Tanpa saldo di ketiga buku berarti keenam saldo Awal/Akhir nol; setiap pelanggan dicantumkan sekali dalam seksi ini."],
    [],
    [
      "Kode unit", "Nama unit", "Tanggal", "Batas awal", "Batas akhir",
      "Seksi", "Buku", "Keanggotaan buku", "Kode pelanggan", "Nama pelanggan", "Awal", "Akhir",
    ],
    ...view.sections.flatMap((section) => section.rows.map((row) => [
      text(unit.code),
      text(unit.name),
      view.asOfDate,
      "dtgl < D · s.d. D−1",
      "dtgl <= D · s.d. D",
      section.title,
      section.book?.title ?? "Ketiga buku",
      piutangBookLabel(row.bookCount) ?? "",
      text(row.customerCode),
      text(row.customerName ?? "Nama belum tersedia"),
      numeric(section.book ? row[section.book.awal] : 0),
      numeric(section.book ? row[section.book.akhir] : 0),
    ])),
  ];
  return susunCsv(rows);
}

function moneyCell(value: number): TableCell {
  return {
    text: PDF_NUMBER.format(Math.round(value)),
    alignment: "right",
    fontSize: 7,
    color: value < 0 ? PDF.danger : PDF.textPrimary,
  };
}

function header(text: string): TableCell {
  return { text: pdfText(text), bold: true, color: PDF.onNavy, fillColor: PDF.navy, fontSize: 7 };
}

function rowCells(row: PiutangViewRow, section: PiutangSection): TableCell[] {
  const label = piutangBookLabel(row.bookCount);
  const books = section.book ? [section.book] : PIUTANG_BOOKS;
  return [
    { text: pdfText(row.customerCode), fontSize: 7 },
    { text: pdfText(`${row.customerName ?? "Nama belum tersedia"}${label ? `\n${label}` : ""}`), fontSize: 7 },
    ...books.flatMap((book) => [moneyCell(row[book.awal]), moneyCell(row[book.akhir])]),
  ];
}

function sectionContent(section: PiutangSection): Content[] {
  const books = section.book ? [section.book] : PIUTANG_BOOKS;
  const headers = [header("Kode"), header("Pelanggan"), ...books.flatMap((book) => [
    header(`${book.title} awal`), header(`${book.title} akhir`),
  ])];
  return [
    { text: pdfText(`${section.title} · ${section.rows.length.toLocaleString("id-ID")} pelanggan`), bold: true, fontSize: 10, margin: [0, 12, 0, 6] },
    ...(section.rows.length ? [{
      table: {
        headerRows: 1,
        widths: section.book ? [55, "*", 120, 120] : [48, "*", 58, 58, 58, 58, 58, 58],
        body: [headers, ...section.rows.map((row) => rowCells(row, section))],
      },
      layout: "lightHorizontalLines",
    } as Content] : [{ text: "Tidak ada pelanggan dalam hasil filter.", fontSize: 8 } as Content]),
  ];
}

export function buildPiutangDoc(input: { kop: KopKeuangan; view: PiutangExportView }): TDocumentDefinitions {
  const { view } = input;
  const note: Content = { text: pdfText(piutangProvenance(view)), fontSize: 7.5, color: PDF.textSecondary, margin: [0, 8, 0, 0] };
  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [28, 30, 28, 38],
    footer: footerKeuangan(input.kop),
    styles: gayaKeuangan,
    content: [
      ...kopKeuangan(input.kop),
      { text: `${view.resultCount.toLocaleString("id-ID")} pelanggan unik · ${view.occurrenceCount.toLocaleString("id-ID")} kemunculan dalam seksi`, fontSize: 8, margin: [0, 0, 0, 8] },
      ...view.sections.flatMap(sectionContent),
      note,
    ],
  };
}
