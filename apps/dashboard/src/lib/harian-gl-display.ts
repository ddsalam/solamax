/** Shared presentation contract for the Laporan Harian screen and PDF. */
import { idn } from "./format";

export const GL_INCOMPLETE_WARNING =
  "Gain/Losses TIDAK LENGKAP — sel tanpa data atau tidak valid beserta total yang bergantung padanya ditampilkan “—”, bukan 0. Lihat Catatan data.";
export const GL_DAILY_PROVISIONAL_WARNING =
  "Angka G/L yang tersedia SEMENTARA — opname penutup atau data pendukung tanggal ini belum final. Nilai dapat berubah.";
export const GL_MONTHLY_PROVISIONAL_WARNING =
  "Angka G/L bulan berjalan yang tersedia SEMENTARA — masih ada hari dengan opname penutup atau data pendukung belum final. Nilai dapat berubah.";

export function glValueText(value: number | null | undefined): string {
  return value == null ? "—" : idn(Math.round(value));
}

export function glStatusText(value: number | null, provisional: boolean): string {
  if (value === null) return "TIDAK LENGKAP";
  const sign = value < 0 ? "losses" : value > 0 ? "gain" : "tanpa selisih";
  return `${sign}${provisional ? " · SEMENTARA" : ""}`;
}
