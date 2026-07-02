/**
 * Warna untuk dokumen PDF (pdfmake tak membaca CSS custom-props). Dipetakan dari
 * token DS di src/styles/ds/tokens/colors.css. Dipilih agar tetap terbaca saat
 * dicetak grayscale (header gelap+teks putih, zebra abu-abu muda).
 */
export const PDF = {
  navy: "#1A3252", // --brand-navy
  navyDeep: "#0D284A", // --brand-navy-deep
  onNavy: "#FFFFFF",
  textPrimary: "#1D1D1F", // --neutral-900
  textSecondary: "#4B5563", // --neutral-600
  textMuted: "#6B7280", // --neutral-500
  zebra: "#F2F4F7", // baris ganjil (grayscale-safe)
  totalFill: "#EAF0F6", // baris TOTAL (tint navy muda)
  border: "#D0D5DD", // --color-border
  borderStrong: "#98A2B3",
  success: "#15803D", // --color-success
  warning: "#B45309", // --color-warning
  danger: "#B91C1C", // --color-danger
} as const;
