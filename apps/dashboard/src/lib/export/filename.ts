/**
 * Pembangun nama file laporan yang dapat dipahami di luar aplikasi.
 * Struktur (Prinsip 3): {report-name}_{scope}_{period}_{generated-date}.pdf
 *   scope   = unit SPBU (kode), diprefiks "SPBU-"
 *   period  = tanggal/bulan laporan (mis. 2026-06-11)
 *   generated = tanggal hari ini (WIB, mis. 2026-07-01)
 * Tidak membocorkan rahasia/PII (hanya kode unit + tanggal). Murni & testable.
 */
export interface ReportFilenameParts {
  /** Nama laporan, mis. "Rincian-Penjualan". */
  reportName: string;
  /** Kode unit SPBU (scope), mis. "6478111". */
  unitCode: string;
  /** Periode laporan ISO, mis. "2026-06-11". */
  period: string;
  /** Tanggal dibuat (WIB) ISO, mis. "2026-07-01". */
  generated: string;
}

/** Sanitasi satu segmen: sisakan alnum + dash, ganti sisanya dgn dash. */
function seg(s: string): string {
  return (
    s
      .normalize("NFKD")
      .replace(/[^\w-]+/g, "-") // non [A-Za-z0-9_-] → dash
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "x"
  );
}

export function buildReportFilename(parts: ReportFilenameParts): string {
  const scope = `SPBU-${seg(parts.unitCode)}`;
  const bits = [seg(parts.reportName), scope, seg(parts.period), seg(parts.generated)];
  return `${bits.join("_")}.pdf`;
}
