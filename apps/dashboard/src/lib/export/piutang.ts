import type { Content, TableCell, TDocumentDefinitions } from "pdfmake/interfaces";
import type { PiutangExportView, PiutangViewRow } from "@/lib/piutang-model";
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
    [],
    [
      "Kode unit", "Nama unit", "Tanggal", "Batas awal", "Batas akhir",
      "Kode pelanggan", "Nama pelanggan", "Piutang Lokal Awal", "Piutang Lokal Akhir",
      "Piutang Online Awal", "Piutang Online Akhir", "Hutang Lokal Awal", "Hutang Lokal Akhir",
    ],
    ...view.rows.map((row) => [
      text(unit.code),
      text(unit.name),
      view.asOfDate,
      "dtgl < D · s.d. D−1",
      "dtgl <= D · s.d. D",
      text(row.customerCode),
      text(row.customerName ?? "Nama belum tersedia"),
      numeric(row.awalPiutangLokal),
      numeric(row.akhirPiutangLokal),
      numeric(row.awalPiutangOnline),
      numeric(row.akhirPiutangOnline),
      numeric(row.awalHutangLokal),
      numeric(row.akhirHutangLokal),
    ]),
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

function rowCells(row: PiutangViewRow, online: boolean): TableCell[] {
  const cells: TableCell[] = [
    { text: pdfText(row.customerCode), fontSize: 7 },
    { text: pdfText(row.customerName ?? "Nama belum tersedia"), fontSize: 7 },
    moneyCell(row.awalPiutangLokal),
    moneyCell(row.akhirPiutangLokal),
  ];
  if (online) cells.push(moneyCell(row.awalPiutangOnline), moneyCell(row.akhirPiutangOnline));
  cells.push(moneyCell(row.awalHutangLokal), moneyCell(row.akhirHutangLokal));
  return cells;
}

export function buildPiutangDoc(input: { kop: KopKeuangan; view: PiutangExportView }): TDocumentDefinitions {
  const { view } = input;
  const online = view.hasOnlineCustomer;
  const headers = [
    header("Kode"), header("Pelanggan"), header("Lokal awal"), header("Lokal akhir"),
    ...(online ? [header("Online awal"), header("Online akhir")] : []),
    header("Hutang awal"), header("Hutang akhir"),
  ];
  const widths = online
    ? [48, "*", 58, 58, 58, 58, 58, 58]
    : [55, "*", 70, 70, 70, 70];
  const note: Content = { text: pdfText(piutangProvenance(view)), fontSize: 7.5, color: PDF.textSecondary, margin: [0, 8, 0, 0] };
  return {
    pageSize: "A4",
    pageOrientation: "landscape",
    pageMargins: [28, 30, 28, 38],
    footer: footerKeuangan(input.kop),
    styles: gayaKeuangan,
    content: [
      ...kopKeuangan(input.kop),
      { text: `${view.resultCount.toLocaleString("id-ID")} pelanggan dalam hasil filter`, fontSize: 8, margin: [0, 0, 0, 8] },
      {
        table: { headerRows: 1, widths, body: [headers, ...view.rows.map((row) => rowCells(row, online))] },
        layout: "lightHorizontalLines",
      },
      note,
    ],
  };
}
