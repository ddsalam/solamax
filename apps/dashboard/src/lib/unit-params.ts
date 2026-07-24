/**
 * Aturan intersect unit dari URL × unit ber-scope — MURNI, tanpa import server.
 *
 * SATU-SATUNYA salinan aturan ini (diekstrak dari board-params.ts, keputusan owner
 * 2026-07-24 D1): menduplikasi filter keamanan ke berkas kedua adalah cara klasik
 * agar satu salinan diam-diam salah kemudian hari. Dipakai `/board`
 * (parseBoardParams) dan `/laporan-harian` (parseHarianParams).
 *
 * KEAMANAN (keputusan FASE 0 №3, tak berubah): kode unit dari URL WAJIB
 * di-intersect dengan unit ber-scope caller — user TIDAK BISA memilih unit di luar
 * scope-nya lewat URL. Hasil intersect kosong / param absen → fallback SEMUA unit
 * ber-scope (URL shareable terdegradasi anggun, tanpa membocorkan keberadaan unit
 * asing lewat 404 yang berbeda).
 */
import type { ScopedUnit } from "./scope-rule";

export interface UnitSelection {
  /** Unit terpilih — SELALU ⊆ scope caller, urutan mengikuti scope. */
  units: ScopedUnit[];
  /** true bila semua unit ber-scope terpilih (default). */
  allUnits: boolean;
}

export function intersectScopedUnits(
  raw: string | undefined,
  scopeUnits: ScopedUnit[],
): UnitSelection {
  const requested = new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
  const picked = scopeUnits.filter((u) => requested.has(u.code));
  const units = picked.length > 0 ? picked : scopeUnits;
  return { units, allUnits: units.length === scopeUnits.length };
}
