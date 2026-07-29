/**
 * Pembangun URL rute per-unit — MURNI (tanpa import server/next) agar teruji
 * langsung. Dipakai oleh filter MILIK HALAMAN (UnitDateFilters) menggantikan
 * regex navigasi yang dulu tertanam di TopbarPicker.
 *
 * Catatan batas: berkas ini hanya MEMBANGUN URL. Semantik PARSING tetap milik
 * `selection-keys.ts` (regex rute untuk cermin picker) dan tidak disentuh —
 * itulah berkas yang jadi akar bug desync (PR #73).
 */

/** Rute yang membawa kode unit di PATH. */
export type UnitRouteSegment = "rincian" | "laporan" | "usulan" | "denah";

export function unitRouteHref(args: {
  segment: UnitRouteSegment;
  code: string;
  /** Wajib untuk segmen ber-tanggal; diabaikan untuk `denah` (realtime). */
  date?: string;
  /** Sub-rute form usulan (`/edit`) — dipertahankan saat unit/tanggal berganti. */
  edit?: boolean;
  /** Query string yang dipertahankan apa adanya, TANPA `?` (mis. `view=ringkas`). */
  query?: string;
}): string {
  const { segment, code, date, edit, query } = args;
  const suffix = query ? `?${query}` : "";
  if (segment === "denah") return `/monitoring/denah/${code}${suffix}`;
  const edt = segment === "usulan" && edit ? "/edit" : "";
  return `/unit/${code}/${segment}/${date}${edt}${suffix}`;
}
