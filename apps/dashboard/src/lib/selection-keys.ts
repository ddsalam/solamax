/**
 * Nama cookie pilihan unit+tanggal terbawa. File ini SENGAJA tanpa import
 * server (mis. next/headers) agar aman diimpor dari komponen client
 * (TopbarPicker) maupun server (selection.ts).
 */
export const UNIT_COOKIE = "solamax.unit";
export const DATE_COOKIE = "solamax.date";

/** Umur cookie (detik) — 30 hari. */
export const SELECTION_MAX_AGE = 60 * 60 * 24 * 30;

const REPORT_ROUTE_RE = /^\/unit\/([^/]+)\/(?:laporan|rincian|usulan)\/(\d{4}-\d{2}-\d{2})/;

/**
 * Sumber nilai TAMPIL picker unit+tanggal. Di rute laporan
 * (`/unit/[code]/{laporan,rincian}/[date]`) URL adalah OTORITAS → picker WAJIB
 * cermin URL, BUKAN cookie/seed. (Akar bug: layout grup `(app)` tak re-render saat
 * pindah sub-rute → prop cookie basi → `<input value>` controlled tetap basi →
 * desync. `usePathname()` berubah tiap navigasi → komponen client re-render dgn
 * nilai segar walau layout server tidak.) Di rute grup-wide (board/ketaatan/
 * beranda/denah) → pakai seed cookie.
 */
export function deriveTopbarSelection(
  path: string,
  seedUnit: string | undefined,
  seedDate: string,
): { unit: string | undefined; date: string; onReportRoute: boolean } {
  const m = REPORT_ROUTE_RE.exec(path);
  if (m) return { unit: m[1], date: m[2]!, onReportRoute: true };
  return { unit: seedUnit, date: seedDate, onReportRoute: false };
}
