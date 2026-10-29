/**
 * Pembantu bulan kalender `YYYY-MM` — MURNI, tanpa I/O, BUKAN "use server".
 * Tanggal bisnis tanpa jam: dihitung di UTC supaya tak bergeser zona.
 */

export const BULAN_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Bulan `YYYY-MM` sah? */
export function bulanSah(bulan: string): boolean {
  return BULAN_RE.test(bulan);
}

const dua = (n: number): string => String(n).padStart(2, "0");

/** Tahun, bulan, dan jumlah harinya — melempar bila bukan `YYYY-MM`. */
function urai(bulan: string): { y: number; m: number; n: number } {
  const x = BULAN_RE.exec(bulan);
  if (!x) throw new Error(`Bulan harus YYYY-MM, diterima "${bulan}".`);
  const y = Number(x[1]);
  const m = Number(x[2]);
  return { y, m, n: new Date(Date.UTC(y, m, 0)).getUTCDate() };
}

/** 'YYYY-MM' → [awal, akhir] inklusif. */
export function rentangBulan(bulan: string): [string, string] {
  const { n } = urai(bulan);
  return [`${bulan}-01`, `${bulan}-${dua(n)}`];
}

/** Semua hari kalender `YYYY-MM`. */
export function hariDalamBulan(bulan: string): string[] {
  const { n } = urai(bulan);
  return Array.from({ length: n }, (_, i) => `${bulan}-${dua(i + 1)}`);
}

/** Hari terakhir bulan `YYYY-MM`. */
export function hariTerakhir(bulan: string): string {
  return rentangBulan(bulan)[1];
}

/** Bulan ke-`n` sebelum (negatif) / sesudah (positif) `YYYY-MM`. Tak memvalidasi. */
export function geserBulan(bulan: string, n: number): string {
  const [y, m] = bulan.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${dua(d.getUTCMonth() + 1)}`;
}
