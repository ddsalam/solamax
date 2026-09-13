import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import { PIUTANG_BOOKS, piutangBookTotalAmounts, piutangBookLabel, piutangBookAmounts, booksForPiutangRow, type PiutangBook, type PiutangExportView, type PiutangSection, type PiutangViewRow } from "@/lib/piutang-model";
import { susunCsv } from "./csv";
import { footerKeuangan, gayaKeuangan, kopKeuangan, type KopKeuangan } from "./keuangan-kop";
import { pdfText } from "./glyphs";
import { PDF } from "./pdf-tokens";

export const PIUTANG_BOUNDARY_NOTE =
  "Debet/Kredit adalah akumulasi transaksi, bukan mutasi harian. Saldo awal memakai transaksi dtgl < D (s.d. D−1); saldo akhir memakai dtgl <= D (s.d. D). " +
  "Piutang Lokal, Piutang Online, dan Hutang Lokal adalah tiga bucket terpisah dan tidak " +
  "dijumlahkan/netto. Hanya baris COALESCE(sbatal,0)=0.";

/** Text imported from EasyMax is neutralised before RFC-4180 quoting. */
export function safeSpreadsheetText(value: string): string {
  return /^[\t\r]/.test(value) || /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
}

const numeric = (value: number): string => String(Object.is(value, -0) ? 0 : value);
const PDF_NUMBER = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

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
    ["Catatan Debet/Kredit", "Setiap buku dengan saldo atau Debet/Kredit ditampilkan sekali per pelanggan. Buku bersaldo nol dengan Debet/Kredit dicantumkan pada seksi aktif pertama pelanggan."],
    ["Catatan seksi nol", "Tanpa saldo di ketiga buku berarti keenam saldo Awal/Akhir nol; setiap pelanggan dicantumkan untuk tiga buku agar Debet/Kredit tetap terlihat walaupun saldo nol."],
    [],
    ["Ringkasan seluruh snapshot", "Awal Debet", "Awal Kredit", "Awal Saldo", "Akhir Debet", "Akhir Kredit", "Akhir Saldo"],
    ...PIUTANG_BOOKS.filter((book) => book.id !== "online" || view.hasOnlineCustomer).map((book) => [
      book.title, ...Object.values(piutangBookTotalAmounts(view.metadata, book)).flatMap((amounts) => [numeric(amounts.debet), numeric(amounts.kredit), numeric(amounts.saldo)]),
    ]),
    [],
    [
      "Kode unit", "Nama unit", "Tanggal", "Batas awal", "Batas akhir",
      "Seksi", "Buku", "Keanggotaan buku", "Kode pelanggan", "Nama pelanggan", "Awal Debet", "Awal Kredit", "Awal Saldo", "Akhir Debet", "Akhir Kredit", "Akhir Saldo",
    ],
    ...view.sections.flatMap((section) => section.rows.flatMap((row) => booksForPiutangRow(section, row).map((book) => [
      text(unit.code),
      text(unit.name),
      view.asOfDate,
      "dtgl < D · s.d. D−1",
      "dtgl <= D · s.d. D",
      section.title,
      book.title,
      [piutangBookLabel(row.bookCount), section.book && section.book.id !== book.id ? "buku bersaldo nol" : null].filter(Boolean).join("; "),
      text(row.customerCode),
      text(row.customerName ?? "Nama belum tersedia"),
      ...Object.values(piutangBookAmounts(row, book)).flatMap((amounts) => [numeric(amounts.debet), numeric(amounts.kredit), numeric(amounts.saldo)]),
    ]))),
  ];
  return susunCsv(rows);
}

function moneyCell(value: number, precise = false): TableCell {
  return {
    text: PDF_NUMBER.format(precise ? value : Math.round(value)),
    alignment: "right",
    fontSize: 7,
    color: value < 0 ? PDF.danger : PDF.textPrimary,
  };
}

function header(text: string): TableCell {
  return { text: pdfText(text), bold: true, color: PDF.onNavy, fillColor: PDF.navy, fontSize: 7 };
}

function rowCells(row: PiutangViewRow, book: PiutangBook, section: PiutangSection): TableCell[] {
  const label = piutangBookLabel(row.bookCount);
  const amounts = piutangBookAmounts(row, book);
  return [
    { text: pdfText(row.customerCode), fontSize: 7 },
    { text: pdfText(`${row.customerName ?? "Nama belum tersedia"}${label ? `\n${label}` : ""}\n${book.title}${section.book && section.book.id !== book.id ? " · buku bersaldo nol" : ""}`), fontSize: 7 },
    ...[amounts.awal, amounts.akhir].flatMap((boundary) => [moneyCell(boundary.debet, true), moneyCell(boundary.kredit, true), moneyCell(boundary.saldo)]),
  ];
}

function sectionContent(section: PiutangSection): Content[] {
  const headers = [header("Kode"), header("Pelanggan / Buku"), ...["Awal", "Akhir"].flatMap((boundary) => [
    header(`${boundary} Debet`), header(`${boundary} Kredit`), header(`${boundary} Saldo`),
  ])];
  return [
    { text: pdfText(`${section.title} · ${section.rows.length.toLocaleString("id-ID")} pelanggan`), bold: true, fontSize: 10, margin: [0, 12, 0, 6] },
    ...(section.rows.length ? [{
      table: {
        headerRows: 1,
        widths: [45, "*", 88, 88, 88, 88, 88, 88],
        body: [headers, ...section.rows.flatMap((row) => booksForPiutangRow(section, row).map((book) => rowCells(row, book, section)))],
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
      { text: "Ringkasan seluruh snapshot", bold: true, fontSize: 10, margin: [0, 4, 0, 6] },
      { table: {
        headerRows: 1, widths: ["*", 88, 88, 88, 88, 88, 88],
        body: [
          [header("Buku"), ...["Awal", "Akhir"].flatMap((boundary) => [header(`${boundary} Debet`), header(`${boundary} Kredit`), header(`${boundary} Saldo`)])],
          ...PIUTANG_BOOKS.filter((book) => book.id !== "online" || view.hasOnlineCustomer).map((book) => [
            { text: book.title, fontSize: 7 }, ...Object.values(piutangBookTotalAmounts(view.metadata, book)).flatMap((amounts) => [moneyCell(amounts.debet, true), moneyCell(amounts.kredit, true), moneyCell(amounts.saldo)]),
          ]),
        ],
      }, layout: "lightHorizontalLines" },
      ...view.sections.flatMap(sectionContent),
      note,
    ],
  };
}
