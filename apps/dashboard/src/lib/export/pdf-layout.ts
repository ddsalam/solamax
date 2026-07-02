/**
 * Primitif tabel pdfmake bersama untuk SEMUA laporan (hindari duplikasi):
 * layout ledger (header navy + zebra aman-grayscale), layout header-saja, helper
 * sel header, dan lebar konten A4 potret/lanskap.
 */
import type { CustomTableLayout, TableCell } from "pdfmake/interfaces";
import { PDF } from "./pdf-tokens";

/** Lebar konten (pt): A4 595.28/841.89 − margin kiri+kanan 40+40. */
export const CONTENT_WIDTH_PORTRAIT = 515;
export const CONTENT_WIDTH_LANDSCAPE = 762;

/** Header navy, zebra abu-abu muda pada baris genap, garis tipis. */
export const ledgerLayout: CustomTableLayout = {
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

/** Hanya header yang di-fill navy; baris lain tanpa zebra (untuk tabel ringkas). */
export const headerOnlyLayout: CustomTableLayout = {
  fillColor: (rowIndex) => (rowIndex === 0 ? PDF.navy : null),
  hLineWidth: () => 0.5,
  vLineWidth: () => 0,
  hLineColor: () => PDF.border,
  paddingTop: () => 3,
  paddingBottom: () => 3,
  paddingLeft: () => 5,
  paddingRight: () => 5,
};

/** Sel header tabel (teks putih tebal di atas fill navy). */
export function th(text: string, alignment?: "right" | "center"): TableCell {
  return { text, style: "th", alignment };
}
